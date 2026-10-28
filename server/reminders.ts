import crypto from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type { EmailReminder, EmailReminderInput, EmailReminderStatus } from '../src/types/email';
import { getDb } from './db';
import { emailGeneration, EmailFeatureError, reconcileEmailGeneration, type EmailServiceOptions } from './accountEmail';
import { createSmtpMailSender, MailDeliveryError } from './mailTransport';

interface ReminderRow {
  id: string; user_id: string; request_id: string; payload_hash: string; generation_id: string;
  title: string; body: string; send_at: number; timezone: string; status: EmailReminderStatus;
  revision: number; attempts: number; next_attempt_at: number; lease_token: string | null;
  lease_until: number | null; message_id: string; delayed: number; created_at: number; updated_at: number;
}
const pendingStates = ['pending', 'retry'];
function publicReminder(row: ReminderRow): EmailReminder {
  return {
    id: row.id, title: row.title, body: row.body, sendAt: new Date(row.send_at).toISOString(),
    timezone: row.timezone, status: row.status, revision: row.revision, attempts: row.attempts,
    delayed: row.delayed === 1, messageId: row.message_id,
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
  };
}
function validateInput(raw: unknown): Omit<EmailReminderInput, 'requestId'> & { sendAtMs: number } {
  const input = raw as Partial<EmailReminderInput> | null;
  const invalid = () => new EmailFeatureError(400, 'INVALID_REMINDER', '请填写 1–100 字标题、最多 1000 字正文、有效的未来时间与时区');
  if (!input || typeof input.title !== 'string' || (input.body !== undefined && typeof input.body !== 'string') || typeof input.sendAt !== 'string' || typeof input.timezone !== 'string') throw invalid();
  const title = input.title.trim();
  const body = input.body ?? '';
  if (!title || title.length > 100 || body.length > 1000 || input.timezone.length > 100 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(input.sendAt)) throw invalid();
  const sendAtMs = Date.parse(input.sendAt);
  if (!Number.isFinite(sendAtMs) || new Date(sendAtMs).toISOString() !== (input.sendAt.includes('.') ? input.sendAt : input.sendAt.replace('Z', '.000Z'))) throw invalid();
  try { new Intl.DateTimeFormat('en', { timeZone: input.timezone }).format(); } catch { throw invalid(); }
  return { title, body, sendAt: new Date(sendAtMs).toISOString(), sendAtMs, timezone: input.timezone };
}
function boundAddress(db: Database, userId: string): string | null {
  return (db.prepare('SELECT b.email FROM account_email_bindings b JOIN users u ON u.id = b.user_id WHERE b.user_id = ? AND u.is_active = 1').get(userId) as { email: string } | undefined)?.email ?? null;
}

export function createReminderService(options: Pick<EmailServiceOptions, 'db' | 'now'>) {
  const { db } = options;
  const now = options.now ?? Date.now;
  function owned(userId: string, id: string): ReminderRow {
    const row = db.prepare('SELECT * FROM email_reminders WHERE id = ? AND user_id = ?').get(id, userId) as ReminderRow | undefined;
    if (!row) throw new EmailFeatureError(404, 'NOT_FOUND', '提醒不存在或无权访问');
    return row;
  }
  function editable(row: ReminderRow, revision: unknown) {
    if (!Number.isInteger(revision) || row.revision !== revision) throw new EmailFeatureError(409, 'REVISION_CONFLICT', '提醒已在其他页面更新，请刷新后再试');
    if (!pendingStates.includes(row.status)) throw new EmailFeatureError(409, 'REMINDER_LOCKED', '该提醒已开始发送或结束，无法修改');
  }
  return {
    list(userId: string): EmailReminder[] {
      reconcileEmailGeneration(db);
      return (db.prepare(`SELECT * FROM email_reminders WHERE user_id = ? AND (
        status IN ('pending','retry','sending') OR id IN (
          SELECT id FROM email_reminders WHERE user_id = ? AND status NOT IN ('pending','retry','sending')
          ORDER BY created_at DESC, id DESC LIMIT 200
        )) ORDER BY CASE WHEN status IN ('pending','retry','sending') THEN 0 ELSE 1 END, created_at DESC, id DESC`)
        .all(userId, userId) as ReminderRow[]).map(publicReminder);
    },
    create(userId: string, raw: unknown): EmailReminder {
      const input = validateInput(raw);
      const requestId = (raw as Partial<EmailReminderInput>).requestId;
      if (typeof requestId !== 'string' || requestId.length < 1 || requestId.length > 100 || !/^[A-Za-z0-9_-]+$/.test(requestId)) throw new EmailFeatureError(400, 'INVALID_REMINDER', '请求标识无效，请刷新后重试');
      const payloadHash = crypto.createHash('sha256').update(JSON.stringify([input.title, input.body, input.sendAt, input.timezone])).digest('hex');
      return db.transaction(() => {
        const previous = db.prepare('SELECT * FROM email_reminders WHERE user_id = ? AND request_id = ?').get(userId, requestId) as ReminderRow | undefined;
        if (previous) {
          if (previous.payload_hash !== payloadHash) throw new EmailFeatureError(409, 'IDEMPOTENCY_CONFLICT', '请求已用于另一条提醒，请重新操作');
          return publicReminder(previous);
        }
        const at = now();
        if (input.sendAtMs <= at) throw new EmailFeatureError(400, 'INVALID_REMINDER', '发送时间必须晚于当前时间');
        if (!boundAddress(db, userId)) throw new EmailFeatureError(409, 'EMAIL_NOT_BOUND', '请先验证并绑定收件邮箱');
        const count = db.prepare("SELECT COUNT(*) AS total FROM email_reminders WHERE user_id = ? AND status IN ('pending','retry','sending')").get(userId) as { total: number };
        if (count.total >= 50) throw new EmailFeatureError(409, 'REMINDER_LIMIT', '最多保留 50 条待发送提醒，请先取消部分提醒');
        const id = crypto.randomUUID();
        db.prepare(`INSERT INTO email_reminders(id,user_id,request_id,payload_hash,generation_id,title,body,send_at,timezone,next_attempt_at,message_id,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, userId, requestId, payloadHash, emailGeneration(db), input.title, input.body, input.sendAtMs, input.timezone, input.sendAtMs, `<reminder-${id}@potato.local>`, at, at);
        return publicReminder(owned(userId, id));
      })();
    },
    update(userId: string, id: string, raw: unknown): EmailReminder {
      const input = validateInput(raw);
      return db.transaction(() => {
        const row = owned(userId, id);
        editable(row, (raw as { revision?: unknown }).revision);
        if (input.sendAtMs <= now()) throw new EmailFeatureError(400, 'INVALID_REMINDER', '发送时间必须晚于当前时间');
        if (row.generation_id !== emailGeneration(db)) throw new EmailFeatureError(409, 'REMINDER_LOCKED', '数据恢复后的提醒需要重新确认');
        if (!boundAddress(db, userId)) throw new EmailFeatureError(409, 'EMAIL_NOT_BOUND', '请先验证并绑定收件邮箱');
        const changed = db.prepare(`UPDATE email_reminders SET title=?,body=?,send_at=?,timezone=?,next_attempt_at=?,status='pending',revision=revision+1,updated_at=?
          WHERE id=? AND user_id=? AND revision=? AND status IN ('pending','retry')`).run(input.title, input.body, input.sendAtMs, input.timezone, input.sendAtMs, now(), id, userId, row.revision);
        if (changed.changes !== 1) throw new EmailFeatureError(409, 'REVISION_CONFLICT', '提醒已更新，请刷新后重试');
        return publicReminder(owned(userId, id));
      })();
    },
    cancel(userId: string, id: string, revision: unknown): EmailReminder {
      return db.transaction(() => {
        const row = owned(userId, id); editable(row, revision);
        db.prepare("UPDATE email_reminders SET status='cancelled',revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=? AND status IN ('pending','retry')").run(now(), id, userId, row.revision);
        return publicReminder(owned(userId, id));
      })();
    },
  };
}

export interface ReminderWorkerOptions extends EmailServiceOptions {
  autoStart?: boolean;
  drainTimeoutMs?: number;
}

/** Start only after acquiring the process data-directory maintenance lock. No import-time work. */
export function startReminderWorker(options?: ReminderWorkerOptions): { poll(): Promise<void>; stop(): Promise<void> } {
  const db = options?.db ?? getDb();
  const now = options?.now ?? Date.now;
  const sender = options?.sender ?? createSmtpMailSender();
  const drainTimeoutMs = Math.max(1, Math.min(options?.drainTimeoutMs ?? 8000, 8000));
  let stopped = false;
  let inProgress: Promise<void> | null = null;
  let active: { id: string; fence: string; controller: AbortController; abandon: () => void } | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  reconcileEmailGeneration(db);
  // A shared maintenance lock permits another live worker: preserve all unexpired leases.
  db.prepare("UPDATE email_reminders SET status='unknown',revision=revision+1,lease_token=NULL,lease_until=NULL,updated_at=? WHERE status='sending' AND (lease_until IS NULL OR lease_until <= ?)").run(now(), now());

  const claim = db.transaction(() => {
    const at = now();
    reconcileEmailGeneration(db);
    db.prepare("UPDATE email_reminders SET status='unknown',revision=revision+1,lease_token=NULL,lease_until=NULL,updated_at=? WHERE status='sending' AND (lease_until IS NULL OR lease_until <= ?)").run(at, at);
    db.prepare("UPDATE email_reminders SET status='missed',revision=revision+1,updated_at=? WHERE status IN ('pending','retry') AND send_at < ?").run(at, at - 86_400_000);
    const row = db.prepare("SELECT * FROM email_reminders WHERE status IN ('pending','retry') AND next_attempt_at <= ? AND generation_id = ? ORDER BY next_attempt_at,created_at,id LIMIT 1").get(at, emailGeneration(db)) as ReminderRow | undefined;
    if (!row) return null;
    if (!boundAddress(db, row.user_id)) {
      db.prepare("UPDATE email_reminders SET status='cancelled',revision=revision+1,updated_at=? WHERE id=? AND status IN ('pending','retry')").run(at, row.id);
      return { cancelled: true as const };
    }
    const fence = crypto.randomUUID();
    const changed = db.prepare("UPDATE email_reminders SET status='sending',attempts=attempts+1,revision=revision+1,lease_token=?,lease_until=?,delayed=?,updated_at=? WHERE id=? AND status IN ('pending','retry') AND revision=?").run(fence, at + 10_000, at - row.send_at > 60_000 ? 1 : 0, at, row.id, row.revision);
    return changed.changes === 1 ? { cancelled: false as const, row: { ...row, attempts: row.attempts + 1 }, fence } : null;
  });

  async function runPoll() {
    if (stopped || !sender.available) return;
    for (let processed = 0; processed < 50 && !stopped; processed++) {
      const claimed = claim();
      if (!claimed) break;
      if (claimed.cancelled) continue;
      const { row, fence } = claimed;
      const finish = (status: EmailReminderStatus, nextAt = now()) => db.prepare("UPDATE email_reminders SET status=?,next_attempt_at=?,lease_token=NULL,lease_until=NULL,revision=revision+1,updated_at=? WHERE id=? AND status='sending' AND lease_token=?").run(status, nextAt, now(), row.id, fence);
      const address = boundAddress(db, row.user_id);
      if (!address) { finish('cancelled'); continue; }
      if (row.generation_id !== emailGeneration(db)) { finish('unknown'); continue; }
      const controller = new AbortController();
      let abandon!: () => void;
      const abandoned = new Promise<never>((_resolve, reject) => { abandon = () => reject(new MailDeliveryError('unknown')); });
      active = { id: row.id, fence, controller, abandon };
      const timeout = setTimeout(() => { controller.abort(); abandon(); }, 7500);
      try {
        await Promise.race([sender.send({ to: address, subject: `土豆工作台 · ${row.title}`, text: `${row.body || row.title}\n\n计划时间：${new Date(row.send_at).toISOString()}（${row.timezone}）${now() - row.send_at > 60_000 ? '\n此提醒延后发送。' : ''}`, messageId: row.message_id, signal: controller.signal }), abandoned]);
        finish('sent');
      } catch (error) {
        const kind = error instanceof MailDeliveryError ? error.kind : 'unknown';
        if (kind === 'transient' && row.attempts < 3) finish('retry', now() + (row.attempts === 1 ? 60_000 : 300_000));
        else finish(kind === 'unknown' || kind === 'unavailable' ? 'unknown' : 'failed');
      } finally {
        clearTimeout(timeout);
        active = null;
      }
    }
  }
  function poll(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (inProgress) return inProgress;
    inProgress = runPoll().catch(() => { /* Keep worker alive; no raw SMTP/database data in logs. */ }).finally(() => { inProgress = null; });
    return inProgress;
  }
  async function stop(): Promise<void> {
    stopped = true;
    if (timer) clearInterval(timer);
    if (!inProgress) return;
    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>(resolve => { stopTimer = setTimeout(resolve, drainTimeoutMs); });
    try { await Promise.race([inProgress, deadline]); } finally { if (stopTimer) clearTimeout(stopTimer); }
    if (active) {
      const { id, fence, controller, abandon } = active;
      db.prepare("UPDATE email_reminders SET status='unknown',revision=revision+1,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND status='sending' AND lease_token=?").run(now(), id, fence);
      controller.abort(); abandon();
    }
    if (inProgress) await inProgress;
  }
  if (options?.autoStart !== false) {
    timer = setInterval(() => { void poll(); }, 30_000);
    timer.unref();
    void poll();
  }
  return { poll, stop };
}
