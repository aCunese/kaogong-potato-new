// ==============================================================================
// 考公工作台 · 版本检查与更新管线（针对只读审查 R16 / R17 的真实修复）
// ==============================================================================
// 设计要点：
//
// R16（失败/缓存结果绝不能被当成“最新”）：
//   1. 状态严格区分：checking / latest / update_available / offline / failed / unrecognized；
//      HTTP 5xx、超时、网络异常、JSON 非法、SW 缓存回退、nonce 不匹配 => failed/offline，绝不 latest。
//   2. 网络新鲜度证明：请求 /version.json?nonce=<一次性随机值>，服务端必须回显同一 nonce（+ servedAt）。
//      回显缺失或不一致 => 说明拿到的是 Service Worker / HTTP 缓存中的陈旧响应 => failed(ERROR_STALE_RESPONSE)。
//      （public/sw.js 同时对 /version.json 与 /api/version 改为网络直通、绝不缓存回退，双保险。）
//   3. 30 分钟真实节流：以上一次“网络新鲜核验成功”的时间为准，lastVerifiedAt 持久化到 localStorage；
//      manual=true 手动检查绕过节流；并发调用共享同一个 in-flight Promise（去重）。
//
// R17（自动检查 / Web 与 APK 动作 / 保护统一）：
//   4. 原生环境：调用 AndroidBridge.getAppInfo()（桥协议 2），使用整数 versionCode 比较，
//      并校验 apkPackageName / apkCertFingerprint / apkSha256 / apkDownloadUrl 元数据完整性；
//      桥存在但抛异常、JSON 非法、页面不受信、版本号为空 => unrecognized（绝不回退成浏览器 Web 判断）。
//   5. 浏览器 / 纯 Web 环境：只比较 Web 构建号，只走 Service Worker 热更新，绝不在“网页更新”场景下载 APK。
//   6. 旧版容器（协议 1 或无桥）=> unrecognized，展示官方安装包地址 + 复制官方地址路径，
//      window.open 仅作为“尝试唤起系统浏览器”，不承诺成功。
//   7. applyWebUpdate() 只有在观测到 Service Worker 状态变化（waiting 激活 / controllerchange）后才返回成功；
//      绝不清理 IndexedDB、账号缓存或业务数据。
// ==============================================================================

// 统一发布配置来源：仓库根目录 release.json（Web 版本 / 构建号与 APK 元数据同源）。
// 禁止在本文件硬编码版本号。
import releaseInfo from '../../release.json';

export type UpdateCheckStatus =
  | 'checking'
  | 'latest'
  | 'update_available'
  | 'offline'
  | 'failed'
  | 'unrecognized';

/** 旧兼容状态集合（历史代码曾包含 idle） */
export type LegacyUpdateCheckStatus = UpdateCheckStatus | 'idle';

/** 30 分钟真实节流窗口 */
export const UPDATE_CHECK_THROTTLE_MS = 30 * 60 * 1000;

/** 当前 Web 运行版本（唯一来源：release.json） */
export const CURRENT_WEB_VERSION: string = releaseInfo.webVersion;
/** 当前 Web 构建号（唯一 Web 版本比较依据；不要在其他逻辑里硬编码构建号） */
export const CURRENT_WEB_BUILD: string = releaseInfo.webBuild;

/** 服务端版本接口返回体（已通过新鲜度校验的规范化结构） */
export interface RemoteVersionInfo {
  version: string;
  build: string;
  schemaVersion: number;
  nonce?: string;
  servedAt?: string;
  apkVersion?: string;
  apkVersionCode?: number;
  apkDownloadUrl?: string;
  apkSha256?: string;
  apkSizeBytes?: number;
  apkPackageName?: string;
  apkCertFingerprint?: string;
  deployedAt?: string;
  summary?: string;
}

/** UpdateCheckResult.remoteInfo 类型（与服务端字段契约保持一致） */
export interface UpdateRemoteInfo {
  version: string;
  build: string;
  apkVersion?: string;
  apkVersionCode?: number;
  apkDownloadUrl?: string;
  apkSha256?: string;
  apkSizeBytes?: number;
  apkPackageName?: string;
  apkCertFingerprint?: string;
  summary?: string;
}

export interface NativeAppInfo {
  versionCode: number;
  versionName: string;
  packageName: string;
}

/** 新版原生桥（桥协议 >= 2）返回的完整信息 */
export interface NativeBridgeInfo {
  protocol: number;
  available: boolean;
  trusted: boolean;
  versionCode: number;
  versionName: string;
  packageName: string;
  certSha256?: string;
  certFingerprint?: string;
  installPermission: 'granted' | 'denied' | 'unknown';
  sdkInt?: number;
  state?: string;
  reason?: string;
}

export interface UpdateCheckResult {
  status: UpdateCheckStatus;
  checkedAt: string;
  source: 'web' | 'native' | 'unknown';
  installedVersionName?: string;
  installedVersionCode?: number;
  remoteInfo?: UpdateRemoteInfo;
  webUpdateAvailable?: boolean;
  /** 云端是否存在更高 versionCode 的 APK（原生环境下使用） */
  apkUpdateAvailable?: boolean;
  cacheState?: 'fresh' | 'stale-fallback' | 'none';
  errorCode?: string;
  message?: string;
  /** 结果是否来自 30 分钟节流缓存（true 时 checkedAt 为上次成功核验时间） */
  fromCache?: boolean;
}

/** 旧接口兼容返回体（SettingsView 等历史代码继续使用） */
export interface CheckUpdateResult {
  status: LegacyUpdateCheckStatus;
  message: string;
  remoteInfo?: RemoteVersionInfo | null;
  installedVersionName?: string;
  installedVersionCode?: number;
  hasNativeBridge: boolean;
}

export interface UpdateGuardResult {
  ok: boolean;
  reason?: string;
}
export type UpdateGuard = () => UpdateGuardResult;

export interface ApplyWebUpdateOptions {
  /** App 层保护：计时器运行中 / 写入未持久化 / 待同步队列非空 / 冲突未处理时返回 ok:false */
  canActivate?: UpdateGuard;
}

export interface ApplyWebUpdateResult {
  ok: boolean;
  message: string;
  controllerChanged?: boolean;
}

declare global {
  interface Window {
    AndroidBridge?: {
      getAppInfo?: () => string; // returns JSON
      getInstallPermissionStatus?: () => string; // returns JSON
      requestInstallPermission?: () => void;
      installApk?: (downloadUrl: string, expectedSha256: string) => void;
      installApkVerified?: (requestJson: string) => void;
      cancelApkDownload?: () => void;
    };
    __kaogongAndroidEvent?: (payload: string) => void;
  }
}

// ------------------------------------------------------------------------------
// 原生桥事件
// ------------------------------------------------------------------------------

export type NativeUpdateEventType =
  | 'download_started'
  | 'download_progress'
  | 'download_failed'
  | 'verification_started'
  | 'verification_failed'
  | 'install_ready'
  | 'installer_launched'
  | 'install_permission_required'
  | 'cancelled'
  | 'update_busy'
  | 'download_needs_bridge'
  | 'bridge_error';

export interface NativeUpdateEvent {
  type: NativeUpdateEventType;
  message?: string;
  errorCode?: string;
  reason?: string;
  downloadId?: number;
  downloaded?: number;
  total?: number;
  percent?: number;
  versionCode?: number;
  versionName?: string;
  packageName?: string;
  certFingerprint?: string;
  sha256?: string;
  retryable?: boolean;
  [key: string]: unknown;
}

const nativeEventListeners = new Set<(event: NativeUpdateEvent) => void>();
let nativeEventHookInstalled = false;

function ensureNativeEventHook(): void {
  if (nativeEventHookInstalled || typeof window === 'undefined') return;
  nativeEventHookInstalled = true;
  window.__kaogongAndroidEvent = (payload: string): void => {
    let event: NativeUpdateEvent | null = null;
    try {
      const parsed = JSON.parse(payload);
      if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string') {
        event = parsed as NativeUpdateEvent;
      }
    } catch {
      return;
    }
    if (!event) return;
    for (const listener of Array.from(nativeEventListeners)) {
      try {
        listener(event);
      } catch (err) {
        console.warn('[versionCheck] native event listener failed:', err);
      }
    }
  };
}

/** 订阅原生安装/下载事件（下载进度、校验失败、安装器调起等） */
export function onNativeInstallEvent(listener: (event: NativeUpdateEvent) => void): () => void {
  ensureNativeEventHook();
  nativeEventListeners.add(listener);
  return () => {
    nativeEventListeners.delete(listener);
  };
}

// ------------------------------------------------------------------------------
// 原生桥读取（永不调用 WebView API；桥线程违规由 Java 端修复）
// ------------------------------------------------------------------------------

function hasAndroidBridge(): boolean {
  return typeof window !== 'undefined'
    && Boolean(window.AndroidBridge)
    && typeof window.AndroidBridge === 'object';
}

/** 读取原生桥信息；无桥返回 null；桥存在但异常返回 available:false 的诊断对象（不抛异常） */
export function getNativeBridgeInfo(): NativeBridgeInfo | null {
  if (!hasAndroidBridge()) return null;
  const bridge = window.AndroidBridge;
  if (!bridge || typeof bridge.getAppInfo !== 'function') {
    return {
      protocol: 0,
      available: false,
      trusted: false,
      versionCode: 0,
      versionName: '',
      packageName: '',
      installPermission: 'unknown',
      reason: 'bridge_missing_method',
    };
  }

  let raw: unknown;
  try {
    raw = bridge.getAppInfo();
  } catch (err) {
    // 旧版容器在 JavascriptInterface 线程调用 WebView.getUrl() 会抛 RuntimeException（R13）
    console.warn('[versionCheck] AndroidBridge.getAppInfo 调用失败:', err);
    return {
      protocol: 0,
      available: false,
      trusted: false,
      versionCode: 0,
      versionName: '',
      packageName: '',
      installPermission: 'unknown',
      reason: 'bridge_error',
    };
  }

  let parsed: Record<string, unknown>;
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!obj || typeof obj !== 'object') throw new Error('empty bridge payload');
    parsed = obj as Record<string, unknown>;
  } catch (err) {
    console.warn('[versionCheck] 解析原生桥信息失败:', err, raw);
    return {
      protocol: 0,
      available: false,
      trusted: false,
      versionCode: 0,
      versionName: '',
      packageName: '',
      installPermission: 'unknown',
      reason: 'bridge_invalid_json',
    };
  }

  const protocol = typeof parsed.bridgeProtocol === 'number' ? parsed.bridgeProtocol : 1; // 旧桥无协议字段
  const available = protocol >= 2 ? parsed.available === true : true;
  const trusted = protocol >= 2 ? parsed.trusted === true : true;
  const versionCode = typeof parsed.versionCode === 'number' && Number.isFinite(parsed.versionCode)
    ? Math.trunc(parsed.versionCode)
    : 0;
  const versionName = typeof parsed.versionName === 'string' ? parsed.versionName : '';
  const packageName = typeof parsed.packageName === 'string' ? parsed.packageName : '';
  const certFingerprint = typeof parsed.certFingerprint === 'string' ? parsed.certFingerprint : undefined;
  const certSha256 = typeof parsed.certSha256 === 'string' ? parsed.certSha256 : undefined;
  const installPermission: 'granted' | 'denied' | 'unknown' =
    parsed.installPermission === 'granted' || parsed.installPermission === 'denied'
      ? parsed.installPermission
      : 'unknown';
  const reason = typeof parsed.reason === 'string' ? parsed.reason : undefined;

  return {
    protocol,
    available,
    trusted,
    versionCode,
    versionName,
    packageName,
    certSha256,
    certFingerprint,
    installPermission,
    sdkInt: typeof parsed.sdkInt === 'number' ? parsed.sdkInt : undefined,
    state: typeof parsed.state === 'string' ? parsed.state : undefined,
    reason,
  };
}

/** 兼容导出：仅当桥可用且读到有效版本号时返回 */
export function getNativeAppInfo(): NativeAppInfo | null {
  const bridge = getNativeBridgeInfo();
  if (!bridge || !bridge.available || bridge.versionCode <= 0) return null;
  return {
    versionCode: bridge.versionCode,
    versionName: bridge.versionName,
    packageName: bridge.packageName,
  };
}

/** 是否为缺少现代桥接的旧版 Android WebView 容器 */
export function isLegacyAndroidWebView(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (hasAndroidBridge()) return false;
  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const isWebView = /;\s*wv\)/i.test(ua) || (/Version\/[0-9.]+/i.test(ua) && /Chrome\/[0-9.]+/i.test(ua));
  return isAndroid && isWebView;
}

// ------------------------------------------------------------------------------
// 工具函数
// ------------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-fA-F0-9]{64}$/.test(value.trim());
}

export function normalizeCertFingerprint(value: string | undefined | null): string {
  if (!value) return '';
  return value.replace(/[:\s]/g, '').toUpperCase();
}

/** Web 构建号比较：兼容 YYYYMMDD.NN / 数字段；非法格式退化为字符串比较 */
export function compareBuildNumbers(a: string, b: string): number {
  const pattern = /^(\d{4,8})\.(\d+)$/;
  const matchA = pattern.exec(a);
  const matchB = pattern.exec(b);
  if (matchA && matchB) {
    const majorA = Number(matchA[1]);
    const majorB = Number(matchB[1]);
    if (majorA !== majorB) return majorA > majorB ? 1 : -1;
    const minorA = Number(matchA[2]);
    const minorB = Number(matchB[2]);
    if (minorA !== minorB) return minorA > minorB ? 1 : -1;
    return 0;
  }
  if (a === b) return 0;
  return a > b ? 1 : -1;
}

function isRemoteBuildNewer(remoteBuild: string, currentBuild: string): boolean {
  return compareBuildNumbers(remoteBuild, currentBuild) > 0;
}

function generateNonce(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // ignore
  }
  return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function safeGuard(guard?: UpdateGuard): UpdateGuardResult | null {
  if (!guard) return null;
  try {
    const result = guard();
    if (!result || typeof result.ok !== 'boolean') return { ok: false, reason: '更新保护检查返回值非法' };
    return result;
  } catch (err) {
    return { ok: false, reason: `更新保护检查异常：${err instanceof Error ? err.message : String(err)}` };
  }
}

// ------------------------------------------------------------------------------
// localStorage 持久化（节流时间 / 上次结果 / 更新横幅关闭状态）
// ------------------------------------------------------------------------------

const STORAGE_KEY_STATE = 'kaogong.updateCheck.state.v1';
const STORAGE_KEY_DISMISS_PREFIX = 'kaogong.updateBanner.dismissed.';

function readStorage(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, value);
  } catch {
    // 隐私模式等场景静默降级为内存节流
  }
}

interface PersistedCheckState {
  verifiedAt: number;
  result: UpdateCheckResult;
}

let lastVerifiedAt = 0;
let cachedResult: UpdateCheckResult | null = null;
let stateRestored = false;

function restorePersistedState(): void {
  if (stateRestored) return;
  stateRestored = true;
  const raw = readStorage(STORAGE_KEY_STATE);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as PersistedCheckState;
    if (parsed && typeof parsed.verifiedAt === 'number' && parsed.result && typeof parsed.result === 'object') {
      lastVerifiedAt = parsed.verifiedAt;
      cachedResult = parsed.result;
    }
  } catch {
    // 忽略损坏缓存
  }
}

function persistSuccessfulResult(result: UpdateCheckResult): void {
  lastVerifiedAt = Date.now();
  cachedResult = result;
  try {
    const payload: PersistedCheckState = { verifiedAt: lastVerifiedAt, result };
    writeStorage(STORAGE_KEY_STATE, JSON.stringify(payload));
  } catch {
    // 结果可序列化性异常时不影响主流程
  }
}

function persistUnverifiedResult(result: UpdateCheckResult): void {
  cachedResult = result;
}

/** 读取上次版本检查结果（可能来自 30 分钟节流缓存/上个会话） */
export function getCachedUpdateResult(): UpdateCheckResult | null {
  restorePersistedState();
  return cachedResult;
}

function isThrottleActive(): boolean {
  restorePersistedState();
  if (lastVerifiedAt <= 0) return false;
  return Date.now() - lastVerifiedAt < UPDATE_CHECK_THROTTLE_MS;
}

/** 测试/调试辅助：清空节流与缓存状态 */
export function resetUpdateCheckState(): void {
  lastVerifiedAt = 0;
  cachedResult = null;
  stateRestored = true;
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY_STATE);
  } catch {
    // ignore
  }
}

/** 标记某个版本号的更新横幅已被用户关闭 */
export function markUpdateBannerDismissed(versionKey: string): void {
  if (!versionKey) return;
  writeStorage(`${STORAGE_KEY_DISMISS_PREFIX}${versionKey}`, new Date().toISOString());
}

/** 查询某个版本号的更新横幅是否已被用户关闭 */
export function isUpdateBannerDismissed(versionKey: string): boolean {
  if (!versionKey) return false;
  return readStorage(`${STORAGE_KEY_DISMISS_PREFIX}${versionKey}`) !== null;
}

// ------------------------------------------------------------------------------
// 网络请求 + 新鲜度证明（R16 核心）
// ------------------------------------------------------------------------------

const VERSION_FETCH_TIMEOUT_MS = 10000;

interface FetchError {
  code: string;
  message: string;
  offline: boolean;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      try {
        if (controller) controller.abort();
      } catch {
        // ignore
      }
      reject(new Error('TIMEOUT'));
    }, timeoutMs);
  });
  try {
    const fetchPromise = fetch(url, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      signal: controller ? controller.signal : undefined,
    });
    return await Promise.race([fetchPromise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface FetchSuccess {
  info: RemoteVersionInfo;
  nonce: string;
}

type FetchOutcome = FetchSuccess | { error: FetchError };

function normalizeRemoteVersionInfo(data: unknown, nonce: string): RemoteVersionInfo | null {
  if (!isObject(data)) return null;

  // 必填字段
  if (typeof data.version !== 'string' || data.version.trim() === '') return null;
  if (typeof data.build !== 'string' || data.build.trim() === '') return null;
  if (typeof data.schemaVersion !== 'number') return null;

  // R16：网络新鲜度证明 —— 服务端必须回显本次请求的 nonce
  if (typeof data.nonce !== 'string' || data.nonce !== nonce) return null;

  const info: RemoteVersionInfo = {
    version: data.version.trim(),
    build: data.build.trim(),
    schemaVersion: data.schemaVersion,
    nonce: data.nonce,
  };
  if (typeof data.servedAt === 'string') info.servedAt = data.servedAt;
  if (typeof data.deployedAt === 'string') info.deployedAt = data.deployedAt;
  if (typeof data.summary === 'string') info.summary = data.summary;
  if (typeof data.apkVersion === 'string') info.apkVersion = data.apkVersion;
  if (typeof data.apkVersionCode === 'number' && Number.isFinite(data.apkVersionCode)) {
    info.apkVersionCode = Math.trunc(data.apkVersionCode);
  } else if (data.apkVersionCode !== undefined && data.apkVersionCode !== null) {
    return null; // 字段存在但类型非法：元数据损坏，不能用于判断“最新”
  }
  if (typeof data.apkDownloadUrl === 'string') info.apkDownloadUrl = data.apkDownloadUrl;
  if (typeof data.apkSha256 === 'string') info.apkSha256 = data.apkSha256;
  if (typeof data.apkSizeBytes === 'number' && Number.isFinite(data.apkSizeBytes)) {
    info.apkSizeBytes = Math.trunc(data.apkSizeBytes);
  }
  if (typeof data.apkPackageName === 'string') info.apkPackageName = data.apkPackageName;
  if (typeof data.apkCertFingerprint === 'string') info.apkCertFingerprint = data.apkCertFingerprint;
  return info;
}

async function fetchRemoteVersionInfo(): Promise<FetchOutcome> {
  const nonce = generateNonce();
  const url = `/version.json?nonce=${encodeURIComponent(nonce)}&_t=${Date.now()}`;

  let response: Response;
  try {
    response = await fetchWithTimeout(url, VERSION_FETCH_TIMEOUT_MS);
  } catch (err) {
    const isTimeout = err instanceof Error && err.message === 'TIMEOUT';
    return {
      error: {
        code: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
        message: isTimeout ? '版本核验请求超时（10 秒）' : '无法连接版本服务器（网络异常或服务器不可达）',
        offline: !isTimeout,
      },
    };
  }

  if (!response.ok) {
    return {
      error: {
        code: `HTTP_${response.status}`,
        message: `版本服务器返回异常状态 HTTP ${response.status}`,
        offline: false,
      },
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      error: {
        code: 'INVALID_JSON',
        message: '版本服务器返回内容不是合法 JSON',
        offline: false,
      },
    };
  }

  const info = normalizeRemoteVersionInfo(payload, nonce);
  if (!info) {
    // 可能是 nonce 不匹配（SW/HTTP 缓存回退），也可能是字段非法
    const nonceEchoed = isObject(payload) && typeof payload.nonce === 'string' && payload.nonce === nonce;
    return {
      error: {
        code: nonceEchoed ? 'INVALID_REMOTE_METADATA' : 'ERROR_STALE_RESPONSE',
        message: nonceEchoed
          ? '版本服务器返回的元数据字段非法，无法进行可信比较'
          : '版本响应未回显本次请求的 nonce，判定为缓存/陈旧响应，已拒绝将其当作最新版本',
        offline: false,
      },
    };
  }
  return { info, nonce };
}

// ------------------------------------------------------------------------------
// 判断逻辑
// ------------------------------------------------------------------------------

function toUpdateRemoteInfo(remote: RemoteVersionInfo): UpdateRemoteInfo {
  return {
    version: remote.version,
    build: remote.build,
    apkVersion: remote.apkVersion,
    apkVersionCode: remote.apkVersionCode,
    apkDownloadUrl: remote.apkDownloadUrl,
    apkSha256: remote.apkSha256,
    apkSizeBytes: remote.apkSizeBytes,
    apkPackageName: remote.apkPackageName,
    apkCertFingerprint: remote.apkCertFingerprint,
    summary: remote.summary,
  };
}

interface BaseResult {
  checkedAt: string;
  source: 'web' | 'native' | 'unknown';
}

/** 原生（APK 容器）环境判断：整数 versionCode + 元数据完整性 + 包名/证书一致性 */
function decideNativeResult(
  bridge: NativeBridgeInfo,
  remote: RemoteVersionInfo,
  base: BaseResult,
): UpdateCheckResult {
  const remoteInfo = toUpdateRemoteInfo(remote);
  const installedVersionCode = bridge.versionCode;
  const installedVersionName = bridge.versionName || String(bridge.versionCode);
  const webUpdateAvailable = isRemoteBuildNewer(remote.build, CURRENT_WEB_BUILD);
  const common: Omit<UpdateCheckResult, 'status'> = {
    ...base,
    remoteInfo,
    installedVersionCode,
    installedVersionName,
    webUpdateAvailable,
    apkUpdateAvailable: false,
    cacheState: 'fresh',
  };

  // 包名一致性（防止把别的应用的安装包当成更新）
  if (remote.apkPackageName && bridge.packageName && remote.apkPackageName !== bridge.packageName) {
    return {
      ...common,
      status: 'failed',
      errorCode: 'RELEASE_PACKAGE_MISMATCH',
      message: `云端安装包包名(${remote.apkPackageName})与当前安装应用(${bridge.packageName})不一致，已停止更新判断`,
    };
  }

  // 签名证书一致性（两端都能读取时）
  if (remote.apkCertFingerprint && bridge.certFingerprint) {
    if (normalizeCertFingerprint(remote.apkCertFingerprint) !== normalizeCertFingerprint(bridge.certFingerprint)) {
      return {
        ...common,
        status: 'failed',
        errorCode: 'RELEASE_CERT_MISMATCH',
        message: '云端声明的签名证书与当前已安装应用证书不一致，为防伪装更新已停止判断，请重新安装官方正版',
      };
    }
  }

  const remoteVersionCode = remote.apkVersionCode;
  if (remoteVersionCode === undefined) {
    if (webUpdateAvailable) {
      return {
        ...common,
        status: 'update_available',
        message: `发现网页资源新版本（${CURRENT_WEB_BUILD} → ${remote.build}）；云端未提供合法 apkVersionCode，无法判断安装包更新`,
      };
    }
    return {
      ...common,
      status: 'failed',
      errorCode: 'INVALID_APK_METADATA',
      message: '云端版本元数据缺少合法的 apkVersionCode，无法与安装版本比较（不会显示“已是最新”）',
    };
  }

  const apkNewer = remoteVersionCode > installedVersionCode;
  if (apkNewer) {
    if (!isValidSha256(remote.apkSha256)) {
      return {
        ...common,
        status: 'failed',
        errorCode: 'APK_SHA256_MISSING',
        message: '发现 APK 新版本但云端未提供合法的 SHA-256 指纹，出于安全禁止下载安装',
      };
    }
    if (!remote.apkDownloadUrl) {
      return {
        ...common,
        status: 'failed',
        errorCode: 'APK_URL_MISSING',
        message: '发现 APK 新版本但云端未提供安装包下载地址',
      };
    }
    return {
      ...common,
      status: 'update_available',
      apkUpdateAvailable: true,
      message: `发现新版 Android 安装包 v${remote.apkVersion || remote.version}（versionCode ${installedVersionCode} → ${remoteVersionCode}）`,
    };
  }

  if (webUpdateAvailable) {
    return {
      ...common,
      status: 'update_available',
      message: `发现网页资源新版本（${CURRENT_WEB_BUILD} → ${remote.build}）`,
    };
  }

  return {
    ...common,
    status: 'latest',
    message: `已是最新：安装版本 v${installedVersionName} (versionCode ${installedVersionCode})，云端 APK versionCode ${remoteVersionCode}`,
  };
}

/** 浏览器 / 纯 Web 环境判断：只比较 Web 构建号，只走 Service Worker 热更新 */
function decideBrowserResult(remote: RemoteVersionInfo, base: BaseResult): UpdateCheckResult {
  const remoteInfo = toUpdateRemoteInfo(remote);
  const webUpdateAvailable = isRemoteBuildNewer(remote.build, CURRENT_WEB_BUILD);
  const common: Omit<UpdateCheckResult, 'status'> = {
    ...base,
    remoteInfo,
    installedVersionName: CURRENT_WEB_VERSION,
    webUpdateAvailable,
    apkUpdateAvailable: false,
    cacheState: 'fresh',
  };
  if (webUpdateAvailable) {
    return {
      ...common,
      status: 'update_available',
      message: `发现网页新版本 v${remote.version}（构建号 ${CURRENT_WEB_BUILD} → ${remote.build}）`,
    };
  }
  const comparison = compareBuildNumbers(remote.build, CURRENT_WEB_BUILD);
  return {
    ...common,
    status: 'latest',
    message: comparison < 0
      ? `当前运行版本已高于云端发布版本（云端构建号 ${remote.build}），无需更新`
      : `当前已是最新运行版本 v${CURRENT_WEB_VERSION}（构建号 ${CURRENT_WEB_BUILD}）`,
  };
}

// ------------------------------------------------------------------------------
// 主检查入口（R16 / R17）
// ------------------------------------------------------------------------------

let inFlightCheck: Promise<UpdateCheckResult> | null = null;

async function performUpdateCheckInternal(): Promise<UpdateCheckResult> {
  const checkedAt = new Date().toISOString();
  const bridge = getNativeBridgeInfo();
  const legacyWebView = !bridge && isLegacyAndroidWebView();
  const source: 'web' | 'native' | 'unknown' = bridge ? 'native' : legacyWebView ? 'unknown' : 'web';
  const base: BaseResult = { checkedAt, source };

  // 离线（仅作为一个快速提示；navigator.onLine=true 不代表服务器可达，真实失败仍归入 failed）
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const result: UpdateCheckResult = {
      ...base,
      status: 'offline',
      cacheState: 'none',
      errorCode: 'OFFLINE',
      message: '当前设备处于离线状态，无法获取云端发布版本（不会显示“已是最新”）',
    };
    persistUnverifiedResult(result);
    return result;
  }

  const outcome = await fetchRemoteVersionInfo();
  if ('error' in outcome) {
    const error = outcome.error;
    const status: UpdateCheckStatus = error.offline ? 'offline' : 'failed';
    const result: UpdateCheckResult = {
      ...base,
      status,
      cacheState: error.code === 'ERROR_STALE_RESPONSE' ? 'stale-fallback' : 'none',
      errorCode: error.code,
      message: error.message,
    };
    persistUnverifiedResult(result);
    return result;
  }

  const remote = outcome.info;

  // 原生桥存在：只走原生判断；桥异常 => unrecognized，绝不回退成浏览器判断
  if (bridge) {
    if (!bridge.available || bridge.versionCode <= 0) {
      const reasonCode = bridge.reason === 'untrusted_page'
        ? 'BRIDGE_UNTRUSTED_PAGE'
        : bridge.reason === 'bridge_error'
          ? 'BRIDGE_CALL_FAILED'
          : bridge.reason || 'BRIDGE_UNAVAILABLE';
      const result: UpdateCheckResult = {
        ...base,
        status: 'unrecognized',
        remoteInfo: toUpdateRemoteInfo(remote),
        cacheState: 'fresh',
        errorCode: reasonCode,
        message: '原生版本桥接不可用或返回异常，无法识别当前安装版本。请通过官方安装包地址在系统浏览器覆盖安装最新正式版',
      };
      persistSuccessfulResult(result);
      return result;
    }
    const result = decideNativeResult(bridge, remote, base);
    persistSuccessfulResult(result);
    return result;
  }

  if (legacyWebView) {
    const result: UpdateCheckResult = {
      ...base,
      status: 'unrecognized',
      remoteInfo: toUpdateRemoteInfo(remote),
      cacheState: 'fresh',
      errorCode: 'LEGACY_WEBVIEW_NO_BRIDGE',
      message: '当前 Android 容器为旧版本，缺少原生版本桥接，无法识别安装版本。请复制官方安装包地址，在系统浏览器中下载覆盖安装',
    };
    persistSuccessfulResult(result);
    return result;
  }

  const result = decideBrowserResult(remote, base);
  persistSuccessfulResult(result);
  return result;
}

/**
 * 统一的版本检查入口。
 * - 默认受 30 分钟节流（以上一次网络新鲜核验成功时间为准，跨 reload 持久化）；
 * - manual=true 手动检查绕过节流；
 * - 并发调用共享同一个 in-flight Promise。
 */
export async function checkAppUpdate(options: { manual?: boolean } = {}): Promise<UpdateCheckResult> {
  if (typeof window === 'undefined') {
    return {
      status: 'failed',
      checkedAt: new Date().toISOString(),
      source: 'unknown',
      errorCode: 'NO_WINDOW',
      message: '当前运行环境不支持版本检查',
    };
  }

  if (!options.manual) {
    if (isThrottleActive()) {
      const cached = getCachedUpdateResult();
      if (cached) {
        return { ...cached, fromCache: true };
      }
    }
  }

  if (inFlightCheck) return inFlightCheck;

  inFlightCheck = performUpdateCheckInternal().finally(() => {
    inFlightCheck = null;
  });
  return inFlightCheck;
}

/** 旧接口兼容包装（保留给历史 SettingsView 调用；语义等价于 manual 检查） */
export async function performUpdateCheck(): Promise<CheckUpdateResult> {
  const result = await checkAppUpdate({ manual: true });
  return {
    status: result.status,
    message: result.message || '',
    remoteInfo: result.remoteInfo
      ? {
          ...result.remoteInfo,
          schemaVersion: 3,
        }
      : null,
    installedVersionName: result.installedVersionName,
    installedVersionCode: result.installedVersionCode,
    hasNativeBridge: result.source === 'native',
  };
}

// ------------------------------------------------------------------------------
// Web 热更新（R17：等待可观测的 Service Worker 状态变化，绝不清理本地数据）
// ------------------------------------------------------------------------------

function waitForControllerChange(timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      resolve(false);
      return;
    }
    let settled = false;
    let onChange: (() => void) | null = null;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (onChange) {
        try {
          navigator.serviceWorker.removeEventListener('controllerchange', onChange);
        } catch {
          // ignore
        }
      }
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    onChange = () => finish(true);
    navigator.serviceWorker.addEventListener('controllerchange', onChange);
  });
}

async function waitForWaitingWorker(
  registration: ServiceWorkerRegistration,
  timeoutMs: number,
): Promise<ServiceWorker | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (registration.waiting) return registration.waiting;
    await delay(250);
  }
  return registration.waiting ?? null;
}

/**
 * 应用 Web 热更新：
 *   1. 可选的 App 层保护检查（计时器/写事务/待同步/冲突）；
 *   2. 触发 registration.update()；
 *   3. 等待 waiting worker 或 controllerchange（可观测状态变化，~10 秒超时）；
 *   4. 只有观测到接管才返回 ok:true，随后由调用方刷新页面。
 * 绝不清理 IndexedDB / 账号缓存 / 业务数据。
 */
export async function applyWebUpdate(options: ApplyWebUpdateOptions = {}): Promise<ApplyWebUpdateResult> {
  const guard = safeGuard(options.canActivate);
  if (guard && !guard.ok) {
    return { ok: false, message: guard.reason || '当前存在未完成的任务，已暂缓更新', controllerChanged: false };
  }

  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return {
      ok: false,
      message: '当前运行环境不支持 Service Worker，无法热更新；请重新打开页面获取新版本',
      controllerChanged: false,
    };
  }

  let registration: ServiceWorkerRegistration | null = null;
  try {
    registration = (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    registration = null;
  }
  if (!registration) {
    return {
      ok: false,
      message: '当前页面尚未注册 Service Worker，无法确认新版本资源；请刷新页面后重试',
      controllerChanged: false,
    };
  }

  // 先挂载 controllerchange 监听，再触发更新，避免错过事件
  const controllerChangedPromise = waitForControllerChange(12000);

  const existingWaiting = registration.waiting;
  if (existingWaiting) {
    try {
      existingWaiting.postMessage({ type: 'SKIP_WAITING' });
    } catch {
      // ignore
    }
  }

  try {
    await registration.update();
  } catch {
    // update 失败不直接判死：继续等待是否有已存在的 waiting/installing worker
  }

  const waiting = existingWaiting || (await waitForWaitingWorker(registration, 9000));
  if (waiting) {
    try {
      waiting.postMessage({ type: 'SKIP_WAITING' });
    } catch {
      // ignore
    }
  }

  const controllerChanged = await controllerChangedPromise;
  if (!controllerChanged) {
    return {
      ok: false,
      controllerChanged: false,
      message: '未能观测到新版本 Service Worker 接管页面（可能新版本尚未部署完成、网络中断或浏览器未允许更新）。本地数据与账号缓存未被清理，请稍后重试',
    };
  }
  return {
    ok: true,
    controllerChanged: true,
    message: '新版本资源已完成接管，刷新页面即可应用更新（本地数据与账号缓存不受影响）',
  };
}

// ------------------------------------------------------------------------------
// 原生 APK 安装（R14 / R15 / R17：强校验 + 保护 + 官方地址回退）
// ------------------------------------------------------------------------------

export interface NativeApkInstallOptions {
  /** App 层保护：计时器运行中 / 写入未持久化 / 待同步队列非空 / 冲突未处理时返回 ok:false */
  canActivate?: UpdateGuard;
}

export interface NativeApkInstallResult {
  ok: boolean;
  code: string;
  message: string;
  requiresPermission?: boolean;
}

/** 解析官方安装包绝对地址（用于复制到系统浏览器 / 兜底路径） */
export function getOfficialApkUrl(remote?: UpdateRemoteInfo | null): string {
  const fallbackOrigin = 'https://work.ruyne.space';
  let origin = fallbackOrigin;
  if (typeof window !== 'undefined' && window.location && window.location.origin) {
    origin = window.location.origin;
  }
  const path = remote && remote.apkDownloadUrl ? remote.apkDownloadUrl : '/api/download/apk';
  try {
    return new URL(path, `${origin}/`).toString();
  } catch {
    return `${origin.replace(/\/$/, '')}/api/download/apk`;
  }
}

/** 复制官方安装包地址到剪贴板（无剪贴板 API 时用隐藏 textarea 兜底） */
export async function copyOfficialApkUrl(remote?: UpdateRemoteInfo | null): Promise<boolean> {
  const url = getOfficialApkUrl(remote);
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(url);
      return true;
    }
  } catch {
    // 继续走兜底
  }
  try {
    if (typeof document === 'undefined') return false;
    const textarea = document.createElement('textarea');
    textarea.value = url;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/** 打开系统安装授权页（原生桥可用时） */
export function requestNativeInstallPermission(): boolean {
  if (!hasAndroidBridge() || !window.AndroidBridge) return false;
  try {
    window.AndroidBridge.requestInstallPermission?.();
    return true;
  } catch {
    return false;
  }
}

/** 取消正在进行的原生更新下载（原生桥可用时） */
export function cancelNativeApkInstall(): boolean {
  if (!hasAndroidBridge() || !window.AndroidBridge) return false;
  try {
    window.AndroidBridge.cancelApkDownload?.();
    return true;
  } catch {
    return false;
  }
}

/**
 * 启动原生 APK 安全下载 + 校验 + 系统安装流程。
 * - 必须存在原生桥（否则返回 NO_BRIDGE，调用方引导“复制官方地址到系统浏览器”）；
 * - 支持 canActivate 保护（计时器/写事务/待同步/冲突）；
 * - 要求 URL / SHA-256 / versionCode / 包名 / 证书元数据完整；
 * - 旧协议桥（v1.0.2 容器）仍会调用，但若抛异常则明确返回失败（不伪装成功）。
 */
export async function startNativeApkInstall(
  remote: UpdateRemoteInfo | null | undefined,
  options: NativeApkInstallOptions = {},
): Promise<NativeApkInstallResult> {
  const guard = safeGuard(options.canActivate);
  if (guard && !guard.ok) {
    return { ok: false, code: 'GUARD_BLOCKED', message: guard.reason || '当前存在未完成的任务，已暂缓更新' };
  }

  const bridge = getNativeBridgeInfo();
  if (!bridge) {
    return {
      ok: false,
      code: 'NO_NATIVE_BRIDGE',
      message: '当前不是官方 Android 安装版容器，无法调用系统安装流程；请复制官方安装包地址到系统浏览器下载安装',
    };
  }

  if (!bridge.available || !bridge.trusted) {
    return {
      ok: false,
      code: 'BRIDGE_UNTRUSTED',
      message: '当前页面未通过原生受信校验，已拒绝安装请求；请重新打开官方应用',
    };
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, code: 'OFFLINE', message: '当前设备离线，无法下载安装包；请连接网络后重试' };
  }

  if (!remote) {
    return { ok: false, code: 'NO_REMOTE_METADATA', message: '缺少云端版本元数据，无法发起安全更新' };
  }
  if (!isValidSha256(remote.apkSha256)) {
    return { ok: false, code: 'APK_SHA256_MISSING', message: '云端未提供合法的 SHA-256 完整性指纹，出于安全禁止下载安装' };
  }
  if (!remote.apkDownloadUrl) {
    return { ok: false, code: 'APK_URL_MISSING', message: '云端未提供安装包下载地址' };
  }
  if (typeof remote.apkVersionCode !== 'number' || !Number.isFinite(remote.apkVersionCode)) {
    return { ok: false, code: 'APK_VERSION_CODE_MISSING', message: '云端未提供合法的 apkVersionCode，无法校验安装包版本' };
  }
  if (bridge.versionCode > 0 && remote.apkVersionCode <= bridge.versionCode) {
    return {
      ok: false,
      code: 'VERSION_NOT_INCREMENTED',
      message: `云端安装包 versionCode(${remote.apkVersionCode}) 未高于当前安装版本(${bridge.versionCode})，系统将拒绝覆盖升级`,
    };
  }
  if (remote.apkPackageName && bridge.packageName && remote.apkPackageName !== bridge.packageName) {
    return { ok: false, code: 'PACKAGE_MISMATCH', message: '云端安装包包名与当前应用不一致，已拒绝下载' };
  }
  if (remote.apkCertFingerprint && bridge.certFingerprint
    && normalizeCertFingerprint(remote.apkCertFingerprint) !== normalizeCertFingerprint(bridge.certFingerprint)) {
    return { ok: false, code: 'CERT_MISMATCH', message: '云端声明的签名证书与当前应用证书不一致，已拒绝下载' };
  }

  const bridgeObject = window.AndroidBridge;
  if (!bridgeObject) {
    return { ok: false, code: 'NO_NATIVE_BRIDGE', message: '原生桥接不可用，无法发起安装' };
  }

  // 旧协议桥（v1.0.2 及更早容器）：只有 legacy installApk(url, sha256)，且存在已知线程兼容问题
  if (bridge.protocol < 2) {
    if (typeof bridgeObject.installApk !== 'function') {
      return {
        ok: false,
        code: 'BRIDGE_PROTOCOL_TOO_OLD',
        message: '当前安装版原生桥接版本过旧，无法安全下载。请复制官方安装包地址到系统浏览器下载覆盖安装',
      };
    }
    try {
      bridgeObject.installApk(getOfficialApkUrl(remote), remote.apkSha256);
      return {
        ok: true,
        code: 'LEGACY_BRIDGE',
        message: '已通过旧版容器发起安装包下载（旧容器仅做 SHA-256 校验）；若未出现系统安装提示，请复制官方安装包地址到系统浏览器安装',
      };
    } catch (err) {
      console.warn('[versionCheck] legacy installApk failed:', err);
      return {
        ok: false,
        code: 'BRIDGE_CALL_FAILED',
        message: '旧版容器原生桥接调用失败（升级安装流程存在兼容问题），请复制官方安装包地址到系统浏览器下载覆盖安装',
      };
    }
  }

  // 新协议桥：安装未知应用权限检查
  if (bridge.installPermission === 'denied') {
    requestNativeInstallPermission();
    return {
      ok: false,
      code: 'INSTALL_PERMISSION_REQUIRED',
      requiresPermission: true,
      message: '需要在系统页面允许“安装未知应用”，已打开授权设置；授权完成返回后会自动继续安装',
    };
  }

  if (typeof bridgeObject.installApkVerified !== 'function') {
    return {
      ok: false,
      code: 'BRIDGE_METHOD_MISSING',
      message: '原生桥接缺少强校验安装方法，请复制官方安装包地址到系统浏览器安装',
    };
  }

  const requestPayload = {
    url: getOfficialApkUrl(remote),
    sha256: remote.apkSha256,
    sizeBytes: typeof remote.apkSizeBytes === 'number' ? remote.apkSizeBytes : undefined,
    packageName: remote.apkPackageName || bridge.packageName,
    versionCode: remote.apkVersionCode,
    versionName: remote.apkVersion || remote.version,
    certFingerprint: remote.apkCertFingerprint,
  };

  try {
    bridgeObject.installApkVerified(JSON.stringify(requestPayload));
    return {
      ok: true,
      code: 'STARTED',
      message: '已开始经官方加密通道下载安装包，下载完成后将自动校验并调起系统安装',
    };
  } catch (err) {
    console.warn('[versionCheck] installApkVerified failed:', err);
    return {
      ok: false,
      code: 'BRIDGE_CALL_FAILED',
      message: '原生桥接调用失败，无法启动安全下载；请复制官方安装包地址到系统浏览器安装',
    };
  }
}
