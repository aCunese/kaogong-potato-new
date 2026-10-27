/**
 * Image compression and storage utilities
 * Follows strict spec:
 * - Standard wrong question photos: max dimension 1200px, quality 0.75
 * - Long photos (aspect ratio > 2): bounding box 4096x1200, short side >= min(original, 720)
 * - Thumbnail max dimension 320px, quality 0.70
 * - Max 10 images per batch, max 20MB per file
 * - Compression failure rejects with explicit error, NEVER quietly returns original raw data
 */

export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB
export const MAX_BATCH_COUNT = 10;

export interface CompressOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  mimeType?: string;
  isWrongPhoto?: boolean;
}

/**
 * Validates a batch of files before compression
 */
export function validateImageBatch(files: (File | Blob)[]): { valid: boolean; error?: string } {
  if (files.length > MAX_BATCH_COUNT) {
    return { valid: false, error: `单次最多上传 ${MAX_BATCH_COUNT} 张图片（当前已选 ${files.length} 张）` };
  }
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file.size > MAX_FILE_SIZE_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      const nameStr = 'name' in file ? `「${(file as File).name}」` : `第 ${i + 1} 张图片`;
      return { valid: false, error: `${nameStr}大小 (${sizeMb}MB) 超过 20MB 限制` };
    }
  }
  return { valid: true };
}

/**
 * Validates a single file
 */
export function validateImageFile(file: File | Blob): { valid: boolean; error?: string } {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    const nameStr = 'name' in file ? `图片「${(file as File).name}」` : '图片';
    return { valid: false, error: `${nameStr}大小 (${sizeMb}MB) 超过 20MB 限制` };
  }
  return { valid: true };
}

/**
 * Compresses an image file using an HTML Canvas element
 * Default: max 1200px, quality 0.75.
 * Strictly throws on any failure; NEVER quietly returns uncompressed raw data.
 */
export async function compressImage(file: File | Blob, options: CompressOptions = {}): Promise<string> {
  const isWrongPhoto = options.isWrongPhoto ?? (
    (options.maxWidth === undefined && options.maxHeight === undefined) ||
    (options.maxWidth === 1200 && options.maxHeight === 1200) ||
    ((options.maxWidth ?? 0) >= 1000 && (options.maxHeight ?? 0) >= 1000)
  );

  const {
    maxWidth = 1200,
    maxHeight = 1200,
    quality = 0.75,
    mimeType = 'image/jpeg',
  } = options;

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`图片文件大小超过 20MB 限制 (${(file.size / (1024 * 1024)).toFixed(1)}MB)`);
  }

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('当前运行环境不支持 DOM/Canvas 图片压缩');
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(new Error('无法读取图片文件内容'));
    };

    reader.onload = (e) => {
      const rawResult = e.target?.result as string;
      if (!rawResult) {
        reject(new Error('读取到的图片数据为空'));
        return;
      }

      const img = new Image();
      img.onerror = () => {
        reject(new Error('图片格式错误或无法解析图片数据'));
      };

      img.onload = () => {
        try {
          const originalWidth = img.naturalWidth || img.width;
          const originalHeight = img.naturalHeight || img.height;

          if (originalWidth <= 0 || originalHeight <= 0) {
            reject(new Error('图片尺寸无效 (0x0)'));
            return;
          }

          let width = originalWidth;
          let height = originalHeight;

          const originalLongSide = Math.max(originalWidth, originalHeight);
          const originalShortSide = Math.min(originalWidth, originalHeight);
          const aspectRatio = originalLongSide / originalShortSide;

          if (isWrongPhoto && aspectRatio > 2) {
            // Long photo: bounding box of long side 4096, short side 1200
            const maxLongSide = 4096;
            const maxShortSide = 1200;
            const minRequiredShortSide = Math.min(originalShortSide, 720);

            // Never upscale images smaller than the bounding box
            const scale = Math.min(1, maxLongSide / originalLongSide, maxShortSide / originalShortSide);
            const targetLongSide = Math.round(originalLongSide * scale);
            const targetShortSide = Math.round(originalShortSide * scale);

            if (targetShortSide < minRequiredShortSide) {
              reject(new Error(
                `长图比例过大（长边缩放至 4096 后短边仅 ${targetShortSide}px，低于 ${minRequiredShortSide}px 清晰度底线）。为保证题目文字清晰可读，请先将长图裁剪或分段为多张后再上传。`
              ));
              return;
            }

            if (originalWidth >= originalHeight) {
              width = targetLongSide;
              height = targetShortSide;
            } else {
              width = targetShortSide;
              height = targetLongSide;
            }
          } else {
            // Non-long standard photo: scale down maintaining aspect ratio
            if (width > maxWidth || height > maxHeight) {
              const ratio = Math.min(maxWidth / width, maxHeight / height);
              width = Math.max(1, Math.round(width * ratio));
              height = Math.max(1, Math.round(height * ratio));
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('创建 Canvas 2D 绘图上下文失败'));
            return;
          }

          // Fill white background for transparent images converted to JPEG
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);

          const compressedDataUrl = canvas.toDataURL(mimeType, quality);
          if (!compressedDataUrl || !compressedDataUrl.startsWith('data:image/')) {
            reject(new Error('图片导出 DataURL 失败'));
            return;
          }

          resolve(compressedDataUrl);
        } catch (err) {
          reject(new Error(`图片压缩处理失败: ${err instanceof Error ? err.message : String(err)}`));
        }
      };

      img.src = rawResult;
    };

    reader.readAsDataURL(file);
  });
}

/**
 * Compresses a wrong question photo with 1200x1200 standard and long photo preservation.
 */
export async function compressWrongPhoto(file: File | Blob, options: CompressOptions = {}): Promise<string> {
  return compressImage(file, {
    maxWidth: 1200,
    maxHeight: 1200,
    quality: 0.75,
    isWrongPhoto: true,
    ...options,
  });
}

/**
 * Generates a thumbnail image
 * Default: max 320px, quality 0.70
 */
export async function generateThumbnail(file: File | Blob, options: CompressOptions = {}): Promise<string> {
  return compressImage(file, {
    maxWidth: 320,
    maxHeight: 320,
    quality: 0.70,
    isWrongPhoto: false,
    mimeType: 'image/jpeg',
    ...options,
  });
}

/**
 * Safely writes state to localStorage with quota overflow handling.
 * Returns { success: true } or { success: false, error: string }.
 */
export function safeSaveState(storageKey: string, state: unknown): { success: boolean; error?: string } {
  try {
    if (typeof localStorage === 'undefined') {
      return { success: false, error: 'localStorage is not supported' };
    }
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
