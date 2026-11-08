import React, { useState, useRef, useEffect } from 'react';
import { Modal, Button } from '../common/UIComponents';
import { useApp } from '../../context/AppContext';
import { Image as ImageIcon, X, Sparkles, Send, Upload, Heart } from 'lucide-react';
import type { CompanionNote } from '../../types/companionNote';
import {
  loadCompanionNoteDraft,
  saveCompanionNoteDraft,
  clearCompanionNoteDraft,
} from '../../utils/companionNoteDraft';

export interface EditCompanionNoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultRecipientNickname?: string;
  defaultRecipientId?: string;
  defaultGrantId?: string;
  onNoteSent?: (note: CompanionNote) => void;
  onToast?: (message: string) => void;
}

const PRESET_STICKERS = [
  { id: 'cheer', label: '🥔 冲刺土豆', emoji: '🥔' },
  { id: 'fire', label: '🔥 刷题狂魔', emoji: '🔥' },
  { id: 'star', label: '✨ 必定上岸', emoji: '✨' },
  { id: 'fish', label: '🐟 拒绝摸鱼', emoji: '🐟' },
  { id: 'coffee', label: '☕️ 提神醒脑', emoji: '☕️' },
  { id: 'hug', label: '🫂 考神附体', emoji: '🫂' },
];

const QUICK_PHRASES = [
  '今天也要一起上岸呀！加油土豆人🥔✨',
  '行测刷满100题，谁先放弃谁是小狗🐶！',
  '申论大作文快去写！别摸鱼啦！⚡️',
  '复习累了吃点好吃的，调整心态继续冲💪',
  '今天做对的每一道题，都是上岸的垫脚石！💯',
];

/**
 * Front-end canvas compression helper.
 * Compresses any user-selected mobile photo/meme to max 800x800 JPEG (quality 0.82),
 * reducing size to ~80-150KB while retaining high clarity for stickers and memes.
 */
export async function compressImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const MAX_DIM = 800;
        let { width, height } = img;
        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          } else {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(reader.result as string);
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        let dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        if (dataUrl.length > 1_500_000) {
          dataUrl = canvas.toDataURL('image/jpeg', 0.65);
        }
        resolve(dataUrl);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export const EditCompanionNoteModal: React.FC<EditCompanionNoteModalProps> = ({
  isOpen,
  onClose,
  defaultRecipientNickname = '学习伙伴',
  defaultRecipientId,
  defaultGrantId,
  onNoteSent,
  onToast,
}) => {
  const { currentUser, csrfToken } = useApp();
  const [hasDraftRestored, setHasDraftRestored] = useState(() => {
    if (!isOpen) return false;
    const draft = loadCompanionNoteDraft(currentUser?.id, defaultRecipientId, defaultGrantId);
    return Boolean(draft && (draft.message.trim() || draft.imageUrl));
  });

  const [message, setMessage] = useState(() => {
    if (!isOpen) return '';
    const draft = loadCompanionNoteDraft(currentUser?.id, defaultRecipientId, defaultGrantId);
    return draft?.message || '';
  });
  const [imageUrl, setImageUrl] = useState<string | null>(() => {
    if (!isOpen) return null;
    const draft = loadCompanionNoteDraft(currentUser?.id, defaultRecipientId, defaultGrantId);
    return draft?.imageUrl || null;
  });
  const [imageName, setImageName] = useState<string>(() => {
    if (!isOpen) return '';
    const draft = loadCompanionNoteDraft(currentUser?.id, defaultRecipientId, defaultGrantId);
    return draft?.imageName || '';
  });
  const [isCompressing, setIsCompressing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevIsOpenRef = useRef(false);

  // 监听模态框打开事件：若上次未成功发送且存在草稿，自动恢复用户上一次编辑的内容
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      const draft = loadCompanionNoteDraft(currentUser?.id, defaultRecipientId, defaultGrantId);
      if (draft && (draft.message.trim() || draft.imageUrl)) {
        setMessage(draft.message || '');
        setImageUrl(draft.imageUrl || null);
        setImageName(draft.imageName || '');
        setHasDraftRestored(true);
      } else {
        setMessage('');
        setImageUrl(null);
        setImageName('');
        setHasDraftRestored(false);
      }
    } else if (!isOpen && prevIsOpenRef.current) {
      setHasDraftRestored(false);
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, currentUser?.id, defaultRecipientId, defaultGrantId]);

  if (!isOpen) return null;

  const handleMessageChange = (val: string) => {
    setMessage(val);
    if (!val.trim() && !imageUrl) {
      setHasDraftRestored(false);
    }
    saveCompanionNoteDraft(currentUser?.id, defaultRecipientId, defaultGrantId, {
      message: val,
      imageUrl,
      imageName,
    });
  };

  const handlePickPhrase = (phrase: string) => {
    setMessage(phrase);
    saveCompanionNoteDraft(currentUser?.id, defaultRecipientId, defaultGrantId, {
      message: phrase,
      imageUrl,
      imageName,
    });
  };

  const handleRemoveImage = () => {
    setImageUrl(null);
    setImageName('');
    if (!message.trim()) {
      setHasDraftRestored(false);
    }
    saveCompanionNoteDraft(currentUser?.id, defaultRecipientId, defaultGrantId, {
      message,
      imageUrl: null,
      imageName: '',
    });
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      onToast?.('请选择图片格式的文件（如 JPG、PNG、WebP）');
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      onToast?.('图片文件过大，请选择 20MB 以内的图片');
      return;
    }

    try {
      setIsCompressing(true);
      const compressed = await compressImageToDataUrl(file);
      setImageUrl(compressed);
      setImageName(file.name);
      saveCompanionNoteDraft(currentUser?.id, defaultRecipientId, defaultGrantId, {
        message,
        imageUrl: compressed,
        imageName: file.name,
      });
    } catch {
      onToast?.('图片读取失败，请重试');
    } finally {
      setIsCompressing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePickSticker = (sticker: typeof PRESET_STICKERS[0]) => {
    // Generate a lightweight canvas badge as dataUrl
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#FAF8F5';
      ctx.fillRect(0, 0, 240, 240);
      ctx.fillStyle = '#E8EFE3';
      ctx.beginPath();
      ctx.arc(120, 120, 100, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '72px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sticker.emoji, 120, 105);
      ctx.font = 'bold 20px sans-serif';
      ctx.fillStyle = '#4B6240';
      ctx.fillText(sticker.label.replace(/^.*? /, ''), 120, 175);
      const url = canvas.toDataURL('image/png');
      setImageUrl(url);
      setImageName(sticker.label);
      saveCompanionNoteDraft(currentUser?.id, defaultRecipientId, defaultGrantId, {
        message,
        imageUrl: url,
        imageName: sticker.label,
      });
    }
  };

  const handleSend = async () => {
    const trimmed = message.trim();
    if (!trimmed && !imageUrl) {
      onToast?.('请写一句打气的话或选一张表情包哦~');
      return;
    }

    setSubmitting(true);
    try {
      let createdNote: CompanionNote;

      if (currentUser && csrfToken) {
        const res = await fetch('/api/sharing/notes', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({
            toUserId: defaultRecipientId,
            grantId: defaultGrantId,
            message: trimmed || '给你贴了一张打气表情包！🥔✨',
            imageUrl: imageUrl || undefined,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || '发送失败，请稍后重试');
        }

        const data = await res.json();
        createdNote = data.note;
      } else {
        // Offline / Guest fallback
        createdNote = {
          id: `local-note-${Date.now()}`,
          fromUserId: currentUser?.id || 'me',
          fromNickname: currentUser?.nickname || '我',
          toUserId: defaultRecipientId,
          grantId: defaultGrantId,
          message: trimmed || '给你贴了一张打气表情包！🥔✨',
          imageUrl: imageUrl || undefined,
          hearts: 0,
          createdAt: new Date().toISOString(),
        };
      }

      // 关键规则：只有发送成功了才会重置内容与草稿
      clearCompanionNoteDraft(currentUser?.id, defaultRecipientId, defaultGrantId);
      setMessage('');
      setImageUrl(null);
      setImageName('');
      setHasDraftRestored(false);

      onToast?.(`已为 ${defaultRecipientNickname} 贴上打气便签！💌`);
      onNoteSent?.(createdNote);
      onClose();
    } catch (err: any) {
      // 发送失败时绝对不重置编辑内容与草稿，避免用户丢失内容
      onToast?.(err.message || '发送便签失败，请检查网络');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="💌 贴一张打气便签">
      <div className="space-y-4">
        {/* Recipient Header */}
        <div className="flex items-center justify-between rounded-xl bg-cream/70 px-3.5 py-2.5 text-xs text-ink-muted">
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate">
              发送给：<strong className="text-ink-main text-sm">{defaultRecipientNickname}</strong>
            </span>
            {hasDraftRestored && (
              <span className="text-[10px] text-sage bg-sage-light border border-sage/30 px-1.5 py-0.5 rounded-full font-medium shrink-0">
                已自动恢复未发送内容
              </span>
            )}
          </div>
          <span className="flex items-center gap-1 text-sage font-medium shrink-0">
            <Sparkles size={13} />
            <span>学友专属打气</span>
          </span>
        </div>

        {/* Text Message Input */}
        <div>
          <label className="block text-xs font-bold text-ink-main mb-1.5" htmlFor="companion-note-text">
            打气留言或考公骚话
          </label>
          <textarea
            id="companion-note-text"
            rows={3}
            maxLength={500}
            value={message}
            onChange={e => handleMessageChange(e.target.value)}
            placeholder="写下你想对TA说的鼓励、打气或互相监督的话吧…"
            className="w-full rounded-2xl border border-line bg-paper px-3.5 py-2.5 text-sm text-ink-main placeholder:text-ink-muted/60 focus:border-sage focus:outline-none transition-colors"
          />
          <div className="flex items-center justify-between text-[11px] text-ink-muted mt-1 px-1">
            <span>支持表情与真题吐槽</span>
            <span>{message.length} / 500</span>
          </div>
        </div>

        {/* Quick Phrases */}
        <div>
          <div className="text-xs font-bold text-ink-muted mb-1.5">⚡️ 快捷打气文案</div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_PHRASES.map((phrase, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handlePickPhrase(phrase)}
                className="rounded-xl border border-line/60 bg-white/70 px-2.5 py-1 text-left text-xs text-ink-main hover:border-sage hover:bg-sage-light transition-colors"
              >
                {phrase}
              </button>
            ))}
          </div>
        </div>

        {/* Meme Sticker & Photo Upload Section */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-bold text-ink-main">
              表情包 / 考公梗图
            </label>
            <span className="text-[11px] text-ink-muted">本地智能压缩，支持大图展示</span>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileSelect}
          />

          {imageUrl ? (
            /* Selected Image Preview */
            <div className="relative rounded-2xl border border-line bg-paper p-2.5 flex items-center gap-3">
              <img
                src={imageUrl}
                alt="表情包预览"
                className="h-20 w-20 rounded-xl object-contain bg-cream border border-line/50 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-ink-main truncate">{imageName || '自定义表情包'}</p>
                <p className="text-[11px] text-sage mt-1">已就绪，便签中将大图展示</p>
                <button
                  type="button"
                  onClick={handleRemoveImage}
                  className="mt-1.5 text-xs text-alarm hover:underline flex items-center gap-0.5"
                >
                  <X size={12} />
                  <span>移除这张表情</span>
                </button>
              </div>
            </div>
          ) : (
            /* Upload Action Buttons */
            <div className="space-y-2">
              <Button
                type="button"
                variant="secondary"
                fullWidth
                disabled={isCompressing}
                onClick={() => fileInputRef.current?.click()}
                className="py-2.5 border-dashed border-[#B8C8AD] bg-[#F7FAF4] hover:bg-[#EEF4E9] text-sage font-medium"
              >
                <Upload size={15} />
                <span>{isCompressing ? '正在压缩相册图片…' : '📁 从手机相册选图'}</span>
              </Button>

              {/* Preset quick stickers */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-0.5">
                {PRESET_STICKERS.map(sticker => (
                  <button
                    key={sticker.id}
                    type="button"
                    onClick={() => handlePickSticker(sticker)}
                    className="shrink-0 rounded-xl border border-line/70 bg-cream/60 px-2 py-1 text-xs text-ink-main hover:border-sage hover:bg-sage-light transition-colors"
                  >
                    {sticker.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={handleSend}
            disabled={submitting || isCompressing || (!message.trim() && !imageUrl)}
            className="flex items-center gap-1.5 px-5"
          >
            <Send size={14} />
            <span>{submitting ? '发送中…' : '贴上便签'}</span>
          </Button>
        </div>
      </div>
    </Modal>
  );
};
