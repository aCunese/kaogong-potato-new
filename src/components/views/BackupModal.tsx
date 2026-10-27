import React, { useState, useRef, useEffect } from 'react';
import { Modal, Button, Card, Tag, ConfirmModal } from '../common/UIComponents';
import { Download, Upload, ShieldCheck, CheckCircle2, AlertTriangle, FileText, Database } from 'lucide-react';
import { PotatoSprite } from '../common/PotatoSprite';
import { useApp } from '../../context/AppContext';
import { validateAndMigrateBackup, BackupValidationResult } from '../../utils/backupValidator';
import { countWrongAttachments } from '../../utils/db';

interface BackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenResetConfirm: () => void;
  onToast: (msg: string) => void;
}

export const BackupModal: React.FC<BackupModalProps> = ({
  isOpen,
  onClose,
  onOpenResetConfirm,
  onToast,
}) => {
  const { state, exportBackup, importBackup, currentUser } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingBackup, setPendingBackup] = useState<{
    content: string;
    validation: BackupValidationResult;
    userId: string | null;
  } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [sizeWarning, setSizeWarning] = useState('');
  const openRef = useRef(isOpen);
  openRef.current = isOpen;

  const currentUserId = currentUser?.id ?? null;
  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;

  useEffect(() => {
    if (!isOpen) {
      setPendingBackup(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
    setError('');
    setSizeWarning('');
  }, [isOpen]);

  useEffect(() => {
    setPendingBackup(null);
    setError('');
    setSizeWarning('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [currentUserId]);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    setError('');
    setSizeWarning('');
    try {
      const result = await exportBackup();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      const receipt = result.value;
      const isNearLimit = receipt.status !== 'cancelled' && typeof receipt.bytes === 'number' && receipt.bytes >= 40 * 1024 * 1024;
      if (isNearLimit) {
        setSizeWarning(`提示：本次备份体积已达 ${(receipt.bytes / (1024 * 1024)).toFixed(1)}MB，正在接近单文件 50MB 导出上限。建议及时清理无用的历史错题照片。`);
      }
      if (receipt.status === 'saved') {
        onToast(isNearLimit ? '备份已保存到设备。注意：文件体积已达 40MB+，正接近 50MB 导出上限！' : '备份文件已成功保存到您的设备');
      } else if (receipt.status === 'download_requested') {
        onToast(isNearLimit ? '已发起备份下载。注意：文件体积已达 40MB+，正接近 50MB 导出上限！' : '已发起备份文件下载，请在浏览器下载目录查看');
      } else if (receipt.status === 'cancelled') {
        onToast('已取消保存备份');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '备份导出失败');
    } finally {
      setExporting(false);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 50 * 1024 * 1024) {
      setError(`备份文件过大 (${(file.size / (1024 * 1024)).toFixed(1)}MB)，超出 50MB 上限限制`);
      e.target.value = '';
      return;
    }

    const chosenUserId = currentUserIdRef.current;
    const reader = new FileReader();
    reader.onload = () => {
      if (!openRef.current || currentUserIdRef.current !== chosenUserId) return;
      const content = reader.result as string;
      const validation = validateAndMigrateBackup(content);
      if (!validation.valid || !validation.summary) {
        onToast(`备份文件校验失败: ${validation.error || '格式不正确'}`);
        setError(validation.error || '无法解析的备份文件');
        return;
      }
      if (currentUserIdRef.current !== chosenUserId) return;
      setPendingBackup({ content, validation, userId: chosenUserId });
    };
    reader.onerror = () => {
      if (openRef.current && currentUserIdRef.current === chosenUserId) {
        setError('读取备份文件失败，请重新选择');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleConfirmImport = async () => {
    if (!pendingBackup || pendingBackup.userId !== currentUserIdRef.current) {
      setPendingBackup(null);
      setError('账号状态已变化，已取消待确认备份');
      return;
    }
    const res = await importBackup(pendingBackup.content);
    if (res.ok) {
      onToast('备份导入成功，已完整恢复数据！');
      setPendingBackup(null);
      onClose();
    } else {
      if (res.code === 'AUTH_EPOCH_CHANGED') {
        setPendingBackup(null);
      }
      return res;
    }
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="数据备份与恢复">
        <div className="space-y-4">
          {/* 顶部概览卡片 */}
          <div className="bg-paper border border-line rounded-2xl p-4 flex items-center gap-3">
            <PotatoSprite pose={3} size={64} />
            <div>
              <h3 className="text-sm font-bold text-ink-main">离线全量数据备份</h3>
              <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">
                随时生成标准 JSON 备份文件，换机或重装时一键恢复所有题本、进度与错题照片。
              </p>
            </div>
          </div>

          {/* 隐藏的 JSON 文件选择器 */}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={handleFileInput}
          />

          {/* 备份操作区 */}
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="primary"
              size="md"
              fullWidth
              onClick={handleExport}
              disabled={exporting}
            >
              <Download size={16} />
              {exporting ? '生成备份中…' : '导出 JSON 备份'}
            </Button>

            <Button
              variant="secondary"
              size="md"
              fullWidth
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={16} />
              导入恢复备份
            </Button>
          </div>
          {error && <p role="alert" className="text-xs text-alarm">{error}</p>}
          {sizeWarning && (
            <div role="status" className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2 text-xs text-amber-800">
              <AlertTriangle size={15} className="shrink-0 mt-0.5 text-amber-600" />
              <div className="flex-1 leading-relaxed font-medium">{sizeWarning}</div>
            </div>
          )}

          {/* 容量规格与配额提示 */}
          <div className="bg-cream/40 rounded-xl p-3 text-xs space-y-1.5 border border-line">
            <div className="font-bold text-ink-main flex items-center justify-between">
              <span>容量规格与配额说明</span>
              <span className="text-[10px] text-ink-muted">规格标准</span>
            </div>
            <div className="text-ink-muted leading-relaxed">
              • <b className="text-ink-main">离线 JSON 单文件上限</b>：单次导出最大限制为 <span className="font-semibold text-ink-main">50 MB</span>（含全部内联错题照片，达到 40 MB 起预警）。
            </div>
            <div className="text-ink-muted leading-relaxed">
              • <b className="text-ink-main">云端媒体存储配额</b>：同步服务器为当前账号提供 <span className="font-semibold text-ink-main">500 MB</span> 媒体云端存储总空间。
            </div>
          </div>

          {/* 资产统计 */}
          <div className="bg-cream/70 rounded-xl p-3 text-xs space-y-1.5 border border-line">
            <div className="font-bold text-ink-main flex items-center justify-between">
              <span>当前本地数据规模</span>
              <Tag variant="sage">健康</Tag>
            </div>
            <div className="text-ink-muted">
              • 题本数量：{state.books.length} 本（关联事项已一对一映射）
            </div>
            <div className="text-ink-muted">
              • 网课数量：{state.courses.length} 门
            </div>
            <div className="text-ink-muted">
              • 学习记录：{state.records.length} 条已归档
            </div>
            <div className="text-ink-muted">
              • 错题归档：{state.wrong.length} 条错题笔记
            </div>
            <div className="text-ink-muted">
              • 错题照片附件：{countWrongAttachments(state.wrong)} 张照片
            </div>
            <div className="text-ink-muted">
              • 考试倒计时：{state.countdowns.length} 个重点考试
            </div>
          </div>

          {/* 重置引导 */}
          <div className="pt-2 border-t border-line/60 flex items-center justify-between text-xs">
            <span className="text-ink-muted">需要清空当前学习数据？</span>
            <button
              onClick={() => {
                onClose();
                onOpenResetConfirm();
              }}
              className="text-alarm hover:underline font-medium"
            >
              恢复初始数据
            </button>
          </div>
        </div>
      </Modal>

      {/* 二次覆盖确认弹窗 */}
      {pendingBackup && pendingBackup.validation.summary && (
        <ConfirmModal
          isOpen={true}
          title="确认导入该备份文件？"
          message={`备份空间：「${pendingBackup.validation.summary.profileName || '未命名'}」。`}
          impactText={`导入将覆盖当前全部数据，包含：\n• ${pendingBackup.validation.summary.bookCount} 本题本\n• ${pendingBackup.validation.summary.courseCount} 门网课\n• ${pendingBackup.validation.summary.planCount} 项日程\n• ${pendingBackup.validation.summary.recordCount} 条做题记录\n• ${pendingBackup.validation.summary.wrongCount} 条错题笔记\n• ${pendingBackup.validation.summary.countdownCount} 个考试倒计时\n导入前系统将自动保存应急恢复快照，可在设置中随时还原。`}
          confirmText="确认覆盖导入"
          cancelText="取消"
          danger={true}
          onConfirm={handleConfirmImport}
          onCancel={() => setPendingBackup(null)}
        />
      )}
    </>
  );
};
