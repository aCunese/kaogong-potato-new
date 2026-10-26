import React from 'react';
import { Modal, Button } from '../common/UIComponents';
import { PotatoSprite } from '../common/PotatoSprite';
import { Download, AlertCircle } from 'lucide-react';

export const DownloadApkModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="专属 Android 安装包">
      <div className="space-y-4 text-center py-2">
        <div className="my-2">
          <PotatoSprite pose={5} size={84} />
        </div>

        <div>
          <h3 className="text-base font-bold text-ink-main">考公工作台 · 安卓离线独立版</h3>
          <p className="text-xs text-ink-muted mt-1 leading-relaxed">
            当前阶段为纯前端离线阶段，Android 独立安装包将在后续真机打包阶段生成交付。
          </p>
        </div>

        <div className="p-3 bg-cream/70 rounded-xl text-left text-xs text-ink-muted space-y-1.5 border border-line">
          <div>• 采用原生 AppCompatActivity + WebView 容器架构</div>
          <div>• 针对 412×915、393×873 等主流安卓分辨率深度校核</div>
          <div>• 数据本地持久化，断网环境下计时刷题依然完整可用</div>
        </div>

        <Button
          variant="secondary"
          size="md"
          fullWidth
          disabled
          className="opacity-60 cursor-not-allowed"
        >
          <Download size={16} />
          未生成安装包（纯前端离线阶段）
        </Button>
      </div>
    </Modal>
  );
};
