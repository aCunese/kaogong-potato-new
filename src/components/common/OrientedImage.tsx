import React, { useEffect, useState } from 'react';

interface Props {
  src: string;
  alt: string;
  rotation?: 0 | 90 | 180 | 270;
  cover?: boolean;
  className?: string;
  style?: React.CSSProperties;
  loading?: 'lazy' | 'eager';
  decoding?: 'async' | 'sync' | 'auto';
  draggable?: boolean;
}

/** Rotate inside a viewBox with swapped dimensions so containment, cropping and zoom use the corrected shape. */
export const OrientedImage: React.FC<Props> = ({ src, alt, rotation = 0, cover = false, className, style, ...rest }) => {
  const [size, setSize] = useState({ src: '', width: 1, height: 1 });
  useEffect(() => {
    if (!rotation) return;
    let alive = true;
    const image = new Image();
    image.onload = () => { if (alive) setSize({ src, width: image.naturalWidth, height: image.naturalHeight }); };
    image.src = src;
    return () => { alive = false; image.onload = null; };
  }, [src, rotation]);
  if (!rotation) return <img src={src} alt={alt} className={className} style={style} {...rest} data-rotation="0" />;
  const width = size.src === src ? size.width : 1, height = size.src === src ? size.height : 1;
  const sideways = rotation === 90 || rotation === 270;
  const transform = rotation === 90 ? `translate(${height} 0) rotate(90)` : rotation === 180 ? `translate(${width} ${height}) rotate(180)` : `translate(0 ${width}) rotate(270)`;
  return <svg role="img" aria-label={alt} data-rotation={rotation} viewBox={`0 0 ${sideways ? height : width} ${sideways ? width : height}`} width={sideways ? height : width} height={sideways ? width : height} preserveAspectRatio={cover ? 'xMidYMid slice' : 'xMidYMid meet'} className={className} style={style}>
    <image href={src} width={width} height={height} transform={transform} />
  </svg>;
};
