import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal, Button } from '../common/UIComponents';
import { PotatoSprite, PotatoPose } from '../common/PotatoSprite';
import { Avatar } from '../common/Avatar';
import { Camera, Check, Upload } from 'lucide-react';
import { compressImage } from '../../utils/imageCompressor';

interface ProfileEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onToast: (msg: string) => void;
}

export const ProfileEditModal: React.FC<ProfileEditModalProps> = ({
  isOpen,
  onClose,
  onToast,
}) => {
  const { state, updateProfile } = useApp();
  const [name, setName] = useState(state.profile.name || '土豆的备考空间');
  const [selectedAvatar, setSelectedAvatar] = useState<string>(state.profile.avatar || 'pose-0');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize and synchronize draft on open/profile change so uncommitted drafts are NEVER retained
  useEffect(() => {
    if (isOpen) {
      setName(state.profile.name || '土豆的备考空间');
      setSelectedAvatar(state.profile.avatar || 'pose-0');
    }
  }, [isOpen, state.profile]);

  const handleCancel = () => {
    setName(state.profile.name || '土豆的备考空间');
    setSelectedAvatar(state.profile.avatar || 'pose-0');
    onClose();
  };

  // Avatar choices using potato poses (0 to 7)
  const avatarOptions: { id: string; pose: PotatoPose; label: string }[] = [
    { id: 'pose-0', pose: 0, label: '元气土豆' },
    { id: 'pose-1', pose: 1, label: '读书土豆' },
    { id: 'pose-2', pose: 2, label: '思考土豆' },
    { id: 'pose-3', pose: 3, label: '记录土豆' },
    { id: 'pose-4', pose: 4, label: '复习土豆' },
    { id: 'pose-5', pose: 5, label: '蓄力土豆' },
    { id: 'pose-6', pose: 6, label: '庆祝土豆' },
    { id: 'pose-7', pose: 7, label: '专注土豆' },
  ];

  const handleAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const dataUrl = await compressImage(file, {
        maxWidth: 320,
        maxHeight: 320,
        quality: 0.75,
      });
      setSelectedAvatar(dataUrl);
      onToast('头像已上传就绪，点击下方保存即可应用');
    } catch (err) {
      onToast(err instanceof Error ? err.message : '相册头像处理失败');
    } finally {
      e.target.value = '';
    }
  };

  const handleSave = () => {
    if (!name.trim()) {
      alert('请输入空间昵称');
      return;
    }
    updateProfile(name.trim(), selectedAvatar);
    onToast('备考资料已保存更新！');
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleCancel} title="编辑个人资料 (13:1231)">
      <div className="space-y-4">
        {/* 大头像展示与相册上传 */}
        <div className="flex flex-col items-center justify-center pt-1 pb-2">
          <div className="relative w-24 h-24 rounded-3xl bg-paper border-2 border-sage/50 p-2 shadow-soft flex items-center justify-center">
            <Avatar avatar={selectedAvatar} size={76} />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full bg-sage text-white flex items-center justify-center shadow-md hover:bg-sage-dark active:scale-95 transition-all"
              title="上传相册头像"
            >
              <Camera size={14} />
            </button>
          </div>
          <span className="text-xs text-ink-muted mt-2">选择土豆吉祥物或上传专属照片</span>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarFile}
          />

          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-2.5 text-xs text-sage"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={13} />
            <span>上传相册头像</span>
          </Button>
        </div>

        {/* 土豆头像库 */}
        <div>
          <label className="block text-xs font-bold text-ink-main mb-2">或选择经典土豆形象</label>
          <div className="grid grid-cols-4 gap-2">
            {avatarOptions.map(opt => {
              const active = selectedAvatar === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSelectedAvatar(opt.id)}
                  className={`p-2 rounded-2xl border flex flex-col items-center justify-center transition-all ${
                    active
                      ? 'border-sage bg-sage-light/60 scale-105 shadow-sm'
                      : 'border-line bg-paper hover:bg-cream/50'
                  }`}
                >
                  <PotatoSprite pose={opt.pose} size={42} />
                  <span className="text-[10px] text-ink-muted mt-1 truncate">{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 空间昵称输入框 */}
        <div>
          <label className="block text-xs font-bold text-ink-main mb-1.5">备考空间名称</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="例如：土豆的省考必胜空间"
            className="w-full px-3.5 py-2.5 bg-cream/70 border border-line rounded-xl text-sm focus:outline-none focus:border-sage font-medium"
            maxLength={20}
          />
        </div>

        {/* 提交按钮 */}
        <div className="flex gap-2.5 pt-2">
          <Button variant="secondary" size="md" fullWidth onClick={handleCancel}>
            取消
          </Button>
          <Button variant="primary" size="md" fullWidth onClick={handleSave}>
            <Check size={16} />
            保存资料
          </Button>
        </div>
      </div>
    </Modal>
  );
};
