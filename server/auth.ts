import argon2 from 'argon2';
import crypto from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { getDb } from './db';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 mins
const MAX_FAILED_ATTEMPTS = 5;

// In-memory failed login tracking: key = ip_username -> { count, firstAttempt }
const loginFailures = new Map<string, { count: number; firstAttempt: number }>();

export function checkLoginRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = loginFailures.get(key);
  if (!entry) return true;
  if (now - entry.firstAttempt > RATE_LIMIT_WINDOW_MS) {
    loginFailures.delete(key);
    return true;
  }
  return entry.count < MAX_FAILED_ATTEMPTS;
}

export function recordLoginFailure(key: string): void {
  const now = Date.now();
  const entry = loginFailures.get(key);
  if (!entry || (now - entry.firstAttempt > RATE_LIMIT_WINDOW_MS)) {
    loginFailures.set(key, { count: 1, firstAttempt: now });
  } else {
    entry.count += 1;
  }
}

export function resetLoginFailure(key: string): void {
  loginFailures.delete(key);
}

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

export interface UserRow {
  id: string;
  username: string;
  nickname: string;
  password_hash: string;
  role: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface SessionRow {
  token: string;
  user_id: string;
  csrf_token: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
}

export function createSession(userId: string): { token: string; csrfToken: string; expiresAt: string } {
  const db = getDb();
  const token = crypto.randomBytes(32).toString('hex');
  const csrfToken = crypto.randomBytes(16).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

  db.prepare(`
    INSERT INTO sessions (token, user_id, csrf_token, created_at, expires_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(token, userId, csrfToken, now.toISOString(), expiresAt, now.toISOString());

  return { token, csrfToken, expiresAt };
}

export function revokeSession(token: string): void {
  const db = getDb();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function revokeAllUserSessions(userId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export interface AuthenticatedRequest extends Request {
  user?: UserRow;
  sessionToken?: string;
  csrfToken?: string;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const sessionToken = req.cookies?.potato_session;
  if (!sessionToken || typeof sessionToken !== 'string') {
    res.status(401).json({ ok: false, code: 'UNAUTHORIZED', message: '未登录或登录已失效，请重新登录' });
    return;
  }

  const db = getDb();
  const nowIso = new Date().toISOString();

  const session = db.prepare(`
    SELECT * FROM sessions WHERE token = ? AND expires_at > ?
  `).get(sessionToken, nowIso) as SessionRow | undefined;

  if (!session) {
    res.clearCookie('potato_session');
    res.status(401).json({ ok: false, code: 'SESSION_EXPIRED', message: '会话已过期，请重新登录' });
    return;
  }

  const user = db.prepare(`
    SELECT * FROM users WHERE id = ?
  `).get(session.user_id) as UserRow | undefined;

  if (!user || user.is_active !== 1) {
    revokeSession(sessionToken);
    res.clearCookie('potato_session');
    res.status(403).json({ ok: false, code: 'USER_DISABLED', message: '账号已停用或不存在，请联系管理员' });
    return;
  }

  // CSRF validation on mutating methods
  const mutatingMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
  if (mutatingMethods.includes(req.method.toUpperCase())) {
    const clientCsrf = req.headers['x-csrf-token'];
    if (!clientCsrf || clientCsrf !== session.csrf_token) {
      res.status(403).json({ ok: false, code: 'CSRF_INVALID', message: '安全凭证校验失败，请刷新页面重试' });
      return;
    }
  }

  // Update last seen
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token = ?').run(nowIso, sessionToken);

  req.user = user;
  req.sessionToken = sessionToken;
  req.csrfToken = session.csrf_token;
  next();
}
