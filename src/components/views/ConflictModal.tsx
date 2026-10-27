import React, { useState, useEffect } from 'react';
import { Modal, Button, Card } from '../common/UIComponents';
import { AlertTriangle, ArrowUpRight, ArrowDownLeft, ShieldCheck, Clock } from 'lucide-react';
import { AppState, MutationResult } from '../../types';
import { countWrongAttachments } from '../../utils/db';

export interface ConflictModalProps {
  isOpen: boolean;
  onClose: () => void;
  localState: AppState;
  localRevision: number;
  serverState: AppState | null;
  serverRevision: number;
  onKeepLocal: () => Promise<MutationResult<void>>;
  onKeepRemote: () => Promise<MutationResult<void>>;
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
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittingChoice, setSubmittingChoice] = useState<'local' | 'remote' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setIsSubmitting(false);
      setSubmittingChoice(null);
      setErrorMessage(null);
    }
  }, [isOpen]);

  const handleResolve = async (choice: 'local' | 'remote') => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setSubmittingChoice(choice);
    setErrorMessage(null);
    try {
      const action = choice === 'local' ? onKeepLocal : onKeepRemote;
      const res = await action();
      if (!res.ok) {
        setErrorMessage(res.message || '处理冲突失败，请重试');
      }
    } catch (err: any) {
      setErrorMessage(err?.message || '处理冲突发生异常，请重试');
    } finally {
      setIsSubmitting(false);
      setSubmittingChoice(null);
    }
  };

  const handleDefer = () => {
    if (isSubmitting) return;
    onClose();
  };

  const localPlansCount = localState?.plans?.length ?? 0;
  const localRecordsCount = localState?.records?.length ?? 0;
  const localWrongCount = localState?.wrong?.length ?? 0;
  const localPhotosCount = countWrongAttachments(localState?.wrong ?? []);

  const serverPlansCount = serverState?.plans?.length ?? 0;
  const serverRecordsCount = serverState?.records?.length ?? 0;
  const serverWrongCount = serverState?.wrong?.length ?? 0;
  const serverPhotosCount = countWrongAttachments(serverState?.wrong ?? []);

  return (
    <Modal isOpen={isOpen} onClose={handleDefer} title="检测到数据版本冲突">
      <div className="space-y-4">
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-2.5 text-ink-main">
          <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <div className="font-bold">云端版本与本机记录存在分叉差异</div>
            <div className="text-ink-muted leading-relaxed">
              可能其他设备提交了新进度，或经历了灾备恢复。系统已为您自动在本地保存恢复快照，请选择以哪方记录为准：
            </div>
          </div>
        </div>

        {/* 错误提示横条（如果裁决失败，留在弹窗内明确报错） */}
        {errorMessage && (
          <div className="p-2.5 bg-alarm-light text-alarm border border-alarm/30 rounded-xl flex items-start gap-2 text-xs">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" />
            <div className="flex-1 leading-relaxed font-medium">{errorMessage}</div>
          </div>
        )}

        {/* 双方版本对比卡片 */}
        <div className="grid grid-cols-2 gap-2.5">
          <Card className="p-3 bg-paper border-line text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-ink-main">当前本机记录</span>
              <span className="text-[10px] text-ink-muted font-mono">
                版本 Rev {localRevision}
              </span>
            </div>
            <div className="text-[11px] text-ink-muted">
              全部日程计划: <span className="font-mono font-bold text-ink-main">{localPlansCount}</span> 项
            </div>
            <div className="text-[11px] text-ink-muted">
              学习打卡记录: <span className="font-mono font-bold text-ink-main">{localRecordsCount}</span> 条
            </div>
            <div className="text-[11px] text-ink-muted">
              错题笔记条目: <span className="font-mono font-bold text-ink-main">{localWrongCount}</span> 条
            </div>
            <div className="text-[11px] text-ink-muted">
              错题照片附件: <span className="font-mono font-bold text-ink-main">{localPhotosCount}</span> 张
            </div>
          </Card>

          <Card className="p-3 bg-paper border-line text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-ink-main">云端最新版本</span>
              <span className="text-[10px] text-ink-muted font-mono">
                版本 Rev {serverRevision}
              </span>
            </div>
            <div className="text-[11px] text-ink-muted">
              全部日程计划: <span className="font-mono font-bold text-ink-main">{serverPlansCount}</span> 项
            </div>
            <div className="text-[11px] text-ink-muted">
              学习打卡记录: <span className="font-mono font-bold text-ink-main">{serverRecordsCount}</span> 条
            </div>
            <div className="text-[11px] text-ink-muted">
              错题笔记条目: <span className="font-mono font-bold text-ink-main">{serverWrongCount}</span> 条
            </div>
            <div className="text-[11px] text-ink-muted">
              错题照片附件: <span className="font-mono font-bold text-ink-main">{serverPhotosCount}</span> 张
            </div>
          </Card>
        </div>

        {/* 冲突解决操作决策 */}
        <div className="space-y-2 pt-1">
          <Button
            variant="secondary"
            className="w-full justify-between text-xs py-2.5"
            onClick={() => handleResolve('remote')}
            disabled={isSubmitting}
          >
            <span className="flex items-center gap-1.5">
              <ArrowDownLeft size={14} className="text-sage" />
              {submittingChoice === 'remote' ? '正在采用云端记录...' : '采用云端记录（覆盖本机）'}
            </span>
            <span className="text-[10px] text-ink-muted">自动先存本机恢复快照</span>
          </Button>

          <Button
            variant="primary"
            className="w-full justify-between text-xs py-2.5"
            onClick={() => handleResolve('local')}
            disabled={isSubmitting}
          >
            <span className="flex items-center gap-1.5">
              <ArrowUpRight size={14} />
              {submittingChoice === 'local' ? '正在推送到云端...' : '保留本机记录（覆盖云端）'}
            </span>
            <span className="text-[10px] text-white/80">以当前手机为准推送到云端</span>
          </Button>

          <Button
            variant="ghost"
            className="w-full justify-center text-xs py-2 text-ink-muted hover:text-ink-main border border-line/60"
            onClick={handleDefer}
            disabled={isSubmitting}
          >
            稍后处理 (暂缓)
          </Button>
        </div>
      </div>
    </Modal>
  );
};
