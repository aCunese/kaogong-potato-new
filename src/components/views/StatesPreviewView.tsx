import React, { useState } from 'react';
import { Card, Tag, Button, Segment } from '../common/UIComponents';
import { PotatoSprite } from '../common/PotatoSprite';
import { AlertCircle, CheckCircle2, CloudOff, RefreshCw, AlertTriangle, ShieldAlert } from 'lucide-react';

interface StatesPreviewProps {
  onBack: () => void;
}

export const StatesPreviewView: React.FC<StatesPreviewProps> = ({ onBack }) => {
  const [tab, setTab] = useState<'empty' | 'sync' | 'form'>('empty');

  return (
    <div className="space-y-4 pb-24">
      {/* 头部 */}
      <div className="flex items-center justify-between pt-1">
        <div>
          <h1 className="text-xl font-bold text-ink-main">系统状态与异常集合</h1>
          <p className="text-xs text-ink-muted mt-0.5">
            长画板：展示完整状态机、空态、同步及表单校验变体
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={onBack}>
          返回工作台
        </Button>
      </div>

      <Segment
        options={[
          { label: '空态合集 (2470)', value: 'empty' },
          { label: '同步状态 (2700)', value: 'sync' },
          { label: '表单校验 (2847)', value: 'form' },
        ]}
        value={tab}
        onChange={val => setTab(val as any)}
      />

      {/* 1. states-empty: 13:2470 */}
      {tab === 'empty' && (
        <div className="space-y-4">
          <Card className="p-4 bg-paper text-center space-y-2 border-line">
            <Tag variant="gray" className="mb-1">今日日程空态</Tag>
            <PotatoSprite pose={7} size={70} className="mx-auto" />
            <h4 className="text-sm font-bold text-ink-main">今天还没有安排日程</h4>
            <p className="text-xs text-ink-muted max-w-[200px] mx-auto">
              从事项库挑选今天要做的事项，正向计时并打卡完成
            </p>
          </Card>

          <Card className="p-4 bg-paper text-center space-y-2 border-line">
            <Tag variant="gray" className="mb-1">错题照片空态</Tag>
            <PotatoSprite pose={3} size={70} className="mx-auto" />
            <h4 className="text-sm font-bold text-ink-main">暂无归档错题照片</h4>
            <p className="text-xs text-ink-muted max-w-[200px] mx-auto">
              遇到典型错题随手拍照上传，按题本归类复盘
            </p>
          </Card>

          <Card className="p-4 bg-paper text-center space-y-2 border-line">
            <Tag variant="gray" className="mb-1">学情趋势无数据空态</Tag>
            <PotatoSprite pose={4} size={70} className="mx-auto" />
            <h4 className="text-sm font-bold text-ink-main">暂无足量统计数据</h4>
            <p className="text-xs text-ink-muted max-w-[200px] mx-auto">
              完成日程并提交做题数据后，将自动生成分布图与正确率曲线
            </p>
          </Card>
        </div>
      )}

      {/* 2. states-sync: 13:2700 */}
      {tab === 'sync' && (
        <div className="space-y-3">
          <Card className="p-3.5 bg-paper border-line flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-sage animate-ping" />
              <div>
                <div className="text-xs font-bold text-ink-main">正在同步最新学情…</div>
                <div className="text-[10px] text-ink-muted">向 Node 服务端原子写主文件与快照</div>
              </div>
            </div>
            <Tag variant="sage">同步中</Tag>
          </Card>

          <Card className="p-3.5 bg-paper border-line flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-ink-muted" />
              <div>
                <div className="text-xs font-bold text-ink-main">单机离线模式</div>
                <div className="text-[10px] text-ink-muted">当前未连接网络，数据完整保存在本机</div>
              </div>
            </div>
            <Tag variant="gray">离线</Tag>
          </Card>

          <Card className="p-3.5 bg-paper border-line flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-alarm" />
              <div>
                <div className="text-xs font-bold text-ink-main">同步校验异常 / 登录过期</div>
                <div className="text-[10px] text-ink-muted">Bearer Token 超期，请重新登录以同步</div>
              </div>
            </div>
            <Button variant="danger" size="sm">
              重新登录
            </Button>
          </Card>

          <Card className="p-3.5 bg-paper border-line flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-potato" />
              <div>
                <div className="text-xs font-bold text-ink-main">多端同步版本冲突</div>
                <div className="text-[10px] text-ink-muted">云端修改时间晚于本机，建议先导出备份</div>
              </div>
            </div>
            <Tag variant="potato">需确认</Tag>
          </Card>
        </div>
      )}

      {/* 3. states-form: 13:2847 */}
      {tab === 'form' && (
        <div className="space-y-3">
          <Card className="p-3.5 bg-paper border-line space-y-2">
            <div className="flex items-center gap-2 text-alarm text-xs font-bold">
              <AlertCircle size={15} />
              <span>必填项缺失错误状态</span>
            </div>
            <div className="p-2 bg-cream/70 border border-alarm/40 rounded-lg text-xs text-alarm">
              请填写题本名称，题本名称不能为空。
            </div>
          </Card>

          <Card className="p-3.5 bg-paper border-line space-y-2">
            <div className="flex items-center gap-2 text-alarm text-xs font-bold">
              <AlertTriangle size={15} />
              <span>逻辑超限校验状态</span>
            </div>
            <div className="p-2 bg-alarm-light border border-alarm/40 rounded-lg text-xs text-alarm">
              错题数 (18) 不能大于本次做题总数 (10)！
            </div>
          </Card>

          <Card className="p-3.5 bg-paper border-line space-y-2">
            <div className="flex items-center gap-2 text-alarm text-xs font-bold">
              <AlertCircle size={15} />
              <span>外链协议校验错误</span>
            </div>
            <div className="p-2 bg-cream/70 border border-alarm/40 rounded-lg text-xs text-alarm">
              网课链接必须以 http:// 或 https:// 开头。
            </div>
          </Card>

          <Card className="p-3.5 bg-paper border-line space-y-2">
            <div className="flex items-center gap-2 text-alarm text-xs font-bold">
              <ShieldAlert size={15} />
              <span>密码安全位数不足</span>
            </div>
            <div className="p-2 bg-cream/70 border border-alarm/40 rounded-lg text-xs text-alarm">
              用户名至少 2 个字符，密码至少 4 个字符。
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};
