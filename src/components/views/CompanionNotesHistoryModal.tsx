import React, { useState, useMemo } from 'react';
import { Modal, Button } from '../common/UIComponents';
import { Avatar } from '../common/Avatar';
import { PotatoSprite } from '../common/PotatoSprite';
import { Heart, MessageSquarePlus, Clock, Pin, Sparkles } from 'lucide-react';
import type { CompanionNote } from '../../types/companionNote';
import { getCompanionDisplayName } from '../../utils/companionRemarks';

export interface CompanionNotesHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  notes: CompanionNote[];
  partnerAvatar?: string;
  todayStr?: string;
  currentUserId?: string;
  initialTab?: 'today' | 'past' | 'sent';
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

const PAGE_SIZE = 5;

export const CompanionNotesHistoryModal: React.FC<CompanionNotesHistoryModalProps> = ({
  isOpen,
  onClose,
  notes,
  partnerAvatar,
  todayStr,
  currentUserId,
  initialTab = 'today',
  onSendHeart,
  onReply,
  onPinNoteToTop,
  onToast,
}) => {
  const [activeTab, setActiveTab] = useState<'today' | 'past' | 'sent'>(initialTab);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [heartLoading, setHeartLoading] = useState<Record<string, boolean>>({});
  const [visibleCount, setVisibleCount] = useState<number>(PAGE_SIZE);
  const [expandedNoteIds, setExpandedNoteIds] = useState<Record<string, boolean>>({});

  React.useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setVisibleCount(PAGE_SIZE);
    }
  }, [isOpen, initialTab]);

  const effectiveUserId = useMemo(() => {
    if (currentUserId) return currentUserId;
    try {
      if (typeof window !== 'undefined') {
        const cachedUser = localStorage.getItem('kaogong_last_user');
        if (cachedUser) {
          const u = JSON.parse(cachedUser);
          if (u?.id) return u.id;
        }
      }
    } catch {}
    return undefined;
  }, [currentUserId]);

  const effectiveToday = useMemo(() => todayStr || new Date().toISOString().slice(0, 10), [todayStr]);

  const { todayNotes, pastNotes, sentNotes } = useMemo(() => {
    const today: CompanionNote[] = [];
    const past: CompanionNote[] = [];
    const sent: CompanionNote[] = [];

    for (const note of notes) {
      const isSent = Boolean((effectiveUserId && note.fromUserId === effectiveUserId) || note.fromUserId === 'me');
      if (isSent) {
        sent.push(note);
        continue;
      }
      const noteDate = note.createdAt ? note.createdAt.slice(0, 10) : '';
      if (noteDate === effectiveToday) {
        today.push(note);
      } else {
        past.push(note);
      }
    }
    return { todayNotes: today, pastNotes: past, sentNotes: sent };
  }, [notes, effectiveToday, effectiveUserId]);

  const handleTabChange = (tab: 'today' | 'past' | 'sent') => {
    setActiveTab(tab);
    setVisibleCount(PAGE_SIZE);
  };

  const toggleExpand = (noteId: string) => {
    setExpandedNoteIds(prev => ({ ...prev, [noteId]: !prev[noteId] }));
  };

  if (!isOpen) return null;

  const currentList = activeTab === 'today' ? todayNotes : activeTab === 'past' ? pastNotes : sentNotes;
  const displayedNotes = currentList.slice(0, visibleCount);
  const hasMore = currentList.length > visibleCount;
  const remainingCount = currentList.length - visibleCount;

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
        {/* 顶部三标签切换 */}
        <div role="tablist" aria-label="便签箱分类" className="grid grid-cols-3 gap-1 rounded-xl bg-cream p-1 text-xs font-bold">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'today'}
            onClick={() => handleTabChange('today')}
            className={`rounded-lg py-2 transition-colors flex items-center justify-center gap-1.5 ${
              activeTab === 'today' ? 'bg-paper text-sage-dark shadow-xs' : 'text-ink-muted hover:text-ink-main'
            }`}
          >
            <span>今日收到</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-sage-light text-sage font-bold">
              {todayNotes.length}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'past'}
            onClick={() => handleTabChange('past')}
            className={`rounded-lg py-2 transition-colors flex items-center justify-center gap-1.5 ${
              activeTab === 'past' ? 'bg-paper text-sage-dark shadow-xs' : 'text-ink-muted hover:text-ink-main'
            }`}
          >
            <span>往常回忆</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-cream text-ink-muted border border-line/60">
              {pastNotes.length}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'sent'}
            onClick={() => handleTabChange('sent')}
            className={`rounded-lg py-2 transition-colors flex items-center justify-center gap-1.5 ${
              activeTab === 'sent' ? 'bg-paper text-sage-dark shadow-xs' : 'text-ink-muted hover:text-ink-main'
            }`}
          >
            <span>我写出的</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[#E8EFF6] text-[#345A7A] border border-[#CCDCEB]">
              {sentNotes.length}
            </span>
          </button>
        </div>

        {/* 便签列表 */}
        {currentList.length === 0 ? (
          <div className="py-10 text-center space-y-3">
            <div className="flex justify-center">
              <PotatoSprite pose={activeTab === 'today' ? 0 : activeTab === 'past' ? 2 : 1} size={64} />
            </div>
            <div>
              <p className="text-sm font-bold text-ink-main">
                {activeTab === 'today'
                  ? '今天还没有收到新的便签'
                  : activeTab === 'past'
                  ? '往常便签回忆空空如也'
                  : '还没有写出过打气便签'}
              </p>
              <p className="text-xs text-ink-muted mt-1 leading-relaxed max-w-[260px] mx-auto">
                {activeTab === 'today'
                  ? '学友贴的打气便签会第一眼展现在这里，你也可以主动给学友贴一张！'
                  : activeTab === 'past'
                  ? '收到过的鼓励便签都会永久妥善保存在这里，见证共同奋斗的日夜。'
                  : '给学友写的鼓励便签和表情包都会记录在这里，去贴一张给学友打气吧！'}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-0.5">
            {displayedNotes.map(note => {
              const isSentTab = activeTab === 'sent' || Boolean((effectiveUserId && note.fromUserId === effectiveUserId) || note.fromUserId === 'me');
              const displayName = isSentTab
                ? getCompanionDisplayName(note.toUserId || note.grantId || '', note.toNickname || '学友', note.grantId)
                : getCompanionDisplayName(note.fromUserId, note.fromNickname, note.grantId);
              const avatar = isSentTab
                ? (note.toAvatar || partnerAvatar || 'pose-2')
                : ((note.fromUserId !== effectiveUserId ? partnerAvatar : undefined) || note.fromAvatar || 'pose-0');
              const timeDisplay = formatNoteTime(note.createdAt);
              const message = note.message || '考公路上一起加油稳稳上岸！🥔🔥';
              const isLongText = message.length > 70 || (message.match(/\n/g) || []).length >= 3;
              const isExpanded = Boolean(expandedNoteIds[note.id]);

              return (
                <div
                  key={note.id}
                  className="rounded-2xl border border-[#DEE7D4] bg-[#FDFBF7] p-3.5 space-y-3 shadow-2xs hover:shadow-xs transition"
                >
                  {/* 便签头部：好友头像 + 备注名 + 时间 */}
                  <div className="flex items-center justify-between gap-2 border-b border-line/50 pb-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar avatar={avatar} size={38} className="shadow-2xs" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-ink-main truncate">{displayName}</span>
                          <span
                            className={`text-[10px] px-1.5 py-0.2 rounded-full font-semibold ${
                              isSentTab ? 'bg-[#E5ECF6] text-[#2F4D6B]' : 'bg-[#E5ECD9] text-[#4F6344]'
                            }`}
                          >
                            {isSentTab ? '寄给学友' : '学友打气'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-ink-muted mt-0.5">
                          <Clock size={10} />
                          <span>{timeDisplay}</span>
                        </div>
                      </div>
                    </div>

                    {/* 置顶展示按钮（仅在收件箱显示，不置顶自己发给好友的便签） */}
                    {!isSentTab && onPinNoteToTop && (
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

                  {/* 便签文字正文：支持长文自动折叠与展开/收起 */}
                  <div className="px-1 space-y-1">
                    <div className={`text-xs font-medium text-ink-main leading-relaxed whitespace-pre-wrap break-words ${!isExpanded && isLongText ? 'line-clamp-3' : ''}`}>
                      {message}
                    </div>
                    {isLongText && (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => toggleExpand(note.id)}
                          className="text-[11px] font-bold text-sage hover:text-sage-dark inline-flex items-center gap-0.5 py-0.5 transition active:scale-95"
                        >
                          <span>{isExpanded ? '收起全文' : '展开全文'}</span>
                          <span className="text-[10px]">{isExpanded ? '▲' : '▼'}</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 底部操作区：爱心数 + 交互操作 */}
                  <div className="pt-2 border-t border-line/40 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1 text-xs text-[#C04940] font-bold">
                      <Heart size={13} className={note.hearts > 0 ? 'fill-[#D32F2F] text-[#D32F2F]' : 'text-[#D32F2F]'} />
                      <span>
                        {isSentTab
                          ? (note.hearts > 0 ? `学友已回赠 ${note.hearts} 颗爱心` : '学友暂未回赠爱心')
                          : `${note.hearts} 颗爱心`}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {!isSentTab && (
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
                      )}

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
                          <span>{isSentTab ? '再贴一张' : '回贴便签'}</span>
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* 分页加载更多与已全部加载提示 */}
            {hasMore && (
              <div className="pt-2 pb-1 flex justify-center">
                <button
                  type="button"
                  onClick={() => setVisibleCount(prev => prev + PAGE_SIZE)}
                  className="px-3.5 py-1.5 rounded-xl bg-paper hover:bg-[#F2F7EB] border border-[#DEE7D4] text-xs font-bold text-sage flex items-center gap-1.5 shadow-2xs hover:shadow-xs transition active:scale-95"
                  title="加载更多往期便签"
                >
                  <Clock size={12} className="text-sage" />
                  <span>加载更早便签 (剩余 {remainingCount} 条)</span>
                </button>
              </div>
            )}
            {!hasMore && currentList.length > PAGE_SIZE && (
              <div className="py-2 text-center text-[11px] text-ink-muted/70 flex items-center justify-center gap-1">
                <Sparkles size={11} className="text-potato" />
                <span>已展示全部 {currentList.length} 条便签 🥔</span>
              </div>
            )}
          </div>
        )}

        {/* 大图预览弹窗 */}
        {previewImage && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-fade-in"
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
