import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { PotatoSprite } from '../common/PotatoSprite';
import { Card, Button, Tag, Modal } from '../common/UIComponents';
import { validateAndMigrateBackup, BackupValidationResult } from '../../utils/backupValidator';
import { Smartphone, Cloud, Download, Upload, ShieldCheck, RefreshCw, User, LogIn, UserPlus, LogOut, FileText, CheckCircle2, AlertTriangle, AlertCircle } from 'lucide-react';

interface SettingsViewProps {
  onOpenLogin: () => void;
  onOpenRegister: () => void;
  onOpenSync: () => void;
  onOpenBackup: () => void;
  onOpenProfile: () => void;
  onOpenDownloadApk: () => void;
  onOpenResetConfirm: () => void;
  onOpenLogoutConfirm: () => void;
  onToast: (msg: string) => void;
  forcedGuestMode?: boolean; // For isolated guest preview (Fixes A07)
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  onOpenLogin,
  onOpenRegister,
  onOpenSync,
  onOpenBackup,
  onOpenProfile,
  onOpenDownloadApk,
  onOpenResetConfirm,
  onOpenLogoutConfirm,
  onToast,
  forcedGuestMode = false,
}) => {
  const { state, exportBackup, importBackup, selfCheck, storageError, clearStorageError } = useApp();
  const [checkResult, setCheckResult] = useState<{ ok: boolean; message: string; details: string[] } | null>(null);
  const [pendingBackup, setPendingBackup] = useState<{ content: string; validation: BackupValidationResult } | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Check login status (supports forcedGuestMode for A07 guest matrix inspection)
  const isGuest = forcedGuestMode || !state.profile.username || state.profile.username === 'guest';

  const handleSelfCheck = () => {
    const res = selfCheck();
    setCheckResult(res);
    onToast(res.message);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      // Pre-flight Schema validation and migration inspection (Fixes A02)
      const validation = validateAndMigrateBackup(content);
      if (!validation.valid || !validation.summary) {
        onToast(`备份文件校验失败: ${validation.error || '格式不正确'}`);
        alert(`导入被拒绝：\n${validation.error || '无法解析的备份文件'}`);
        return;
      }

      // Open explicit confirmation modal before overwriting user state
      setPendingBackup({ content, validation });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleConfirmImport = () => {
    if (!pendingBackup) return;
    const res = importBackup(pendingBackup.content);
    if (res.success) {
      onToast('备份导入成功，已完整恢复数据！');
      setPendingBackup(null);
    } else {
      onToast(`导入失败: ${res.error}`);
    }
  };

  return (
    <div className="space-y-4 pb-24">
      {/* Storage Quota Warning Card if any (Fixes A01) */}
      {storageError && (
        <div className="p-3 bg-alarm/10 border border-alarm/30 rounded-2xl flex items-start gap-2.5 text-xs text-alarm">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-bold">本地存储异常</div>
            <div className="mt-0.5 leading-relaxed">{storageError}</div>
          </div>
          <button onClick={clearStorageError} className="underline text-[11px] shrink-0">关闭提示</button>
        </div>
      )}
      {/* 头部与用户身份卡片 */}
      <Card className="p-4 bg-gradient-to-br from-paper to-cream/70 border-line">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              onClick={onOpenProfile}
              className="w-14 h-14 rounded-2xl bg-paper border-2 border-line overflow-hidden flex items-center justify-center cursor-pointer shadow-soft active:scale-95 transition-transform"
            >
              {state.profile.avatar ? (
                <img src={state.profile.avatar} alt="头像" className="w-full h-full object-cover" />
              ) : (
                <PotatoSprite pose={0} size={50} />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-ink-main">{state.profile.name}</h2>
                <Tag variant={isGuest ? 'gray' : 'sage'}>
                  {isGuest ? '离线模式' : `@${state.profile.username}`}
                </Tag>
              </div>
              <p className="text-xs text-ink-muted mt-0.5">
                {isGuest ? '数据仅保存在当前设备，支持随时备份' : '已连接专属账号，支持多端数据同步'}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onOpenProfile}>
            编辑资料
          </Button>
        </div>
      </Card>

      {/* 1. 安卓安装包卡片 */}
      <Card className="p-4 bg-paper border-line">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Smartphone size={16} className="text-sage" />
              <h3 className="text-sm font-bold text-ink-main">手机 App 安装包</h3>
              <Tag variant="potato">Android 独立版</Tag>
            </div>
            <p className="text-xs text-ink-muted leading-relaxed">
              专为 Android 打造的 WebView 独立壳，全屏沉浸操作，桌面一触即发。
            </p>
          </div>
          <Button variant="primary" size="sm" onClick={onOpenDownloadApk}>
            <Download size={14} />
            查看安装包
          </Button>
        </div>
      </Card>

      {/* 2. 云端账号与同步 */}
      <Card className="p-4 bg-paper border-line space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cloud size={16} className="text-sage" />
            <h3 className="text-sm font-bold text-ink-main">云端多用户同步</h3>
          </div>
          <Tag variant={isGuest ? 'gray' : 'sage'}>
            {isGuest ? '未登录' : '已就绪'}
          </Tag>
        </div>

        <p className="text-xs text-ink-muted leading-relaxed">
          {isGuest
            ? '当前为离线模式。登录或注册专属备考账号，可将做题数据与复盘进度自动备份至服务端。'
            : `当前已登录账号：${state.profile.username}。可进行手动数据上传或从云端拉取覆盖。`}
        </p>

        <div className="flex gap-2 pt-1">
          {isGuest ? (
            <>
              <Button variant="primary" size="sm" fullWidth onClick={onOpenLogin}>
                <LogIn size={14} />
                登录账号
              </Button>
              <Button variant="secondary" size="sm" fullWidth onClick={onOpenRegister}>
                <UserPlus size={14} />
                注册新学员
              </Button>
            </>
          ) : (
            <>
              <Button variant="primary" size="sm" fullWidth onClick={onOpenSync}>
                <RefreshCw size={14} />
                同步管理
              </Button>
              <Button variant="danger" size="sm" onClick={onOpenLogoutConfirm}>
                <LogOut size={14} />
                退出
              </Button>
            </>
          )}
        </div>
      </Card>

      {/* 3. 本地文件备份 */}
      <Card className="p-4 bg-paper border-line space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-sage" />
            <h3 className="text-sm font-bold text-ink-main">本地 JSON 备份</h3>
          </div>
          <Tag variant="gray">离线双保险</Tag>
        </div>

        <p className="text-xs text-ink-muted leading-relaxed">
          将题本、课程、每日计划、学习记录及错题笔记完整导出为标准 JSON 备份，随时导入恢复。
        </p>

        <div className="flex gap-2 pt-1">
          <Button variant="secondary" size="sm" fullWidth onClick={exportBackup}>
            <Download size={14} />
            导出备份 (JSON)
          </Button>
          <Button
            variant="secondary"
            size="sm"
            fullWidth
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={14} />
            导入恢复
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={handleFileInput}
          />
        </div>
      </Card>

      {/* 4. 数据一致性自检 */}
      <Card className="p-4 bg-paper border-line space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-sage" />
            <h3 className="text-sm font-bold text-ink-main">数据自检与修复</h3>
          </div>
          <Button variant="secondary" size="sm" onClick={handleSelfCheck}>
            立即自检
          </Button>
        </div>

        <p className="text-xs text-ink-muted leading-relaxed">
          自动校验题本/课程与事项库的一对一映射、倒计时有效性以及来源 ID 的完整性。
        </p>

        {checkResult && (
          <div className="p-3 bg-cream/70 rounded-xl text-xs space-y-1.5 border border-line">
            <div className="font-bold flex items-center gap-1.5 text-sage">
              <CheckCircle2 size={14} />
              {checkResult.message}
            </div>
            {checkResult.details.map((item, idx) => (
              <div key={idx} className="text-ink-muted pl-5">
                • {item}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 5. 危险重置区 */}
      <Card className="p-4 bg-paper border-line space-y-2.5">
        <div className="flex items-center gap-2 text-alarm">
          <AlertTriangle size={16} />
          <h3 className="text-sm font-bold">恢复初始工作台数据</h3>
        </div>
        <p className="text-xs text-ink-muted leading-relaxed">
          恢复为初始示例数据（含14本题本、7门网课、1260分钟学情基准）。请确保在重置前已导出备份。
        </p>
        <Button variant="danger" size="sm" onClick={onOpenResetConfirm}>
          恢复初始数据
        </Button>
      </Card>

      {/* 导入确认覆盖弹窗 (Fixes A02) */}
      {pendingBackup && pendingBackup.validation.summary && (
        <Modal
          isOpen={true}
          onClose={() => setPendingBackup(null)}
          title="用这份备份恢复？"
        >
          <div className="space-y-4 text-center">
            <div className="flex justify-center">
              <PotatoSprite pose={5} size={70} />
            </div>
            <div>
              <div className="text-sm font-bold text-ink-main">
                即将覆盖当前本地数据
              </div>
              <p className="text-xs text-ink-muted mt-1 leading-relaxed">
                导入后将使用备份中的数据完全替换当前工作台内容。建议在恢复前先导出当前进度的本地备份。
              </p>
            </div>

            <div className="bg-cream/70 rounded-xl p-3 text-xs text-left space-y-1.5 border border-line">
              <div className="font-bold text-ink-main border-b border-line pb-1 mb-1">
                备份内容预览
              </div>
              <div className="flex justify-between text-ink-muted">
                <span>用户昵称</span>
                <span className="font-medium text-ink-main">{pendingBackup.validation.summary.profileName}</span>
              </div>
              <div className="flex justify-between text-ink-muted">
                <span>题本数量</span>
                <span className="font-medium text-ink-main">{pendingBackup.validation.summary.bookCount} 本</span>
              </div>
              <div className="flex justify-between text-ink-muted">
                <span>网课课程</span>
                <span className="font-medium text-ink-main">{pendingBackup.validation.summary.courseCount} 门</span>
              </div>
              <div className="flex justify-between text-ink-muted">
                <span>学习记录</span>
                <span className="font-medium text-ink-main">{pendingBackup.validation.summary.recordCount} 条</span>
              </div>
              <div className="flex justify-between text-ink-muted">
                <span>错题笔记</span>
                <span className="font-medium text-ink-main">{pendingBackup.validation.summary.wrongCount} 条</span>
              </div>
              <div className="flex justify-between text-ink-muted">
                <span>倒计时目标</span>
                <span className="font-medium text-ink-main">{pendingBackup.validation.summary.countdownCount} 个</span>
              </div>
            </div>

            <div className="flex gap-2.5 pt-2">
              <Button
                variant="secondary"
                size="md"
                fullWidth
                onClick={() => setPendingBackup(null)}
              >
                再想想
              </Button>
              <Button
                variant="danger"
                size="md"
                fullWidth
                onClick={handleConfirmImport}
              >
                确认导入覆盖
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
