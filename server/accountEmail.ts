import crypto from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type { AccountEmailStatus } from '../src/types/email';
import { createSmtpMailSender, type MailSender } from './mailTransport';

export class EmailFeatureError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message); this.name = 'EmailFeatureError';
  }
}

export interface EmailServiceOptions {
  db: Database;
  sender?: MailSender;
  now?: () => number;
  secret?: string;
}

export function emailGeneration(db: Database): string {
  const row = db.prepare("SELECT value FROM server_meta WHERE key = 'generation_id'").get() as { value: string } | undefined;
  if (!row?.value) throw new EmailFeatureError(503, 'EMAIL_UNAVAILABLE', '邮件服务暂不可用，请稍后重试');
  return row.value;
}

/** Run after server_meta generation exists, also after an offline restore has rotated it. */
export function initEmailSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_email_bindings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      verified_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS email_challenges (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      generation_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      delivered INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_email_challenge_user ON email_challenges(user_id, created_at);
    CREATE TABLE IF NOT EXISTS email_rate_limits (
      bucket TEXT PRIMARY KEY,
      window_start INTEGER NOT NULL,
      count INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS email_reminders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      generation_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      send_at INTEGER NOT NULL,
      timezone TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','retry','sending','sent','failed','unknown','cancelled','missed','needs_review')),
      revision INTEGER NOT NULL DEFAULT 1,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL,
      lease_token TEXT,
      lease_until INTEGER,
      message_id TEXT NOT NULL,
      delayed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(user_id, request_id)
    );
    CREATE INDEX IF NOT EXISTS idx_email_reminders_due ON email_reminders(status, next_attempt_at);
    CREATE INDEX IF NOT EXISTS idx_email_reminders_user ON email_reminders(user_id, created_at);
  `);
  reconcileEmailGeneration(db);
}

export function reconcileEmailGeneration(db: Database): void {
  const generation = emailGeneration(db);
  db.transaction(() => {
    db.prepare('DELETE FROM email_challenges WHERE generation_id <> ?').run(generation);
    db.prepare("UPDATE email_reminders SET status = 'needs_review', revision = revision + 1, lease_token = NULL, lease_until = NULL WHERE generation_id <> ? AND status IN ('pending','retry')").run(generation);
    db.prepare("UPDATE email_reminders SET status = 'unknown', revision = revision + 1, lease_token = NULL, lease_until = NULL WHERE generation_id <> ? AND status = 'sending'").run(generation);
  })();
}

interface ChallengeRow { id: string; user_id: string; email: string; code_hash: string; generation_id: string; created_at: number; expires_at: number; attempts: number; delivered: number }

export function createAccountEmailService(options: EmailServiceOptions) {
  const { db } = options;
  const sender = options.sender ?? createSmtpMailSender();
  const now = options.now ?? Date.now;
  const secret = options.secret ?? process.env.EMAIL_CODE_SECRET ?? process.env.SESSION_SECRET ?? '';
  const available = sender.available && secret.length >= 16;
  const requireAvailable = () => { if (!available) throw new EmailFeatureError(503, 'EMAIL_UNAVAILABLE', '邮件服务尚未启用，请联系管理员'); };
  const hmac = (value: string) => crypto.createHmac('sha256', secret).update(value).digest('hex');
  const verifiedAddress = (userId: string): string | null => (db.prepare('SELECT email FROM account_email_bindings WHERE user_id = ?').get(userId) as { email: string } | undefined)?.email ?? null;
  const status = (userId: string): AccountEmailStatus => {
    const email = verifiedAddress(userId);
    return { available, bound: Boolean(email), maskedEmail: email ? `${email[0]}***@${email.split('@')[1]}` : null };
  };
  function limit(bucket: string, max: number, at: number) {
    const key = hmac(bucket);
    const row = db.prepare('SELECT window_start, count FROM email_rate_limits WHERE bucket = ?').get(key) as { window_start: number; count: number } | undefined;
    if (row && at - row.window_start < 3_600_000 && row.count >= max) throw new EmailFeatureError(429, 'RATE_LIMITED', '验证请求过于频繁，请一小时后再试');
    if (row && at - row.window_start < 3_600_000) db.prepare('UPDATE email_rate_limits SET count = count + 1 WHERE bucket = ?').run(key);
    else db.prepare('INSERT OR REPLACE INTO email_rate_limits(bucket, window_start, count) VALUES (?, ?, 1)').run(key, at);
  }
  return {
    status, verifiedAddress,
    async requestCode(userId: string, ip: string, rawEmail: unknown) {
      requireAvailable();
      if (typeof rawEmail !== 'string') throw new EmailFeatureError(400, 'INVALID_EMAIL', '请输入有效邮箱地址');
      const email = rawEmail.trim().toLowerCase();
      if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(email)) throw new EmailFeatureError(400, 'INVALID_EMAIL', '请输入有效邮箱地址');
      const at = now();
      const id = crypto.randomUUID();
      const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
      const generation = emailGeneration(db);
      db.transaction(() => {
        db.prepare('DELETE FROM email_rate_limits WHERE window_start <= ?').run(at - 3_600_000);
        db.prepare('DELETE FROM email_challenges WHERE expires_at <= ?').run(at);
        const last = db.prepare('SELECT created_at FROM email_challenges WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(userId) as { created_at: number } | undefined;
        if (last && at - last.created_at < 60_000) throw new EmailFeatureError(429, 'CODE_COOLDOWN', '请在 60 秒后重新获取验证码');
        limit(`code:user:${userId}`, 5, at);
        limit(`code:ip:${ip}`, 20, at);
        limit(`code:email:${email}`, 5, at);
        db.prepare('DELETE FROM email_challenges WHERE user_id = ?').run(userId);
        db.prepare('INSERT INTO email_challenges(id,user_id,email,code_hash,generation_id,created_at,expires_at) VALUES (?,?,?,?,?,?,?)').run(id, userId, email, hmac(`${id}:${generation}:${userId}:${email}:${code}`), generation, at, at + 600_000);
      })();
      try {
        await sender.send({ to: email, subject: '土豆工作台 · 邮箱验证码', text: `你的邮箱验证码是 ${code}，10 分钟内有效。若非本人操作，请忽略此邮件。`, messageId: `<verify-${id}@potato.local>` });
      } catch {
        db.prepare('UPDATE email_challenges SET attempts = 5 WHERE id = ?').run(id);
        throw new EmailFeatureError(503, 'MAIL_SEND_FAILED', '验证码暂未发送成功，请稍后重试');
      }
      db.prepare('UPDATE email_challenges SET delivered = 1 WHERE id = ? AND generation_id = ?').run(id, emailGeneration(db));
      return { challengeId: id, expiresAt: new Date(at + 600_000).toISOString(), resendAfter: 60 };
    },
    verifyCode(userId: string, challengeId: unknown, code: unknown) {
      requireAvailable();
      const invalid = () => new EmailFeatureError(400, 'INVALID_CODE', '验证码无效、已过期或错误次数过多，请重新获取');
      if (typeof challengeId !== 'string' || challengeId.length > 100 || typeof code !== 'string' || !/^\d{6}$/.test(code)) throw invalid();
      const at = now();
      const accepted = db.transaction(() => {
        limit(`verify:user:${userId}`, 30, at);
        const challenge = db.prepare('SELECT * FROM email_challenges WHERE id = ? AND user_id = ?').get(challengeId, userId) as ChallengeRow | undefined;
        if (!challenge || challenge.expires_at <= at || challenge.attempts >= 5 || challenge.delivered !== 1 || challenge.generation_id !== emailGeneration(db)) return false;
        db.prepare('UPDATE email_challenges SET attempts = attempts + 1 WHERE id = ?').run(challenge.id);
        const actual = hmac(`${challenge.id}:${challenge.generation_id}:${userId}:${challenge.email}:${code}`);
        if (!crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(challenge.code_hash, 'hex'))) return false;
        db.prepare('INSERT OR REPLACE INTO account_email_bindings(user_id,email,verified_at) VALUES (?,?,?)').run(userId, challenge.email, at);
        db.prepare('DELETE FROM email_challenges WHERE user_id = ?').run(userId);
        return true;
      })();
      if (!accepted) throw invalid();
      return status(userId);
    },
    unbind(userId: string) {
      db.transaction(() => {
        db.prepare('DELETE FROM account_email_bindings WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM email_challenges WHERE user_id = ?').run(userId);
        db.prepare("UPDATE email_reminders SET status = 'cancelled', revision = revision + 1, updated_at = ? WHERE user_id = ? AND status IN ('pending','retry')").run(now(), userId);
      })();
      return status(userId);
    },
  };
}
