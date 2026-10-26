/**
 * Image compression and storage utilities
 * Fixes A01: Compresses uploaded wrong-question photos before base64/storage
 * to prevent QuotaExceededError and image loss.
 */

export interface CompressOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  mimeType?: string;
}

/**
 * Compresses an image file using an HTML Canvas element
 * Scales down high-resolution images (e.g. 2000x1500) to max 1200px and reduces JPEG quality to ~0.75,
 * reducing payload from 5-10MB to ~80-150KB while keeping text fully readable.
 */
export async function compressImage(file: File, options: CompressOptions = {}): Promise<string> {
  const {
    maxWidth = 1200,
    maxHeight = 1200,
    quality = 0.75,
    mimeType = 'image/jpeg',
  } = options;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('无法读取文件'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('无法解析图片数据'));
      img.onload = () => {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        // Calculate aspect-preserving dimensions
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          // Fallback if canvas 2D context fails
          resolve(e.target?.result as string);
          return;
        }

        // Draw image onto canvas
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        try {
          const compressedDataUrl = canvas.toDataURL(mimeType, quality);
          resolve(compressedDataUrl);
        } catch (err) {
          // Fallback to original read result if toDataURL fails
          resolve(e.target?.result as string);
        }
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Safely writes state to localStorage with quota overflow handling.
 * Returns { success: true } or { success: false, error: string }.
 */
export function safeSaveState(storageKey: string, state: unknown): { success: boolean; error?: string } {
  try {
    const serialized = JSON.stringify(state);
    localStorage.setItem(storageKey, serialized);
    return { success: true };
  } catch (err: any) {
    console.error('LocalStorage write failed:', err);
    if (err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22)) {
      return { success: false, error: '本地存储空间不足，未能保存数据。请清理过期错题照片或导出备份。' };
    }
    return { success: false, error: err?.message || '本地存储写入异常' };
  }
}
