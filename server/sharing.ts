import crypto from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getCurrentGenerationId, getDb } from './db';
import { MAX_WORKSPACE_PAYLOAD_BYTES, validateWorkspacePayload } from './workspace';
import { isStudySubjectForType, SUBJECTS } from '../src/types';
import type { AppState, PlanType, StudySubject } from '../src/types';
import type {
  CreatedSharingCode, SharedGrant, SharedSourceProgress, SharedStudyOverview,
  SharedStudyRecord, SharedStudyTotals, SharingGrantsResponse,
} from '../src/types/sharing';

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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sharing_active_pair
      ON sharing_grants(owner_id, viewer_id, generation_id) WHERE revoked_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_sharing_codes_owner ON sharing_codes(owner_id, generation_id);
    CREATE INDEX IF NOT EXISTS idx_sharing_grants_viewer ON sharing_grants(viewer_id, generation_id);
    CREATE INDEX IF NOT EXISTS idx_sharing_grants_owner ON sharing_grants(owner_id, generation_id);
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

export function listSharingGrants(userId: string): SharingGrantsResponse {
  const db = getDb(); const generation = getCurrentGenerationId();
  const list = (side: 'owner' | 'viewer'): SharedGrant[] => {
    const rows = db.prepare(`SELECT g.id,g.created_at,u.nickname FROM sharing_grants g
      JOIN users u ON u.id = g.${side === 'owner' ? 'viewer' : 'owner'}_id AND u.is_active = 1
      WHERE g.${side}_id = ? AND g.generation_id = ? AND g.revoked_at IS NULL
      ORDER BY g.created_at DESC,g.id`).all(userId, generation) as { id: string; created_at: string; nickname: string }[];
    return rows.map(row => ({ id: row.id, nickname: displayName(row.nickname, '备考伙伴', 64), createdAt: row.created_at }));
  };
  const rows = db.prepare(`SELECT id,created_at,expires_at FROM sharing_codes WHERE owner_id = ?
    AND generation_id = ? AND used_at IS NULL AND cancelled_at IS NULL AND expires_at > ?
    ORDER BY created_at DESC,id`).all(userId, generation, new Date().toISOString()) as { id: string; created_at: string; expires_at: string }[];
  return {
    ok: true, owned: list('owner'), received: list('viewer'),
    codes: rows.map(row => ({ id: row.id, createdAt: row.created_at, expiresAt: row.expires_at })),
  };
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
