import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { PotatoSprite } from '../common/PotatoSprite';
import { Card, Button, Tag, Modal } from '../common/UIComponents';
import { Smartphone, Cloud, Download, Upload, ShieldCheck, RefreshCw, User, LogIn, UserPlus, LogOut, FileText, CheckCircle2, AlertTriangle } from 'lucide-react';

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
}) => {
  const { state, exportBackup, importBackup, selfCheck } = useApp();
  const [checkResult, setCheckResult] = useState<{ ok: boolean; message: string; details: string[] } | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Check login status (in this new isolated project, we display state.profile.username)
  const isGuest = !state.profile.username || state.profile.username === 'guest';

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
      const result = importBackup(reader.result as string);
      if (result.success) {
        onToast('数据导入成功，已自动重新关联事项库！');
      } else {
        onToast(`导入失败: ${result.error}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-4 pb-24">
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
    </div>
  );
};
