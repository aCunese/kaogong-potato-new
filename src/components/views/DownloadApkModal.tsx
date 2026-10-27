import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Button, ProgressBar } from '../common/UIComponents';
import { PotatoSprite } from '../common/PotatoSprite';
import {
  Download,
  CheckCircle2,
  Copy,
  Check,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import {
  checkAppUpdate,
  getNativeBridgeInfo,
  getNativeInstallState,
  startNativeApkInstall,
  onNativeInstallEvent,
  cancelNativeApkInstall,
  getOfficialApkUrl,
  copyOfficialApkUrl,
  type UpdateCheckResult,
  type NativeUpdateEvent,
} from '../../utils/versionCheck';

/**
 * 官方正版 Android 安装包说明/下载弹窗（R16 / R17）。
 *
 * - 版本号、SHA-256、大小、证书指纹全部来自 /version.json（带 nonce 新鲜度核验），
 *   不再硬编码任何版本/哈希（旧实现硬编码 1.0.2 且文案误写 1.0.1）；
 * - 元数据核验失败时明确提示“未能在线核验”，仍提供官方地址供手动复制，绝不展示虚假“最新版”；
 * - 原生容器内优先走应用内强校验安装流程（R14/R15）；旧容器/浏览器则提供官方地址复制按钮；
 * - 始终提示唯一官方域名，拒绝第三方渠道安装包。
 */
export const DownloadApkModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [shaCopied, setShaCopied] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const [installMessage, setInstallMessage] = useState('');
  const [installPhase, setInstallPhase] = useState<'idle' | 'downloading' | 'verifying' | 'installing' | 'error'>('idle');
  const [progress, setProgress] = useState<{ downloaded: number; total: number; percent: number } | null>(null);
  const checkSeqRef = useRef(0);

  const remoteInfo = result?.remoteInfo;
  const bridge = getNativeBridgeInfo();
  const isNativeContainer = Boolean(bridge);
  const officialUrl = getOfficialApkUrl(remoteInfo);
  const metadataVerified = result?.status === 'update_available' || result?.status === 'latest';

  const runCheck = useCallback(async () => {
    const seq = ++checkSeqRef.current;
    setChecking(true);
    try {
      const res = await checkAppUpdate({ manual: true });
      if (seq !== checkSeqRef.current) return;
      setResult(res);
    } catch (err) {
      if (seq !== checkSeqRef.current) return;
      setResult({
        status: 'failed',
        checkedAt: new Date().toISOString(),
        source: 'unknown',
        errorCode: 'CHECK_EXCEPTION',
        message: `版本信息核验异常：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      if (seq === checkSeqRef.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setShaCopied(false);
    setUrlCopied(false);
    const initialNative = getNativeInstallState();
    if (initialNative) {
      const phase = initialNative.phase === 'permission'
        ? 'idle'
        : initialNative.phase === 'install_ready'
          ? 'verifying'
          : initialNative.phase;
      setInstallPhase(phase);
      setInstallMessage(initialNative.message);
    } else {
      setInstallPhase('idle');
      setInstallMessage('');
    }
    setProgress(null);
    void runCheck();
  }, [isOpen, runCheck]);

  useEffect(() => {
    if (!isOpen) return;
    const unsubscribe = onNativeInstallEvent((event: NativeUpdateEvent) => {
      switch (event.type) {
        case 'download_started':
          setInstallPhase('downloading');
          setInstallMessage(event.message || '已开始安全下载更新包');
          setProgress({ downloaded: 0, total: 0, percent: 0 });
          break;
        case 'download_progress':
          setInstallPhase('downloading');
          setProgress({
            downloaded: typeof event.downloaded === 'number' ? event.downloaded : 0,
            total: typeof event.total === 'number' ? event.total : 0,
            percent: typeof event.percent === 'number' ? event.percent : 0,
          });
          break;
        case 'verification_started':
          setInstallPhase('verifying');
          setInstallMessage(event.message || '正在校验安装包完整性');
          break;
        case 'install_ready':
          setInstallPhase('verifying');
          setInstallMessage(event.message || '安装包校验通过');
          break;
        case 'installer_launched':
          setInstallPhase('installing');
          setInstallMessage(event.message || '已调起系统安装程序');
          break;
        case 'install_permission_required':
          setInstallPhase('idle');
          setInstallMessage(event.message || '请在系统设置中允许“安装未知应用”后重试');
          break;
        case 'download_failed':
        case 'verification_failed':
        case 'install_failed':
        case 'bridge_error':
          setInstallPhase('error');
          setInstallMessage(
            event.message
              || (event.errorCode || event.code ? `更新失败（${event.errorCode || event.code}）` : '更新失败，请稍后重试'),
          );
          break;
        case 'cancelled':
        case 'install_cancelled':
          setInstallPhase('idle');
          setInstallMessage(event.message || '已取消更新下载');
          break;
        case 'install_permission_denied':
          setInstallPhase('idle');
          setInstallMessage(event.message || '未授予安装未知应用权限');
          break;
        case 'installed':
          setInstallPhase('idle');
          setInstallMessage(event.message || '应用已成功安装更新');
          break;
        default:
          break;
      }
    });
    return () => unsubscribe();
  }, [isOpen]);

  const handleCopySha = async () => {
    if (!remoteInfo?.apkSha256) return;
    try {
      await navigator.clipboard.writeText(remoteInfo.apkSha256);
      setShaCopied(true);
      window.setTimeout(() => setShaCopied(false), 2200);
    } catch {
      setShaCopied(false);
    }
  };

  const handleCopyUrl = async () => {
    const ok = await copyOfficialApkUrl(remoteInfo);
    setUrlCopied(ok);
    window.setTimeout(() => setUrlCopied(false), 2200);
  };

  const handleStartNativeInstall = async () => {
    setInstallMessage('');
    const res = await startNativeApkInstall(remoteInfo);
    if (res.ok) {
      setInstallPhase('downloading');
      setInstallMessage(res.message);
      return;
    }
    if (res.requiresPermission) {
      setInstallPhase('idle');
      setInstallMessage(res.message);
      return;
    }
    setInstallPhase('error');
    setInstallMessage(res.message);
  };

  const apkFilename = remoteInfo?.apkVersion
    ? `kaogong-potato-v${remoteInfo.apkVersion}.apk`
    : 'kaogong-potato-official.apk';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="官方正版 Android 安装包">
      <div className="space-y-4 text-center py-1">
        <div className="my-1">
          <PotatoSprite pose={5} size={76} />
        </div>

        <div>
          <h3 className="text-base font-bold text-ink-main">考公工作台 · 安卓正式独立版</h3>
          <p className="text-xs text-ink-muted mt-1 leading-relaxed">
            官方正版安装包，全屏沉浸、离线可用、数据与账号隔离。
          </p>
        </div>

        <div className="p-3 bg-cream/70 rounded-xl text-left text-xs text-ink-muted space-y-2 border border-line">
          {checking ? (
            <div className="flex items-center gap-2 text-[11px] text-ink-muted">
              <RefreshCw size={13} className="animate-spin" />
              正在通过官方版本接口核验安装包元数据（nonce 防缓存）…
            </div>
          ) : metadataVerified && remoteInfo ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-ink-main font-bold">
                  <CheckCircle2 size={14} className="text-sage" />
                  <span>版本 v{remoteInfo.apkVersion || remoteInfo.version}（官方正版）</span>
                </div>
                <span className="text-[10px] text-ink-muted/80">
                  {typeof remoteInfo.apkSizeBytes === 'number'
                    ? `${(remoteInfo.apkSizeBytes / 1024).toFixed(0)} KB`
                    : ''}
                </span>
              </div>
              <div className="flex items-center gap-1 text-[10px] text-sage">
                <ShieldCheck size={11} />
                元数据已通过官方接口网络新鲜度校验
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-amber-800 font-bold">
                <AlertTriangle size={13} className="text-amber-600 shrink-0" />
                <span>暂未能在网核验安装包元数据</span>
              </div>
              <div className="text-[11px] leading-relaxed">
                请使用下方官方地址下载；若提示失败，可稍后重试核验或复制官方地址在系统浏览器打开。
              </div>
            </div>
          )}

          <div className="space-y-1 text-[11px] pt-1 border-t border-line/60">
            <div>• 原生独立 WebView 安全容器，强制 HTTPS 与 SSL 证书强校验</div>
            <div>• 应用内更新会对安装包做 SHA-256、包名、versionCode、签名证书四项强校验</div>
            <div>• 覆盖升级不会清除本地学情、账号缓存与相册附件</div>
          </div>

          {remoteInfo?.apkSha256 && (
            <div className="pt-2 border-t border-line/60">
              <div className="flex items-center justify-between text-[11px] font-semibold text-ink-main mb-1">
                <span className="flex items-center gap-1">
                  <ShieldCheck size={13} className="text-sage" />
                  官方 SHA-256 完整性指纹
                </span>
                <button
                  type="button"
                  onClick={handleCopySha}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-white border border-line hover:bg-cream transition-colors text-ink-muted hover:text-ink-main"
                  title="复制哈希值"
                >
                  {shaCopied ? <Check size={11} className="text-sage" /> : <Copy size={11} />}
                  <span>{shaCopied ? '已复制' : '复制哈希'}</span>
                </button>
              </div>
              <div className="p-1.5 bg-white/80 rounded border border-line/50 font-mono text-[10px] break-all select-all text-ink-muted">
                {remoteInfo.apkSha256}
              </div>
            </div>
          )}

          {remoteInfo?.apkCertFingerprint && (
            <div className="pt-1">
              <div className="text-[11px] font-semibold text-ink-main mb-1">官方签名证书 SHA-256</div>
              <div className="p-1.5 bg-white/80 rounded border border-line/50 font-mono text-[10px] break-all select-all text-ink-muted/90">
                {remoteInfo.apkCertFingerprint}
              </div>
            </div>
          )}

          <div className="pt-2 border-t border-line/60">
            <div className="flex items-center justify-between text-[11px] font-semibold text-ink-main mb-1">
              <span>官方安装包地址</span>
              <button
                type="button"
                onClick={handleCopyUrl}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-white border border-line hover:bg-cream transition-colors text-ink-muted hover:text-ink-main"
              >
                {urlCopied ? <Check size={11} className="text-sage" /> : <Copy size={11} />}
                <span>{urlCopied ? '已复制' : '复制地址'}</span>
              </button>
            </div>
            <div className="p-1.5 bg-white/80 rounded border border-line/50 font-mono text-[10px] break-all select-all text-ink-muted">
              {officialUrl}
            </div>
          </div>

          <div className="text-[10px] text-ink-muted/80 bg-cream/90 p-2 rounded border border-line/40 leading-relaxed">
            <span className="font-semibold text-ink-main">防冒充提示：</span>
            本站唯一官方域名为 <span className="font-mono text-sage font-bold">work.ruyne.space</span>。
            {remoteInfo?.apkSha256
              ? ` 下载后可在终端执行 shasum -a 256 ${apkFilename} 对比上方哈希。`
              : ' 请勿从第三方渠道下载安装。'}
            若安装时提示“安装包与现有签名冲突”，说明来源已被篡改，切勿继续安装！
          </div>
        </div>

        {installPhase === 'downloading' && (
          <div className="space-y-2 bg-cream/70 p-3 rounded-xl border border-line text-left">
            <ProgressBar value={progress?.percent ?? 0} />
            <div className="flex items-center justify-between text-[11px] text-ink-muted">
              <span className="truncate">{installMessage || '正在安全下载安装包…'}</span>
              <span className="font-mono font-bold text-ink-main shrink-0 ml-2">{progress?.percent ?? 0}%</span>
            </div>
            <Button variant="danger" size="sm" fullWidth onClick={() => { cancelNativeApkInstall(); setInstallPhase('idle'); }}>
              取消下载
            </Button>
          </div>
        )}

        {installPhase === 'verifying' && (
          <div className="p-3 bg-cream/70 border border-line rounded-xl flex items-center gap-2 text-[11px] text-ink-main text-left">
            <RefreshCw size={13} className="text-sage animate-spin shrink-0" />
            <span>{installMessage || '正在校验安装包 SHA-256、包名、版本号与签名证书…'}</span>
          </div>
        )}

        {installPhase === 'installing' && (
          <div className="p-3 bg-sage-light/40 border border-sage/30 rounded-xl text-[11px] text-ink-main leading-relaxed text-left">
            <div className="flex items-center gap-1.5 font-bold">
              <CheckCircle2 size={14} className="text-sage" />
              系统安装程序已调起
            </div>
            <div className="mt-1 text-ink-muted">{installMessage || '请在系统弹窗中确认覆盖安装。'}</div>
          </div>
        )}

        {installPhase === 'error' && (
          <div className="p-3 bg-red-50/70 border border-red-200 rounded-xl text-[11px] text-alarm leading-relaxed text-left">
            <div className="flex items-center gap-1.5 font-bold">
              <AlertTriangle size={14} className="shrink-0" />
              应用内更新未完成
            </div>
            <div className="mt-1">{installMessage || '请稍后重试，或复制官方地址到系统浏览器安装。'}</div>
          </div>
        )}

        {isNativeContainer && bridge && bridge.protocol >= 2 ? (
          <div className="space-y-2">
            <Button
              variant="primary"
              size="md"
              fullWidth
              onClick={handleStartNativeInstall}
              disabled={installPhase === 'downloading' || installPhase === 'verifying' || installPhase === 'installing'}
            >
              <Download size={16} />
              {installPhase === 'downloading' ? '正在下载…' : '使用应用内安全更新'}
            </Button>
            <div className="text-[10px] text-ink-muted leading-relaxed">
              应用内更新将校验安装包 SHA-256、包名、versionCode 与签名证书，校验通过后调起系统安装。
              {!metadataVerified && ' 当前未能在线核验元数据，将拒绝发起下载，请复制官方地址安装。'}
            </div>
          </div>
        ) : isNativeContainer ? (
          <div className="space-y-2">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-900 text-left leading-relaxed">
              当前 Android 容器为旧版本（缺少强校验安装桥接），无法在应用内安全更新。
              请复制上方官方地址，在系统浏览器中下载覆盖安装。
            </div>
            <Button variant="secondary" size="md" fullWidth onClick={handleCopyUrl}>
              <Copy size={14} className="mr-1.5" />
              复制官方安装包地址
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <a href={officialUrl} download={apkFilename} className="block w-full">
              <Button variant="primary" size="md" fullWidth className="shadow-sm">
                <Download size={16} />
                下载官方 Android 安装包 (APK)
              </Button>
            </a>
            <button
              type="button"
              onClick={handleCopyUrl}
              className="w-full flex items-center justify-center gap-1 text-[11px] text-ink-muted hover:text-ink-main"
            >
              <ExternalLink size={12} />
              复制官方地址到系统浏览器打开
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
};
