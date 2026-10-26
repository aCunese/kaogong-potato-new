import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Button, ProgressBar } from '../common/UIComponents';
import {
  checkAppUpdate,
  getCachedUpdateResult,
  applyWebUpdate,
  startNativeApkInstall,
  onNativeInstallEvent,
  cancelNativeApkInstall,
  requestNativeInstallPermission,
  copyOfficialApkUrl,
  getOfficialApkUrl,
  markUpdateBannerDismissed,
  isUpdateBannerDismissed,
  CURRENT_WEB_BUILD,
  CURRENT_WEB_VERSION,
  type UpdateCheckResult,
  type UpdateGuard,
  type NativeUpdateEvent,
} from '../../utils/versionCheck';
import {
  Sparkles,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  Copy,
  Check,
  ShieldCheck,
  RefreshCw,
  Smartphone,
  Globe,
} from 'lucide-react';

export interface UpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onToast?: (message: string) => void;
  /** 受控模式：传入 AppContext/SettingsView 持有的检查结果；省略则组件自行检查 */
  result?: UpdateCheckResult | null;
  /** 受控模式：外部是否正在检查 */
  isChecking?: boolean;
  /** 受控模式：外部手动重新检查回调；省略则组件内部执行 checkAppUpdate({manual:true}) */
  onRecheck?: () => void;
  /** App 层更新保护（计时器运行中 / 写入未持久化 / 待同步队列非空 / 冲突未处理） */
  canActivate?: UpdateGuard;
  /** Web 热更新激活成功后的回调（组件随后刷新页面） */
  onApplied?: () => void;
}

type NativePhase =
  | 'idle'
  | 'downloading'
  | 'verifying'
  | 'install_ready'
  | 'installing'
  | 'permission'
  | 'error';

type WebPhase = 'idle' | 'working' | 'ready' | 'error';

function formatCheckedAt(value?: string): string {
  if (!value) return '未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatBytes(bytes?: number): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '未知大小';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * 统一的应用更新弹窗（R16 / R17）。
 *
 * - 失败 / 离线 / nonce 新鲜度校验失败 / 桥异常 => 明确展示失败原因，绝不显示“当前已是最新版本”；
 * - 原生 APK 更新：整数 versionCode 对比 + 强校验下载安装 + 安装未知应用授权 + 进度/失败/重试；
 * - 旧版容器 / 无桥：展示官方安装包地址 + 复制官方地址路径（window.open 只作为“尝试唤起”，不承诺成功）；
 * - 浏览器 Web 更新：只走 Service Worker 热更新，动画/文案只在观测到接管后才算成功，绝不清理本地数据；
 * - 更新保护：通过 canActivate 传入 App 层的计时器/写入/待同步/冲突检查。
 */
export const UpdateModal: React.FC<UpdateModalProps> = ({
  isOpen,
  onClose,
  onToast,
  result,
  isChecking,
  onRecheck,
  canActivate,
  onApplied,
}) => {
  const [internalResult, setInternalResult] = useState<UpdateCheckResult | null>(() => getCachedUpdateResult());
  const [internalChecking, setInternalChecking] = useState(false);
  const [nativePhase, setNativePhase] = useState<NativePhase>('idle');
  const [nativeMessage, setNativeMessage] = useState('');
  const [progress, setProgress] = useState<{ downloaded: number; total: number; percent: number } | null>(null);
  const [webPhase, setWebPhase] = useState<WebPhase>('idle');
  const [webMessage, setWebMessage] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [browserAttempted, setBrowserAttempted] = useState(false);
  const reloadTimerRef = useRef<number | null>(null);

  const effectiveResult = result !== undefined ? result : internalResult;
  const effectiveChecking = isChecking !== undefined ? isChecking : internalChecking;

  const toast = useCallback(
    (message: string) => {
      if (onToast) onToast(message);
    },
    [onToast],
  );

  const runInternalCheck = useCallback(async () => {
    setInternalChecking(true);
    try {
      const res = await checkAppUpdate({ manual: true });
      setInternalResult(res);
    } catch (err) {
      setInternalResult({
        status: 'failed',
        checkedAt: new Date().toISOString(),
        source: 'unknown',
        errorCode: 'CHECK_EXCEPTION',
        message: `版本检查异常：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setInternalChecking(false);
    }
  }, []);

  const handleRecheck = useCallback(() => {
    if (onRecheck) {
      onRecheck();
      return;
    }
    void runInternalCheck();
  }, [onRecheck, runInternalCheck]);

  // 打开弹窗时重置动作状态；非受控模式下自动发起一次手动检查
  useEffect(() => {
    if (!isOpen) return;
    setNativePhase('idle');
    setNativeMessage('');
    setProgress(null);
    setWebPhase('idle');
    setWebMessage('');
    setCopyState('idle');
    setBrowserAttempted(false);
    if (result === undefined && isChecking === undefined && !onRecheck) {
      void runInternalCheck();
    }
    // 仅在打开时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // 订阅原生下载/校验/安装事件
  useEffect(() => {
    if (!isOpen) return;
    const unsubscribe = onNativeInstallEvent((event: NativeUpdateEvent) => {
      switch (event.type) {
        case 'download_started':
          setNativePhase('downloading');
          setNativeMessage(event.message || '已开始安全下载更新包');
          setProgress({ downloaded: 0, total: 0, percent: 0 });
          break;
        case 'download_progress':
          setNativePhase('downloading');
          setProgress({
            downloaded: typeof event.downloaded === 'number' ? event.downloaded : 0,
            total: typeof event.total === 'number' ? event.total : 0,
            percent: typeof event.percent === 'number' ? event.percent : 0,
          });
          break;
        case 'verification_started':
          setNativePhase('verifying');
          setNativeMessage(event.message || '正在校验安装包完整性、包名、版本号与签名证书');
          break;
        case 'install_ready':
          setNativePhase('install_ready');
          setNativeMessage(event.message || '安装包校验全部通过');
          break;
        case 'installer_launched':
          setNativePhase('installing');
          setNativeMessage(event.message || '已调起系统安装程序，请按系统提示确认覆盖安装');
          break;
        case 'install_permission_required':
          setNativePhase('permission');
          setNativeMessage(event.message || '需要授予“安装未知应用”权限后才能继续');
          break;
        case 'download_failed':
        case 'verification_failed':
        case 'bridge_error':
          setNativePhase('error');
          setNativeMessage(
            event.message
              || (event.errorCode ? `更新失败（${event.errorCode}）` : '更新失败，请稍后重试'),
          );
          break;
        case 'cancelled':
        case 'install_cancelled':
          setNativePhase('idle');
          setNativeMessage(event.message || '已取消更新下载');
          setProgress(null);
          break;
        case 'install_permission_denied':
          setNativePhase('idle');
          setNativeMessage(event.message || '未授予安装未知应用权限');
          break;
        case 'installed':
          setNativePhase('idle');
          setNativeMessage(event.message || '应用已成功安装更新');
          break;
        case 'update_busy':
          setNativeMessage(event.message || '已有更新任务正在进行，请稍候');
          break;
        default:
          break;
      }
    });
    return () => unsubscribe();
  }, [isOpen]);

  // 清理自动刷新计时器
  useEffect(() => {
    return () => {
      if (reloadTimerRef.current !== null) {
        window.clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }
    };
  }, []);

  const remoteInfo = effectiveResult?.remoteInfo;

  const handleCopyUrl = async () => {
    const ok = await copyOfficialApkUrl(remoteInfo);
    setCopyState(ok ? 'copied' : 'failed');
    toast(ok ? '官方安装包地址已复制到剪贴板' : '复制失败，请长按官方地址手动复制');
    window.setTimeout(() => setCopyState('idle'), 2200);
  };

  const handleAttemptSystemBrowser = () => {
    const url = getOfficialApkUrl(remoteInfo);
    setBrowserAttempted(true);
    let opened: Window | null = null;
    try {
      opened = window.open(url, '_blank');
    } catch {
      opened = null;
    }
    toast(
      opened
        ? '已尝试唤起系统浏览器；无法确认是否成功打开，若未跳转请复制下方官方地址手动打开'
        : '系统浏览器未能自动打开，请复制下方官方安装包地址手动打开',
    );
  };

  const handleStartNativeInstall = async () => {
    setNativePhase('idle');
    setNativeMessage('');
    setProgress(null);
    const res = await startNativeApkInstall(remoteInfo, { canActivate });
    if (res.ok) {
      setNativePhase('downloading');
      setNativeMessage(res.message);
      toast(res.message);
      return;
    }
    if (res.requiresPermission) {
      setNativePhase('permission');
      setNativeMessage(res.message);
      toast(res.message);
      return;
    }
    setNativePhase('error');
    setNativeMessage(res.message);
    toast(res.message);
  };

  const handleCancelNative = () => {
    const ok = cancelNativeApkInstall();
    setNativePhase('idle');
    setNativeMessage(ok ? '已请求取消更新下载' : '取消请求未能送达原生下载服务');
    setProgress(null);
  };

  const handleApplyWebUpdate = async () => {
    setWebPhase('working');
    setWebMessage('正在检查并等待 Service Worker 接管新版本资源…');
    const res = await applyWebUpdate({ canActivate });
    if (!res.ok) {
      setWebPhase('error');
      setWebMessage(res.message);
      toast(res.message);
      return;
    }
    setWebPhase('ready');
    setWebMessage(res.message);
    toast(res.message);
    if (onApplied) onApplied();
    if (reloadTimerRef.current !== null) window.clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = window.setTimeout(() => {
      window.location.reload();
    }, 1200);
  };

  const handleDismissVersion = () => {
    if (remoteInfo) {
      markUpdateBannerDismissed(`${remoteInfo.version}-${remoteInfo.build}`);
    }
    onClose();
  };

  const isNative = effectiveResult?.source === 'native';
  const remoteVersionCode = remoteInfo?.apkVersionCode;
  const installedVersionCode = effectiveResult?.installedVersionCode;
  const apkAvailable =
    effectiveResult?.status === 'update_available'
    && (effectiveResult.apkUpdateAvailable === true
      || (isNative && effectiveResult.webUpdateAvailable !== true));
  const webAvailable = effectiveResult?.status === 'update_available' && !apkAvailable;
  const dismissalKey = remoteInfo ? `${remoteInfo.version}-${remoteInfo.build}` : '';
  const bannerDismissed = dismissalKey ? isUpdateBannerDismissed(dismissalKey) : false;

  const renderChecking = () => (
    <div className="p-4 bg-cream/70 border border-line rounded-2xl text-center space-y-2">
      <RefreshCw size={22} className="mx-auto text-sage animate-spin" />
      <div className="font-bold text-ink-main">正在核验版本，请稍候…</div>
      <div className="text-ink-muted leading-relaxed">
        正在通过一次性 nonce 请求官方版本接口，确认网络响应新鲜度；失败时不会提示“已是最新”。
      </div>
    </div>
  );

  const renderLatest = () => (
    <div className="space-y-3">
      <div className="p-4 bg-sage-light/40 border border-sage/30 rounded-2xl text-center space-y-1.5">
        <CheckCircle2 size={24} className="mx-auto text-sage" />
        <div className="font-bold text-ink-main">当前已是最新版本</div>
        <div className="text-ink-muted leading-relaxed">{effectiveResult?.message}</div>
      </div>
      <div className="bg-cream/60 p-3 rounded-xl border border-line space-y-1.5 text-[11px]">
        <div className="flex justify-between gap-2">
          <span className="text-ink-muted shrink-0">当前运行版本</span>
          <span className="font-mono font-bold text-ink-main text-right">
            {isNative
              ? `v${effectiveResult?.installedVersionName || '未知'} (versionCode ${installedVersionCode ?? '未知'})`
              : `v${CURRENT_WEB_VERSION} (${CURRENT_WEB_BUILD})`}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-ink-muted shrink-0">云端发布版本</span>
          <span className="font-mono font-bold text-sage text-right">
            v{remoteInfo?.version || '未知'} ({remoteInfo?.build || '未知'})
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-ink-muted shrink-0">网络核验时间</span>
          <span className="font-mono text-ink-main text-right">{formatCheckedAt(effectiveResult?.checkedAt)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-ink-muted shrink-0">新鲜度证明</span>
          <span className="text-sage font-bold text-right">
            {effectiveResult?.cacheState === 'fresh' ? 'nonce 回显校验通过' : '未证明'}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-ink-muted shrink-0">检查来源</span>
          <span className="font-mono text-ink-main text-right">
            {isNative ? 'Android 原生 versionCode' : effectiveResult?.source === 'unknown' ? '未知容器' : 'Web 构建号'}
          </span>
        </div>
      </div>
      {effectiveResult?.fromCache && (
        <div className="text-[11px] text-ink-muted leading-relaxed">
          本次结果来自 30 分钟节流缓存（期间不会重复请求服务器）；需要立即重新核验请点击下方按钮。
        </div>
      )}
      <div className="flex gap-2 pt-1">
        <Button variant="secondary" size="md" fullWidth onClick={handleRecheck} disabled={effectiveChecking}>
          <RefreshCw size={14} className="mr-1.5" />
          重新核验
        </Button>
        <Button variant="primary" size="md" fullWidth onClick={onClose}>
          关闭
        </Button>
      </div>
    </div>
  );

  const renderFailureState = (isOffline: boolean) => (
    <div className="space-y-3">
      <div
        className={`p-4 border rounded-2xl text-center space-y-1.5 ${
          isOffline
            ? 'bg-amber-50 border-amber-200 text-amber-900'
            : 'bg-red-50/70 border-red-200 text-alarm'
        }`}
      >
        {isOffline ? (
          <AlertCircle size={24} className="mx-auto text-amber-600" />
        ) : (
          <AlertTriangle size={24} className="mx-auto text-alarm" />
        )}
        <div className="font-bold">
          {isOffline ? '当前无法完成版本核验（离线）' : '版本核验失败'}
        </div>
        <div className="text-[11px] leading-relaxed">{effectiveResult?.message || '无法获取云端版本信息'}</div>
        {effectiveResult?.errorCode && (
          <div className="text-[10px] font-mono opacity-80">错误码: {effectiveResult.errorCode}</div>
        )}
      </div>
      <div className="text-[11px] text-ink-muted leading-relaxed bg-cream/60 p-3 rounded-xl border border-line">
        核验失败或响应无法证明网络新鲜度时，本应用不会显示“当前已是最新版本”，以避免误报。
        若反复失败，请检查网络连接或稍后重试；已下载的本地数据与账号缓存不受影响。
      </div>
      <div className="flex gap-2 pt-1">
        <Button variant="primary" size="md" fullWidth onClick={handleRecheck} disabled={effectiveChecking}>
          <RefreshCw size={14} className="mr-1.5" />
          重新核验
        </Button>
        <Button variant="secondary" size="md" fullWidth onClick={onClose}>
          关闭
        </Button>
      </div>
    </div>
  );

  const renderUnrecognized = () => {
    const officialUrl = getOfficialApkUrl(remoteInfo);
    return (
      <div className="space-y-3">
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl space-y-1.5 text-amber-900">
          <div className="flex items-center gap-2 font-bold">
            <Smartphone size={16} className="shrink-0" />
            当前安装版本无法识别
          </div>
          <div className="text-[11px] leading-relaxed">
            {effectiveResult?.message
              || '旧版 Android 容器缺少原生版本桥接，无法读取安装版本号。请通过系统浏览器安装官方最新版覆盖升级。'}
          </div>
          {effectiveResult?.errorCode && (
            <div className="text-[10px] font-mono opacity-80">原因码: {effectiveResult.errorCode}</div>
          )}
        </div>

        <div className="bg-cream/60 p-3 rounded-xl border border-line space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-semibold text-ink-main">
            <span>官方安装包地址</span>
            <button
              type="button"
              onClick={handleCopyUrl}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-line bg-paper hover:bg-cream transition-colors text-ink-muted hover:text-ink-main"
            >
              {copyState === 'copied' ? <Check size={11} className="text-sage" /> : <Copy size={11} />}
              <span>{copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制'}</span>
            </button>
          </div>
          <div className="p-1.5 bg-paper rounded border border-line/60 font-mono text-[10px] break-all select-all text-ink-muted">
            {officialUrl}
          </div>
          <div className="text-[10px] text-ink-muted leading-relaxed">
            唯一官方域名：<span className="font-mono font-bold text-sage">work.ruyne.space</span>。
            请在系统浏览器地址栏粘贴该地址下载安装，切勿从第三方渠道安装。
          </div>
        </div>

        <Button variant="primary" size="md" fullWidth onClick={handleAttemptSystemBrowser}>
          <ExternalLink size={14} className="mr-1.5" />
          尝试在系统浏览器中打开
        </Button>
        {browserAttempted && (
          <div className="text-[10px] text-amber-700 leading-relaxed">
            本操作仅“尝试唤起”系统浏览器，无法保证已成功打开。若页面未跳转，请复制上方官方地址手动打开。
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="secondary" size="md" fullWidth onClick={handleRecheck} disabled={effectiveChecking}>
            <RefreshCw size={14} className="mr-1.5" />
            重新核验
          </Button>
          <Button variant="ghost" size="md" fullWidth onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    );
  };

  const renderNativeApkUpdate = () => (
    <div className="space-y-3">
      <div className="p-3.5 bg-potato/20 border border-potato/30 rounded-2xl flex items-start gap-2.5">
        <Sparkles size={18} className="text-potato-dark shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-bold text-ink-main">
            发现新版 Android 安装包 v{remoteInfo?.apkVersion || remoteInfo?.version}
          </div>
          <div className="text-[11px] text-ink-muted leading-relaxed">
            {remoteInfo?.summary || '包含多项稳定性与安全修复，建议在完成当前任务后更新。'}
          </div>
        </div>
      </div>

      <div className="bg-cream/60 p-3 rounded-xl border border-line space-y-1.5 text-[11px]">
        <div className="flex justify-between gap-2">
          <span className="text-ink-muted shrink-0">当前安装版本</span>
          <span className="font-mono font-bold text-ink-main text-right">
            v{effectiveResult?.installedVersionName || '未知'} (versionCode {installedVersionCode ?? '未知'})
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-ink-muted shrink-0">云端 APK 版本</span>
          <span className="font-mono font-bold text-sage text-right">
            v{remoteInfo?.apkVersion || remoteInfo?.version} (versionCode {remoteVersionCode ?? '未知'})
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-ink-muted shrink-0">安装包大小</span>
          <span className="font-mono text-ink-main text-right">{formatBytes(remoteInfo?.apkSizeBytes)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-ink-muted shrink-0">SHA-256 指纹</span>
          <span className="font-mono text-ink-main text-right break-all">
            {remoteInfo?.apkSha256 ? `${remoteInfo.apkSha256.slice(0, 16)}…` : '缺失（已禁止下载）'}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-ink-muted shrink-0">签名证书校验</span>
          <span className="font-mono text-ink-main text-right break-all">
            {remoteInfo?.apkCertFingerprint ? '云端指纹已声明，安装前强校验' : '安装前校验当前应用证书'}
          </span>
        </div>
      </div>

      {nativePhase === 'downloading' && (
        <div className="space-y-2 bg-cream/60 p-3 rounded-xl border border-line">
          <ProgressBar value={progress?.percent ?? 0} />
          <div className="flex items-center justify-between text-[11px] text-ink-muted">
            <span>
              正在下载 {progress ? `${formatBytes(progress.downloaded)} / ${formatBytes(progress.total)}` : '…'}
            </span>
            <span className="font-mono font-bold text-ink-main">{progress?.percent ?? 0}%</span>
          </div>
          <Button variant="danger" size="sm" fullWidth onClick={handleCancelNative}>
            取消下载
          </Button>
        </div>
      )}

      {(nativePhase === 'verifying' || nativePhase === 'install_ready') && (
        <div className="p-3 bg-cream/70 border border-line rounded-xl flex items-center gap-2 text-[11px] text-ink-main">
          <RefreshCw size={14} className="text-sage animate-spin shrink-0" />
          <span>{nativeMessage || '正在校验安装包完整性与签名…'}</span>
        </div>
      )}

      {nativePhase === 'installing' && (
        <div className="p-3 bg-sage-light/40 border border-sage/30 rounded-xl text-[11px] text-ink-main leading-relaxed space-y-1">
          <div className="flex items-center gap-1.5 font-bold">
            <CheckCircle2 size={14} className="text-sage" />
            系统安装程序已调起
          </div>
          <div>{nativeMessage || '请在系统弹窗中确认覆盖安装。'}</div>
          <div className="text-ink-muted">
            覆盖升级不会清除 IndexedDB 学情、账号缓存或本地文件；更新完成后重新打开应用即可。
          </div>
        </div>
      )}

      {nativePhase === 'permission' && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-900 leading-relaxed space-y-2">
          <div className="flex items-center gap-1.5 font-bold">
            <ShieldCheck size={14} className="text-amber-600" />
            需要“安装未知应用”权限
          </div>
          <div>{nativeMessage || '请在系统设置中允许本应用安装未知应用，返回后会自动继续安装。'}</div>
          <Button
            variant="secondary"
            size="sm"
            fullWidth
            onClick={() => {
              const ok = requestNativeInstallPermission();
              toast(ok ? '已打开系统安装授权页面' : '未能打开授权页面，请前往系统设置手动允许');
            }}
          >
            前往系统设置开启权限
          </Button>
        </div>
      )}

      {nativePhase === 'error' && (
        <div className="p-3 bg-red-50/70 border border-red-200 rounded-xl text-[11px] text-alarm leading-relaxed space-y-1">
          <div className="flex items-center gap-1.5 font-bold">
            <AlertTriangle size={14} className="shrink-0" />
            更新未完成
          </div>
          <div>{nativeMessage || '更新失败，请稍后重试。'}</div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {nativePhase === 'idle' || nativePhase === 'error' || nativePhase === 'permission' ? (
          <Button
            variant="primary"
            size="md"
            fullWidth
            onClick={handleStartNativeInstall}
          >
            <Download size={14} className="mr-1.5" />
            {nativePhase === 'error' ? '重试更新' : nativePhase === 'permission' ? '重新发起安装' : '下载并安装更新'}
          </Button>
        ) : nativePhase === 'installing' || nativePhase === 'install_ready' ? (
          <Button variant="secondary" size="md" fullWidth onClick={onClose}>
            关闭
          </Button>
        ) : null}
        {nativePhase !== 'installing' && nativePhase !== 'install_ready' && (
          <Button variant="ghost" size="md" fullWidth onClick={handleCopyUrl}>
            <Copy size={14} className="mr-1.5" />
            {copyState === 'copied' ? '官方地址已复制' : copyState === 'failed' ? '复制失败，请手动复制' : '复制官方安装包地址'}
          </Button>
        )}
      </div>
      {nativePhase !== 'installing' && nativePhase !== 'install_ready' && (
        <div className="text-[10px] text-ink-muted leading-relaxed">
          更新保护：若存在正在运行的计时器、尚未持久化的改动、待同步队列或未处理的版本冲突，更新会被暂停并提示原因。
          更新过程不会清理本地数据或账号缓存。
        </div>
      )}
    </div>
  );

  const renderWebUpdate = () => (
    <div className="space-y-3">
      <div className="p-3.5 bg-potato/20 border border-potato/30 rounded-2xl flex items-start gap-2.5">
        <Sparkles size={18} className="text-potato-dark shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-bold text-ink-main">
            发现工作台网页新版本 v{remoteInfo?.version}
          </div>
          <div className="text-[11px] text-ink-muted leading-relaxed">
            {remoteInfo?.summary || '本次为 Web / PWA 资源更新，将通过 Service Worker 热更新完成，不会改动本地学情与账号数据。'}
          </div>
        </div>
      </div>

      <div className="bg-cream/60 p-3 rounded-xl border border-line space-y-1.5 text-[11px]">
        <div className="flex justify-between gap-2">
          <span className="text-ink-muted shrink-0">当前构建号</span>
          <span className="font-mono font-bold text-ink-main text-right">{CURRENT_WEB_BUILD}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-ink-muted shrink-0">云端构建号</span>
          <span className="font-mono font-bold text-sage text-right">{remoteInfo?.build || '未知'}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-ink-muted shrink-0">更新方式</span>
          <span className="font-mono text-ink-main text-right">Service Worker 热更新 + 页面刷新</span>
        </div>
      </div>

      {webPhase === 'working' && (
        <div className="p-3 bg-cream/70 border border-line rounded-xl flex items-center gap-2 text-[11px] text-ink-main">
          <RefreshCw size={14} className="text-sage animate-spin shrink-0" />
          <span>{webMessage || '正在等待新版本 Service Worker 接管…'}</span>
        </div>
      )}
      {webPhase === 'ready' && (
        <div className="p-3 bg-sage-light/40 border border-sage/30 rounded-xl text-[11px] text-ink-main leading-relaxed space-y-1">
          <div className="flex items-center gap-1.5 font-bold">
            <CheckCircle2 size={14} className="text-sage" />
            新版本资源已接管
          </div>
          <div>{webMessage || '即将自动刷新页面应用新版本。'}</div>
        </div>
      )}
      {webPhase === 'error' && (
        <div className="p-3 bg-red-50/70 border border-red-200 rounded-xl text-[11px] text-alarm leading-relaxed space-y-1">
          <div className="flex items-center gap-1.5 font-bold">
            <AlertTriangle size={14} className="shrink-0" />
            未能确认新版本激活
          </div>
          <div>{webMessage || '请稍后重试或重新打开应用。'}</div>
          <div className="text-ink-muted">
            在观测到 Service Worker 接管前，不会提示更新成功；本地数据与账号缓存未被清理。
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Button
          variant="primary"
          size="md"
          fullWidth
          onClick={handleApplyWebUpdate}
          disabled={webPhase === 'working' || webPhase === 'ready'}
        >
          <RefreshCw size={14} className="mr-1.5" />
          {webPhase === 'working' ? '正在应用更新…' : webPhase === 'ready' ? '已接管，正在刷新…' : '立即更新'}
        </Button>
        <Button variant="ghost" size="md" onClick={onClose}>
          稍后
        </Button>
      </div>
      <div className="text-[10px] text-ink-muted leading-relaxed">
        原生 Android 容器内，Web 更新同样通过 Service Worker 热更新完成；安装包级别更新请使用 APK 更新入口。
      </div>
    </div>
  );

  const renderBody = () => {
    if (effectiveChecking || !effectiveResult) return renderChecking();
    switch (effectiveResult.status) {
      case 'checking':
        return renderChecking();
      case 'latest':
        return renderLatest();
      case 'offline':
        return renderFailureState(true);
      case 'failed':
        return renderFailureState(false);
      case 'unrecognized':
        return renderUnrecognized();
      case 'update_available':
        return apkAvailable ? renderNativeApkUpdate() : renderWebUpdate();
      default:
        return renderChecking();
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="应用版本与更新">
      <div className="space-y-4 text-xs">
        {renderBody()}

        {effectiveResult?.status === 'update_available' && !bannerDismissed && (
          <button
            type="button"
            onClick={handleDismissVersion}
            className="w-full text-center text-[11px] text-ink-muted hover:text-ink-main underline-offset-2 hover:underline"
          >
            稍后提醒我（该版本不再自动弹出提示）
          </button>
        )}

        <div className="pt-2 border-t border-line/60 flex items-center justify-between text-[10px] text-ink-muted">
          <span className="flex items-center gap-1">
            <Globe size={11} />
            官方域名 work.ruyne.space · 版本核验 nonce 防缓存
          </span>
          <span className="font-mono">v{CURRENT_WEB_VERSION}</span>
        </div>
      </div>
    </Modal>
  );
};
