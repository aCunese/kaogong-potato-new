import React, { useState, useRef } from 'react';
import { Modal, Button } from '../common/UIComponents';
import { useApp } from '../../context/AppContext';
import { Image as ImageIcon, X, Sparkles, Send, Upload, Heart } from 'lucide-react';
import type { CompanionNote } from '../../types/companionNote';

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
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
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
  const [message, setMessage] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string>('');
  const [isCompressing, setIsCompressing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      onToast?.('请选择图片格式的文件（如 JPG、PNG、WebP）');
      return;
    }

    try {
      setIsCompressing(true);
      const compressed = await compressImageToDataUrl(file);
      setImageUrl(compressed);
      setImageName(file.name);
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
      setImageUrl(canvas.toDataURL('image/png'));
      setImageName(sticker.label);
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

      onToast?.(`已为 ${defaultRecipientNickname} 贴上打气便签！💌`);
      onNoteSent?.(createdNote);
      onClose();
    } catch (err: any) {
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
          <span>
            发送给：<strong className="text-ink-main text-sm">{defaultRecipientNickname}</strong>
          </span>
          <span className="flex items-center gap-1 text-sage font-medium">
            <Sparkles size={13} />
            <span>研友专属打气</span>
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
            onChange={e => setMessage(e.target.value)}
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
                onClick={() => setMessage(phrase)}
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
                  onClick={() => {
                    setImageUrl(null);
                    setImageName('');
                  }}
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
            disabled={submitting || (!message.trim() && !imageUrl)}
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
