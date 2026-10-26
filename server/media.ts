import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDb, getAttachmentsDir } from './db';

export const MAX_USER_QUOTA_BYTES = Number(process.env.USER_MEDIA_QUOTA_BYTES) || 500 * 1024 * 1024; // 500 MB
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB per image

export interface MediaRecordRow {
  id: string;
  user_id: string;
  filename: string;
  original_name: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  created_at: string;
}

export function detectImageMime(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // WebP: RIFF ... WEBP
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
}

export function getUserTotalMediaUsage(userId: string): number {
  const db = getDb();
  const row = db.prepare('SELECT COALESCE(SUM(byte_size), 0) as total FROM media_records WHERE user_id = ?').get(userId) as { total: number };
  return row?.total || 0;
}

export interface SaveMediaResult {
  ok: boolean;
  code?: string;
  message?: string;
  media?: MediaRecordRow;
}

export function saveUserMedia(
  userId: string,
  buffer: Buffer,
  originalName: string
): SaveMediaResult {
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    return { ok: false, code: 'FILE_TOO_LARGE', message: '单张图片大小不能超过 10MB' };
  }

  const mime = detectImageMime(buffer);
  if (!mime) {
    return { ok: false, code: 'INVALID_IMAGE_TYPE', message: '仅支持 JPEG、PNG 或 WebP 格式的图片' };
  }

  const currentUsage = getUserTotalMediaUsage(userId);
  if (currentUsage + buffer.length > MAX_USER_QUOTA_BYTES) {
    const quotaMb = Math.round(MAX_USER_QUOTA_BYTES / 1024 / 1024);
    return { ok: false, code: 'QUOTA_EXCEEDED', message: `附件存储已超额（每账号限额 ${quotaMb} MB），请清理历史无用错题照片` };
  }

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp';
  const diskFilename = `${sha256}.${ext}`;
  const attachmentsDir = getAttachmentsDir();
  const diskPath = path.join(attachmentsDir, diskFilename);

  // Write file atomically if not already on disk
  if (!fs.existsSync(diskPath)) {
    const tmpPath = `${diskPath}.tmp_${Date.now()}`;
    fs.writeFileSync(tmpPath, buffer);
    fs.renameSync(tmpPath, diskPath);
  }

  const mediaId = `media_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  const nowIso = new Date().toISOString();

  const db = getDb();
  db.prepare(`
    INSERT INTO media_records (id, user_id, filename, original_name, mime_type, byte_size, sha256, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(mediaId, userId, diskFilename, originalName || diskFilename, mime, buffer.length, sha256, nowIso);

  const savedRecord: MediaRecordRow = {
    id: mediaId,
    user_id: userId,
    filename: diskFilename,
    original_name: originalName,
    mime_type: mime,
    byte_size: buffer.length,
    sha256,
    created_at: nowIso,
  };

  return { ok: true, media: savedRecord };
}

export function getUserMediaFile(userId: string, mediaId: string): { diskPath: string; mime: string } | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT filename, mime_type FROM media_records WHERE id = ? AND user_id = ?
  `).get(mediaId, userId) as { filename: string; mime_type: string } | undefined;

  if (!row) return null;

  const diskPath = path.join(getAttachmentsDir(), row.filename);
  if (!fs.existsSync(diskPath)) return null;

  return { diskPath, mime: row.mime_type };
}

export function deleteUserMedia(userId: string, mediaId: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT filename FROM media_records WHERE id = ? AND user_id = ?').get(mediaId, userId) as { filename: string } | undefined;
  if (!row) return false;

  db.prepare('DELETE FROM media_records WHERE id = ? AND user_id = ?').run(mediaId, userId);

  // If no other records reference this filename, prune it from disk
  const others = db.prepare('SELECT count(*) as cnt FROM media_records WHERE filename = ?').get(row.filename) as { cnt: number };
  if (others.cnt === 0) {
    const diskPath = path.join(getAttachmentsDir(), row.filename);
    try { if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath); } catch {}
  }

  return true;
}
