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
  apkReleased?: boolean;
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
  apkReleased?: boolean;
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
  activeOperationId?: string;
  lastTerminalEvent?: NativeUpdateEvent | null;
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
  activeOperationId?: string;
  lastTerminalEvent?: NativeUpdateEvent | null;
  nativeState?: string;
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
  targetBuild?: string;
}

export type WebUpdateStatus = 'failed' | 'download_ready' | 'controlled' | 'needs_reload';

export interface ApplyWebUpdateResult {
  ok: boolean;
  status?: WebUpdateStatus;
  message: string;
  controllerChanged?: boolean;
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
  | 'install_permission_denied'
  | 'install_cancelled'
  | 'install_failed'
  | 'installed'
  | 'cancelled'
  | 'update_busy'
  | 'download_needs_bridge'
  | 'bridge_error';

export interface NativeUpdateEvent {
  type: NativeUpdateEventType;
  message?: string;
  errorCode?: string;
  code?: string;
  resultCode?: number;
  operationId?: string;
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
  const activeOperationId = typeof parsed.activeOperationId === 'string' && parsed.activeOperationId
    ? parsed.activeOperationId
    : undefined;
  let lastTerminalEvent: NativeUpdateEvent | null = null;
  if (parsed.lastTerminalEvent && typeof parsed.lastTerminalEvent === 'object') {
    const rawEvt = parsed.lastTerminalEvent as Record<string, unknown>;
    if (typeof rawEvt.type === 'string') {
      lastTerminalEvent = rawEvt as unknown as NativeUpdateEvent;
    }
  }
  if (!lastTerminalEvent && typeof bridge.getLastTerminalEvent === 'function') {
    try {
      const rawTerm = bridge.getLastTerminalEvent();
      if (rawTerm && typeof rawTerm === 'string') {
        const obj = JSON.parse(rawTerm);
        if (obj && typeof obj === 'object' && typeof obj.type === 'string') {
          lastTerminalEvent = obj as NativeUpdateEvent;
        }
      }
    } catch {
      // ignore
    }
  }

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
    activeOperationId,
    lastTerminalEvent,
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

export interface NativeInstallState {
  state: string;
  activeOperationId?: string;
  lastTerminalEvent: NativeUpdateEvent | null;
  phase: 'idle' | 'downloading' | 'verifying' | 'install_ready' | 'installing' | 'permission' | 'error';
  message: string;
}

/**
 * 读取原生更新状态机当前任务与最近终态。
 * 供弹窗重新打开或检查版本时调用，避免单纯依赖实时广播事件。
 */
export function getNativeInstallState(): NativeInstallState | null {
  const bridge = getNativeBridgeInfo();
  if (!bridge || !bridge.available) return null;

  const state = bridge.state || 'idle';
  const activeOperationId = bridge.activeOperationId;
  const lastTerminalEvent = bridge.lastTerminalEvent || null;

  if (state === 'downloading') {
    return { state, activeOperationId, lastTerminalEvent, phase: 'downloading', message: '正在安全下载更新包...' };
  }
  if (state === 'verifying') {
    return { state, activeOperationId, lastTerminalEvent, phase: 'verifying', message: '正在校验安装包完整性...' };
  }
  if (state === 'ready') {
    return { state, activeOperationId, lastTerminalEvent, phase: 'install_ready', message: '安装包校验全部通过' };
  }
  if (state === 'installer_open') {
    return { state, activeOperationId, lastTerminalEvent, phase: 'installing', message: '已调起系统安装程序，请按系统提示确认覆盖安装' };
  }
  if (state === 'needs_permission') {
    return { state, activeOperationId, lastTerminalEvent, phase: 'permission', message: '需要授予“安装未知应用”权限后才能继续' };
  }

  if (lastTerminalEvent) {
    switch (lastTerminalEvent.type) {
      case 'installed':
        return { state, activeOperationId, lastTerminalEvent, phase: 'idle', message: lastTerminalEvent.message || '应用已成功安装更新' };
      case 'download_failed':
      case 'verification_failed':
      case 'install_failed':
      case 'bridge_error':
        return {
          state,
          activeOperationId,
          lastTerminalEvent,
          phase: 'error',
          message: lastTerminalEvent.message
            || (lastTerminalEvent.errorCode || lastTerminalEvent.code ? `更新失败（${lastTerminalEvent.errorCode || lastTerminalEvent.code}）` : '更新失败，请稍后重试'),
        };
      case 'cancelled':
      case 'install_cancelled':
        return { state, activeOperationId, lastTerminalEvent, phase: 'idle', message: lastTerminalEvent.message || '已取消更新下载' };
      case 'install_permission_denied':
        return { state, activeOperationId, lastTerminalEvent, phase: 'idle', message: lastTerminalEvent.message || '未授予安装未知应用权限' };
      default:
        break;
    }
  }

  return { state, activeOperationId, lastTerminalEvent, phase: 'idle', message: '' };
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

export interface ClientIdentity {
  webVersion: string;
  webBuild: string;
  isNativeApp: boolean;
  appVersionCode?: number;
  appPackageName?: string;
  certFingerprint?: string;
  bridgeProtocol?: number;
}

export function getClientIdentity(): ClientIdentity {
  const bridge = getNativeBridgeInfo();
  const isNative = Boolean(bridge && bridge.available);
  const identity: ClientIdentity = {
    webVersion: CURRENT_WEB_VERSION,
    webBuild: CURRENT_WEB_BUILD,
    isNativeApp: isNative,
  };
  if (isNative && bridge) {
    identity.appVersionCode = bridge.versionCode;
    identity.appPackageName = bridge.packageName;
    identity.certFingerprint = bridge.certFingerprint;
    identity.bridgeProtocol = bridge.protocol;
  }
  return identity;
}

export function isSameClientIdentity(a: ClientIdentity, b: ClientIdentity): boolean {
  return (
    a.webVersion === b.webVersion &&
    a.webBuild === b.webBuild &&
    a.isNativeApp === b.isNativeApp &&
    a.appVersionCode === b.appVersionCode &&
    a.appPackageName === b.appPackageName &&
    a.certFingerprint === b.certFingerprint &&
    a.bridgeProtocol === b.bridgeProtocol
  );
}

export interface PersistedCheckCache {
  verifiedAt: number;
  identity: ClientIdentity;
  remote: UpdateRemoteInfo;
}

let lastVerifiedAt = 0;
let cachedIdentity: ClientIdentity | null = null;
let cachedRemote: UpdateRemoteInfo | null = null;
let stateRestored = false;

function discardCache(): void {
  lastVerifiedAt = 0;
  cachedIdentity = null;
  cachedRemote = null;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY_STATE);
    }
  } catch {
    // ignore
  }
}

function restorePersistedState(): void {
  if (stateRestored) return;
  stateRestored = true;
  const raw = readStorage(STORAGE_KEY_STATE);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.verifiedAt !== 'number') {
      discardCache();
      return;
    }
    if (parsed.identity && parsed.remote && typeof parsed.remote === 'object') {
      const currentIdentity = getClientIdentity();
      if (!isSameClientIdentity(parsed.identity, currentIdentity)) {
        discardCache();
        return;
      }
      lastVerifiedAt = parsed.verifiedAt;
      cachedIdentity = parsed.identity;
      cachedRemote = parsed.remote;
      return;
    }
    // 旧版结构或损坏缓存直接废弃
    discardCache();
  } catch {
    discardCache();
  }
}

function persistSuccessfulCheck(remote: RemoteVersionInfo): void {
  lastVerifiedAt = Date.now();
  cachedIdentity = getClientIdentity();
  cachedRemote = toUpdateRemoteInfo(remote);
  try {
    const payload: PersistedCheckCache = {
      verifiedAt: lastVerifiedAt,
      identity: cachedIdentity,
      remote: cachedRemote,
    };
    writeStorage(STORAGE_KEY_STATE, JSON.stringify(payload));
  } catch {
    // 结果可序列化性异常时不影响主流程
  }
}

function persistUnverifiedResult(_result: UpdateCheckResult): void {
  // 失败态或未验证结果不写入长期节流持久化缓存
}

function evaluateDecisionFromCache(remote: UpdateRemoteInfo, verifiedAt: number): UpdateCheckResult {
  const currentIdentity = getClientIdentity();
  const checkedAt = new Date(verifiedAt).toISOString();
  const fullRemote: RemoteVersionInfo = {
    ...remote,
    schemaVersion: 3,
  };

  if (currentIdentity.isNativeApp) {
    const bridge = getNativeBridgeInfo();
    if (!bridge || !bridge.available) {
      return {
        status: 'unrecognized',
        checkedAt,
        source: 'unknown',
        remoteInfo: remote,
        cacheState: 'fresh',
        fromCache: true,
        errorCode: 'NATIVE_BRIDGE_UNAVAILABLE',
        message: '原生版本桥接不可用，无法识别当前安装版本',
      };
    }
    const res = decideNativeResult(bridge, fullRemote, { checkedAt, source: 'native' });
    return { ...res, fromCache: true };
  }

  const res = decideBrowserResult(fullRemote, { checkedAt, source: 'web' });
  return { ...res, fromCache: true };
}

/** 读取上次版本检查结果（可能来自 30 分钟节流缓存/上个会话，动态重新评估） */
export function getCachedUpdateResult(): UpdateCheckResult | null {
  restorePersistedState();
  if (!cachedRemote || !cachedIdentity) return null;
  if (!isSameClientIdentity(cachedIdentity, getClientIdentity())) {
    discardCache();
    return null;
  }
  return evaluateDecisionFromCache(cachedRemote, lastVerifiedAt);
}

function isThrottleActive(): boolean {
  restorePersistedState();
  if (lastVerifiedAt <= 0 || !cachedRemote || !cachedIdentity) return false;
  if (!isSameClientIdentity(cachedIdentity, getClientIdentity())) {
    discardCache();
    return false;
  }
  return Date.now() - lastVerifiedAt < UPDATE_CHECK_THROTTLE_MS;
}

/** 测试/调试辅助：清空节流与缓存状态 */
export function resetUpdateCheckState(): void {
  lastVerifiedAt = 0;
  cachedIdentity = null;
  cachedRemote = null;
  stateRestored = false;
  discardCache();
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
  if (typeof data.apkReleased === 'boolean') info.apkReleased = data.apkReleased;
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
  const result: UpdateRemoteInfo = {
    version: remote.version,
    build: remote.build,
  };
  if (remote.apkVersion !== undefined) result.apkVersion = remote.apkVersion;
  if (remote.apkVersionCode !== undefined) result.apkVersionCode = remote.apkVersionCode;
  if (remote.apkReleased !== undefined) result.apkReleased = remote.apkReleased;
  if (remote.apkDownloadUrl !== undefined) result.apkDownloadUrl = remote.apkDownloadUrl;
  if (remote.apkSha256 !== undefined) result.apkSha256 = remote.apkSha256;
  if (remote.apkSizeBytes !== undefined) result.apkSizeBytes = remote.apkSizeBytes;
  if (remote.apkPackageName !== undefined) result.apkPackageName = remote.apkPackageName;
  if (remote.apkCertFingerprint !== undefined) result.apkCertFingerprint = remote.apkCertFingerprint;
  if (remote.summary !== undefined) result.summary = remote.summary;
  return result;
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
    activeOperationId: bridge.activeOperationId,
    lastTerminalEvent: bridge.lastTerminalEvent,
    nativeState: bridge.state,
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
    if (remote.apkReleased === false) {
      if (webUpdateAvailable) {
        return {
          ...common,
          status: 'update_available',
          apkUpdateAvailable: false,
          message: `发现网页资源新版本（${CURRENT_WEB_BUILD} → ${remote.build}）；新版 Android 安装包暂未开放下载`,
        };
      }
      return {
        ...common,
        status: 'latest',
        apkUpdateAvailable: false,
        message: `云端存在新版本规划（v${remote.apkVersion || remote.version}），但官方安装包尚未正式发布，暂不提示升级`,
      };
    }
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
      return result;
    }
    const result = decideNativeResult(bridge, remote, base);
    if (result.status === 'latest' || result.status === 'update_available') {
      persistSuccessfulCheck(remote);
    }
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
    return result;
  }

  const result = decideBrowserResult(remote, base);
  if (result.status === 'latest' || result.status === 'update_available') {
    persistSuccessfulCheck(remote);
  }
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

interface ControllerChangeWaitResult {
  changed: boolean;
  blockedByGuard?: UpdateGuardResult;
}

function waitForControllerChange(
  timeoutMs: number,
  canActivate?: UpdateGuard,
): Promise<ControllerChangeWaitResult> {
  return new Promise<ControllerChangeWaitResult>((resolve) => {
    if (
      typeof navigator === 'undefined' ||
      !('serviceWorker' in navigator) ||
      typeof navigator.serviceWorker?.addEventListener !== 'function'
    ) {
      resolve({ changed: false });
      return;
    }
    let settled = false;
    let timer: any = null;
    let intervalTimer: any = null;
    let onChange: (() => void) | null = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (intervalTimer) clearInterval(intervalTimer);
      if (onChange) {
        try {
          navigator.serviceWorker.removeEventListener('controllerchange', onChange);
        } catch {
          // ignore
        }
      }
    };

    const finish = (result: ControllerChangeWaitResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    if (canActivate) {
      const g = safeGuard(canActivate);
      if (g && !g.ok) {
        finish({ changed: false, blockedByGuard: g });
        return;
      }
      intervalTimer = setInterval(() => {
        const check = safeGuard(canActivate);
        if (check && !check.ok) {
          finish({ changed: false, blockedByGuard: check });
        }
      }, 200);
    }

    timer = setTimeout(() => finish({ changed: false }), timeoutMs);
    onChange = () => {
      if (canActivate) {
        const check = safeGuard(canActivate);
        if (check && !check.ok) {
          finish({ changed: false, blockedByGuard: check });
          return;
        }
      }
      finish({ changed: true });
    };

    try {
      navigator.serviceWorker.addEventListener('controllerchange', onChange);
    } catch {
      finish({ changed: false });
    }
  });
}

async function waitForWaitingWorker(
  registration: ServiceWorkerRegistration,
  timeoutMs: number,
  canActivate?: UpdateGuard,
): Promise<{ worker: ServiceWorker | null; blockedByGuard?: UpdateGuardResult }> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (canActivate) {
      const g = safeGuard(canActivate);
      if (g && !g.ok) {
        return { worker: null, blockedByGuard: g };
      }
    }
    if (registration.waiting) return { worker: registration.waiting };
    if (!registration.installing && Date.now() - startedAt >= 400) {
      break;
    }
    await delay(100);
  }
  if (canActivate) {
    const g = safeGuard(canActivate);
    if (g && !g.ok) {
      return { worker: null, blockedByGuard: g };
    }
  }
  return { worker: registration.waiting ?? null };
}

export const STORAGE_KEY_PENDING_RELOAD = 'kaogong_pending_reload_target';
export const STORAGE_KEY_RELOAD_ATTEMPTS = 'kaogong_reload_attempts';
export const MAX_RELOAD_ATTEMPTS = 1;

interface WorkerReleaseInfo {
  type: string;
  cacheName?: string;
  version?: string;
  build?: string;
}

function isWorkerMatchingTarget(
  release: WorkerReleaseInfo | null | undefined,
  targetBuild: string,
): boolean {
  if (!release || !targetBuild) return false;
  if (release.build && release.build === targetBuild) return true;
  if (release.cacheName && release.cacheName.includes(targetBuild)) return true;
  return false;
}

function queryWorkerReleaseInfo(worker: ServiceWorker, timeoutMs = 500): Promise<WorkerReleaseInfo | null> {
  return new Promise((resolve) => {
    try {
      const channel = new MessageChannel();
      let timer: any = null;
      channel.port1.onmessage = (event) => {
        if (timer) clearTimeout(timer);
        resolve(event.data || null);
      };
      timer = setTimeout(() => {
        resolve(null);
      }, timeoutMs);
      worker.postMessage({ type: 'GET_RELEASE_INFO' }, [channel.port2]);
    } catch {
      resolve(null);
    }
  });
}

function getStoredPendingReloadTarget(): string | null {
  try {
    if (typeof sessionStorage !== 'undefined') {
      return sessionStorage.getItem(STORAGE_KEY_PENDING_RELOAD);
    }
  } catch {
    // ignore
  }
  return null;
}

function setStoredPendingReloadTarget(targetBuild: string): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(STORAGE_KEY_PENDING_RELOAD, targetBuild);
    }
  } catch {
    // ignore
  }
}

function getStoredReloadAttempts(): number {
  try {
    if (typeof sessionStorage !== 'undefined') {
      const v = sessionStorage.getItem(STORAGE_KEY_RELOAD_ATTEMPTS);
      return v ? parseInt(v, 10) || 0 : 0;
    }
  } catch {
    // ignore
  }
  return 0;
}

function setStoredReloadAttempts(attempts: number): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(STORAGE_KEY_RELOAD_ATTEMPTS, String(attempts));
    }
  } catch {
    // ignore
  }
}

function clearPendingReloadState(): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(STORAGE_KEY_PENDING_RELOAD);
      sessionStorage.removeItem(STORAGE_KEY_RELOAD_ATTEMPTS);
    }
  } catch {
    // ignore
  }
}

function tryRecordReload(targetBuild: string, currentAttempts: number): boolean {
  if (currentAttempts >= MAX_RELOAD_ATTEMPTS) {
    return false;
  }
  setStoredPendingReloadTarget(targetBuild);
  setStoredReloadAttempts(currentAttempts + 1);
  return true;
}

/**
 * 应用 Web 热更新：
 *   1. App 层保护检查（计时器/写事务/待同步/冲突）；
 *   2. 检查当前 active worker 是否精确匹配目标构建；
 *   3. 若不匹配则触发 registration.update()，等待目标 worker 就绪、激活和接管；
 *   4. controllerchange 发生后仍核对目标身份，杜绝盲目判成功；
 *   5. 明确区分四种状态（检查失败、下载就绪、已接管、需要刷新）；
 *   6. 所有刷新路径共用次数限制 (MAX_RELOAD_ATTEMPTS = 1)，刷新后核对页面 build 避免死循环。
 * 绝不清理 IndexedDB / 账号缓存 / 业务数据。
 */
export async function applyWebUpdate(options: ApplyWebUpdateOptions = {}): Promise<ApplyWebUpdateResult> {
  const guard = safeGuard(options.canActivate);
  if (guard && !guard.ok) {
    return {
      ok: false,
      status: 'failed',
      message: guard.reason || '当前存在未完成的任务，已暂缓更新',
      controllerChanged: false,
    };
  }

  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return {
      ok: false,
      status: 'failed',
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
      status: 'failed',
      message: '当前页面尚未注册 Service Worker，无法确认新版本资源；请刷新页面后重试',
      controllerChanged: false,
    };
  }

  const targetBuild = options.targetBuild || getCachedUpdateResult()?.remoteInfo?.build || CURRENT_WEB_BUILD;

  // 检查是否有前次未完成的刷新意图及次数限制 (MAX_RELOAD_ATTEMPTS = 1)
  const pendingTarget = getStoredPendingReloadTarget();
  const reloadAttempts = getStoredReloadAttempts();
  if (pendingTarget) {
    if (CURRENT_WEB_BUILD === pendingTarget) {
      clearPendingReloadState();
    } else if (reloadAttempts >= MAX_RELOAD_ATTEMPTS) {
      clearPendingReloadState();
      return {
        ok: false,
        status: 'failed',
        controllerChanged: false,
        message: `刷新后页面版本 (${CURRENT_WEB_BUILD}) 仍未更新至预期构建 (${pendingTarget})，请稍后重试或清理浏览器缓存`,
      };
    }
  }

  // 1. 检查当前 active worker 是否已经是目标更新
  // 注意：只有 active worker 精确匹配目标 build 时才判成功；移除“存在 active/controller 就算已激活”的误判
  const activeWorker = registration.active;
  let activeRelease: WorkerReleaseInfo | null = null;
  if (activeWorker) {
    activeRelease = await queryWorkerReleaseInfo(activeWorker, 500);
  }

  const activeMatchesTarget = isWorkerMatchingTarget(activeRelease, targetBuild);

  if (activeMatchesTarget) {
    const finalGuard = safeGuard(options.canActivate);
    if (finalGuard && !finalGuard.ok) {
      return {
        ok: false,
        status: 'failed',
        message: finalGuard.reason || '当前存在未完成的任务，已暂缓更新',
        controllerChanged: false,
      };
    }
    if (!tryRecordReload(targetBuild, reloadAttempts)) {
      clearPendingReloadState();
      return {
        ok: false,
        status: 'failed',
        controllerChanged: false,
        message: `刷新后页面版本 (${CURRENT_WEB_BUILD}) 仍未更新至预期构建 (${targetBuild})，请稍后重试或清理浏览器缓存`,
      };
    }
    return {
      ok: true,
      status: 'needs_reload',
      controllerChanged: true,
      message: '新版本已激活，刷新页面即可完成更新',
    };
  }

  // 挂载 controllerchange 监听器，并在等待期间周期性检查 options.canActivate 保护
  const controllerChangedPromise = waitForControllerChange(10000, options.canActivate);

  // 2. 如果已有 waiting worker，直接触发 SKIP_WAITING
  let waiting = registration.waiting;
  if (waiting) {
    try {
      waiting.postMessage({ type: 'SKIP_WAITING', targetBuild });
    } catch {
      // ignore
    }
  }

  // 3. active 不匹配目标时，触发 registration.update() 拉取新版本
  try {
    await registration.update();
  } catch {
    // update 失败不直接判死
  }

  // 检查 update 后保护状态
  const guardAfterUpdate = safeGuard(options.canActivate);
  if (guardAfterUpdate && !guardAfterUpdate.ok) {
    return {
      ok: false,
      status: 'failed',
      message: guardAfterUpdate.reason || '当前存在未完成的任务，已暂缓更新',
      controllerChanged: false,
    };
  }

  // 4. 如果之前没有 waiting，再次检查是否有新进入 waiting 的 worker
  if (!waiting) {
    const waitResult = await waitForWaitingWorker(registration, 3000, options.canActivate);
    if (waitResult.blockedByGuard) {
      return {
        ok: false,
        status: 'failed',
        message: waitResult.blockedByGuard.reason || '当前存在未完成的任务，已暂缓更新',
        controllerChanged: false,
      };
    }
    waiting = waitResult.worker;
  }

  if (waiting) {
    try {
      waiting.postMessage({ type: 'SKIP_WAITING', targetBuild });
    } catch {
      // ignore
    }

    const controllerResult = await controllerChangedPromise;
    if (controllerResult.blockedByGuard) {
      return {
        ok: false,
        status: 'failed',
        message: controllerResult.blockedByGuard.reason || '当前存在未完成的任务，已暂缓更新',
        controllerChanged: false,
      };
    }

    // controllerchange 发生后仍核对目标身份；旧版 worker 无法返回身份或身份不匹配时，也不能仅凭事件判成功
    let targetVerified = false;
    if (controllerResult.changed) {
      let controllerRelease: WorkerReleaseInfo | null = null;
      if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
        controllerRelease = await queryWorkerReleaseInfo(navigator.serviceWorker.controller, 1000);
      }
      let refreshedActiveRelease: WorkerReleaseInfo | null = null;
      if (registration.active) {
        refreshedActiveRelease = await queryWorkerReleaseInfo(registration.active, 1000);
      }
      targetVerified =
        isWorkerMatchingTarget(controllerRelease, targetBuild) ||
        isWorkerMatchingTarget(refreshedActiveRelease, targetBuild);
    }

    if (targetVerified) {
      const finalGuard = safeGuard(options.canActivate);
      if (finalGuard && !finalGuard.ok) {
        return {
          ok: false,
          status: 'failed',
          message: finalGuard.reason || '当前存在未完成的任务，已暂缓更新',
          controllerChanged: true,
        };
      }
      if (!tryRecordReload(targetBuild, reloadAttempts)) {
        clearPendingReloadState();
        return {
          ok: false,
          status: 'failed',
          controllerChanged: false,
          message: `刷新后页面版本 (${CURRENT_WEB_BUILD}) 仍未更新至预期构建 (${targetBuild})，请稍后重试或清理浏览器缓存`,
        };
      }
      return {
        ok: true,
        status: 'controlled',
        controllerChanged: true,
        message: '新版本资源已完成接管，刷新页面即可应用更新（本地数据与账号缓存不受影响）',
      };
    }

    // 等待 controllerchange 超时或未接管：核对 waiting worker 是否就是目标版本（下载就绪）
    const waitingRelease = await queryWorkerReleaseInfo(waiting, 800);
    const waitingMatchesTarget = isWorkerMatchingTarget(waitingRelease, targetBuild);

    if (waitingMatchesTarget) {
      const finalGuard = safeGuard(options.canActivate);
      if (finalGuard && !finalGuard.ok) {
        return {
          ok: false,
          status: 'failed',
          message: finalGuard.reason || '当前存在未完成的任务，已暂缓更新',
          controllerChanged: false,
        };
      }
      if (tryRecordReload(targetBuild, reloadAttempts)) {
        return {
          ok: true,
          status: 'download_ready',
          controllerChanged: false,
          message: '新版本资源已下载就绪，刷新页面完成更新',
        };
      }
      clearPendingReloadState();
      return {
        ok: false,
        status: 'failed',
        controllerChanged: false,
        message: '未能观测到新版本 Service Worker 接管页面（可能新版本尚未部署完成、网络中断或浏览器未允许更新）。本地数据与账号缓存未被清理，请稍后重试',
      };
    }

    // waiting 既不匹配目标版本，controllerchange 也未确认目标版本
    clearPendingReloadState();
    return {
      ok: false,
      status: 'failed',
      controllerChanged: false,
      message: '未能观测到新版本 Service Worker 接管页面（可能新版本尚未部署完成、网络中断或浏览器未允许更新）。本地数据与账号缓存未被清理，请稍后重试',
    };
  }

  // 5. 如果没有 waiting worker，检查 active worker（可能直接在 update() 中激活）
  const refreshedActive = registration.active;
  if (refreshedActive) {
    const refreshedRelease = await queryWorkerReleaseInfo(refreshedActive, 500);
    if (isWorkerMatchingTarget(refreshedRelease, targetBuild)) {
      const finalGuard = safeGuard(options.canActivate);
      if (finalGuard && !finalGuard.ok) {
        return {
          ok: false,
          status: 'failed',
          message: finalGuard.reason || '当前存在未完成的任务，已暂缓更新',
          controllerChanged: false,
        };
      }
      if (!tryRecordReload(targetBuild, reloadAttempts)) {
        clearPendingReloadState();
        return {
          ok: false,
          status: 'failed',
          controllerChanged: false,
          message: `刷新后页面版本 (${CURRENT_WEB_BUILD}) 仍未更新至预期构建 (${targetBuild})，请稍后重试或清理浏览器缓存`,
        };
      }
      return {
        ok: true,
        status: 'needs_reload',
        controllerChanged: Boolean(navigator.serviceWorker.controller),
        message: '新版本已激活，刷新页面即可完成更新',
      };
    }
  }

  return {
    ok: false,
    status: 'failed',
    controllerChanged: false,
    message: '未能检测到新版本 Service Worker 资源，请确认网络连接后重试',
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

  if (typeof bridgeObject.installApkVerified !== 'function') {
    return {
      ok: false,
      code: 'BRIDGE_METHOD_MISSING',
      message: '原生桥接缺少强校验安装方法，请复制官方安装包地址到系统浏览器安装',
    };
  }

  const operationId = `op_inst_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const requestPayload = {
    url: getOfficialApkUrl(remote),
    sha256: remote.apkSha256,
    sizeBytes: remote.apkSizeBytes,
    packageName: remote.apkPackageName || bridge.packageName,
    versionCode: remote.apkVersionCode,
    versionName: remote.apkVersion || remote.version,
    certFingerprint: remote.apkCertFingerprint,
    operationId,
  };

  try {
    bridgeObject.installApkVerified(JSON.stringify(requestPayload));
  } catch (err) {
    console.warn('[versionCheck] installApkVerified failed:', err);
    return {
      ok: false,
      code: 'BRIDGE_CALL_FAILED',
      message: '原生桥接调用失败，无法启动安全下载；请复制官方安装包地址到系统浏览器安装',
    };
  }

  if (bridge.installPermission === 'denied') {
    return {
      ok: false,
      code: 'INSTALL_PERMISSION_REQUIRED',
      requiresPermission: true,
      message: '需要在系统页面允许“安装未知应用”，已打开授权设置；授权完成返回后会自动继续安装',
    };
  }

  return {
    ok: true,
    code: 'STARTED',
    message: '已开始经官方加密通道下载安装包，下载完成后将自动校验并调起系统安装',
  };
}
