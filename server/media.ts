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
  /** 稳定的服务端读取地址（契约：/api/media/<id>） */
  url?: string;
}

/** 为媒体记录补充稳定 URL（不修改数据库行） */
export function withMediaUrl(record: MediaRecordRow): MediaRecordRow {
  return { ...record, url: `/api/media/${record.id}` };
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

export function verifyImageDimensions(buffer: Buffer, mime: string, maxDim = 4096): boolean {
  try {
    if (mime === 'image/png' && buffer.length >= 24) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      if (width > maxDim || height > maxDim) return false;
    } else if (mime === 'image/jpeg') {
      let offset = 2;
      while (offset < buffer.length - 8) {
        if (buffer[offset] !== 0xff) break;
        const marker = buffer[offset + 1];
        if (marker === 0xc0 || marker === 0xc2) { // SOF0 or SOF2
          const height = buffer.readUInt16BE(offset + 5);
          const width = buffer.readUInt16BE(offset + 7);
          if (width > maxDim || height > maxDim) return false;
          break;
        }
        offset += 2 + buffer.readUInt16BE(offset + 2);
      }
    }
  } catch {
    return false;
  }
  return true;
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
  /** true = 同账号同 sha256 命中既有记录（秒传），未重复计费/占用配额 */
  deduplicated?: boolean;
}

function ensureAttachmentFile(filename: string, buffer: Buffer, attachmentsDir: string): void {
  const diskPath = path.join(attachmentsDir, filename);
  if (fs.existsSync(diskPath)) return;
  const tmpPath = `${diskPath}.tmp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmpPath, buffer);
  try {
    fs.renameSync(tmpPath, diskPath);
  } catch {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
  }
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

  // 防御客户端解压像素炸弹 (Decompression Bomb DoS)
  if (!verifyImageDimensions(buffer, mime, 4096)) {
    return { ok: false, code: 'IMAGE_DIMENSION_EXCEEDED', message: '图片分辨率过大（单边最大支持 4096 像素），已拒绝以防客户端解压内存溢出' };
  }

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp';
  const diskFilename = `${sha256}.${ext}`;
  const attachmentsDir = getAttachmentsDir();
  const db = getDb();

  // R06：上传幂等（按 user_id + sha256 秒传）。同账号重复上传同一图片直接返回既有记录，
  // 绝不产生第二条 media_records，也不重复累计配额。
  const dedupeRow = db.prepare(`
    SELECT * FROM media_records WHERE user_id = ? AND sha256 = ? ORDER BY created_at ASC, rowid ASC LIMIT 1
  `).get(userId, sha256) as MediaRecordRow | undefined;
  if (dedupeRow) {
    // 若历史数据的磁盘文件缺失（例如人工清理），按本次上传内容自愈补齐，不新增记账行
    ensureAttachmentFile(dedupeRow.filename, buffer, attachmentsDir);
    return { ok: true, media: withMediaUrl(dedupeRow), deduplicated: true };
  }

  // Write file atomically with unique temporary file
  ensureAttachmentFile(diskFilename, buffer, attachmentsDir);

  const mediaId = `media_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  const nowIso = new Date().toISOString();

  // 关键防御：在 SQLite 事务内原子执行配额累计检查与记录插入，彻底消除 TOCTOU 竞态穿透
  try {
    const insertTx = db.transaction(() => {
      const usageRow = db.prepare('SELECT COALESCE(SUM(byte_size), 0) as total FROM media_records WHERE user_id = ?').get(userId) as { total: number };
      if (usageRow.total + buffer.length > MAX_USER_QUOTA_BYTES) {
        throw new Error('QUOTA_EXCEEDED');
      }

      db.prepare(`
        INSERT INTO media_records (id, user_id, filename, original_name, mime_type, byte_size, sha256, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(mediaId, userId, diskFilename, (originalName || diskFilename).slice(0, 255), mime, buffer.length, sha256, nowIso);
    });

    insertTx();
  } catch (err: any) {
    if (err.message === 'QUOTA_EXCEEDED') {
      const quotaMb = Math.round(MAX_USER_QUOTA_BYTES / 1024 / 1024);
      return { ok: false, code: 'QUOTA_EXCEEDED', message: `附件存储已超额（每账号限额 ${quotaMb} MB），请清理历史无用错题照片` };
    }
    throw err;
  }

  const savedRecord: MediaRecordRow = {
    id: mediaId,
    user_id: userId,
    filename: diskFilename,
    original_name: (originalName || diskFilename).slice(0, 255),
    mime_type: mime,
    byte_size: buffer.length,
    sha256,
    created_at: nowIso,
  };

  return { ok: true, media: withMediaUrl(savedRecord), deduplicated: false };
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
