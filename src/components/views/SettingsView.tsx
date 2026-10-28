import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Avatar } from '../common/Avatar';
import { Card, Button, Tag, Modal } from '../common/UIComponents';
import {
  CURRENT_WEB_VERSION,
  CURRENT_WEB_BUILD,
} from '../../utils/versionCheck';
import { UpdateModal } from './UpdateModal';
import { EmailRemindersModal } from './EmailRemindersModal';
import { SharingModal } from './SharingModal';
import {
  getLatestRecoverySnapshot,
} from '../../utils/db';
import { SnapshotRecord } from '../../types';
import {
  RefreshCw,
  Sparkles,
  Info,
  Shield,
  LogOut,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ChevronRight,
  ExternalLink,
  Download,
  Database,
  Trash2,
  RotateCcw,
  Mail,
  Users,
} from 'lucide-react';

interface SettingsViewProps {
  onOpenProfile: () => void;
  onOpenBackup: () => void;
  onOpenConflict?: () => void;
  onOpenLogoutConfirm: () => void;
  onOpenResetConfirm: () => void;
  onToast: (msg: string) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  onOpenProfile,
  onOpenBackup,
  onOpenConflict,
  onOpenLogoutConfirm,
  onOpenResetConfirm,
  onToast,
}) => {
  const {
    state,
    currentUser,
    syncStatus,
    syncMessage,
    triggerSync,
    conflictData,
    storageError,
    clearStorageError,
    offlineReady,
    pendingSyncCount,
    hasUnsyncedChanges,
    clearSafeCache,
    restoreLatestRecovery,
    updateCheckState,
    isCheckingUpdate,
    checkForUpdate,
    updateGuard,
    registerUpdateBlocker,
  } = useApp();

  // Update modal state
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showEmailReminders, setShowEmailReminders] = useState(false);
  const [showSharing, setShowSharing] = useState(false);
  useEffect(() => {
    if (!showEmailReminders && !showSharing) return;
    return registerUpdateBlocker('account_feature_modal', '正在管理邮箱提醒或共享授权，已暂缓应用更新');
  }, [showEmailReminders, showSharing, registerUpdateBlocker]);

  // About App modal state
  const [showAboutModal, setShowAboutModal] = useState(false);

  // Data & Security Settings modal state
  const [showDataSettingsModal, setShowDataSettingsModal] = useState(false);
  const [latestRecovery, setLatestRecovery] = useState<SnapshotRecord | null>(null);
  const [isRestoringRecovery, setIsRestoringRecovery] = useState(false);
  const [isSyncingNow, setIsSyncingNow] = useState(false);

  // Recovery point info + passive update state comes from AppContext (real 30-min throttle).
  useEffect(() => {
    getLatestRecoverySnapshot(currentUser?.id).then(snap => {
      setLatestRecovery(snap);
    });
  }, [currentUser?.id, showDataSettingsModal]);

  // Manual update check (unthrottled by manual=true)
  const handleManualCheckUpdate = async () => {
    setShowUpdateModal(true);
    try {
      await checkForUpdate(true);
    } catch {
      onToast('检查更新失败，请检查网络连接');
    }
  };

  // Immediate Sync Trigger
  const handleManualSync = async () => {
    if (isSyncingNow) return;
    setIsSyncingNow(true);
    try {
      const res = await triggerSync();
      if (res.ok) {
        onToast('全部学情已与云端完成同步！');
      } else if (res.status === 'offline') {
        onToast('当前处于离线状态，修改已安全保存在本地');
      } else if (res.status === 'conflict') {
        onToast('检测到版本冲突，请根据弹窗确认裁决方向');
        if (onOpenConflict) onOpenConflict();
      } else {
        onToast(res.message || '同步暂未完成，正在自动重试');
      }
    } catch {
      onToast('网络通信异常，待下次联网重试');
    } finally {
      setIsSyncingNow(false);
    }
  };

  // Safe Local Cache Flush (R07: never deletes account snapshot / unsynced queue / referenced photos)
  const handleClearCache = async () => {
    const result = await clearSafeCache();
    if (result.ok) {
      onToast(result.message);
      setShowDataSettingsModal(false);
    } else {
      onToast(result.message);
    }
  };

  // Restore from emergency recovery point (R08: really reads + applies the recovery snapshot)
  const handleRestoreRecovery = async () => {
    if (isRestoringRecovery) return;
    setIsRestoringRecovery(true);
    try {
      const result = await restoreLatestRecovery();
      if (!result.ok) {
        onToast(result.message || '恢复快照还原失败');
        return;
      }
      onToast('已还原所选恢复快照，并生成同步任务');
      const refreshed = await getLatestRecoverySnapshot(currentUser?.id);
      setLatestRecovery(refreshed);
      setShowDataSettingsModal(false);
    } finally {
      setIsRestoringRecovery(false);
    }
  };

  // Compute Sync Tag
  const renderSyncBadge = () => {
    if (syncStatus === 'syncing' || isSyncingNow) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-sage-light text-sage-dark rounded-full text-[11px] font-medium animate-pulse">
          <RefreshCw size={11} className="animate-spin" />
          正在同步
        </span>
      );
    }
    if (syncStatus === 'conflict' || Boolean(conflictData)) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-alarm-light text-alarm rounded-full text-[11px] font-medium">
          <AlertTriangle size={11} />
          需要处理版本冲突
        </span>
      );
    }
    if (syncStatus === 'synced') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-sage-light text-sage-dark rounded-full text-[11px] font-medium">
          <CheckCircle2 size={11} className="text-sage" />
          {pendingSyncCount > 0 ? `已保存到服务器 · 待传 ${pendingSyncCount} 项` : '已保存到服务器'}
        </span>
      );
    }
    if (!navigator.onLine || syncStatus === 'idle') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-full text-[11px] font-medium">
          {navigator.onLine ? (pendingSyncCount > 0 ? `待同步 (${pendingSyncCount} 项)` : '待同步') : '离线 · 待同步'}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-full text-[11px] font-medium">
        同步暂未完成，正在重试{pendingSyncCount > 0 ? ` (${pendingSyncCount} 项)` : ''}
      </span>
    );
  };

  // Compute Update Badge
  const renderUpdateBadge = () => {
    if (isCheckingUpdate) {
      return <span className="text-[11px] text-ink-muted">检查中...</span>;
    }
    if (!updateCheckState) {
      return <span className="text-[11px] text-ink-muted">检查更新</span>;
    }
    if (updateCheckState.status === 'update_available') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-potato/20 text-ink-main border border-potato/40 rounded-full text-[11px] font-bold">
          <span className="w-1.5 h-1.5 rounded-full bg-potato animate-pulse" />
          发现新版本
        </span>
      );
    }
    if (updateCheckState.status === 'offline') {
      return <span className="text-[11px] text-ink-muted">当前离线</span>;
    }
    if (updateCheckState.status === 'unrecognized') {
      return (
        <span className="text-[11px] text-amber-700 font-medium">安装版本无法识别</span>
      );
    }
    if (updateCheckState.status === 'failed') {
      return <span className="text-[11px] text-ink-muted">检查失败</span>;
    }
    return (
      <span className="text-[11px] text-sage font-medium">
        已是最新 (v{updateCheckState.installedVersionName || CURRENT_WEB_VERSION})
      </span>
    );
  };

  return (
    <div className="space-y-4 pb-24 animate-fade-in">
      {/* 存储警告条（若检测到配额异常） */}
      {storageError && (
        <div className="p-3 bg-alarm/10 border border-alarm/30 rounded-2xl flex items-start gap-2.5 text-xs text-alarm">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-bold">本地存储异常</div>
            <div className="mt-0.5 leading-relaxed">{storageError}</div>
          </div>
          <button onClick={clearStorageError} className="underline text-[11px] shrink-0">
            关闭提示
          </button>
        </div>
      )}

      {/* 冲突待处理醒目提示卡片 (S09) */}
      {conflictData && (
        <div className="p-3.5 bg-amber-500/15 border border-amber-500/30 rounded-2xl flex items-center justify-between gap-3 text-xs text-ink-main shadow-sm animate-fade-in">
          <div className="flex items-start gap-2.5 min-w-0">
            <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="font-bold text-ink-main text-xs">检测到数据版本冲突待处理</div>
              <div className="text-[11px] text-ink-muted mt-0.5 leading-relaxed">
                云端与本机记录存在分叉版本，为保护您的学情资料，已暂停自动覆盖。
              </div>
            </div>
          </div>
          {onOpenConflict && (
            <Button
              variant="primary"
              size="sm"
              onClick={onOpenConflict}
              className="shrink-0 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs px-3 py-1.5"
            >
              处理冲突
            </Button>
          )}
        </div>
      )}

      {/* 1. 个人资料卡片 */}
      <Card className="p-4 bg-gradient-to-br from-paper to-cream/70 border-line">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              onClick={onOpenProfile}
              className="w-14 h-14 rounded-2xl bg-paper border-2 border-line overflow-hidden flex items-center justify-center cursor-pointer shadow-soft active:scale-95 transition-transform shrink-0"
              title="点击修改头像"
            >
              <Avatar avatar={state.profile.avatar} size={52} className="w-full h-full" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-ink-main truncate">{state.profile.name}</h2>
                <Tag variant="sage" className="shrink-0">
                  @{currentUser ? currentUser.username : state.profile.username}
                </Tag>
              </div>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap text-xs text-ink-muted">
                <span>正式学员专属空间</span>
                {offlineReady && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.2 bg-sage-light text-sage-dark rounded text-[10px] font-bold">
                    <span className="w-1.5 h-1.5 rounded-full bg-sage inline-block" />
                    离线就绪
                  </span>
                )}
              </div>
            </div>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenProfile}
            className="shrink-0 whitespace-nowrap px-3 py-1.5 text-xs font-bold border border-line/60 bg-paper hover:bg-cream active:scale-95 transition-all"
          >
            编辑资料
          </Button>
        </div>
      </Card>

      {/* 2. 紧凑功能列表 (规范排版：同步状态、检查更新、关于应用、数据设置、退出登录) */}
      <Card className="p-0 bg-paper border-line divide-y divide-line/60 overflow-hidden shadow-card">
        {/* 同步状态 */}
        <div
          onClick={handleManualSync}
          className="flex items-center justify-between px-4 py-3.5 hover:bg-cream/40 cursor-pointer transition-colors active:bg-cream/60"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-sage-light/60 flex items-center justify-center text-sage">
              <RefreshCw size={16} className={isSyncingNow ? 'animate-spin' : ''} />
            </div>
            <div>
              <div className="text-xs font-bold text-ink-main">云端同步状态</div>
              <div className="text-[11px] text-ink-muted mt-0.5">
                {syncMessage || (navigator.onLine ? '学情实时自动双向同步' : '当前离线，已在本地安全暂存')}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {renderSyncBadge()}
            <ChevronRight size={15} className="text-ink-muted/60" />
          </div>
        </div>

        {/* 检查更新 */}
        <div
          onClick={handleManualCheckUpdate}
          className="flex items-center justify-between px-4 py-3.5 hover:bg-cream/40 cursor-pointer transition-colors active:bg-cream/60"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-potato/20 flex items-center justify-center text-ink-main">
              <Sparkles size={16} className="text-potato-dark" />
            </div>
            <div>
              <div className="text-xs font-bold text-ink-main">检查更新</div>
              <div className="text-[11px] text-ink-muted mt-0.5">
                支持 Web 与 Android 原生容器版本核验
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {renderUpdateBadge()}
            <ChevronRight size={15} className="text-ink-muted/60" />
          </div>
        </div>

        {/* 数据备份与恢复 */}
        <div
          onClick={onOpenBackup}
          className="flex items-center justify-between px-4 py-3.5 hover:bg-cream/40 cursor-pointer transition-colors active:bg-cream/60"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-sage-light/60 flex items-center justify-center text-sage">
              <Database size={16} />
            </div>
            <div>
              <div className="text-xs font-bold text-ink-main">数据备份与恢复</div>
              <div className="text-[11px] text-ink-muted mt-0.5">
                离线全量 JSON 备份导出与换机恢复
              </div>
            </div>
          </div>
          <ChevronRight size={15} className="text-ink-muted/60" />
        </div>

        {/* 关于应用 */}
        <div
          onClick={() => setShowAboutModal(true)}
          className="flex items-center justify-between px-4 py-3.5 hover:bg-cream/40 cursor-pointer transition-colors active:bg-cream/60"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
              <Info size={16} />
            </div>
            <div>
              <div className="text-xs font-bold text-ink-main">关于应用</div>
              <div className="text-[11px] text-ink-muted mt-0.5">
                版本信息、技术规范与品牌版权
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-ink-muted font-mono">v{CURRENT_WEB_VERSION}</span>
            <ChevronRight size={15} className="text-ink-muted/60" />
          </div>
        </div>

        <button type="button" disabled={!currentUser} onClick={() => setShowEmailReminders(true)} className="w-full text-left flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-cream/40 disabled:opacity-50">
          <span className="flex items-center gap-3"><Mail size={18} className="text-sage shrink-0" /><span><span className="block text-xs font-bold">邮箱与提醒</span><span className="block text-[11px] text-ink-muted mt-0.5">绑定邮箱，在指定日期时间收到学习提醒</span></span></span>
          <ChevronRight size={15} className="text-ink-muted shrink-0" />
        </button>
        <button type="button" disabled={!currentUser} onClick={() => setShowSharing(true)} className="w-full text-left flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-cream/40 disabled:opacity-50">
          <span className="flex items-center gap-3"><Users size={18} className="text-sage shrink-0" /><span><span className="block text-xs font-bold">学习数据共享</span><span className="block text-[11px] text-ink-muted mt-0.5">通过分享码授权伙伴只读查看学习进度</span></span></span>
          <ChevronRight size={15} className="text-ink-muted shrink-0" />
        </button>

        {/* 必要的账号与数据设置 */}
        <div
          onClick={() => setShowDataSettingsModal(true)}
          className="flex items-center justify-between px-4 py-3.5 hover:bg-cream/40 cursor-pointer transition-colors active:bg-cream/60"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-amber-50 flex items-center justify-center text-amber-700">
              <Shield size={16} />
            </div>
            <div>
              <div className="text-xs font-bold text-ink-main">必要的账号与数据设置</div>
              <div className="text-[11px] text-ink-muted mt-0.5">
                缓存清理、应急快照还原与资料重置
              </div>
            </div>
          </div>
          <ChevronRight size={15} className="text-ink-muted/60" />
        </div>

        {/* 退出登录 */}
        <div
          onClick={onOpenLogoutConfirm}
          className="flex items-center justify-between px-4 py-3.5 hover:bg-red-50/40 cursor-pointer transition-colors active:bg-red-50/60"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-red-50 flex items-center justify-center text-alarm">
              <LogOut size={16} />
            </div>
            <div>
              <div className="text-xs font-bold text-alarm">退出登录</div>
              <div className="text-[11px] text-ink-muted mt-0.5">
                退出当前账号，未同步学情安全保留在设备
              </div>
            </div>
          </div>
          <ChevronRight size={15} className="text-ink-muted/60" />
        </div>
      </Card>

      <EmailRemindersModal key={`email:${currentUser?.id ?? 'guest'}`} isOpen={showEmailReminders && Boolean(currentUser)} onClose={() => setShowEmailReminders(false)} onToast={onToast} />
      <SharingModal key={`sharing:${currentUser?.id ?? 'guest'}`} isOpen={showSharing && Boolean(currentUser)} onClose={() => setShowSharing(false)} onToast={onToast} />

      {/* 3. 统一的应用更新弹窗 (R16/R17) */}
      <UpdateModal
        isOpen={showUpdateModal}
        onClose={() => setShowUpdateModal(false)}
        onToast={onToast}
        result={updateCheckState}
        isChecking={isCheckingUpdate}
        onRecheck={() => { void checkForUpdate(true); }}
        canActivate={updateGuard}
        onApplied={() => {
          onToast('更新已激活，即将刷新页面');
          setTimeout(() => window.location.reload(), 400);
        }}
      />

      {/* 4. 关于应用弹窗 */}
      <Modal
        isOpen={showAboutModal}
        onClose={() => setShowAboutModal(false)}
        title="关于考公工作台"
      >
        <div className="space-y-4 text-xs">
          <div className="flex flex-col items-center text-center p-3">
            <div className="w-16 h-16 rounded-2xl bg-cream border border-line flex items-center justify-center p-2 mb-2 shadow-soft">
              <img
                src="/branding/logo-transparent.png"
                alt="Logo"
                className="w-full h-full object-contain"
              />
            </div>
            <h3 className="text-sm font-bold text-ink-main">考公工作台 · 土豆新版</h3>
            <p className="text-[11px] text-ink-muted mt-0.5">公考考生个人陪伴与学情复盘工具</p>
          </div>

          <div className="bg-cream/60 p-3 rounded-2xl border border-line space-y-2">
            <div className="flex justify-between">
              <span className="text-ink-muted">网页运行版本</span>
              <span className="font-mono font-bold text-ink-main">v{CURRENT_WEB_VERSION}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-muted">构建编号</span>
              <span className="font-mono text-ink-main">{CURRENT_WEB_BUILD}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-muted">数据保存</span>
              <span className="text-ink-main">本机自动保存 · 联网自动同步</span>
            </div>
          </div>

          <p className="text-[11px] text-ink-muted leading-relaxed text-center">
            致力于为公考备考者提供纯粹、轻量、可靠的手动刷题记录与学情复盘，不含繁杂题库与广告干扰。
          </p>
        </div>
      </Modal>

      {/* 5. 必要的账号与数据设置弹窗 */}
      <Modal
        isOpen={showDataSettingsModal}
        onClose={() => setShowDataSettingsModal(false)}
        title="账号与数据安全设置"
      >
        <div className="space-y-4 text-xs">
          {/* 清理本地缓存 */}
          <div className="p-3 bg-cream/60 border border-line rounded-2xl flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-bold text-ink-main flex items-center gap-1.5">
                <Trash2 size={14} className="text-ink-muted" />
                清理本地临时缓存
              </div>
              <div className="text-[11px] text-ink-muted mt-0.5 leading-relaxed">
                只释放可安全重建的旧缓存，不会删除账号快照、未同步学情、待处理照片与恢复点
              </div>
              {hasUnsyncedChanges && (
                <div className="text-[10px] text-amber-700 mt-1">
                  当前有 {pendingSyncCount} 项未同步内容，清理将自动保留这些数据
                </div>
              )}
            </div>
            <Button variant="secondary" size="sm" onClick={handleClearCache}>
              清理缓存
            </Button>
          </div>

          {/* 应急恢复点还原 */}
          <div className="p-3 bg-sage-light/40 border border-sage/30 rounded-2xl flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-bold text-ink-main flex items-center gap-1.5">
                <RotateCcw size={14} className="text-sage" />
                还原最近应急恢复点
              </div>
              <div className="text-[11px] text-ink-muted mt-0.5 leading-relaxed">
                {latestRecovery
                  ? `保存时间: ${new Date(latestRecovery.updatedAt).toLocaleString()} · 本地版本 ${latestRecovery.revision}`
                  : '暂无恢复点：重置、导入、冲突覆盖与游客迁移前都会自动保存恢复快照'}
              </div>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={handleRestoreRecovery}
              disabled={isRestoringRecovery || !latestRecovery}
            >
              {isRestoringRecovery ? '还原中...' : '还原该快照'}
            </Button>
          </div>

          {/* 重置当前题库 (危险操作，自动先建恢复点) */}
          <div className="p-3 bg-red-50/50 border border-red-200/80 rounded-2xl flex items-center justify-between gap-3">
            <div>
              <div className="font-bold text-alarm flex items-center gap-1.5">
                <AlertTriangle size={14} className="text-alarm" />
                重置工作台题库
              </div>
              <div className="text-[11px] text-ink-muted mt-0.5 leading-relaxed">
                清空学习记录、错题与进度（保留题本/网课资料）。执行前会先持久化恢复点，失败则停止重置
              </div>
            </div>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                setShowDataSettingsModal(false);
                onOpenResetConfirm();
              }}
            >
              重置题库
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
