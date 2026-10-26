import React from 'react';
import { Modal, Button } from '../common/UIComponents';
import { PotatoSprite } from '../common/PotatoSprite';
import { Download, CheckCircle2 } from 'lucide-react';

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
          <h3 className="text-base font-bold text-ink-main">考公工作台 · 安卓正式独立版</h3>
          <p className="text-xs text-ink-muted mt-1 leading-relaxed">
            专为 Android 设备优化的原生 WebView 独立容器，全屏沉浸，支持离线做题与错题拍照。
          </p>
        </div>

        <div className="p-3 bg-cream/70 rounded-xl text-left text-xs text-ink-muted space-y-1.5 border border-line">
          <div className="flex items-center gap-1.5 text-ink-main font-bold">
            <CheckCircle2 size={13} className="text-sage" />
            <span>版本 v1.0.1 (Build 20261026.02)</span>
          </div>
          <div>• 采用原生 AppCompatActivity + WebView 容器架构</div>
          <div>• 针对 412×915、393×873 等主流安卓分辨率深度校核</div>
          <div>• 数据本地持久化，断网环境下计时刷题依然完整可用</div>
          <div>• 严格校验 SSL 证书，禁止明文混合加载，安全隔离</div>
        </div>

        <a
          href="/api/download/apk"
          download="kaogong-potato-v1.0.1.apk"
          className="block w-full"
        >
          <Button
            variant="primary"
            size="md"
            fullWidth
            className="shadow-sm"
          >
            <Download size={16} />
            立即下载 Android 安装包 (APK)
          </Button>
        </a>
      </div>
    </Modal>
  );
};
