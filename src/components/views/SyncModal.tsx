import React from 'react';
import { Modal, Button, Card, Tag } from '../common/UIComponents';
import { Cloud, Upload, Download, RefreshCw, CheckCircle2, ShieldCheck, Info } from 'lucide-react';
import { PotatoSprite } from '../common/PotatoSprite';

interface SyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenUploadConfirm: () => void;
  onOpenPullConfirm: () => void;
  onToast: (msg: string) => void;
}

export const SyncModal: React.FC<SyncModalProps> = ({
  isOpen,
  onClose,
  onOpenUploadConfirm,
  onOpenPullConfirm,
  onToast,
}) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="云端同步管理 (13:976)">
      <div className="space-y-4">
        {/* 顶部云端状态大卡片 */}
        <div className="bg-gradient-to-b from-sage-light/60 to-cream/40 rounded-2xl p-5 border border-sage/30 flex flex-col items-center text-center">
          <div className="relative mb-2">
            <PotatoSprite pose={0} size={76} />
            <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-sage text-white flex items-center justify-center shadow-md">
              <Cloud size={13} />
            </div>
          </div>
          <h3 className="text-base font-bold text-ink-main">本机数据已受保护</h3>
          <p className="text-xs text-ink-muted mt-1 leading-relaxed max-w-[260px]">
            联网时自动双向同步；离线时修改会可靠暂存本机并保留待同步队列，恢复连接后自动补传。
          </p>
          <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 bg-paper rounded-full text-[11px] text-ink-muted font-medium border border-line">
            <CheckCircle2 size={12} className="text-sage" />
            <span>自动同步已启用 · 离线可靠暂存</span>
          </div>
        </div>

        {/* 覆盖同步操作说明 */}
        <div className="space-y-2.5">
          <div className="text-xs font-bold text-ink-main">手动数据同步控制</div>

          <Card className="p-3 bg-paper border-line flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-sage-light flex items-center justify-center text-sage">
                <Upload size={16} />
              </div>
              <div>
                <div className="text-xs font-bold text-ink-main">上传本机覆盖云端</div>
                <div className="text-[10px] text-ink-muted">以当前手机记录为准推送到服务器</div>
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={() => { onClose(); onOpenUploadConfirm(); }}>
              上传覆盖
            </Button>
          </Card>

          <Card className="p-3 bg-paper border-line flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-potato-light flex items-center justify-center text-potato-dark">
                <Download size={16} />
              </div>
              <div>
                <div className="text-xs font-bold text-ink-main">从云端拉取覆盖</div>
                <div className="text-[10px] text-ink-muted">拉取服务器存档替换当前手机记录</div>
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={() => { onClose(); onOpenPullConfirm(); }}>
              拉取覆盖
            </Button>
          </Card>
        </div>

        {/* 提示说明 (Fixes A15) */}
        <div className="p-3 bg-cream/70 rounded-xl text-[11px] text-ink-muted leading-relaxed border border-line/60 flex items-start gap-2">
          <Info size={14} className="text-sage shrink-0 mt-0.5" />
          <span>
            提示：跨设备同步需要配置远端后端服务。若在无网络环境下学习，建议使用“设置 - 本地 JSON 备份”导出离线文件。
          </span>
        </div>
      </div>
    </Modal>
  );
};
