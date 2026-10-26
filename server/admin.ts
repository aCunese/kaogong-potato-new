import crypto from 'node:crypto';
import { getDb, rotateGenerationId, getCurrentGenerationId } from './db';
import { hashPassword, revokeAllUserSessions, UserRow } from './auth';
import { AppState } from '../src/types';
import { validateAndMigrateBackup } from '../src/utils/backupValidator';

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
  if (!newPlainPassword || newPlainPassword.length < 4) {
    return { ok: false, message: '新密码长度至少需要 4 位字符' };
  }

  const db = getDb();
  const nowIso = new Date().toISOString();

  const resetRow = db.prepare(`
    SELECT * FROM reset_codes WHERE code = ? AND expires_at > ? AND used_at IS NULL
  `).get(code, nowIso) as { code: string; user_id: string } | undefined;

  if (!resetRow) {
    return { ok: false, message: '重置码无效、已使用或已过期（30分钟有效）' };
  }

  const newHash = await hashPassword(newPlainPassword);

  const tx = db.transaction(() => {
    // 1. Mark reset code used
    db.prepare('UPDATE reset_codes SET used_at = ? WHERE code = ?').run(nowIso, code);
    // 2. Update user password
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(newHash, nowIso, resetRow.user_id);
    // 3. Revoke all old active sessions
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(resetRow.user_id);
  });

  tx();
  return { ok: true, message: '密码重置成功，请使用新密码重新登录' };
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
  const validation = validateAndMigrateBackup(backupJsonString);
  if (!validation.valid || !validation.migratedState) {
    return { ok: false, message: `备份数据结构校验未通过: ${validation.error || '非法结构'}` };
  }

  const db = getDb();
  const currentGen = getCurrentGenerationId();
  const stateJson = JSON.stringify(validation.migratedState);
  const nowIso = new Date().toISOString();

  const tx = db.transaction(() => {
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

    db.prepare(`
      INSERT INTO workspaces (user_id, revision, generation_id, state_json, schema_version, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        revision = excluded.revision,
        generation_id = excluded.generation_id,
        state_json = excluded.state_json,
        schema_version = excluded.schema_version,
        updated_at = excluded.updated_at
    `).run(userId, nextRev, currentGen, stateJson, 3, nowIso);

    return nextRev;
  });

  const nextRev = tx();
  return { ok: true, revision: nextRev, message: `用户工作区已成功恢复为版本 revision: ${nextRev}` };
}
