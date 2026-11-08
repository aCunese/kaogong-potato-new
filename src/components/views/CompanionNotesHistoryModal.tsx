import React, { useState, useMemo } from 'react';
import { Modal, Button } from '../common/UIComponents';
import { Avatar } from '../common/Avatar';
import { PotatoSprite } from '../common/PotatoSprite';
import { Heart, MessageSquarePlus, Calendar, Clock, Pin, Sparkles, Image as ImageIcon } from 'lucide-react';
import type { CompanionNote } from '../../types/companionNote';
import { getCompanionDisplayName } from '../../utils/companionRemarks';

export interface CompanionNotesHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  notes: CompanionNote[];
  partnerAvatar?: string;
  todayStr?: string;
  currentUserId?: string;
  onSendHeart?: (noteId: string) => Promise<void>;
  onReply?: (note: CompanionNote) => void;
  onPinNoteToTop?: (note: CompanionNote) => void;
  onToast?: (msg: string) => void;
}

function formatNoteTime(val?: string): string {
  if (!val) return '刚刚';
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return '刚刚';
    return d.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '刚刚';
  }
}

export const CompanionNotesHistoryModal: React.FC<CompanionNotesHistoryModalProps> = ({
  isOpen,
  onClose,
  notes,
  partnerAvatar,
  todayStr,
  currentUserId,
  onSendHeart,
  onReply,
  onPinNoteToTop,
  onToast,
}) => {
  const [activeTab, setActiveTab] = useState<'today' | 'past'>('today');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [heartLoading, setHeartLoading] = useState<Record<string, boolean>>({});

  const effectiveToday = useMemo(() => todayStr || new Date().toISOString().slice(0, 10), [todayStr]);

  const { todayNotes, pastNotes } = useMemo(() => {
    const today: CompanionNote[] = [];
    const past: CompanionNote[] = [];

    for (const note of notes) {
      const noteDate = note.createdAt ? note.createdAt.slice(0, 10) : '';
      if (noteDate === effectiveToday) {
        today.push(note);
      } else {
        past.push(note);
      }
    }
    return { todayNotes: today, pastNotes: past };
  }, [notes, effectiveToday]);

  if (!isOpen) return null;

  const currentList = activeTab === 'today' ? todayNotes : pastNotes;

  const handleHeart = async (noteId: string) => {
    if (heartLoading[noteId]) return;
    setHeartLoading(prev => ({ ...prev, [noteId]: true }));
    try {
      if (onSendHeart) {
        await onSendHeart(noteId);
      } else {
        onToast?.('❤️ 已回赠爱心！');
      }
    } catch {
      onToast?.('爱心发送失败，请稍后重试');
    } finally {
      setHeartLoading(prev => ({ ...prev, [noteId]: false }));
    }
  };

  const handlePin = (note: CompanionNote) => {
    if (onPinNoteToTop) {
      onPinNoteToTop(note);
      onToast?.('📌 已将此便签设为今日置顶展示！');
      onClose();
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="📮 打气便签箱 · 往常与今日">
      <div className="space-y-4">
        {/* 顶部标签切换 */}
        <div role="tablist" aria-label="便签箱分类" className="grid grid-cols-2 gap-1 rounded-xl bg-cream p-1 text-xs font-bold">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'today'}
            onClick={() => setActiveTab('today')}
            className={`rounded-lg py-2 transition-colors flex items-center justify-center gap-1.5 ${
              activeTab === 'today' ? 'bg-paper text-sage-dark shadow-xs' : 'text-ink-muted hover:text-ink-main'
            }`}
          >
            <span>今日便签</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-sage-light text-sage font-bold">
              {todayNotes.length}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'past'}
            onClick={() => setActiveTab('past')}
            className={`rounded-lg py-2 transition-colors flex items-center justify-center gap-1.5 ${
              activeTab === 'past' ? 'bg-paper text-sage-dark shadow-xs' : 'text-ink-muted hover:text-ink-main'
            }`}
          >
            <span>往常便签回忆</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-cream text-ink-muted border border-line/60">
              {pastNotes.length}
            </span>
          </button>
        </div>

        {/* 便签列表 */}
        {currentList.length === 0 ? (
          <div className="py-10 text-center space-y-3">
            <div className="flex justify-center">
              <PotatoSprite pose={activeTab === 'today' ? 0 : 2} size={64} />
            </div>
            <div>
              <p className="text-sm font-bold text-ink-main">
                {activeTab === 'today' ? '今天还没有收到新的便签' : '往常便签箱空空如也'}
              </p>
              <p className="text-xs text-ink-muted mt-1 leading-relaxed max-w-[260px] mx-auto">
                {activeTab === 'today'
                  ? '研友贴的打气便签会第一眼展现在这里，你也可以主动给研友贴一张！'
                  : '收到过的鼓励便签都会永久妥善保存在这里，见证共同奋斗的日夜。'}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-0.5">
            {currentList.map(note => {
              const displayName = getCompanionDisplayName(note.fromUserId, note.fromNickname);
              const timeDisplay = formatNoteTime(note.createdAt);

              return (
                <div
                  key={note.id}
                  className="rounded-2xl border border-[#DEE7D4] bg-[#FDFBF7] p-3.5 space-y-3 shadow-2xs hover:shadow-xs transition"
                >
                  {/* 便签头部：好友头像 + 备注名 + 时间 */}
                  <div className="flex items-center justify-between gap-2 border-b border-line/50 pb-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar avatar={(note.fromUserId !== currentUserId ? partnerAvatar : undefined) || note.fromAvatar || 'pose-0'} size={38} className="shadow-2xs" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-ink-main truncate">{displayName}</span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[#E5ECD9] text-[#4F6344] font-semibold">
                            研友打气
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-ink-muted mt-0.5">
                          <Clock size={10} />
                          <span>{timeDisplay}</span>
                        </div>
                      </div>
                    </div>

                    {/* 置顶展示按钮 */}
                    {onPinNoteToTop && (
                      <button
                        type="button"
                        onClick={() => handlePin(note)}
                        className="text-[10px] font-bold text-sage hover:bg-sage-light px-2 py-1 rounded-lg border border-sage/30 flex items-center gap-1 shrink-0 transition active:scale-95"
                        title="将此便签设为今日置顶展示"
                      >
                        <Pin size={11} />
                        <span>置顶展示</span>
                      </button>
                    )}
                  </div>

                  {/* 表情包图（若有） */}
                  {note.imageUrl && (
                    <div
                      onClick={() => setPreviewImage(note.imageUrl || null)}
                      className="cursor-pointer max-h-48 w-full bg-paper/80 border border-line/60 rounded-xl p-2 flex items-center justify-center overflow-hidden hover:bg-paper transition"
                      title="点击查看大图"
                    >
                      <img
                        src={note.imageUrl}
                        alt="打气表情贴纸"
                        className="max-h-44 object-contain rounded-lg"
                      />
                    </div>
                  )}

                  {/* 便签文字正文 */}
                  <div className="px-1 text-xs font-medium text-ink-main leading-relaxed whitespace-pre-wrap">
                    {note.message || '考公路上一起加油稳稳上岸！🥔🔥'}
                  </div>

                  {/* 底部操作区：爱心数 + 回赠爱心 + 回贴一张 */}
                  <div className="pt-2 border-t border-line/40 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1 text-xs text-[#C04940] font-bold">
                      <Heart size={13} className="fill-[#D32F2F] text-[#D32F2F]" />
                      <span>{note.hearts} 颗爱心</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => handleHeart(note.id)}
                        disabled={heartLoading[note.id]}
                        className="px-2.5 py-1 text-[11px] h-7 border-[#E2BFB8] bg-[#FDF5F4] hover:bg-[#FCEAE8] text-[#C04940] font-bold flex items-center gap-1"
                      >
                        <Heart size={12} className="fill-current" />
                        <span>回赠爱心</span>
                      </Button>

                      {onReply && (
                        <Button
                          type="button"
                          size="sm"
                          variant="primary"
                          onClick={() => {
                            onClose();
                            onReply(note);
                          }}
                          className="px-2.5 py-1 text-[11px] h-7 font-bold flex items-center gap-1"
                        >
                          <MessageSquarePlus size={12} />
                          <span>回贴便签</span>
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 大图预览弹窗 */}
        {previewImage && (
          <div
            className="fixed inset-0 z-60 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs animate-fade-in"
            onClick={() => setPreviewImage(null)}
          >
            <div className="max-w-md w-full bg-paper rounded-2xl p-3 space-y-2 shadow-2xl" onClick={e => e.stopPropagation()}>
              <img src={previewImage} alt="大图预览" className="w-full max-h-[75vh] object-contain rounded-xl" />
              <Button size="sm" variant="secondary" fullWidth onClick={() => setPreviewImage(null)}>
                关闭预览
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
