import React, { useState, useEffect } from 'react';
import { PotatoSprite, PotatoPose } from './PotatoSprite';

export interface AvatarProps {
  avatar?: string | null;
  size?: number; // size in px
  className?: string;
  alt?: string;
  style?: React.CSSProperties;
}

export const Avatar: React.FC<AvatarProps> = ({
  avatar,
  size = 50,
  className = '',
  alt = '用户头像',
  style,
}) => {
  const [hasError, setHasError] = useState(false);

  // Reset error state when avatar source changes
  useEffect(() => {
    setHasError(false);
  }, [avatar]);

  // Fallback helper: extracts pose number 0-7 or defaults to 0
  const getPoseNumber = (str: string): PotatoPose => {
    const num = parseInt(str.replace('pose-', ''), 10);
    return (num >= 0 && num <= 7 ? num : 0) as PotatoPose;
  };

  // If no avatar or image failed to load, render default potato sprite
  if (!avatar || avatar.trim() === '' || hasError) {
    return <PotatoSprite pose={0} size={size} className={className} alt={alt} />;
  }

  // Pre-configured potato poses (pose-0 to pose-7)
  if (avatar.startsWith('pose-')) {
    const pose = getPoseNumber(avatar);
    return <PotatoSprite pose={pose} size={size} className={className} alt={alt} />;
  }

  // Real image data URL, HTTP URL, or Blob URL
  if (
    avatar.startsWith('data:') ||
    avatar.startsWith('http://') ||
    avatar.startsWith('https://') ||
    avatar.startsWith('blob:')
  ) {
    return (
      <img
        src={avatar}
        alt={alt}
        className={`rounded-2xl object-cover shrink-0 ${className}`}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          minWidth: `${size}px`,
          minHeight: `${size}px`,
          ...style,
        }}
        onError={() => setHasError(true)}
      />
    );
  }

  // Any unrecognized or corrupted string falls back safely to pose 0
  return <PotatoSprite pose={0} size={size} className={className} alt={alt} />;
};
