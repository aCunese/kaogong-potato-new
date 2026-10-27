import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDb, rotateGenerationId, getCurrentGenerationId, getAttachmentsDir } from './db';
import { hashPassword, revokeAllUserSessions, UserRow } from './auth';
import { pruneWorkspaceHistory } from './retention';
import { AppState } from '../src/types';
import { validateAndMigrateBackup } from '../src/utils/backupValidator';
import {
  MAX_FILE_SIZE_BYTES,
  MAX_USER_QUOTA_BYTES,
  detectImageMime,
  verifyImageDimensions,
  parseMediaRef,
  extractMediaIdsFromState,
  getUserTotalMediaUsage,
  ensureAttachmentFile,
} from './media';
import {
  validateMediaRefsOwnership,
  validateWorkspacePayload,
  MAX_WORKSPACE_PAYLOAD_BYTES,
} from './workspace';

export function createInviteCode(createdBy: string = 'admin'): string {
  const db = getDb();
  const code = `invite_${crypto.randomBytes(8).toString('hex')}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO invites (code, created_by, created_at)
    VALUES (?, ?, ?)
  `).run(code, createdBy, now);
  return code;
}

export function listUsers(): (Omit<UserRow, 'password_hash'> & { revision: number; mediaBytes: number })[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT u.id, u.username, u.nickname, u.role, u.is_active, u.created_at, u.updated_at,
           COALESCE(w.revision, 0) as revision,
           COALESCE((SELECT SUM(byte_size) FROM media_records WHERE user_id = u.id), 0) as mediaBytes
    FROM users u
    LEFT JOIN workspaces w ON w.user_id = u.id
    ORDER BY u.created_at DESC
  `).all() as any[];

  return rows;
}

export function setUserActiveStatus(userId: string, active: boolean): boolean {
  const db = getDb();
  const info = db.prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?').run(
    active ? 1 : 0,
    new Date().toISOString(),
    userId
  );
  if (!active) {
    revokeAllUserSessions(userId);
  }
  return info.changes > 0;
}

export function createPasswordResetCode(userId: string, createdBy: string = 'admin'): { code: string; expiresAt: string } | null {
  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) return null;

  const code = `rst_${crypto.randomBytes(12).toString('hex')}`;
  const now = Date.now();
  const expiresAt = new Date(now + 30 * 60 * 1000).toISOString(); // 30 mins valid

  db.prepare(`
    INSERT INTO reset_codes (code, user_id, created_by, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(code, userId, createdBy, new Date(now).toISOString(), expiresAt);

  return { code, expiresAt };
}

export async function resetPasswordWithCode(code: string, newPlainPassword: string): Promise<{ ok: boolean; message: string }> {
  if (!newPlainPassword || newPlainPassword.length < 8) {
    return { ok: false, message: '新密码长度至少需要 8 位字符' };
  }

  const db = getDb();
  const nowIso = new Date().toISOString();

  // Fast pre-check before expensive Argon2 hashing
  const resetRow = db.prepare(`
    SELECT * FROM reset_codes WHERE code = ? AND expires_at > ? AND used_at IS NULL
  `).get(code, nowIso) as { code: string; user_id: string } | undefined;

  if (!resetRow) {
    return { ok: false, message: '重置码无效、已使用或已过期（30分钟有效）' };
  }

  const newHash = await hashPassword(newPlainPassword);

  try {
    const tx = db.transaction(() => {
      // 1. Conditionally claim reset code with changes === 1 check (Defect H)
      const claimInfo = db.prepare(`
        UPDATE reset_codes SET used_at = ? WHERE code = ? AND used_at IS NULL AND expires_at > ?
      `).run(nowIso, code, nowIso);

      if (claimInfo.changes !== 1) {
        throw new Error('RESET_CODE_ALREADY_USED');
      }

      // 2. Update user password
      db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(newHash, nowIso, resetRow.user_id);
      // 3. Revoke all old active sessions
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(resetRow.user_id);
    });

    tx();
    return { ok: true, message: '密码重置成功，请使用新密码重新登录' };
  } catch (err: any) {
    if (err.message === 'RESET_CODE_ALREADY_USED') {
      return { ok: false, message: '重置码已被使用或已失效' };
    }
    throw err;
  }
}

/**
 * Single user disaster recovery restore:
 * Preserves the current version in workspace_history before applying the restore snapshot,
 * increments the revision, and does not alter other users' data.
 */
export function restoreUserWorkspace(
  userId: string,
  backupJsonString: string,
  reason: string = 'admin_restore'
): { ok: boolean; revision?: number; message?: string } {
  const db = getDb();

  // 1. 先校验目标账号存在性（SELECT id FROM users WHERE id = ?）
  const targetUser = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!targetUser) {
    return { ok: false, message: `目标用户不存在: ${userId}，无法恢复工作区` };
  }

  // 2. 校验 JSON 格式
  try {
    const parsed = JSON.parse(backupJsonString);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, message: '备份数据必须为有效 JSON 对象' };
    }
  } catch {
    return { ok: false, message: '备份数据必须为有效 JSON 格式，损坏内容已拒绝恢复' };
  }

  // 3. 校验备份结构（备份中的来源 userId 不能改变恢复目标）
  const validation = validateAndMigrateBackup(backupJsonString);
  if (!validation.valid || !validation.migratedState) {
    return { ok: false, message: `备份数据结构校验未通过: ${validation.error || '非法结构'}` };
  }
  const state = validation.migratedState;

  // 4. 图片格式、单图上限 (10MiB) 和全部媒体引用校验
  const attachmentsDir = getAttachmentsDir();
  const POSE_RE = /^pose-[0-7]$/;
  const BRANDING_PATH_RE = /^\/branding\/[a-zA-Z0-9_\-./]+$/;

  interface DataUrlToProcess {
    dataUrl: string;
    buffer: Buffer;
    mime: string;
    sha256: string;
    ext: string;
  }

  const dataUrlsToProcess = new Map<string, DataUrlToProcess>();
  const serverMediaRefs: string[] = [];

  function inspectImageRef(val: unknown, field: string): { ok: boolean; message?: string } {
    if (val === undefined || val === null || val === '') return { ok: true };
    if (typeof val !== 'string') return { ok: false, message: `${field} 必须为字符串` };
    if (POSE_RE.test(val)) return { ok: true };
    if (val.startsWith('/branding/')) {
      if (val.length > 512 || !BRANDING_PATH_RE.test(val) || val.includes('..')) {
        return { ok: false, message: `${field} 的 /branding/ 静态路径不合法` };
      }
      return { ok: true };
    }
    if (val.startsWith('data:image/')) {
      if (!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(val)) {
        return { ok: false, message: `${field} 仅支持 data:image/(jpeg|jpg|png|webp);base64 形式的图片` };
      }
      const comma = val.indexOf(',');
      if (comma === -1) return { ok: false, message: `${field} data URL 格式非法` };
      const b64 = val.slice(comma + 1);
      let buffer: Buffer;
      try {
        buffer = Buffer.from(b64, 'base64');
      } catch {
        return { ok: false, message: `${field} 图片 base64 解码失败` };
      }
      if (buffer.length > MAX_FILE_SIZE_BYTES) {
        return { ok: false, message: `${field} 图片大小 (${buffer.length} 字节) 超过 10MB 限制` };
      }
      const mime = detectImageMime(buffer);
      if (!mime) {
        return { ok: false, message: `${field} 仅支持 JPEG、PNG 或 WebP 格式的图片` };
      }
      if (!verifyImageDimensions(buffer, mime, 4096)) {
        return { ok: false, message: `${field} 图片分辨率过大（单边最大支持 4096 像素）` };
      }
      if (!dataUrlsToProcess.has(val)) {
        const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
        const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp';
        dataUrlsToProcess.set(val, { dataUrl: val, buffer, mime, sha256, ext });
      }
      return { ok: true };
    }

    const mediaId = parseMediaRef(val);
    if (mediaId) {
      serverMediaRefs.push(mediaId);
      return { ok: true };
    }

    if (val.startsWith('https://')) {
      if (val.length > 512) return { ok: false, message: `${field} 的旧版 https 图片地址超过 512 字符` };
      return { ok: true };
    }

    return { ok: false, message: `${field} 图片引用形式不受支持: ${val.slice(0, 30)}` };
  }

  // Inspect profile avatar
  if (state.profile?.avatar) {
    const avatarCheck = inspectImageRef(state.profile.avatar, 'profile.avatar');
    if (!avatarCheck.ok) return { ok: false, message: avatarCheck.message };
  }

  // Inspect wrong records
  if (Array.isArray(state.wrong)) {
    for (let i = 0; i < state.wrong.length; i++) {
      const w = state.wrong[i];
      if (w.image) {
        const imgCheck = inspectImageRef(w.image, `wrong[${i}].image`);
        if (!imgCheck.ok) return { ok: false, message: imgCheck.message };
      }
      if (Array.isArray(w.images)) {
        for (let j = 0; j < w.images.length; j++) {
          const itemCheck = inspectImageRef(w.images[j], `wrong[${i}].images[${j}]`);
          if (!itemCheck.ok) return { ok: false, message: itemCheck.message };
        }
      }
    }
  }

  // 旧服务器引用必须属于目标账号，文件存在且大小、SHA 正确
  if (serverMediaRefs.length > 0) {
    const ownership = validateMediaRefsOwnership(userId, serverMediaRefs);
    if (!ownership.valid) {
      return {
        ok: false,
        message: `备份引用的媒体附件已缺失或损坏，无法恢复: ${ownership.invalidRefs.join(', ')}`,
      };
    }
  }

  // 5. 内嵌图片先注册为附件并替换成稳定引用
  const nowIso = new Date().toISOString();
  const newlyCreatedFiles: string[] = [];
  const mediaRecordsToInsert: Array<{
    id: string;
    userId: string;
    filename: string;
    originalName: string;
    mime: string;
    byteSize: number;
    sha256: string;
    createdAt: string;
  }> = [];
  const dataUrlToMediaUrl = new Map<string, string>();

  let pendingNewBytes = 0;
  const currentUsage = getUserTotalMediaUsage(userId);

  const cleanupNewFiles = () => {
    for (const fn of newlyCreatedFiles) {
      const cnt = db.prepare('SELECT COUNT(*) as c FROM media_records WHERE filename = ?').get(fn) as { c: number };
      if (cnt.c === 0) {
        try { fs.unlinkSync(path.join(attachmentsDir, fn)); } catch {}
      }
    }
  };

  for (const item of dataUrlsToProcess.values()) {
    // 检查目标账号既有同 SHA 图片（秒传去重）
    const dedupeRow = db.prepare(`
      SELECT id, filename FROM media_records WHERE user_id = ? AND sha256 = ? ORDER BY created_at ASC LIMIT 1
    `).get(userId, item.sha256) as { id: string; filename: string } | undefined;

    if (dedupeRow) {
      try {
        ensureAttachmentFile(dedupeRow.filename, item.buffer, attachmentsDir, item.sha256);
      } catch (err: any) {
        cleanupNewFiles();
        return { ok: false, message: `恢复媒体附件失败: ${err.message || '落盘持久化失败'}` };
      }
      dataUrlToMediaUrl.set(item.dataUrl, `/api/media/${dedupeRow.id}`);
      continue;
    }

    // 新图片配额前置校验
    if (currentUsage + pendingNewBytes + item.buffer.length > MAX_USER_QUOTA_BYTES) {
      cleanupNewFiles();
      return { ok: false, message: '媒体存储配额已满，无法恢复包含图片的备份' };
    }

    const diskFilename = `${item.sha256}.${item.ext}`;
    try {
      ensureAttachmentFile(diskFilename, item.buffer, attachmentsDir, item.sha256);
      newlyCreatedFiles.push(diskFilename);
    } catch (err: any) {
      cleanupNewFiles();
      return { ok: false, message: `写入图片附件失败: ${err.message || '落盘持久化失败'}` };
    }

    const mediaId = `media_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    mediaRecordsToInsert.push({
      id: mediaId,
      userId,
      filename: diskFilename,
      originalName: diskFilename,
      mime: item.mime,
      byteSize: item.buffer.length,
      sha256: item.sha256,
      createdAt: nowIso,
    });
    pendingNewBytes += item.buffer.length;
    dataUrlToMediaUrl.set(item.dataUrl, `/api/media/${mediaId}`);
  }

  // 替换内嵌图片为稳定引用
  const replaceImg = (val: string | undefined): string | undefined => {
    if (!val) return val;
    return dataUrlToMediaUrl.get(val) || val;
  };

  if (state.profile?.avatar) {
    state.profile.avatar = replaceImg(state.profile.avatar) || '';
  }
  if (Array.isArray(state.wrong)) {
    for (const w of state.wrong) {
      if (w.image) {
        w.image = replaceImg(w.image) || '';
      }
      if (Array.isArray(w.images)) {
        w.images = w.images.map(img => replaceImg(img) || '');
      }
    }
  }

  // 6. 替换完成后再校验工作区大小（12MiB）及结构强类型校验
  const stateJson = JSON.stringify(state);
  const payloadBytes = Buffer.byteLength(stateJson, 'utf8');
  if (payloadBytes > MAX_WORKSPACE_PAYLOAD_BYTES) {
    cleanupNewFiles();
    return {
      ok: false,
      message: `工作区数据体积 (${payloadBytes} 字节) 超出服务端上限 (${MAX_WORKSPACE_PAYLOAD_BYTES} 字节)`,
    };
  }

  const payloadValidation = validateWorkspacePayload(state, state.version);
  if (!payloadValidation.valid) {
    cleanupNewFiles();
    return {
      ok: false,
      message: `工作区数据校验未通过: ${payloadValidation.message || '非法数据'}`,
    };
  }

  // 7. 媒体记录、历史快照和工作区更新纳入同一数据库事务
  const currentGen = getCurrentGenerationId();

  try {
    const tx = db.transaction(() => {
      // 1) 写入新媒体记录（事务内配额守卫）
      for (const rec of mediaRecordsToInsert) {
        const usage = db.prepare('SELECT COALESCE(SUM(byte_size), 0) as total FROM media_records WHERE user_id = ?').get(userId) as { total: number };
        if (usage.total + rec.byteSize > MAX_USER_QUOTA_BYTES) {
          throw new Error('QUOTA_EXCEEDED');
        }
        db.prepare(`
          INSERT INTO media_records (id, user_id, filename, original_name, mime_type, byte_size, sha256, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(rec.id, rec.userId, rec.filename, rec.originalName, rec.mime, rec.byteSize, rec.sha256, rec.createdAt);
      }

      // 2) 保存当前版本至 workspace_history
      const existing = db.prepare('SELECT * FROM workspaces WHERE user_id = ?').get(userId) as any;
      const currentRev = existing ? existing.revision : 0;
      const nextRev = currentRev + 1;

      if (existing) {
        const historyId = `hist_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
        db.prepare(`
          INSERT INTO workspace_history (id, user_id, revision, reason, state_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(historyId, userId, currentRev, reason, existing.state_json, nowIso);
      }

      // 3) 更新工作区数据与修订号
      db.prepare(`
        INSERT INTO workspaces (user_id, revision, generation_id, state_json, schema_version, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          revision = excluded.revision,
          generation_id = excluded.generation_id,
          state_json = excluded.state_json,
          schema_version = excluded.schema_version,
          updated_at = excluded.updated_at
      `).run(userId, nextRev, currentGen, stateJson, state.version, nowIso);

      // 4) 历史版本窗口淘汰
      pruneWorkspaceHistory(userId, new Date(nowIso), db);

      return nextRev;
    });

    const nextRev = tx();
    return { ok: true, revision: nextRev, message: `用户工作区已成功恢复为版本 revision: ${nextRev}` };
  } catch (err: any) {
    // 失败补偿清理新建文件
    cleanupNewFiles();
    if (err.message === 'QUOTA_EXCEEDED') {
      return { ok: false, message: '媒体存储配额已满，无法恢复包含图片的备份' };
    }
    return { ok: false, message: `恢复用户工作区失败: ${err.message || '数据库事务执行失败'}` };
  }
}
