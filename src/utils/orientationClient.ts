import { ImageOrientationResult } from '../types';
import { isImageOrientationResult } from './imageOrientation';

export class OrientationClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly retryAfterSeconds: number,
    message: string
  ) {
    super(message);
    this.name = 'OrientationClientError';
  }
}

export async function requestImageOrientation(
  mediaId: string,
  csrf: string,
  userId: string,
  signal?: AbortSignal
): Promise<ImageOrientationResult> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 35000);
  try {
    const response = await fetch(`/api/media/${encodeURIComponent(mediaId)}/orientation`, {
      method: 'POST',
      credentials: 'same-origin',
      signal: controller.signal,
      headers: { 'x-csrf-token': csrf, 'x-workspace-user': userId },
    });
    const retryAfterHeader = response.headers.get('retry-after');
    const headerRetrySec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : NaN;
    if (!response.ok) {
      let code = 'ORIENTATION_UNAVAILABLE';
      let retryAfter = Number.isFinite(headerRetrySec) ? headerRetrySec : 2;
      let errorMsg = '暂未完成自动摆正，请稍后重试';
      try {
        const errJson = await response.json();
        if (errJson?.code) code = errJson.code;
        if (Number.isFinite(errJson?.retryAfterSeconds)) retryAfter = errJson.retryAfterSeconds;
        if (errJson?.error) errorMsg = errJson.error;
      } catch {
        // response may not be json
      }
      if (response.status === 429) {
        throw new OrientationClientError(response.status, code || 'ORIENTATION_BUSY', retryAfter, '识别正在排队，稍后自动重试');
      }
      if (response.status === 504) {
        throw new OrientationClientError(response.status, code || 'ORIENTATION_TIMEOUT', 5, '识别超时，稍后自动重试');
      }
      throw new OrientationClientError(response.status, code, retryAfter, errorMsg);
    }
    const data = await response.json();
    if (data?.ok !== true || data.mediaId !== mediaId || !isImageOrientationResult(data.orientation)) {
      throw new OrientationClientError(200, 'INVALID_ORIENTATION', 0, '图片识别结果无效，请重试');
    }
    return data.orientation;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
