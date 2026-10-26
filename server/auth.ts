import argon2 from 'argon2';
import crypto from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { getDb } from './db';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 mins
const MAX_FAILED_ATTEMPTS_PER_USER = 5;  // 单账号最大错误次数（防分布式代理池撞库）
const MAX_FAILED_ATTEMPTS_PER_IP = 20;   // 单 IP 最大错误次数（防跨账号密码喷洒）
const MAX_TRACKED_ENTRIES = 2000;        // 严格硬限制，防止内存无上限膨胀 (LRU 驱逐)

// 双桶滑动窗口失败追踪: 账号桶 + IP 桶 + 通用端点桶
const userFailures = new Map<string, { count: number; firstAttempt: number }>();
const ipFailures = new Map<string, { count: number; firstAttempt: number }>();
const genericIpCounters = new Map<string, { count: number; firstAttempt: number }>();

function setWithBoundedEviction<K, V extends { count: number; firstAttempt: number }>(map: Map<K, V>, key: K, value: V) {
  if (map.has(key)) {
    map.set(key, value);
    return;
  }

  const now = Date.now();

  // 1. 优先剔除已过期的键
  if (map.size >= MAX_TRACKED_ENTRIES) {
    for (const [k, v] of map.entries()) {
      if (now - v.firstAttempt > RATE_LIMIT_WINDOW_MS) {
        map.delete(k);
      }
      if (map.size < MAX_TRACKED_ENTRIES) break;
    }
  }

  // 2. 若仍超限，绝不可剔除正在锁定惩罚中的高危键，优先寻找 count 最低的键淘汰 (防范 Map 驱逐攻击与锁定绕过)
  if (map.size >= MAX_TRACKED_ENTRIES) {
    let candidateKey: K | undefined;
    let minCount = Infinity;

    for (const [k, v] of map.entries()) {
      if (v.count < minCount) {
        minCount = v.count;
        candidateKey = k;
        if (minCount <= 1) break;
      }
    }

    if (candidateKey !== undefined) {
      map.delete(candidateKey);
    }
  }

  map.set(key, value);
}

function pruneExpiredEntries(map: Map<string, { count: number; firstAttempt: number }>) {
  const now = Date.now();
  for (const [k, v] of map.entries()) {
    if (now - v.firstAttempt > RATE_LIMIT_WINDOW_MS) {
      map.delete(k);
    }
  }
}

export function checkEndpointRateLimit(action: string, ip: string, maxAttempts = 30, windowMs = RATE_LIMIT_WINDOW_MS): boolean {
  const key = `${action}:${ip}`;
  const now = Date.now();
  const entry = genericIpCounters.get(key);
  if (!entry) return true;
  if (now - entry.firstAttempt > windowMs) {
    genericIpCounters.delete(key);
    return true;
  }
  return entry.count < maxAttempts;
}

export function recordEndpointAttempt(action: string, ip: string, windowMs = RATE_LIMIT_WINDOW_MS): void {
  const key = `${action}:${ip}`;
  const now = Date.now();
  if (genericIpCounters.size > MAX_TRACKED_ENTRIES / 2) {
    pruneExpiredEntries(genericIpCounters);
  }
  const entry = genericIpCounters.get(key);
  if (!entry || (now - entry.firstAttempt > windowMs)) {
    setWithBoundedEviction(genericIpCounters, key, { count: 1, firstAttempt: now });
  } else {
    entry.count += 1;
  }
}

export function checkLoginRateLimit(ipOrKey: string, username?: string): boolean {
  const now = Date.now();
  let ip = ipOrKey;
  let user = username;

  if (!user && ipOrKey.includes('_')) {
    const parts = ipOrKey.split('_');
    ip = parts[0];
    user = parts.slice(1).join('_');
  }

  // 1. IP 桶限制 (防单 IP 密码喷洒)
  const ipEntry = ipFailures.get(ip);
  if (ipEntry) {
    if (now - ipEntry.firstAttempt > RATE_LIMIT_WINDOW_MS) {
      ipFailures.delete(ip);
    } else if (ipEntry.count >= MAX_FAILED_ATTEMPTS_PER_IP) {
      return false;
    }
  }

  // 2. 账号桶限制 (防代理池对单账号撞库)
  if (user) {
    const userEntry = userFailures.get(user);
    if (userEntry) {
      if (now - userEntry.firstAttempt > RATE_LIMIT_WINDOW_MS) {
        userFailures.delete(user);
      } else if (userEntry.count >= MAX_FAILED_ATTEMPTS_PER_USER) {
        return false;
      }
    }
  }

  return true;
}

export function recordLoginFailure(ipOrKey: string, username?: string): void {
  const now = Date.now();
  let ip = ipOrKey;
  let user = username;

  if (!user && ipOrKey.includes('_')) {
    const parts = ipOrKey.split('_');
    ip = parts[0];
    user = parts.slice(1).join('_');
  }

  if (ipFailures.size > MAX_TRACKED_ENTRIES / 2) {
    pruneExpiredEntries(ipFailures);
  }
  if (userFailures.size > MAX_TRACKED_ENTRIES / 2) {
    pruneExpiredEntries(userFailures);
  }

  // 记录 IP 桶
  const ipEntry = ipFailures.get(ip);
  if (!ipEntry || (now - ipEntry.firstAttempt > RATE_LIMIT_WINDOW_MS)) {
    setWithBoundedEviction(ipFailures, ip, { count: 1, firstAttempt: now });
  } else {
    ipEntry.count += 1;
  }

  // 记录 账号 桶
  if (user) {
    const userEntry = userFailures.get(user);
    if (!userEntry || (now - userEntry.firstAttempt > RATE_LIMIT_WINDOW_MS)) {
      setWithBoundedEviction(userFailures, user, { count: 1, firstAttempt: now });
    } else {
      userEntry.count += 1;
    }
  }
}

export function resetLoginFailure(ipOrKey: string, username?: string): void {
  let user = username;

  if (!user && ipOrKey.includes('_')) {
    const parts = ipOrKey.split('_');
    user = parts.slice(1).join('_');
  }

  // 关键防御：仅清除该用户的失败计数，绝不可删除 ipFailures 计数！
  // IP 失败计数代表该来源网络的风险评分，必须随 15 分钟窗口自然衰减，防止攻击者利用单次有效登录重置 IP 桶进行无限密码喷洒 (Password Spraying)
  if (user) {
    userFailures.delete(user);
  }
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

  // CSRF validation on mutating methods using timingSafeEqual
  const mutatingMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
  if (mutatingMethods.includes(req.method.toUpperCase())) {
    const clientCsrf = req.headers['x-csrf-token'];
    let csrfValid = false;
    if (typeof clientCsrf === 'string' && typeof session.csrf_token === 'string') {
      const bufClient = Buffer.from(clientCsrf);
      const bufExpected = Buffer.from(session.csrf_token);
      if (bufClient.length === bufExpected.length) {
        csrfValid = crypto.timingSafeEqual(bufClient, bufExpected);
      }
    }
    if (!csrfValid) {
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
