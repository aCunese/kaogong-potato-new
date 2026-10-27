import { AppState, MediaRecord, OperationScope, OperationContext } from '../types';
import {
  applyMediaRefMappings,
  createMediaMigrationOutbox,
  getUnresolvedLocalChanges,
  hashState,
  isLocalOnlyImageRef,
  loadSnapshot,
  MediaRefReplacement,
} from './db';

/**
 * Media sync (R06): real photo / avatar pipeline.
 *
 * Flow (inside the account sync lock):
 * 1. scan the local snapshot for local-only image references (data URLs, blob URLs)
 * 2. upload each attachment to /api/media/upload (server dedupes by sha256 and
 *    enforces quota), obtaining a stable permission-protected media reference
 * 3. atomically rewrite the snapshot AND all queued outbox payloads to the
 *    confirmed references, keeping a pre-migration recovery copy
 * 4. only then may the workspace snapshot be pushed to the server
 *
 * If any upload fails the local data is left untouched and the queue keeps the
 * old references; the sync is reported as pending/retrying, never "saved on server".
 */

export interface MediaFlushFailure {
  ok: false;
  code:
    | 'SESSION_EXPIRED'
    | 'AUTH_EPOCH_CHANGED'
    | 'CSRF_INVALID'
    | 'QUOTA_EXCEEDED'
    | 'UPLOAD_FAILED'
    | 'NETWORK'
    | 'INVALID_MEDIA'
    | 'BLOB_EXPIRED';
  message: string;
  retryable: boolean;
}

export interface MediaFlushSuccess {
  ok: true;
  uploaded: number;
  alreadyRemote: number;
  changed: boolean;
}

export type MediaFlushResult = MediaFlushSuccess | MediaFlushFailure;

export interface LegacyMediaRef {
  kind: 'wrong' | 'avatar' | 'wrong-images';
  recordId?: string;
  index?: number;
  ref: string;
}

const DATA_URL_REGEX = /^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/i;

export function isDataImageUrl(ref: string | undefined | null): boolean {
  return Boolean(ref && DATA_URL_REGEX.test(ref));
}

/** Collect all local-only image references that require migration to server media. */
export function collectLegacyMediaRefs(state: AppState): LegacyMediaRef[] {
  const refs: LegacyMediaRef[] = [];
  if (!state) return refs;
  const avatar = state.profile?.avatar;
  if (avatar && isLocalOnlyImageRef(avatar)) refs.push({ kind: 'avatar', ref: avatar });
  for (const wrong of state.wrong ?? []) {
    if (wrong.image && isLocalOnlyImageRef(wrong.image)) {
      refs.push({ kind: 'wrong', recordId: wrong.id, ref: wrong.image });
    }
    const legacyImages = (wrong as unknown as { images?: unknown }).images;
    if (Array.isArray(legacyImages)) {
      legacyImages.forEach((img, index) => {
        if (typeof img === 'string' && isLocalOnlyImageRef(img)) {
          refs.push({ kind: 'wrong-images', recordId: wrong.id, index, ref: img });
        }
      });
    }
  }
  return refs;
}

export function hasLocalOnlyMediaRefs(state: AppState): boolean {
  return collectLegacyMediaRefs(state).length > 0;
}

function dataUrlToBlobParts(dataUrl: string): { mime: string; bytes: Uint8Array; filename: string } | null {
  const match = DATA_URL_REGEX.exec(dataUrl);
  if (!match) return null;
  const mime = match[1].toLowerCase().replace('jpg', 'jpeg');
  const base64 = match[2];
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp';
    return { mime, bytes, filename: `upload_${Date.now()}.${ext}` };
  } catch {
    return null;
  }
}

async function blobUrlToParts(blobUrl: string): Promise<{ mime: string; bytes: Uint8Array; filename: string } | null> {
  try {
    const response = await fetch(blobUrl);
    if (!response.ok) return null;
    const blob = await response.blob();
    const mime = (blob.type || 'image/jpeg').toLowerCase();
    if (!/^image\/(jpeg|jpg|png|webp)$/.test(mime)) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('png') ? 'png' : 'webp';
    return { mime: mime.replace('jpg', 'jpeg'), bytes, filename: `upload_${Date.now()}.${ext}` };
  } catch {
    return null;
  }
}

async function readBlobAsDataUrl(blobUrl: string): Promise<string | null> {
  try {
    const response = await fetch(blobUrl);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

interface UploadSuccess {
  mediaId: string;
  url: string;
  sha256?: string;
  mime?: string;
}

type UploadOutcome = { ok: true; data: UploadSuccess } | { ok: false; failure: MediaFlushFailure };

async function uploadOneMedia(csrfToken: string, ref: string, userId?: string): Promise<UploadOutcome> {
  let parts: { mime: string; bytes: Uint8Array; filename: string } | null = null;
  let localBlobDataUrl: string | null = null;

  if (isDataImageUrl(ref)) {
    parts = dataUrlToBlobParts(ref);
    localBlobDataUrl = ref;
  } else if (ref.startsWith('blob:')) {
    parts = await blobUrlToParts(ref);
    localBlobDataUrl = await readBlobAsDataUrl(ref);
  }

  if (!parts) {
    return {
      ok: false,
      failure: {
        ok: false,
        code: 'INVALID_MEDIA',
        message: '本机照片格式无法识别，已保留原始数据等待重试。',
        retryable: false,
      },
    };
  }

  const form = new FormData();
  const blob = new Blob([parts.bytes as unknown as BlobPart], { type: parts.mime });
  form.append('file', blob, parts.filename);

  let response: Response;
  try {
    const headers: Record<string, string> = { 'x-csrf-token': csrfToken };
    if (userId) {
      headers['x-workspace-user'] = userId;
    }
    response = await fetch('/api/media/upload', {
      method: 'POST',
      headers,
      body: form,
    });
  } catch (err) {
    return {
      ok: false,
      failure: {
        ok: false,
        code: 'NETWORK',
        message: '照片上传暂未完成，正在等待联网重试。',
        retryable: true,
      },
    };
  }

  if (response.status === 409) {
    const body = await response.json().catch(() => ({}));
    return {
      ok: false,
      failure: { ok: false, code: body.code || 'SESSION_ACCOUNT_MISMATCH', message: body.message || '账号会话不匹配', retryable: false },
    };
  }
  if (response.status === 401) {
    return {
      ok: false,
      failure: { ok: false, code: 'SESSION_EXPIRED', message: '登录状态已失效，请重新登录后继续上传照片。', retryable: false },
    };
  }
  if (response.status === 403) {
    return {
      ok: false,
      failure: { ok: false, code: 'CSRF_INVALID', message: '安全令牌已过期，正在重新验证会话。', retryable: true },
    };
  }
  if (response.status === 413) {
    const body = await response.json().catch(() => ({}));
    return {
      ok: false,
      failure: {
        ok: false,
        code: 'QUOTA_EXCEEDED',
        message: body.message || '附件存储配额不足：照片仍完整保留在本机，清理历史错题照片后可重试。',
        retryable: false,
      },
    };
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    return {
      ok: false,
      failure: {
        ok: false,
        code: 'UPLOAD_FAILED',
        message: body.message || `照片上传失败 (HTTP ${response.status})，已保留本机副本等待重试。`,
        retryable: response.status >= 500 || response.status === 429,
      },
    };
  }

  const json = await response.json().catch(() => null);
  const mediaId = json?.media?.id;
  if (!json?.ok || !mediaId || typeof mediaId !== 'string') {
    return {
      ok: false,
      failure: {
        ok: false,
        code: 'UPLOAD_FAILED',
        message: '服务器返回的附件标识无效，已保留本机副本等待重试。',
        retryable: true,
      },
    };
  }

  return {
    ok: true,
    data: {
      mediaId,
      url: typeof json.media.url === 'string' ? json.media.url : `/api/media/${mediaId}`,
      sha256: typeof json.media.sha256 === 'string' ? json.media.sha256 : undefined,
      mime: typeof json.media.mime_type === 'string' ? json.media.mime_type : parts.mime,
    },
  };
}

export interface FlushMediaOptions {
  /** Called right before a mutating transaction so callers can verify auth epoch. */
  guard?: () => boolean;
  scope?: OperationScope;
  context?: OperationContext;
  signal?: AbortSignal;
}

function isMediaSyncCancelled(options?: FlushMediaOptions): boolean {
  if (!options) return false;
  if (options.guard && !options.guard()) return true;
  if (options.context && !options.context.isCurrent()) return true;
  if (options.scope && typeof (options.scope as any).isExpired === 'function' && (options.scope as any).isExpired()) return true;
  if (options.scope?.signal?.aborted) return true;
  if (options.signal?.aborted) return true;
  return false;
}

/**
 * Upload all local-only attachments for a user and rewrite references atomically.
 * Must be called inside the account sync lock, BEFORE pushing the workspace snapshot.
 */
export async function flushLegacyMedia(
  userId: string,
  csrfToken: string,
  options: FlushMediaOptions = {}
): Promise<MediaFlushResult> {
  if (isMediaSyncCancelled(options)) {
    return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已终止附件上传。', retryable: false };
  }
  if (!csrfToken) {
    return { ok: false, code: 'CSRF_INVALID', message: '缺少安全令牌，正在重新验证会话。', retryable: true };
  }

  const snapshot = await loadSnapshot(userId);
  if (isMediaSyncCancelled(options)) {
    return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已终止附件上传。', retryable: false };
  }
  if (!snapshot) {
    return { ok: true, uploaded: 0, alreadyRemote: 0, changed: false };
  }

  const refs = collectLegacyMediaRefs(snapshot.state);
  if (refs.length === 0) {
    return { ok: true, uploaded: 0, alreadyRemote: 0, changed: false };
  }

  const replacements: MediaRefReplacement[] = [];
  const mediaRecords: MediaRecord[] = [];
  let uploaded = 0;

  // Deduplicate identical data URLs (e.g. same photo attached to two records).
  const cache = new Map<string, UploadSuccess>();

  for (const legacyRef of refs) {
    if (isMediaSyncCancelled(options)) {
      return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已终止附件上传。', retryable: false };
    }
    const cached = cache.get(legacyRef.ref);
    if (cached) {
      replacements.push({ from: legacyRef.ref, to: cached.url });
      continue;
    }

    const outcome = await uploadOneMedia(csrfToken, legacyRef.ref, userId);
    if (isMediaSyncCancelled(options)) {
      return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已终止附件上传。', retryable: false };
    }
    if (!outcome.ok) {
      return outcome.failure;
    }
    uploaded += 1;
    cache.set(legacyRef.ref, outcome.data);
    replacements.push({ from: legacyRef.ref, to: outcome.data.url });

    // Persist a local copy so the image still renders offline after migration.
    let localCopy: string | undefined;
    if (isDataImageUrl(legacyRef.ref)) {
      localCopy = legacyRef.ref;
    } else {
      const dataUrl = await readBlobAsDataUrl(legacyRef.ref);
      if (dataUrl) localCopy = dataUrl;
    }
    if (localCopy) {
      const type: MediaRecord['type'] = legacyRef.kind === 'avatar' ? 'avatar' : 'photo';
      mediaRecords.push({
        id: outcome.data.mediaId,
        type,
        mime: outcome.data.mime || 'image/jpeg',
        blob: localCopy,
        createdAt: new Date().toISOString(),
      });
    }
  }

  if (isMediaSyncCancelled(options)) {
    return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已终止附件上传。', retryable: false };
  }

  try {
    await applyMediaRefMappings(userId, replacements, mediaRecords, options);
  } catch (err) {
    if (isMediaSyncCancelled(options) || (err as any)?.code === 'AUTH_EPOCH_CHANGED') {
      return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已终止附件上传。', retryable: false };
    }
    throw err;
  }

  if (isMediaSyncCancelled(options)) {
    return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已终止附件上传。', retryable: false };
  }

  // Ensure the migrated content will actually be pushed to the cloud.
  const unresolved = await getUnresolvedLocalChanges(userId);
  if (unresolved.total === 0) {
    await createMediaMigrationOutbox(userId);
  }

  return { ok: true, uploaded, alreadyRemote: 0, changed: true };
}

/** Hash of the current local snapshot content (for divergence checks). */
export async function currentSnapshotHash(userId: string): Promise<string | null> {
  const snapshot = await loadSnapshot(userId);
  if (!snapshot) return null;
  return hashState(snapshot.state);
}
