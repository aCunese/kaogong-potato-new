import crypto from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getCurrentGenerationId, getDb } from './db';
import { MAX_WORKSPACE_PAYLOAD_BYTES, validateWorkspacePayload } from './workspace';
import { isStudySubjectForType, SUBJECTS } from '../src/types';
import type { AppState, PlanType, StudySubject } from '../src/types';
import type {
  CreatedSharingCode, PartnerLiveStatus, SharedGrant, SharedSourceProgress, SharedStudyOverview,
  SharedStudyRecord, SharedStudyTotals, SharingGrantsResponse,
} from '../src/types/sharing';
import type { CompanionNote, CreateCompanionNoteInput } from '../src/types/companionNote';
import { createSmtpMailSender, type MailSender } from './mailTransport';
import { generatePokeEmailContent } from './pokeEmailTemplate';

const CODE_TTL_MS = 10 * 60 * 1000;

export function initSharingSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sharing_codes (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL UNIQUE,
      generation_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      cancelled_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sharing_grants (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      viewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      generation_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      CHECK (owner_id <> viewer_id)
    );
    CREATE TABLE IF NOT EXISTS companion_notes (
      id TEXT PRIMARY KEY,
      from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      grant_id TEXT,
      message TEXT NOT NULL,
      image_url TEXT,
      hearts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS companion_nudges (
      id TEXT PRIMARY KEY,
      from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      grant_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sharing_active_pair
      ON sharing_grants(owner_id, viewer_id, generation_id) WHERE revoked_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_sharing_codes_owner ON sharing_codes(owner_id, generation_id);
    CREATE INDEX IF NOT EXISTS idx_sharing_grants_viewer ON sharing_grants(viewer_id, generation_id);
    CREATE INDEX IF NOT EXISTS idx_sharing_grants_owner ON sharing_grants(owner_id, generation_id);
    CREATE INDEX IF NOT EXISTS idx_companion_notes_to ON companion_notes(to_user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_companion_notes_from ON companion_notes(from_user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_companion_nudges_pair ON companion_nudges(from_user_id, to_user_id, created_at);
  `);
}

export class SharingError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

interface CodeRow {
  id: string;
  owner_id: string;
  expires_at: string;
}

function invalidCode(): never {
  throw new SharingError(400, 'SHARING_CODE_INVALID', '分享码无效、已使用或已过期，请向分享者获取新码');
}

function displayName(value: unknown, fallback: string, length = 120): string {
  if (typeof value !== 'string') return fallback;
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, length) || fallback;
}

export function createSharingCode(ownerId: string): CreatedSharingCode {
  const db = getDb();
  const now = new Date();
  const result: CreatedSharingCode = {
    id: crypto.randomUUID(), value: crypto.randomBytes(24).toString('base64url'),
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + CODE_TTL_MS).toISOString(),
  };
  const hash = crypto.createHash('sha256').update(result.value).digest('hex');
  db.prepare(`INSERT INTO sharing_codes (id,owner_id,code_hash,generation_id,created_at,expires_at)
    VALUES (?,?,?,?,?,?)`).run(result.id, ownerId, hash, getCurrentGenerationId(), result.createdAt, result.expiresAt);
  return result;
}

export function cancelSharingCode(ownerId: string, id: string): void {
  const result = getDb().prepare(`UPDATE sharing_codes SET cancelled_at = ?
    WHERE id = ? AND owner_id = ? AND generation_id = ? AND used_at IS NULL AND cancelled_at IS NULL`)
    .run(new Date().toISOString(), id, ownerId, getCurrentGenerationId());
  if (!result.changes) throw new SharingError(404, 'SHARING_CODE_NOT_FOUND', '分享码已失效或不存在');
}

export function redeemSharingCode(viewerId: string, value: unknown): SharedGrant {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{22,128}$/.test(value.trim())) invalidCode();
  const hash = crypto.createHash('sha256').update(value.trim()).digest('hex');
  const db = getDb();
  // IMMEDIATE prevents two connections from consuming the same unused code.
  return db.transaction(() => {
    const generation = getCurrentGenerationId();
    const now = new Date().toISOString();
    const code = db.prepare(`SELECT c.id,c.owner_id,c.expires_at FROM sharing_codes c
      JOIN users u ON u.id = c.owner_id AND u.is_active = 1
      WHERE c.code_hash = ? AND c.generation_id = ? AND c.used_at IS NULL
        AND c.cancelled_at IS NULL AND c.expires_at > ?`).get(hash, generation, now) as CodeRow | undefined;
    if (!code || code.owner_id === viewerId) invalidCode();
    const consumed = db.prepare(`UPDATE sharing_codes SET used_at = ? WHERE id = ?
      AND used_at IS NULL AND cancelled_at IS NULL AND expires_at > ? AND generation_id = ?`).run(now, code.id, now, generation);
    if (consumed.changes !== 1) invalidCode();
    const existing = db.prepare(`SELECT id,created_at FROM sharing_grants
      WHERE owner_id = ? AND viewer_id = ? AND generation_id = ? AND revoked_at IS NULL`)
      .get(code.owner_id, viewerId, generation) as { id: string; created_at: string } | undefined;
    const id = existing?.id ?? crypto.randomUUID();
    if (!existing) db.prepare(`INSERT INTO sharing_grants (id,owner_id,viewer_id,generation_id,created_at)
      VALUES (?,?,?,?,?)`).run(id, code.owner_id, viewerId, generation, now);
    const owner = db.prepare('SELECT nickname FROM users WHERE id = ?').get(code.owner_id) as { nickname: string };
    return { id, nickname: displayName(owner.nickname, '备考伙伴', 64), createdAt: existing?.created_at ?? now };
  }).immediate();
}

function computePartnerLiveStatus(db: Database, ownerId: string, viewerId: string): PartnerLiveStatus {
  let state: AppState | null = null;
  const wsRow = db.prepare('SELECT state_json FROM workspaces WHERE user_id = ?').get(ownerId) as { state_json: string } | undefined;
  if (wsRow) {
    try {
      state = JSON.parse(wsRow.state_json) as AppState;
    } catch {}
  }

  const binding = db.prepare('SELECT email FROM account_email_bindings WHERE user_id = ?').get(ownerId) as { email: string } | undefined;
  const lastNudge = db.prepare('SELECT created_at FROM companion_nudges WHERE from_user_id = ? AND to_user_id = ? ORDER BY created_at DESC LIMIT 1').get(viewerId, ownerId) as { created_at: string } | undefined;
  let cooldownSeconds = 0;
  let canPoke = true;
  if (lastNudge) {
    const elapsed = Date.now() - Date.parse(lastNudge.created_at);
    if (elapsed < 30 * 60 * 1000) {
      cooldownSeconds = Math.ceil((30 * 60 * 1000 - elapsed) / 1000);
      canPoke = false;
    }
  }

  const now = Date.now();
  if (state) {
    const runningPlan = state.plans?.find(p => !p.done && (p.timerStart > 0 || (p.restStart ?? 0) > 0));
    if (runningPlan) {
      const elapsedMs = runningPlan.timerStart
        ? (runningPlan.accumulatedMs ?? 0) + Math.max(0, now - runningPlan.timerStart)
        : (runningPlan.accumulatedMs ?? 0);
      const minutes = Math.max(1, Math.floor(elapsedMs / 60000));
      const focusTitle = runningPlan.name || '备考计划';
      return {
        state: 'focusing',
        focusTitle,
        focusMinutes: minutes,
        hasEmailBinding: Boolean(binding?.email),
        canPoke,
        cooldownSeconds,
      };
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const todayPlans = state.plans?.filter(p => p.date === todayStr) ?? [];
    const hasUnfinished = todayPlans.some(p => !p.done);

    const reminder = db.prepare(`
      SELECT title, send_at FROM email_reminders
      WHERE user_id = ? AND send_at <= ?
      ORDER BY send_at DESC LIMIT 1
    `).get(ownerId, now) as { title: string; send_at: number } | undefined;

    if (reminder && now - reminder.send_at >= 30 * 60 * 1000) {
      const overdueHours = Math.max(1, Math.round((now - reminder.send_at) / 3600000));
      const dateObj = new Date(reminder.send_at);
      const timeStr = `${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}`;
      return {
        state: 'missed',
        scheduledTime: timeStr,
        overdueHours,
        missedText: `约定 ${timeStr} 学习，已超 ${overdueHours} 小时未学`,
        hasEmailBinding: Boolean(binding?.email),
        canPoke,
        cooldownSeconds,
      };
    }

    if (hasUnfinished) {
      const overdueHours = Math.max(1, Math.abs(new Date().getHours() - 14) || 2);
      return {
        state: 'missed',
        scheduledTime: '14:00',
        overdueHours,
        missedText: `约定 14:00 学习，已超 ${overdueHours} 小时未学`,
        hasEmailBinding: Boolean(binding?.email),
        canPoke,
        cooldownSeconds,
      };
    }

    if (todayPlans.length > 0 && todayPlans.every(p => p.done)) {
      return {
        state: 'completed',
        hasEmailBinding: Boolean(binding?.email),
        canPoke,
        cooldownSeconds,
      };
    }
  }

  return {
    state: 'missed',
    scheduledTime: '14:00',
    overdueHours: 2,
    missedText: '约定 14:00 学习，已超 2 小时未学',
    hasEmailBinding: Boolean(binding?.email),
    canPoke,
    cooldownSeconds,
  };
}

export function listSharingGrants(userId: string): SharingGrantsResponse {
  const db = getDb(); const generation = getCurrentGenerationId();
  const list = (side: 'owner' | 'viewer'): SharedGrant[] => {
    const rows = db.prepare(`SELECT g.id, g.owner_id, g.viewer_id, g.created_at, u.nickname FROM sharing_grants g
      JOIN users u ON u.id = g.${side === 'owner' ? 'viewer' : 'owner'}_id AND u.is_active = 1
      WHERE g.${side}_id = ? AND g.generation_id = ? AND g.revoked_at IS NULL
      ORDER BY g.created_at DESC, g.id`).all(userId, generation) as { id: string; owner_id: string; viewer_id: string; created_at: string; nickname: string }[];
    return rows.map(row => ({
      id: row.id,
      nickname: displayName(row.nickname, '备考伙伴', 64),
      createdAt: row.created_at,
      liveStatus: side === 'viewer' ? computePartnerLiveStatus(db, row.owner_id, userId) : undefined,
    }));
  };
  const rows = db.prepare(`SELECT id,created_at,expires_at FROM sharing_codes WHERE owner_id = ?
    AND generation_id = ? AND used_at IS NULL AND cancelled_at IS NULL AND expires_at > ?
    ORDER BY created_at DESC,id`).all(userId, generation, new Date().toISOString()) as { id: string; created_at: string; expires_at: string }[];
  return {
    ok: true, owned: list('owner'), received: list('viewer'),
    codes: rows.map(row => ({ id: row.id, createdAt: row.created_at, expiresAt: row.expires_at })),
  };
}

export interface NudgeResult {
  ok: true;
  delivered: boolean;
  recipientEmail?: string | null;
  message: string;
  cooldownSeconds: number;
}

export async function pokeCompanion(
  senderId: string,
  grantId: string,
  options?: { sender?: MailSender; now?: () => number }
): Promise<NudgeResult> {
  const db = getDb();
  const generation = getCurrentGenerationId();
  const nowMs = options?.now ? options.now() : Date.now();
  const nowIso = new Date(nowMs).toISOString();

  if (!grantId || typeof grantId !== 'string') {
    throw new SharingError(400, 'INVALID_GRANT', '请指定学习伙伴');
  }

  const grant = db.prepare(`
    SELECT g.id, g.owner_id, g.viewer_id, g.generation_id
    FROM sharing_grants g
    WHERE g.id = ? AND (g.viewer_id = ? OR g.owner_id = ?) AND g.generation_id = ? AND g.revoked_at IS NULL
  `).get(grantId, senderId, senderId, generation) as { id: string; owner_id: string; viewer_id: string; generation_id: string } | undefined;

  if (!grant) {
    throw new SharingError(404, 'SHARING_GRANT_NOT_FOUND', '未找到对应的学习伙伴授权或授权已失效');
  }

  const targetUserId = grant.owner_id === senderId ? grant.viewer_id : grant.owner_id;

  const COOLDOWN_MS = 30 * 60 * 1000;
  const recentNudge = db.prepare(`
    SELECT created_at FROM companion_nudges
    WHERE from_user_id = ? AND to_user_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(senderId, targetUserId) as { created_at: string } | undefined;

  if (recentNudge) {
    const elapsed = nowMs - Date.parse(recentNudge.created_at);
    if (elapsed < COOLDOWN_MS) {
      const remainingMs = COOLDOWN_MS - elapsed;
      const remainingMinutes = Math.ceil(remainingMs / 60000);
      throw new SharingError(
        429,
        'NUDGE_COOLDOWN',
        `刚刚已经提醒过 TA 啦，给伙伴一点时间，${remainingMinutes} 分钟后再戳吧~`
      );
    }
  }

  const nudgeId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO companion_nudges (id, from_user_id, to_user_id, grant_id, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(nudgeId, senderId, targetUserId, grant.id, nowIso);

  const senderRow = db.prepare('SELECT nickname FROM users WHERE id = ?').get(senderId) as { nickname: string } | undefined;
  const targetRow = db.prepare('SELECT nickname FROM users WHERE id = ?').get(targetUserId) as { nickname: string } | undefined;
  const senderNickname = displayName(senderRow?.nickname, '你的备考伙伴', 64);
  const targetNickname = displayName(targetRow?.nickname, '备考同学', 64);

  const noteId = crypto.randomUUID();
  const noteMsg = `⚡️ 叮咚！你的考公研友向你发来了一记夺命连环催：说好一起上岸，今天怎么还没打卡？快快归队开始学习吧！🥔💨`;
  db.prepare(`
    INSERT INTO companion_notes (id, from_user_id, to_user_id, grant_id, message, hearts, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `).run(noteId, senderId, targetUserId, grant.id, noteMsg, nowIso);

  const binding = db.prepare(`
    SELECT b.email FROM account_email_bindings b
    JOIN users u ON u.id = b.user_id
    WHERE b.user_id = ? AND u.is_active = 1
  `).get(targetUserId) as { email: string } | undefined;

  if (!binding?.email) {
    return {
      ok: true,
      delivered: false,
      recipientEmail: null,
      message: `已为 ${targetNickname} 发送催学便签（对方尚未在工作台绑定提醒邮箱）`,
      cooldownSeconds: 1800,
    };
  }

  const mailSender = options?.sender ?? createSmtpMailSender();
  let delivered = false;
  if (mailSender.available) {
    const { subject, text, html } = generatePokeEmailContent({
      senderNickname,
      recipientNickname: targetNickname,
      loginUrl: process.env.PUBLIC_URL || 'http://localhost:5174',
    });
    try {
      await mailSender.send({
        to: binding.email,
        subject,
        text,
        html,
        messageId: `<nudge-${nudgeId}@potato.local>`,
      });
      delivered = true;
    } catch {
      // transient delivery error ignored
    }
  }

  return {
    ok: true,
    delivered,
    recipientEmail: binding.email,
    message: delivered
      ? `已成功向 ${targetNickname} 的邮箱发送催学邮件！`
      : `已为 ${targetNickname} 记录催学便签（邮件服务当前离线）`,
    cooldownSeconds: 1800,
  };
}

export function listCompanionNotes(userId: string): { ok: true; notes: CompanionNote[] } {
  const db = getDb();
  const rows = db.prepare(`
    SELECT n.id, n.from_user_id, n.to_user_id, n.grant_id, n.message, n.image_url, n.hearts, n.created_at,
           u.nickname AS from_nickname
    FROM companion_notes n
    JOIN users u ON u.id = n.from_user_id AND u.is_active = 1
    WHERE n.to_user_id = ? OR n.from_user_id = ?
    ORDER BY n.created_at DESC
    LIMIT 30
  `).all(userId, userId) as {
    id: string;
    from_user_id: string;
    to_user_id: string;
    grant_id: string | null;
    message: string;
    image_url: string | null;
    hearts: number;
    created_at: string;
    from_nickname: string;
  }[];

  return {
    ok: true,
    notes: rows.map(r => ({
      id: r.id,
      fromUserId: r.from_user_id,
      fromNickname: displayName(r.from_nickname, '备考伙伴', 64),
      toUserId: r.to_user_id,
      grantId: r.grant_id ?? undefined,
      message: r.message,
      imageUrl: r.image_url ?? undefined,
      hearts: r.hearts,
      createdAt: r.created_at,
    })),
  };
}

export function createCompanionNote(fromUserId: string, raw: unknown): CompanionNote {
  const db = getDb();
  const generation = getCurrentGenerationId();
  const input = raw as Partial<CreateCompanionNoteInput> | null;
  const message = (input?.message ?? '').trim().slice(0, 1000);
  const imageUrl = typeof input?.imageUrl === 'string' && input.imageUrl.length < 2_000_000 ? input.imageUrl : undefined;
  if (!message && !imageUrl) {
    throw new SharingError(400, 'INVALID_NOTE', '便签内容或表情包不能为空');
  }

  let toUserId = input?.toUserId;
  let grantId = input?.grantId;

  if (!toUserId && grantId) {
    const grant = db.prepare('SELECT owner_id, viewer_id FROM sharing_grants WHERE id = ? AND generation_id = ? AND revoked_at IS NULL').get(grantId, generation) as { owner_id: string; viewer_id: string } | undefined;
    if (grant) {
      toUserId = grant.owner_id === fromUserId ? grant.viewer_id : grant.owner_id;
    } else {
      grantId = undefined;
    }
  }

  if (!toUserId) {
    const anyGrant = db.prepare(`SELECT owner_id, viewer_id, id FROM sharing_grants WHERE (owner_id = ? OR viewer_id = ?) AND generation_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`).get(fromUserId, fromUserId, generation) as { owner_id: string; viewer_id: string; id: string } | undefined;
    if (anyGrant) {
      toUserId = anyGrant.owner_id === fromUserId ? anyGrant.viewer_id : anyGrant.owner_id;
      grantId = anyGrant.id;
    } else {
      toUserId = fromUserId;
    }
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO companion_notes (id, from_user_id, to_user_id, grant_id, message, image_url, hearts, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
  `).run(id, fromUserId, toUserId, grantId ?? null, message, imageUrl ?? null, now);

  const sender = db.prepare('SELECT nickname FROM users WHERE id = ?').get(fromUserId) as { nickname: string } | undefined;
  return {
    id,
    fromUserId,
    fromNickname: displayName(sender?.nickname, '备考伙伴', 64),
    toUserId,
    grantId: grantId ?? undefined,
    message,
    imageUrl,
    hearts: 0,
    createdAt: now,
  };
}

export function heartCompanionNote(userId: string, noteId: string): number {
  const db = getDb();
  if (!noteId || typeof noteId !== 'string') {
    throw new SharingError(400, 'INVALID_NOTE', '便签参数无效');
  }
  const note = db.prepare('SELECT id, hearts FROM companion_notes WHERE id = ?').get(noteId) as { id: string; hearts: number } | undefined;
  if (!note) {
    throw new SharingError(404, 'NOTE_NOT_FOUND', '便签不存在或已删除');
  }
  const nextHearts = note.hearts + 1;
  db.prepare('UPDATE companion_notes SET hearts = ? WHERE id = ?').run(nextHearts, noteId);
  return nextHearts;
}

export function revokeSharingGrant(ownerId: string, id: string): void {
  const result = getDb().prepare(`UPDATE sharing_grants SET revoked_at = ?
    WHERE id = ? AND owner_id = ? AND generation_id = ? AND revoked_at IS NULL`)
    .run(new Date().toISOString(), id, ownerId, getCurrentGenerationId());
  if (!result.changes) throw new SharingError(404, 'SHARING_GRANT_NOT_FOUND', '授权已撤销或不存在');
}

export interface SharingOverviewQuery { from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown }

function dateValue(value: unknown): string | null {
  if (value === undefined || value === '') return null;
  const parsed = typeof value === 'string' ? new Date(`${value}T00:00:00.000Z`) : null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !parsed || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new SharingError(400, 'SHARING_RANGE_INVALID', '请选择有效的日期范围');
  }
  return value;
}

function pageValue(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d{0,8}$/.test(value)) throw new SharingError(400, 'SHARING_PAGE_INVALID', '分页参数必须为正整数');
  return Math.min(Number(value), maximum);
}

const numberValue = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(value, Number.MAX_SAFE_INTEGER) : 0;
const add = (left: number, right: number) => Math.min(left + right, Number.MAX_SAFE_INTEGER);

function subjectValue(value: unknown, type: PlanType): StudySubject {
  return isStudySubjectForType(value, type) ? value : SUBJECTS[0];
}

function summarize(records: SharedStudyRecord[]): SharedStudyTotals {
  let minutes = 0; let questions = 0; let errors = 0; let lessons = 0;
  for (const record of records) {
    minutes = add(minutes, record.minutes);
    if (record.type === 'book') { questions = add(questions, record.quantity); errors = add(errors, record.errors); }
    if (record.type === 'course') lessons = add(lessons, record.quantity);
  }
  return { minutes, questions, errors, accuracy: questions ? Math.round((questions - errors) / questions * 10000) / 100 : null, lessons };
}

export function getSharedStudyOverview(viewerId: string, grantId: string, query: SharingOverviewQuery): SharedStudyOverview {
  const db = getDb(); const generation = getCurrentGenerationId();
  const owner = db.prepare(`SELECT u.id,u.nickname FROM sharing_grants g
    JOIN users u ON u.id = g.owner_id AND u.is_active = 1
    WHERE g.id = ? AND g.viewer_id = ? AND g.generation_id = ? AND g.revoked_at IS NULL`)
    .get(grantId, viewerId, generation) as { id: string; nickname: string } | undefined;
  if (!owner) throw new SharingError(403, 'SHARING_ACCESS_REVOKED', '分享授权已失效，请向分享者重新获取授权');
  const from = dateValue(query.from); const to = dateValue(query.to);
  if (from && to && from > to) throw new SharingError(400, 'SHARING_RANGE_INVALID', '开始日期不能晚于结束日期');
  const page = pageValue(query.page, 1, 1_000_000); const pageSize = pageValue(query.pageSize, 30, 100);
  const row = db.prepare('SELECT state_json,schema_version,updated_at,generation_id FROM workspaces WHERE user_id = ?')
    .get(owner.id) as { state_json: string; schema_version: number; updated_at: string; generation_id: string } | undefined;
  const empty: SharedStudyOverview = {
    ownerNickname: displayName(owner.nickname, '备考伙伴', 64), updatedAt: null, range: { from, to },
    selectedTotals: summarize([]), allTimeTotals: summarize([]), books: [], courses: [], records: { items: [], page, pageSize, total: 0 },
    studyDates: [],
  };
  if (!row) return empty;
  if (row.generation_id !== generation) throw new SharingError(403, 'SHARING_ACCESS_REVOKED', '云端数据代次已变化，请重新获取授权');
  let state: AppState;
  try {
    if (Buffer.byteLength(row.state_json, 'utf8') > MAX_WORKSPACE_PAYLOAD_BYTES) throw new Error('oversize');
    state = JSON.parse(row.state_json) as AppState;
    if (!validateWorkspacePayload(state, row.schema_version).valid) throw new Error('invalid');
  } catch {
    throw new SharingError(422, 'SHARING_WORKSPACE_INVALID', '分享者的云端学习数据暂时无法读取，请分享者重新同步后重试');
  }
  const books: SharedSourceProgress[] = state.books.map(book => ({
    name: displayName(book.name, '题库'), subject: subjectValue(book.subject, 'book'),
    total: numberValue(book.total), done: numberValue(book.done), errors: Math.min(numberValue(book.errors), numberValue(book.done)), minutes: numberValue(book.minutes),
  }));
  const courses: SharedSourceProgress[] = state.courses.map(course => ({
    name: displayName(course.name, '课程'), subject: subjectValue(course.subject, 'course'),
    total: numberValue(course.totalLessons), done: numberValue(course.completedLessons), errors: 0, minutes: numberValue(course.minutes),
  }));
  const bookNames = new Map(state.books.map((book, i) => [book.id, books[i].name]));
  const courseNames = new Map(state.courses.map((course, i) => [course.id, courses[i].name]));
  const completedCustomPlans = new Map(state.plans.filter(plan => plan.done && plan.type === 'custom').map(plan => [plan.id, plan]));
  // Records are completed bookkeeping facts in the owner's calendar; UTC must not hide local midnight study.
  const records: SharedStudyRecord[] = state.records.map(record => {
    // Older snapshots may omit type; infer only from a matched catalogue source.
    const type: PlanType = ['book', 'course', 'custom'].includes(record.type) ? record.type
      : bookNames.has(record.sourceId) ? 'book' : courseNames.has(record.sourceId) ? 'course' : 'custom';
    const quantity = type === 'book' ? numberValue(record.questions) : type === 'course' ? numberValue(record.lessons) : 0;
    const customPlan = completedCustomPlans.get(record.planId);
    const customName = customPlan?.date === record.date ? displayName(customPlan.name, '自定义学习', 200) : '自定义学习';
    return {
      date: record.date, type, subject: subjectValue(record.subject, type),
      sourceName: type === 'book' ? bookNames.get(record.sourceId) ?? '已删除题库' : type === 'course' ? courseNames.get(record.sourceId) ?? '已删除课程' : customName,
      quantity, minutes: numberValue(record.minutes), errors: type === 'book' ? Math.min(numberValue(record.errors), quantity) : 0,
    };
  }).sort((left, right) => right.date.localeCompare(left.date));
  const selected = records.filter(record => (!from || record.date >= from) && (!to || record.date <= to));
  const studyDates = Array.from(new Set(records.map(record => record.date))).sort();
  return {
    ownerNickname: empty.ownerNickname, updatedAt: Number.isFinite(Date.parse(row.updated_at)) ? row.updated_at : null,
    range: { from, to }, selectedTotals: summarize(selected), allTimeTotals: summarize(records), books, courses,
    records: { items: selected.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: selected.length },
    studyDates,
  };
}
