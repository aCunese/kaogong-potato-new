import React, { useState } from 'react';
import { Card, Button, Tag, ConfirmModal } from '../common/UIComponents';
import { AlertTriangle, Trash2, RotateCcw, UploadCloud, DownloadCloud, LogOut, FileUp } from 'lucide-react';

interface ConfirmModalsViewProps {
  onBack: () => void;
}

export const ConfirmModalsView: React.FC<ConfirmModalsViewProps> = ({ onBack }) => {
  const [activeModal, setActiveModal] = useState<string | null>(null);

  const confirmItems = [
    {
      id: 'confirm-book',
      fId: '13:3182',
      title: '删除题本确认',
      desc: '删除题本及其在事项库中的对应项目',
      impact: '影响：将一并从事项库中移除该题本，但已经产生的历史做题记录与累计数据仍会安全保留。',
      btnText: '测试“删除题本确认”',
      icon: Trash2,
      danger: true,
    },
    {
      id: 'confirm-course',
      fId: '13:3249',
      title: '删除网课确认',
      desc: '删除指定网课及事项库联动项目',
      impact: '影响：事项库中对应课程将被清理，已有听课记录与学习时间仍然保留在月度汇总中。',
      btnText: '测试“删除网课确认”',
      icon: Trash2,
      danger: true,
    },
    {
      id: 'confirm-photo',
      fId: '13:3316',
      title: '删除错题照片确认',
      desc: '从当前题本归档中永久移除该错题手稿照片',
      impact: '重要说明：删除照片仅移除图片记录与笔记，不会擅自减少题本中累计统计的错题总数。',
      btnText: '测试“删除照片确认”',
      icon: Trash2,
      danger: true,
    },
    {
      id: 'confirm-reset',
      fId: '13:3383',
      title: '恢复初始数据危险确认',
      desc: '将工作台重置为全新默认预设（含14本题本、7门课程、1260分钟基准）',
      impact: '高危提示：当前设备所有自定义日程、错题照片将被重置！建议操作前先点击“导出备份”。',
      btnText: '测试“重置数据确认”',
      icon: RotateCcw,
      danger: true,
    },
    {
      id: 'confirm-import',
      fId: '13:3453',
      title: '导入备份覆盖确认',
      desc: '使用所选 JSON 备份文件完整替换当前工作台数据',
      impact: '提示：导入将先校验结构，通过后覆盖当前全部日程、记录与配置，并自动重建事项一对一绑定。',
      btnText: '测试“导入覆盖确认”',
      icon: FileUp,
      danger: false,
    },
    {
      id: 'confirm-upload',
      fId: '13:3523',
      title: '上传本机数据覆盖云端',
      desc: '将当前手机/电脑数据全量推送至 Node 服务端',
      impact: '提示：云端已有档案将被当前版本原子替换。若多设备同时使用，请确保当前数据最新。',
      btnText: '测试“上传云端确认”',
      icon: UploadCloud,
      danger: false,
    },
    {
      id: 'confirm-pull',
      fId: '13:3593',
      title: '从云端拉取覆盖本机',
      desc: '从 Node 服务端下载最新档案并替换当前设备缓存',
      impact: '提示：本机尚未同步的新增改动将被云端覆盖。如有未保存的重要照片请先导出 JSON 备份。',
      btnText: '测试“从云端拉取确认”',
      icon: DownloadCloud,
      danger: true,
    },
    {
      id: 'confirm-logout',
      fId: '13:3663',
      title: '退出账号登录确认',
      desc: '退出当前备考学员账号并断开云端实时备份',
      impact: '说明：退出后将转入单机离线模式，本地数据不会被清除，后续随时可重新登录接续同步。',
      btnText: '测试“退出登录确认”',
      icon: LogOut,
      danger: true,
    },
  ];

  const currentItem = confirmItems.find(c => c.id === activeModal);

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center justify-between pt-1">
        <div>
          <h1 className="text-xl font-bold text-ink-main">8 类危险确认弹窗系统</h1>
          <p className="text-xs text-ink-muted mt-0.5">
            严格按照设计规范建立独立影响提示与二次确认机制
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={onBack}>
          返回工作台
        </Button>
      </div>

      <div className="space-y-3">
        {confirmItems.map(item => {
          const Icon = item.icon;
          return (
            <Card key={item.id} className="p-3.5 bg-paper border-line flex items-center justify-between gap-3">
              <div className="flex items-start gap-2.5 flex-1 min-w-0">
                <div className={`p-2 rounded-xl mt-0.5 ${item.danger ? 'bg-alarm-light text-alarm' : 'bg-sage-light text-sage'}`}>
                  <Icon size={16} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-ink-main">{item.title}</h3>
                    <Tag variant="gray" className="text-[10px] font-mono">{item.fId}</Tag>
                  </div>
                  <p className="text-xs text-ink-muted mt-0.5 truncate">{item.desc}</p>
                </div>
              </div>
              <Button
                variant={item.danger ? 'danger' : 'light'}
                size="sm"
                className="shrink-0"
                onClick={() => setActiveModal(item.id)}
              >
                唤起弹窗
              </Button>
            </Card>
          );
        })}
      </div>

      {/* 弹窗渲染 */}
      {currentItem && (
        <ConfirmModal
          isOpen={true}
          title={currentItem.title}
          message={currentItem.desc}
          impactText={currentItem.impact}
          danger={currentItem.danger}
          confirmText="确认执行"
          cancelText="取消返回"
          onConfirm={() => {
            alert(`已确认操作：${currentItem.title}`);
            setActiveModal(null);
          }}
          onCancel={() => setActiveModal(null)}
        />
      )}
    </div>
  );
};
