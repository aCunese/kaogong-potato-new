import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal, Button } from '../common/UIComponents';
import { PotatoSprite, PotatoPose } from '../common/PotatoSprite';
import { Camera, Check, Sparkles } from 'lucide-react';

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

  const handleSave = () => {
    if (!name.trim()) {
      alert('请输入空间昵称');
      return;
    }
    // Real persistence call (Fixes A11)
    updateProfile(name.trim(), selectedAvatar);
    onToast('备考资料已保存更新！');
    onClose();
  };

  const getPoseNumber = (str: string): PotatoPose => {
    const num = parseInt(str.replace('pose-', '') || '0', 10);
    return (num >= 0 && num <= 7 ? num : 0) as PotatoPose;
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="编辑个人资料 (13:1231)">
      <div className="space-y-4">
        {/* 大头像展示与选择器 */}
        <div className="flex flex-col items-center justify-center pt-1 pb-2">
          <div className="relative w-24 h-24 rounded-3xl bg-paper border-2 border-sage/50 p-2 shadow-soft flex items-center justify-center">
            {selectedAvatar.startsWith('data:') || selectedAvatar.startsWith('http') ? (
              <img src={selectedAvatar} alt="头像" className="w-full h-full object-cover rounded-2xl" />
            ) : (
              <PotatoSprite pose={getPoseNumber(selectedAvatar)} size={76} />
            )}
            <div className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full bg-sage text-white flex items-center justify-center shadow-md">
              <Camera size={14} />
            </div>
          </div>
          <span className="text-xs text-ink-muted mt-2">点击下方更换土豆陪伴头像</span>
        </div>

        {/* 土豆头像库 */}
        <div>
          <label className="block text-xs font-bold text-ink-main mb-2">选择土豆吉祥物形象</label>
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
          <Button variant="secondary" size="md" fullWidth onClick={onClose}>
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
