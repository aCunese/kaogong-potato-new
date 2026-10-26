import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { getDb, getCurrentGenerationId } from './db';
import {
  hashPassword,
  verifyPassword,
  createSession,
  revokeSession,
  requireAuth,
  checkLoginRateLimit,
  recordLoginFailure,
  resetLoginFailure,
  AuthenticatedRequest,
} from './auth';
import { getUserWorkspace, syncUserWorkspace } from './workspace';
import { saveUserMedia, getUserMediaFile, deleteUserMedia, getUserTotalMediaUsage, MAX_USER_QUOTA_BYTES } from './media';
import { resetPasswordWithCode } from './admin';

const app = express();

// Security and parser middlewares
app.disable('x-powered-by');
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());

// Request logging (sanitized: logs method, path, status, duration, requestId, userId; NO passwords or body)
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const requestId = (req.headers['x-request-id'] as string) || `req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  res.setHeader('x-request-id', requestId);

  res.on('finish', () => {
    const duration = Date.now() - start;
    const authReq = req as AuthenticatedRequest;
    const userLabel = authReq.user ? ` user:${authReq.user.id}` : '';
    // Format: [TIME] [REQ_ID] METHOD PATH STATUS DURATION user:USER_ID
    console.log(`[${new Date().toISOString()}] [${requestId}] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms${userLabel}`);
  });

  next();
});

// ----------------------------------------------------------------------
// System & Health Endpoints
// ----------------------------------------------------------------------

const VERSION_INFO = {
  version: '1.0.0',
  build: '20261026.01',
  schemaVersion: 3,
  apkVersion: '1.0.0',
  deployedAt: '2026-10-26T15:00:00Z',
  summary: '正式上线：多账号邀请制、云端快照幂等同步与防冲突保护',
};

app.get('/version.json', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json(VERSION_INFO);
});

app.get('/api/health', (_req: Request, res: Response) => {
  try {
    const genId = getCurrentGenerationId();
    res.json({
      ok: true,
      status: 'healthy',
      generationId: genId,
      time: new Date().toISOString(),
      uptime: process.uptime(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, status: 'unhealthy', error: String(err) });
  }
});

// ----------------------------------------------------------------------
// Auth Endpoints (/api/auth/*)
// ----------------------------------------------------------------------

app.post('/api/auth/register', async (req: Request, res: Response) => {
  const { username, password, nickname, inviteCode } = req.body || {};

  if (!username || typeof username !== 'string' || username.trim().length < 2) {
    res.status(400).json({ ok: false, code: 'INVALID_USERNAME', message: '用户名至少需要 2 位字符' });
    return;
  }
  if (!password || typeof password !== 'string' || password.length < 4) {
    res.status(400).json({ ok: false, code: 'INVALID_PASSWORD', message: '密码至少需要 4 位字符' });
    return;
  }
  if (!inviteCode || typeof inviteCode !== 'string') {
    res.status(400).json({ ok: false, code: 'MISSING_INVITE', message: '本系统为专属邀请制，请输入有效的注册邀请码' });
    return;
  }

  const cleanUsername = username.trim().toLowerCase();
  const cleanNickname = (nickname && typeof nickname === 'string' && nickname.trim()) ? nickname.trim() : cleanUsername;
  const db = getDb();

  // Validate invite code
  const invite = db.prepare('SELECT * FROM invites WHERE code = ? AND used_at IS NULL').get(inviteCode) as any;
  if (!invite) {
    res.status(400).json({ ok: false, code: 'INVALID_INVITE_CODE', message: '邀请码无效或已被使用' });
    return;
  }

  // Check username uniqueness
  const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername);
  if (existingUser) {
    res.status(409).json({ ok: false, code: 'USERNAME_EXISTS', message: '该用户名已被注册，请尝试其他用户名' });
    return;
  }

  const passwordHash = await hashPassword(password);
  const userId = `u_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const nowIso = new Date().toISOString();

  // Transaction: Create user and mark invite used
  const registerTx = db.transaction(() => {
    db.prepare(`
      INSERT INTO users (id, username, nickname, password_hash, role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'user', 1, ?, ?)
    `).run(userId, cleanUsername, cleanNickname, passwordHash, nowIso, nowIso);

    db.prepare(`
      UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?
    `).run(userId, nowIso, inviteCode);
  });

  registerTx();

  // Issue session
  const { token, csrfToken } = createSession(userId);

  res.cookie('potato_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

  res.json({
    ok: true,
    user: { id: userId, username: cleanUsername, nickname: cleanNickname, role: 'user' },
    csrfToken,
    message: '注册成功，欢迎加入备考工作台！',
  });
});

app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { username, password } = req.body || {};
  const ip = req.ip || req.socket.remoteAddress || 'unknown';

  if (!username || !password) {
    res.status(400).json({ ok: false, code: 'BAD_REQUEST', message: '请输入用户名和密码' });
    return;
  }

  const cleanUsername = String(username).trim().toLowerCase();
  const rateLimitKey = `${ip}_${cleanUsername}`;

  if (!checkLoginRateLimit(rateLimitKey)) {
    res.status(429).json({ ok: false, code: 'TOO_MANY_ATTEMPTS', message: '密码错误次数过多，请 15 分钟后再试' });
    return;
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(cleanUsername) as any;

  if (!user || user.is_active !== 1) {
    recordLoginFailure(rateLimitKey);
    res.status(401).json({ ok: false, code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' });
    return;
  }

  const matches = await verifyPassword(user.password_hash, String(password));
  if (!matches) {
    recordLoginFailure(rateLimitKey);
    res.status(401).json({ ok: false, code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' });
    return;
  }

  resetLoginFailure(rateLimitKey);

  const { token, csrfToken } = createSession(user.id);

  res.cookie('potato_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

  res.json({
    ok: true,
    user: { id: user.id, username: user.username, nickname: user.nickname, role: user.role },
    csrfToken,
    message: '登录成功',
  });
});

app.post('/api/auth/logout', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  if (req.sessionToken) {
    revokeSession(req.sessionToken);
  }
  res.clearCookie('potato_session');
  res.json({ ok: true, message: '已安全退出登录' });
});

app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const u = req.user!;
  res.json({
    ok: true,
    user: { id: u.id, username: u.username, nickname: u.nickname, role: u.role },
    csrfToken: req.csrfToken,
  });
});

app.post('/api/auth/reset-password', async (req: Request, res: Response) => {
  const { code, newPassword } = req.body || {};
  if (!code || !newPassword) {
    res.status(400).json({ ok: false, code: 'BAD_REQUEST', message: '请输入重置码和新密码' });
    return;
  }

  const result = await resetPasswordWithCode(String(code).trim(), String(newPassword));
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }

  res.json(result);
});

// ----------------------------------------------------------------------
// Workspace & Sync Endpoints (/api/workspace)
// ----------------------------------------------------------------------

app.get('/api/workspace', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const result = getUserWorkspace(req.user!.id);
  res.json(result);
});

app.post('/api/workspace', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const { expectedRevision, requestId, schemaVersion, generationId, state, reason } = req.body || {};

  if (typeof expectedRevision !== 'number' || !requestId || !state) {
    res.status(400).json({ ok: false, code: 'INVALID_SYNC_PAYLOAD', message: '同步快照请求参数不完整' });
    return;
  }

  const result = syncUserWorkspace({
    userId: req.user!.id,
    expectedRevision,
    requestId: String(requestId),
    schemaVersion: schemaVersion || 3,
    generationId: String(generationId || ''),
    state,
    reason,
  });

  res.status(result.status).json(result);
});

// ----------------------------------------------------------------------
// Media Endpoints (/api/media/*)
// ----------------------------------------------------------------------

const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

app.post('/api/media/upload', requireAuth, uploadMiddleware.single('file'), (req: AuthenticatedRequest, res: Response) => {
  if (!req.file) {
    res.status(400).json({ ok: false, code: 'NO_FILE', message: '未检测到上传文件' });
    return;
  }

  const result = saveUserMedia(req.user!.id, req.file.buffer, req.file.originalname);
  if (!result.ok) {
    res.status(result.code === 'QUOTA_EXCEEDED' ? 413 : 400).json(result);
    return;
  }

  res.json({
    ok: true,
    media: result.media,
    message: '图片上传成功',
  });
});

app.get('/api/media/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const media = getUserMediaFile(req.user!.id, req.params.id);
  if (!media) {
    res.status(404).json({ ok: false, code: 'NOT_FOUND', message: '图片不存在或无权访问' });
    return;
  }

  res.setHeader('Content-Type', media.mime);
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  const stream = fs.createReadStream(media.diskPath);
  stream.pipe(res);
});

app.delete('/api/media/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const deleted = deleteUserMedia(req.user!.id, req.params.id);
  if (!deleted) {
    res.status(404).json({ ok: false, code: 'NOT_FOUND', message: '图片不存在或无权删除' });
    return;
  }
  res.json({ ok: true, message: '图片已安全删除' });
});

// ----------------------------------------------------------------------
// Static Frontend Serving (Strictly serves dist/, excludes data/ and source files)
// ----------------------------------------------------------------------

const distPath = path.resolve(process.cwd(), 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath, { index: false }));

  // SPA fallback for all non-API GET requests (Express 5 syntax)
  app.get('/{*splat}', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/') || req.path === '/version.json') {
      next();
      return;
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// 404 for unhandled API routes
app.all('/api/{*splat}', (_req: Request, res: Response) => {
  res.status(404).json({ ok: false, code: 'ROUTE_NOT_FOUND', message: 'API 路径不存在' });
});

export default app;
