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
  status?: number;
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
    return { ok: false, status: 400, code: 'FILE_TOO_LARGE', message: '单张图片大小不能超过 10MB' };
  }

  const mime = detectImageMime(buffer);
  if (!mime) {
    return { ok: false, status: 400, code: 'INVALID_IMAGE_TYPE', message: '仅支持 JPEG、PNG 或 WebP 格式的图片' };
  }

  // 防御客户端解压像素炸弹 (Decompression Bomb DoS)
  if (!verifyImageDimensions(buffer, mime, 4096)) {
    return { ok: false, status: 400, code: 'IMAGE_DIMENSION_EXCEEDED', message: '图片分辨率过大（单边最大支持 4096 像素），已拒绝以防客户端解压内存溢出' };
  }

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp';
  const diskFilename = `${sha256}.${ext}`;
  const attachmentsDir = getAttachmentsDir();
  const db = getDb();

  // 1. Quota check BEFORE creating any temporary or final files on disk!
  const currentTotal = getUserTotalMediaUsage(userId);
  if (currentTotal + buffer.length > MAX_USER_QUOTA_BYTES) {
    return {
      ok: false,
      status: 413,
      code: 'QUOTA_EXCEEDED',
      message: '媒体存储配额已满',
    };
  }

  // 2. R06：上传幂等（按 user_id + sha256 秒传）。同账号重复上传同一图片直接返回既有记录，
  // 绝不产生第二条 media_records，也不重复累计配额。
  const dedupeRow = db.prepare(`
    SELECT * FROM media_records WHERE user_id = ? AND sha256 = ? ORDER BY created_at ASC, rowid ASC LIMIT 1
  `).get(userId, sha256) as MediaRecordRow | undefined;
  if (dedupeRow) {
    // 若历史数据的磁盘文件缺失（例如人工清理），按本次上传内容自愈补齐，不新增记账行
    ensureAttachmentFile(dedupeRow.filename, buffer, attachmentsDir);
    return { ok: true, media: withMediaUrl(dedupeRow), deduplicated: true };
  }

  // 3. Write new disk file: write to request-unique temp file, then atomically rename
  const diskPath = path.join(attachmentsDir, diskFilename);
  let tempFilePath: string | null = null;
  if (!fs.existsSync(diskPath)) {
    const tmpPath = path.join(attachmentsDir, `.tmp_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`);
    try {
      fs.writeFileSync(tmpPath, buffer);
      tempFilePath = tmpPath;
      fs.renameSync(tmpPath, diskPath);
      tempFilePath = null;
    } catch (writeErr) {
      if (tempFilePath) {
        try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch {}
      }
      if (!fs.existsSync(diskPath)) {
        throw writeErr;
      }
    }
  }

  const mediaId = `media_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  const nowIso = new Date().toISOString();

  // 4. Wrap quota check and INSERT INTO media_records in SQLite transaction
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
    if (tempFilePath) {
      try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch {}
    }
    // If transaction failed, clean up diskPath only if NO record references it across all users
    const refCount = db.prepare('SELECT COUNT(*) as count FROM media_records WHERE filename = ?').get(diskFilename) as { count: number };
    if (refCount.count === 0) {
      try { if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath); } catch {}
    }

    if (err.message === 'QUOTA_EXCEEDED') {
      return { ok: false, status: 413, code: 'QUOTA_EXCEEDED', message: '媒体存储配额已满' };
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

export interface DeleteMediaResult {
  ok: boolean;
  status: number;
  code?: string;
  message: string;
}

export function deleteUserMedia(userId: string, mediaId: string): DeleteMediaResult {
  const db = getDb();
  const row = db.prepare('SELECT filename FROM media_records WHERE id = ? AND user_id = ?').get(mediaId, userId) as { filename: string } | undefined;
  if (!row) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: '图片不存在或无权删除' };
  }

  // Before deleting, inspect current workspace AND all history records
  const currentWorkspaceRow = db.prepare('SELECT state_json FROM workspaces WHERE user_id = ?').get(userId) as { state_json: string } | undefined;
  const historyRows = db.prepare('SELECT state_json FROM workspace_history WHERE user_id = ?').all(userId) as Array<{ state_json: string }>;

  const statesToCheck: string[] = [];
  if (currentWorkspaceRow?.state_json) {
    statesToCheck.push(currentWorkspaceRow.state_json);
  }
  for (const h of historyRows) {
    if (h.state_json) {
      statesToCheck.push(h.state_json);
    }
  }

  for (const jsonStr of statesToCheck) {
    try {
      JSON.parse(jsonStr);
    } catch {
      return {
        ok: false,
        status: 409,
        code: 'MEDIA_REFERENCE_CHECK_FAILED',
        message: '历史记录解析失败，已保护附件不被删除',
      };
    }

    if (
      jsonStr.includes(`/api/media/${mediaId}`) ||
      jsonStr.includes(`media:${mediaId}`)
    ) {
      return {
        ok: false,
        status: 409,
        code: 'MEDIA_IN_USE',
        message: '该媒体附件仍在工作区或历史版本中被引用，无法删除',
      };
    }
  }

  db.prepare('DELETE FROM media_records WHERE id = ? AND user_id = ?').run(mediaId, userId);

  // If no other records across all users reference this filename, prune it from disk
  const others = db.prepare('SELECT count(*) as cnt FROM media_records WHERE filename = ?').get(row.filename) as { cnt: number };
  if (others.cnt === 0) {
    const diskPath = path.join(getAttachmentsDir(), row.filename);
    try { if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath); } catch {}
  }

  return { ok: true, status: 200, message: '图片已安全删除' };
}

export function extractMediaIdsFromStateJson(stateJson: string): string[] {
  const ids = new Set<string>();
  if (!stateJson || typeof stateJson !== 'string') return [];

  // Match /api/media/<id>
  const apiMatches = stateJson.matchAll(/\/api\/media\/([A-Za-z0-9_\-]+)/g);
  for (const m of apiMatches) {
    if (m[1]) ids.add(m[1]);
  }

  // Match media:<id>
  const prefixMatches = stateJson.matchAll(/media:([A-Za-z0-9_\-]+)/g);
  for (const m of prefixMatches) {
    if (m[1]) ids.add(m[1]);
  }

  return Array.from(ids);
}

export interface MediaAuditReport {
  ok: boolean;
  totalDiskFiles: number;
  totalDbRecords: number;
  orphanedDiskFiles: string[];
  missingFiles: Array<{ id: string; userId: string; filename: string }>;
  corruptedReferences: Array<{ type: 'workspace' | 'history'; userId: string; mediaId: string; reason: string }>;
}

export function auditMediaStorage(): MediaAuditReport {
  const db = getDb();
  const attachmentsDir = getAttachmentsDir();

  let diskFiles: string[] = [];
  try {
    if (fs.existsSync(attachmentsDir)) {
      diskFiles = fs.readdirSync(attachmentsDir).filter(f => !f.startsWith('.'));
    }
  } catch {}

  const diskFileSet = new Set(diskFiles);

  const dbRecords = db.prepare('SELECT id, user_id, filename, byte_size, sha256 FROM media_records').all() as Array<{
    id: string;
    user_id: string;
    filename: string;
    byte_size: number;
    sha256: string;
  }>;

  const dbFilenames = new Set(dbRecords.map(r => r.filename));
  const dbMediaMap = new Map(dbRecords.map(r => [r.id, r]));

  const orphanedDiskFiles = diskFiles.filter(f => !dbFilenames.has(f));

  const missingFiles: Array<{ id: string; userId: string; filename: string }> = [];
  for (const record of dbRecords) {
    if (!diskFileSet.has(record.filename)) {
      missingFiles.push({ id: record.id, userId: record.user_id, filename: record.filename });
    }
  }

  const corruptedReferences: Array<{ type: 'workspace' | 'history'; userId: string; mediaId: string; reason: string }> = [];

  const workspaces = db.prepare('SELECT user_id, state_json FROM workspaces').all() as Array<{ user_id: string; state_json: string }>;
  for (const ws of workspaces) {
    const ids = extractMediaIdsFromStateJson(ws.state_json);
    for (const id of ids) {
      const record = dbMediaMap.get(id);
      if (!record) {
        corruptedReferences.push({ type: 'workspace', userId: ws.user_id, mediaId: id, reason: 'Media record not found in database' });
      } else if (record.user_id !== ws.user_id) {
        corruptedReferences.push({ type: 'workspace', userId: ws.user_id, mediaId: id, reason: 'Media owned by different user' });
      } else if (!diskFileSet.has(record.filename)) {
        corruptedReferences.push({ type: 'workspace', userId: ws.user_id, mediaId: id, reason: 'Physical file missing on disk' });
      }
    }
  }

  const history = db.prepare('SELECT user_id, state_json FROM workspace_history').all() as Array<{ user_id: string; state_json: string }>;
  for (const h of history) {
    const ids = extractMediaIdsFromStateJson(h.state_json);
    for (const id of ids) {
      const record = dbMediaMap.get(id);
      if (!record) {
        corruptedReferences.push({ type: 'history', userId: h.user_id, mediaId: id, reason: 'Media record not found in database' });
      } else if (record.user_id !== h.user_id) {
        corruptedReferences.push({ type: 'history', userId: h.user_id, mediaId: id, reason: 'Media owned by different user' });
      } else if (!diskFileSet.has(record.filename)) {
        corruptedReferences.push({ type: 'history', userId: h.user_id, mediaId: id, reason: 'Physical file missing on disk' });
      }
    }
  }

  const ok = orphanedDiskFiles.length === 0 && missingFiles.length === 0 && corruptedReferences.length === 0;

  return {
    ok,
    totalDiskFiles: diskFiles.length,
    totalDbRecords: dbRecords.length,
    orphanedDiskFiles,
    missingFiles,
    corruptedReferences,
  };
}

export function verifyWorkspaceUserMatch(req: any, authenticatedUserId: string): { ok: boolean; status?: number; error?: any } {
  const headerWorkspaceUser = typeof req?.header === 'function' ? req.header('x-workspace-user') : (req?.headers && req.headers['x-workspace-user']);
  if (headerWorkspaceUser && typeof headerWorkspaceUser === 'string' && headerWorkspaceUser !== authenticatedUserId) {
    return {
      ok: false,
      status: 409,
      error: {
        ok: false,
        code: 'SESSION_ACCOUNT_MISMATCH',
        message: 'Requested workspace user does not match active session',
      },
    };
  }
  return { ok: true };
}
