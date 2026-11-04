import type { ImageOrientationResult } from '../types';

export function isImageOrientationResult(value: unknown): value is ImageOrientationResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as ImageOrientationResult;
  return Object.keys(item).every(key => ['status', 'rotation', 'version'].includes(key))
    && item.version === 1 && ['resolved', 'unresolved'].includes(item.status)
    && [0, 90, 180, 270].includes(item.rotation)
    && (item.status !== 'unresolved' || item.rotation === 0);
}

export function validImageOrientations(value: unknown, imageCount: number): value is Array<ImageOrientationResult | null> {
  return Array.isArray(value) && value.length <= Math.min(9, imageCount)
    && value.every(item => item === null || isImageOrientationResult(item));
}

export function orientationMediaId(ref: string): string | null {
  const id = ref.startsWith('/api/media/') ? ref.slice(11) : ref.startsWith('media:') ? ref.slice(6) : ref.startsWith('media_') ? ref : '';
  return /^[A-Za-z0-9_-]{4,128}$/.test(id) ? id : null;
}
