import React from 'react';
import { Modal, Button, Card, Tag } from '../common/UIComponents';
import { Download, Upload, ShieldCheck, CheckCircle2, AlertTriangle, FileText, Database } from 'lucide-react';
import { PotatoSprite } from '../common/PotatoSprite';
import { useApp } from '../../context/AppContext';

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
  const { state, exportBackup, selfCheck } = useApp();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="数据备份与恢复 (13:1095)">
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

        {/* 备份操作区 */}
        <div className="grid grid-cols-2 gap-3">
          <Button
            variant="primary"
            size="md"
            fullWidth
            onClick={() => {
              exportBackup();
              onToast('备份文件已成功生成并下载！');
            }}
          >
            <Download size={16} />
            导出 JSON 备份
          </Button>

          <Button
            variant="secondary"
            size="md"
            fullWidth
            onClick={() => {
              onClose();
              onToast('请在“我的”页面点击导入恢复并选择文件');
            }}
          >
            <Upload size={16} />
            导入恢复备份
          </Button>
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
            • 错题归档：{state.wrong.length} 条错题照片笔记
          </div>
        </div>

        {/* 重置引导 */}
        <div className="pt-2 border-t border-line/60 flex items-center justify-between text-xs">
          <span className="text-ink-muted">需要清空并恢复默认数据？</span>
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
  );
};
