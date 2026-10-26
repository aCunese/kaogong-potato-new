import React from 'react';
import { Modal, Button, Card } from '../common/UIComponents';
import { AlertTriangle, Download, ArrowUpRight, ArrowDownLeft, ShieldCheck } from 'lucide-react';
import { AppState } from '../../types';

interface ConflictModalProps {
  isOpen: boolean;
  onClose: () => void;
  localState: AppState;
  localRevision: number;
  serverState: AppState | null;
  serverRevision: number;
  onKeepLocal: () => void;
  onKeepRemote: () => void;
  onExportLocal: () => void;
  onExportServer: () => void;
}

export const ConflictModal: React.FC<ConflictModalProps> = ({
  isOpen,
  onClose,
  localState,
  localRevision,
  serverState,
  serverRevision,
  onKeepLocal,
  onKeepRemote,
  onExportLocal,
  onExportServer,
}) => {
  const localPlansCount = localState.plans.length;
  const localRecordsCount = localState.records.length;
  const serverPlansCount = serverState?.plans.length ?? 0;
  const serverRecordsCount = serverState?.records.length ?? 0;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="检测到数据版本冲突">
      <div className="space-y-4">
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-2.5 text-ink-main">
          <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs leading-relaxed">
            <div className="font-bold text-amber-800">云端与本机记录存在不一致</div>
            <div className="text-ink-muted text-[11px] mt-0.5">
              其他设备已向云端提交了新记录，或者服务器执行了维护。为防止意外覆盖，请核对后选择保留方案。
            </div>
          </div>
        </div>

        {/* 版本对照卡片 */}
        <div className="grid grid-cols-2 gap-3">
          <Card className="p-3 bg-paper border-line text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-ink-main">本机当前版本</span>
              <span className="text-[10px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-mono">
                Rev {localRevision}
              </span>
            </div>
            <div className="text-[11px] text-ink-muted">
              今日日程: <span className="font-mono font-bold text-ink-main">{localPlansCount}</span> 条
            </div>
            <div className="text-[11px] text-ink-muted">
              累计记录: <span className="font-mono font-bold text-ink-main">{localRecordsCount}</span> 条
            </div>
            <Button
              variant="light"
              size="sm"
              className="w-full mt-2 text-[11px] py-1"
              onClick={onExportLocal}
            >
              <Download size={12} className="mr-1" />
              导出本机备份
            </Button>
          </Card>

          <Card className="p-3 bg-paper border-line text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-ink-main">云端最新版本</span>
              <span className="text-[10px] bg-sage-light text-sage px-1.5 py-0.5 rounded font-mono">
                Rev {serverRevision}
              </span>
            </div>
            <div className="text-[11px] text-ink-muted">
              今日日程: <span className="font-mono font-bold text-ink-main">{serverPlansCount}</span> 条
            </div>
            <div className="text-[11px] text-ink-muted">
              累计记录: <span className="font-mono font-bold text-ink-main">{serverRecordsCount}</span> 条
            </div>
            <Button
              variant="light"
              size="sm"
              className="w-full mt-2 text-[11px] py-1"
              onClick={onExportServer}
              disabled={!serverState}
            >
              <Download size={12} className="mr-1" />
              导出云端备份
            </Button>
          </Card>
        </div>

        {/* 操作决策 */}
        <div className="space-y-2 pt-1">
          <Button
            variant="secondary"
            className="w-full justify-between text-xs py-2.5"
            onClick={onKeepRemote}
          >
            <span className="flex items-center gap-1.5">
              <ArrowDownLeft size={14} className="text-sage" />
              采用云端记录（覆盖本机）
            </span>
            <span className="text-[10px] text-ink-muted">自动先存本机恢复快照</span>
          </Button>

          <Button
            variant="primary"
            className="w-full justify-between text-xs py-2.5"
            onClick={onKeepLocal}
          >
            <span className="flex items-center gap-1.5">
              <ArrowUpRight size={14} />
              保留本机记录（覆盖云端）
            </span>
            <span className="text-[10px] text-white/80">以当前手机为准推送到云端</span>
          </Button>
        </div>
      </div>
    </Modal>
  );
};
