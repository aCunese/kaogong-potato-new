import React, { useState } from 'react';
import { Modal, Button } from '../common/UIComponents';
import { Avatar } from '../common/Avatar';
import { Heart, MessageSquarePlus, Sparkles, X, Zap, Edit3, Check, Archive } from 'lucide-react';
import type { CompanionNote } from '../../types/companionNote';
import { useApp } from '../../context/AppContext';
import { getCompanionDisplayName, setCompanionRemark, getCompanionRemark } from '../../utils/companionRemarks';

export interface CompanionNoteDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  note: CompanionNote | null;
  partnerAvatar?: string;
  onReply: (note: CompanionNote) => void;
  onPoke?: (note: CompanionNote) => void;
  isPartnerFocusing?: boolean;
  pokeCooldown?: number;
  onOpenSharing?: (partnerId?: string) => void;
  onOpenHistory?: () => void;
  onToast?: (message: string) => void;
}

export const CompanionNoteDetailModal: React.FC<CompanionNoteDetailModalProps> = ({
  isOpen,
  onClose,
  note,
  partnerAvatar,
  onReply,
  onPoke,
  isPartnerFocusing = false,
  pokeCooldown = 0,
  onOpenSharing,
  onOpenHistory,
  onToast,
}) => {
  const { csrfToken } = useApp();
  const [heartCount, setHeartCount] = useState<number>(note?.hearts ?? 0);
  const [heartAnimating, setHeartAnimating] = useState(false);
  const [isHearting, setIsHearting] = useState(false);
  const [isEditingRemark, setIsEditingRemark] = useState(false);
  const [remarkInput, setRemarkInput] = useState('');

  // Sync heart count and remark when note changes
  React.useEffect(() => {
    if (note) {
      setHeartCount(note.hearts);
      setRemarkInput(getCompanionRemark(note.fromUserId));
      setIsEditingRemark(false);
    }
  }, [note]);

  if (!isOpen || !note) return null;

  const partnerDisplayName = getCompanionDisplayName(note.fromUserId, note.fromNickname);

  const handleSaveRemark = () => {
    setCompanionRemark(note.fromUserId, remarkInput);
    setIsEditingRemark(false);
    onToast?.(`已将研友备注名更新为「${remarkInput.trim() || note.fromNickname}」`);
  };

  const handleSendHeart = async () => {
    if (isHearting) return;
    setIsHearting(true);
    setHeartAnimating(true);
    setTimeout(() => setHeartAnimating(false), 700);

    const nextHearts = heartCount + 1;
    setHeartCount(nextHearts);

    if (note.id && !note.id.startsWith('local-') && note.id !== 'default-note') {
      try {
        await fetch(`/api/sharing/notes/${note.id}/heart`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
          },
        });
      } catch {
        // Fallback optimistic update
      }
    }

    onToast?.(`已给 ${partnerDisplayName} 送上一颗爱心 ❤️！`);
    setIsHearting(false);
  };

  const handleReplyClick = () => {
    onClose();
    onReply(note);
  };

  const handlePokeClick = () => {
    if (isPartnerFocusing) {
      onToast?.(`「${partnerDisplayName}」正在专注学习中，请勿打扰~`);
      return;
    }
    if (onPoke) {
      onPoke(note);
    } else {
      onToast?.(`⚡️ 已向「${partnerDisplayName}」发送催学提醒！`);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="💌 研友打气便签">
      <div className="space-y-4">
        {/* Cute Polaroid / Note Paper Container */}
        <div className="relative rounded-[22px] border border-[#DEE6D5] bg-[#FDFBF7] p-4 shadow-sm overflow-hidden">
          {/* Top Tape decoration */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-4 bg-[#EBE7D8]/80 border-b border-[#D8D2BD] rounded-b-md shadow-xs pointer-events-none" />

          {/* Sender Header: 好友头像 + 昵称/备注名 + 时间 */}
          <div className="flex items-center justify-between border-b border-line/60 pb-3 mt-1">
            <div className="flex items-center gap-2.5">
              <Avatar avatar={partnerAvatar || note.fromAvatar || 'pose-0'} size={42} className="shadow-xs shrink-0" />
              <div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {isEditingRemark ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={remarkInput}
                        onChange={e => setRemarkInput(e.target.value)}
                        placeholder={note.fromNickname}
                        maxLength={16}
                        className="w-24 px-1.5 py-0.5 text-xs border border-sage rounded bg-paper outline-none font-bold"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={handleSaveRemark}
                        className="p-1 text-sage hover:bg-sage-light rounded"
                        title="保存备注"
                      >
                        <Check size={12} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="font-bold text-sm text-ink-main">{partnerDisplayName}</span>
                      <button
                        type="button"
                        onClick={() => setIsEditingRemark(true)}
                        className="text-[10px] text-ink-muted hover:text-sage flex items-center gap-0.5"
                        title="自定义备注名"
                      >
                        <Edit3 size={10} />
                      </button>
                    </>
                  )}
                  <span className="rounded-full bg-sage-light px-2 py-0.5 text-[10px] font-semibold text-sage">
                    研友打气
                  </span>
                </div>
                <div className="text-[11px] text-ink-muted mt-0.5">
                  {note.createdAt ? new Date(note.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '刚刚'}
                </div>
              </div>
            </div>
          </div>

          {/* Large Meme Image Display */}
          {note.imageUrl && (
            <div className="my-3 rounded-2xl bg-paper/80 border border-line/60 p-2 text-center overflow-hidden">
              <img
                src={note.imageUrl}
                alt="表情包大图"
                className="max-h-72 w-full object-contain rounded-xl mx-auto"
                onError={e => { (e.currentTarget as HTMLElement).style.display = 'none'; }}
              />
            </div>
          )}

          {/* Message Text */}
          <div className="my-3 px-1">
            <p className="text-sm font-medium text-ink-main leading-relaxed whitespace-pre-wrap">
              {note.message}
            </p>
          </div>

          {/* Footer mascot encouragement */}
          <div className="mt-4 pt-3 border-t border-line/40 flex items-center justify-between text-[11px] text-[#718267]">
            <span className="flex items-center gap-1">
              <Sparkles size={13} className="text-potato" />
              <span>每天打气，一起稳稳上岸</span>
            </span>
            <span className="font-mono text-ink-muted">🥔 土豆互助站</span>
          </div>
        </div>

        {/* Action Buttons: 回赠爱心 + 戳一戳 + 我也贴一张 */}
        <div className="grid grid-cols-3 gap-2 pt-1">
          {/* 回赠爱心 */}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleSendHeart}
            className={`py-2 px-1 text-xs flex items-center justify-center gap-1 border-[#E2BFB8] bg-[#FDF5F4] hover:bg-[#FCEAE8] text-[#C04940] font-bold transition-transform ${
              heartAnimating ? 'scale-105' : ''
            }`}
          >
            <Heart
              size={14}
              className={`text-[#D32F2F] fill-[#D32F2F] transition-transform ${
                heartAnimating ? 'scale-125' : ''
              }`}
            />
            <span>回赠爱心 ({heartCount})</span>
          </Button>

          {/* 戳一戳 */}
          {isPartnerFocusing ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled
              className="py-2 px-1 text-xs flex items-center justify-center gap-1 border border-line/60 bg-cream/40 opacity-60 text-ink-muted cursor-not-allowed"
              title="研友正在专注学习中，请勿打扰~"
            >
              <Zap size={14} className="text-ink-muted/50" />
              <span>专注中</span>
            </Button>
          ) : (
            <Button
              type="button"
              variant="light"
              size="sm"
              disabled={pokeCooldown > 0}
              onClick={handlePokeClick}
              className="py-2 px-1 text-xs flex items-center justify-center gap-1 border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold transition disabled:opacity-50"
              title="向研友发送小猫催学信"
            >
              <Zap size={14} className="fill-current text-amber-600" />
              <span>{pokeCooldown > 0 ? `${Math.ceil(pokeCooldown / 60)}分后` : '戳一戳'}</span>
            </Button>
          )}

          {/* 一键回贴 */}
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleReplyClick}
            className="py-2 px-1 text-xs flex items-center justify-center gap-1 font-bold"
          >
            <MessageSquarePlus size={14} />
            <span>我也贴一张</span>
          </Button>
        </div>

        {/* 便签箱入口 & 研友学情与督学直达 */}
        <div className="space-y-2">
          {onOpenHistory && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenHistory();
              }}
              className="w-full py-2 px-3 rounded-xl border border-line bg-cream/50 hover:bg-cream text-ink-main text-xs font-bold flex items-center justify-center gap-1.5 transition active:scale-[0.99]"
            >
              <Archive size={14} className="text-sage" />
              <span>打开便签箱 · 查看今日与往常所有便签</span>
            </button>
          )}

          {onOpenSharing && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenSharing(note.fromUserId || 'demo-atu');
              }}
              className="w-full py-2.5 px-3 rounded-xl border border-sage/25 bg-sage-light/25 hover:bg-sage-light/40 text-sage-dark text-xs font-bold flex items-center justify-center gap-1.5 transition active:scale-[0.99]"
            >
              <span>👥</span>
              <span>查看 {partnerDisplayName} 的今日学情与督学状态</span>
            </button>
          )}
        </div>

        {/* 机制说明小贴士卡片 */}
        <div className="rounded-xl bg-sage-light/25 border border-sage/20 p-2.5 text-[11px] leading-relaxed text-ink-muted flex items-start gap-1.5">
          <Sparkles size={14} className="text-sage shrink-0 mt-0.5" />
          <span>
            <strong>💡 陪伴与督学说明</strong>：打气便签每日打开 App 第一眼可见；研友未在学习时可「戳一戳」发送小猫催学信，正在专注学习时请勿打扰哦！
          </span>
        </div>
      </div>
    </Modal>
  );
};

