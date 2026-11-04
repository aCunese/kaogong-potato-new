import { ImageOrientationResult } from '../types';
import { isImageOrientationResult } from './imageOrientation';

export async function requestImageOrientation(mediaId: string, csrf: string, userId: string, signal?: AbortSignal): Promise<ImageOrientationResult> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 35000);
  try {
    const response = await fetch(`/api/media/${encodeURIComponent(mediaId)}/orientation`, {
      method: 'POST', credentials: 'same-origin', signal: controller.signal,
      headers: { 'x-csrf-token': csrf, 'x-workspace-user': userId },
    });
    if (!response.ok) {
      throw new Error(response.status === 429 ? '识别正在排队，稍后自动重试' : response.status === 504 ? '识别超时，稍后可重新识别' : '暂未完成自动摆正，请稍后重试');
    }
    const data = await response.json();
    if (data?.ok !== true || data.mediaId !== mediaId || !isImageOrientationResult(data.orientation)) throw new Error('图片识别结果无效，请重试');
    return data.orientation;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
