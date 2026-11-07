import React, { useState } from 'react';
import { Modal, Button } from '../common/UIComponents';
import { Heart, MessageSquarePlus, Sparkles, X } from 'lucide-react';
import type { CompanionNote } from '../../types/companionNote';
import { useApp } from '../../context/AppContext';

export interface CompanionNoteDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  note: CompanionNote | null;
  onReply: (note: CompanionNote) => void;
  onToast?: (message: string) => void;
}

export const CompanionNoteDetailModal: React.FC<CompanionNoteDetailModalProps> = ({
  isOpen,
  onClose,
  note,
  onReply,
  onToast,
}) => {
  const { csrfToken } = useApp();
  const [heartCount, setHeartCount] = useState<number>(note?.hearts ?? 0);
  const [heartAnimating, setHeartAnimating] = useState(false);
  const [isHearting, setIsHearting] = useState(false);

  // Sync heart count when note changes
  React.useEffect(() => {
    if (note) {
      setHeartCount(note.hearts);
    }
  }, [note]);

  if (!isOpen || !note) return null;

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

    onToast?.(`已给 ${note.fromNickname} 送上一颗爱心 ❤️！`);
    setIsHearting(false);
  };

  const handleReplyClick = () => {
    onClose();
    onReply(note);
  };

  return (
    <Modal isOpen onClose={onClose} title="💌 研友打气便签">
      <div className="space-y-4">
        {/* Cute Polaroid / Note Paper Container */}
        <div className="relative rounded-[22px] border border-[#DEE6D5] bg-[#FDFBF7] p-4 shadow-sm overflow-hidden">
          {/* Top Tape decoration */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-4 bg-[#EBE7D8]/80 border-b border-[#D8D2BD] rounded-b-md shadow-xs pointer-events-none" />

          {/* Sender Header */}
          <div className="flex items-center justify-between border-b border-line/60 pb-3 mt-1">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-2xl bg-[#E8EFE2] text-[#4A643E] font-bold flex items-center justify-center text-sm shadow-xs border border-[#D5E1CC]">
                {note.fromNickname ? note.fromNickname.slice(0, 2) : '研友'}
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-sm text-ink-main">{note.fromNickname}</span>
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

        {/* Action Buttons: 回赠爱心 + 一键回贴 */}
        <div className="grid grid-cols-2 gap-2.5 pt-1">
          {/* 回赠爱心 */}
          <Button
            type="button"
            variant="secondary"
            onClick={handleSendHeart}
            className={`py-2.5 flex items-center justify-center gap-1.5 border-[#E2BFB8] bg-[#FDF5F4] hover:bg-[#FCEAE8] text-[#C04940] font-bold transition-transform ${
              heartAnimating ? 'scale-105' : ''
            }`}
          >
            <Heart
              size={16}
              className={`text-[#D32F2F] fill-[#D32F2F] transition-transform ${
                heartAnimating ? 'scale-125' : ''
              }`}
            />
            <span>回赠爱心 ({heartCount})</span>
          </Button>

          {/* 一键回贴 */}
          <Button
            type="button"
            variant="primary"
            onClick={handleReplyClick}
            className="py-2.5 flex items-center justify-center gap-1.5"
          >
            <MessageSquarePlus size={16} />
            <span>我也贴一张</span>
          </Button>
        </div>
      </div>
    </Modal>
  );
};
