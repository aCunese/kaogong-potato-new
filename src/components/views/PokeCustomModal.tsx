import React, { useState, useEffect } from 'react';
import { Modal, Button } from '../common/UIComponents';
import { Avatar } from '../common/Avatar';
import { Zap, Sparkles, Plus, Trash2, Send, CheckCircle2 } from 'lucide-react';
import { getCompanionDisplayName } from '../../utils/companionRemarks';

export interface PokeCustomModalProps {
  isOpen: boolean;
  onClose: () => void;
  partner: { id: string; nickname: string; avatar?: string };
  onSend: (data: { customMessage: string; checkItems: string[] }) => Promise<void>;
  isSending?: boolean;
  cooldownSeconds?: number;
  onToast?: (msg: string) => void;
}

const QUICK_PHRASES = [
  '说好一起上岸，快回书桌前一起复习吧！',
  '约定时间已到，今天任务还在等你打卡哦！',
  '坐下学25分钟，行动就是最好的解药！',
  '土豆人永不服输，今晚互相抽背行测！',
  '喝口温水，深呼吸，今天也要稳稳上岸！',
];

const QUICK_CHECK_PRESETS = [
  '行测：言语理解抓中心、资料分析速算公式背熟了吗？',
  '申论：概括归纳要点找全、大作文思辨结构列出来了吗？',
  '常识：今日时政积累与重要考点翻阅了吗？',
  '错题：昨日错题本与高频坑点复盘了吗？',
];

export const PokeCustomModal: React.FC<PokeCustomModalProps> = ({
  isOpen,
  onClose,
  partner,
  onSend,
  isSending = false,
  cooldownSeconds = 0,
  onToast,
}) => {
  const displayName = getCompanionDisplayName(partner.id, partner.nickname);

  const [message, setMessage] = useState(
    '说好一起上岸，约定好的复习时间已经到了，今日任务还在等你打卡，快回书桌前一起复习吧！'
  );

  const [checkItems, setCheckItems] = useState<string[]>([
    '行测：言语理解抓中心、资料分析速算公式背熟了吗？',
    '申论：概括归纳要点找全、大作文思辨结构列出来了吗？',
  ]);

  useEffect(() => {
    if (isOpen) {
      setMessage('说好一起上岸，约定好的复习时间已经到了，今日任务还在等你打卡，快回书桌前一起复习吧！');
      setCheckItems([
        '行测：言语理解抓中心、资料分析速算公式背熟了吗？',
        '申论：概括归纳要点找全、大作文思辨结构列出来了吗？',
      ]);
    }
  }, [isOpen, partner.id]);

  if (!isOpen) return null;

  const handleAddCheckItem = () => {
    if (checkItems.length >= 4) {
      onToast?.('最多添加 4 条自查事项');
      return;
    }
    setCheckItems(prev => [...prev, '综合：错题集今天复习了吗？']);
  };

  const handleUpdateCheckItem = (index: number, val: string) => {
    setCheckItems(prev => {
      const next = [...prev];
      next[index] = val;
      return next;
    });
  };

  const handleRemoveCheckItem = (index: number) => {
    if (checkItems.length <= 1) {
      onToast?.('至少保留一条自查项目');
      return;
    }
    setCheckItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) {
      onToast?.('请输入催学正文或选择快捷打气短句');
      return;
    }
    await onSend({
      customMessage: message.trim(),
      checkItems: checkItems.filter(i => i.trim().length > 0),
    });
  };

  return (
    <Modal isOpen onClose={onClose} title="⚡️ 催学提醒信 · 小猫代戳">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 收件人信息卡片 */}
        <div className="flex items-center gap-3 p-3 rounded-2xl bg-gradient-to-r from-[#FAF6ED] to-[#F1F6EC] border border-[#DEE7D4]">
          <Avatar avatar={partner.avatar || 'pose-0'} size={42} className="shadow-xs" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-sm text-ink-main truncate">{displayName}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-sage-light text-sage font-bold">
                收信人
              </span>
            </div>
            <p className="text-[11px] text-ink-muted mt-0.5">
              点击发送后将向对方绑定邮箱投递「C版小猫督学」定制排版催学邮件
            </p>
          </div>
        </div>

        {/* 催学正文编辑 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-ink-main flex items-center gap-1">
              <span>💌 学友来信正文</span>
              <span className="text-[10px] text-ink-muted font-normal">(支持编辑自定义)</span>
            </label>
            <span className="text-[10px] text-ink-muted font-mono">{message.length}/200</span>
          </div>

          <textarea
            value={message}
            onChange={e => setMessage(e.target.value.slice(0, 200))}
            rows={3}
            className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-xs text-ink-main leading-relaxed focus:border-sage focus:outline-none focus:ring-1 focus:ring-sage resize-none"
            placeholder="写下你想对学友说的督学话语…"
            disabled={isSending}
          />

          {/* 快捷文案芯片 */}
          <div>
            <div className="text-[11px] font-medium text-ink-muted mb-1.5 flex items-center gap-1">
              <Sparkles size={11} className="text-sage" />
              <span>快捷打气短句（点击一键填入）：</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_PHRASES.map((phrase, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setMessage(phrase)}
                  className="text-[11px] px-2.5 py-1 rounded-xl bg-cream hover:bg-[#F2F6ED] hover:text-sage text-ink-main border border-line/80 transition active:scale-95 text-left"
                >
                  {phrase}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 今日自查项目编辑 (今日白查 / BEFORE YOU START) */}
        <div className="space-y-2 pt-2 border-t border-line/60">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-ink-main flex items-center gap-1">
              <span>📋 今日自查清单 (BEFORE YOU START)</span>
            </label>
            {checkItems.length < 4 && (
              <button
                type="button"
                onClick={handleAddCheckItem}
                className="text-[11px] text-sage hover:underline flex items-center gap-0.5 font-bold"
              >
                <Plus size={12} />
                <span>添加一项</span>
              </button>
            )}
          </div>
          <p className="text-[10px] text-ink-muted leading-tight">
            自查清单将以红印序号优雅排版在邮件内，帮助伙伴收拢注意力：
          </p>

          <div className="space-y-2">
            {checkItems.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-[#b03a26] shrink-0 w-6 text-center">
                  0{idx + 1}
                </span>
                <input
                  type="text"
                  value={item}
                  onChange={e => handleUpdateCheckItem(idx, e.target.value)}
                  className="flex-1 min-w-0 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-xs text-ink-main focus:border-sage focus:outline-none"
                  placeholder={`自查要点 ${idx + 1}`}
                  maxLength={60}
                  disabled={isSending}
                />
                {checkItems.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveCheckItem(idx)}
                    className="p-1 text-ink-muted hover:text-alarm rounded transition"
                    title="删除此项"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* 常用自查要点快捷填入 */}
          <div className="pt-1">
            <div className="text-[11px] font-medium text-ink-muted mb-1 flex items-center gap-1">
              <Sparkles size={11} className="text-sage" />
              <span>常用备考自查要点（点击一键追加）：</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_CHECK_PRESETS.map((preset, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    if (checkItems.includes(preset)) return;
                    if (checkItems.length < 4) {
                      setCheckItems(prev => [...prev, preset]);
                    } else {
                      onToast?.('最多添加 4 条自查事项');
                    }
                  }}
                  className="text-[10px] px-2 py-0.5 rounded-lg bg-cream hover:bg-[#F2F6ED] hover:text-sage text-ink-main border border-line/70 transition active:scale-95 text-left"
                >
                  ＋ {preset.slice(0, 16)}…
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 底部投递按钮 */}
        <div className="pt-3 border-t border-line flex items-center justify-between gap-3">
          <div className="text-[11px] text-ink-muted flex items-center gap-1">
            <CheckCircle2 size={12} className="text-sage" />
            <span>附带小猫抬爪督学封套</span>
          </div>

          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={isSending}>
              取消
            </Button>
            <Button
              type="submit"
              size="sm"
              variant="primary"
              disabled={isSending || cooldownSeconds > 0}
              className="bg-amber-500 hover:bg-amber-600 border-amber-500 text-white font-bold flex items-center gap-1 shadow-sm px-4"
            >
              <Zap size={13} className="fill-current" />
              <span>
                {isSending
                  ? '发送中…'
                  : cooldownSeconds > 0
                  ? `${Math.ceil(cooldownSeconds / 60)} 分钟后可用`
                  : '发送催学信'}
              </span>
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
};
