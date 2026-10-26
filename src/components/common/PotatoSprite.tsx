import React from 'react';

export type PotatoPose = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

interface PotatoSpriteProps {
  pose: PotatoPose;
  size?: number; // width in pixels
  className?: string;
  alt?: string;
}

export const POTATO_DESCRIPTIONS: Record<PotatoPose, string> = {
  0: '挥手土豆 (打招呼/今日)',
  1: '读书土豆 (题本刷题)',
  2: '戴耳机土豆 (听网课)',
  3: '放大镜土豆 (错题复盘)',
  4: '图表土豆 (总体分析)',
  5: '电脑土豆 (每月分析)',
  6: '庆祝土豆 (登记成功/完成)',
  7: '写笔记土豆 (事项库/设置)',
};

export const PotatoSprite: React.FC<PotatoSpriteProps> = ({
  pose,
  size = 64,
  className = '',
  alt,
}) => {
  // The sprite sheet has 4 columns and 2 rows.
  // Each sprite frame has an aspect ratio of approximately 1:1.
  const height = size;

  return (
    <div
      className={`potato-pose pose-${pose} ${className}`}
      style={{
        width: `${size}px`,
        height: `${height}px`,
      }}
      role="img"
      aria-label={alt || POTATO_DESCRIPTIONS[pose]}
    />
  );
};
