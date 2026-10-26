import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
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
  checkEndpointRateLimit,
  recordEndpointAttempt,
  AuthenticatedRequest,
} from './auth';
import {
  getUserWorkspace,
  syncUserWorkspace,
  getUserBackupExport,
  getUserWorkspaceHistory,
  restoreUserFromHistory,
  applyWorkspaceInitChoice,
  InitChoice,
} from './workspace';
import { saveUserMedia, getUserMediaFile, deleteUserMedia, getUserTotalMediaUsage, MAX_USER_QUOTA_BYTES } from './media';
import { resetPasswordWithCode } from './admin';
import { createSeedState } from '../src/utils/seedFactory';

const app = express();

// 反向代理信任设置 (解决 IP Spoofing 与 127.0.0.1 锁死问题)
app.set('trust proxy', 1);

// Security and parser middlewares
app.disable('x-powered-by');
// 细粒度 Body-Parser：防范 50MB 内存炸弹穿透打崩 512MB 容器内存
app.use((req: Request, res: Response, next: NextFunction) => {
  // 仅工作区全量同步端点放行大体积 JSON (50MB，内部还有 12MiB 工作区字节上限)，
  // 其余端点（含 /api/workspace/init-choice）严格限制为 64KB
  const isWorkspaceSync = req.path === '/api/workspace';
  const limit = isWorkspaceSync ? '50mb' : '64kb';
  express.json({ limit })(req, res, next);
});
app.use(cookieParser());

// Request logging (sanitized: logs method, path, status, duration, requestId, clientIp, userId; NO passwords or body)
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const requestId = (req.headers['x-request-id'] as string) || `req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  res.setHeader('x-request-id', requestId);

  res.on('finish', () => {
    const duration = Date.now() - start;
    const authReq = req as AuthenticatedRequest;
    const userLabel = authReq.user ? ` user:${authReq.user.id}` : '';
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    // Format: [TIME] [REQ_ID] [CLIENT_IP] METHOD PATH STATUS DURATION user:USER_ID
    console.log(`[${new Date().toISOString()}] [${requestId}] [${clientIp}] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms${userLabel}`);
  });

  next();
});

// ----------------------------------------------------------------------
// System & Health Endpoints
// ----------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ReleaseConfig {
  webVersion: string;
  webBuild: string;
  schemaVersion: number;
  apkVersion: string;
  apkVersionCode: number;
  apkPackageName: string;
  apkSha256: string;
  apkSizeBytes: number;
  apkCertFingerprint: string;
  apkReleased: boolean;
  apkDownloadUrl: string;
  deployedAt: string;
  summary: string;
}

export interface ReleaseValidationResult {
  valid: boolean;
  error?: string;
  config?: ReleaseConfig;
  configPath?: string;
}

/**
 * 确定 release.json 的绝对路径：
 * 优先环境变量 RELEASE_CONFIG_PATH；
 * 其次服务根目录（__dirname 的上一级，即应用根目录）；
 * 再次进程当前工作目录 process.cwd()；
 * 避免盲目依赖 process.cwd()。
 */
export function resolveReleaseConfigPath(): string | null {
  if (process.env.RELEASE_CONFIG_PATH) {
    if (fs.existsSync(process.env.RELEASE_CONFIG_PATH)) {
      return process.env.RELEASE_CONFIG_PATH;
    }
    return null;
  }
  const appRootPath = path.resolve(__dirname, '..', 'release.json');
  if (fs.existsSync(appRootPath)) {
    return appRootPath;
  }
  const cwdPath = path.resolve(process.cwd(), 'release.json');
  if (fs.existsSync(cwdPath)) {
    return cwdPath;
  }
  return null;
}

/**
 * 校验 release.json 配置合法性：
 * - 必须为有效 JSON 对象
 * - webVersion 与 webBuild 必填且不能为 "unknown"
 * - apkReleased === true 时：必须有非空 apkSha256、apkSizeBytes > 0、apkPackageName、apkCertFingerprint
 * - apkReleased === false 时：允许 apkSha256 为空且 apkSizeBytes 为 0
 */
export function validateReleaseConfig(raw: unknown): { valid: boolean; error?: string; config?: ReleaseConfig } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, error: 'Release configuration must be a JSON object' };
  }
  const r = raw as Record<string, unknown>;

  const webVersion = typeof r.webVersion === 'string' ? r.webVersion.trim() : '';
  if (!webVersion || webVersion === 'unknown') {
    return { valid: false, error: 'webVersion must be a non-empty string and cannot be "unknown"' };
  }

  const webBuild = typeof r.webBuild === 'string' ? r.webBuild.trim() : '';
  if (!webBuild || webBuild === 'unknown') {
    return { valid: false, error: 'webBuild must be a non-empty string and cannot be "unknown"' };
  }

  const apkReleased = r.apkReleased === true;
  const apkSha256 = typeof r.apkSha256 === 'string' ? r.apkSha256.trim() : '';
  const apkSizeBytes = typeof r.apkSizeBytes === 'number' ? r.apkSizeBytes : 0;
  const apkPackageName = typeof r.apkPackageName === 'string' ? r.apkPackageName.trim() : '';
  const apkCertFingerprint = typeof r.apkCertFingerprint === 'string' ? r.apkCertFingerprint.trim() : '';

  if (apkReleased) {
    if (!apkSha256) {
      return { valid: false, error: 'apkSha256 is required when apkReleased is true' };
    }
    if (apkSizeBytes <= 0) {
      return { valid: false, error: 'apkSizeBytes must be greater than 0 when apkReleased is true' };
    }
    if (!apkPackageName) {
      return { valid: false, error: 'apkPackageName is required when apkReleased is true' };
    }
    if (!apkCertFingerprint) {
      return { valid: false, error: 'apkCertFingerprint is required when apkReleased is true' };
    }
  }

  const schemaVersion = typeof r.schemaVersion === 'number' ? r.schemaVersion : 3;
  const apkVersion = typeof r.apkVersion === 'string' && r.apkVersion.trim() ? r.apkVersion.trim() : webVersion;
  const apkVersionCode = typeof r.apkVersionCode === 'number' ? r.apkVersionCode : 0;
  const apkDownloadUrl = typeof r.apkDownloadUrl === 'string' && r.apkDownloadUrl.trim() ? r.apkDownloadUrl.trim() : '/api/download/apk';
  const deployedAt = typeof r.deployedAt === 'string' ? r.deployedAt : '';
  const summary = typeof r.summary === 'string' ? r.summary : '';

  return {
    valid: true,
    config: {
      webVersion,
      webBuild,
      schemaVersion,
      apkVersion,
      apkVersionCode,
      apkPackageName: apkPackageName || 'com.ruyne.kaogong',
      apkSha256,
      apkSizeBytes,
      apkCertFingerprint,
      apkReleased,
      apkDownloadUrl,
      deployedAt,
      summary,
    },
  };
}

export function getReleaseValidation(): ReleaseValidationResult {
  const configPath = resolveReleaseConfigPath();
  if (!configPath) {
    return { valid: false, error: 'Release configuration file (release.json) not found' };
  }
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content);
    const result = validateReleaseConfig(parsed);
    return {
      ...result,
      configPath,
    };
  } catch (err) {
    return {
      valid: false,
      error: `Failed to read or parse release configuration: ${err instanceof Error ? err.message : String(err)}`,
      configPath,
    };
  }
}

/**
 * 版本元数据端点：完整保留既有字段以兼容旧客户端。
 * 网络新鲜度证明（R16）：回显请求 ?nonce=（最长 64 字符）并附带本次响应服务端时间 servedAt，
 * 客户端可据此证明拿到的是本次真实网络响应，而不是 Service Worker 缓存里的旧响应。
 * 若发布配置缺失或非法，返回 HTTP 503。
 */
app.get(['/version.json', '/api/version'], (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const releaseStatus = getReleaseValidation();
  if (!releaseStatus.valid || !releaseStatus.config) {
    return res.status(503).json({
      ok: false,
      status: 'unhealthy',
      code: 'RELEASE_CONFIG_INVALID',
      error: releaseStatus.error || 'Release configuration missing or invalid',
    });
  }
  const config = releaseStatus.config;
  const nonceRaw = req.query.nonce;
  const nonce = typeof nonceRaw === 'string' && nonceRaw.length > 0 ? nonceRaw.slice(0, 64) : null;
  res.json({
    version: config.webVersion,
    build: config.webBuild,
    schemaVersion: config.schemaVersion,
    apkVersion: config.apkVersion,
    apkVersionCode: config.apkVersionCode,
    apkDownloadUrl: config.apkDownloadUrl,
    apkSha256: config.apkSha256,
    apkSizeBytes: config.apkSizeBytes,
    apkPackageName: config.apkPackageName,
    apkCertFingerprint: config.apkCertFingerprint,
    apkReleased: config.apkReleased,
    deployedAt: config.deployedAt,
    summary: config.summary,
    servedAt: new Date().toISOString(),
    ...(nonce !== null ? { nonce } : {}),
  });
});

/**
 * 服务端健康检查：
 * - 检查数据库连接与同步代际 ID
 * - 检查发布配置 (release.json) 合法性
 * 若发布配置缺失或非法，返回 HTTP 503 (RELEASE_CONFIG_INVALID)；
 * 仅当数据库正常且发布配置验证通过时，返回 HTTP 200 { ok: true, status: 'healthy', ... }。
 */
app.get('/api/health', (_req: Request, res: Response) => {
  let genId = '';
  try {
    genId = getCurrentGenerationId();
  } catch (err) {
    return res.status(500).json({ ok: false, status: 'unhealthy', error: String(err) });
  }

  const releaseStatus = getReleaseValidation();
  if (!releaseStatus.valid || !releaseStatus.config) {
    return res.status(503).json({
      ok: false,
      status: 'unhealthy',
      code: 'RELEASE_CONFIG_INVALID',
      error: 'Release configuration missing or invalid',
      generationId: genId,
      time: new Date().toISOString(),
      uptime: process.uptime(),
    });
  }

  return res.json({
    ok: true,
    status: 'healthy',
    generationId: genId,
    time: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// APK 完整性校验缓存（根据文件 stat.mtimeMs 和 stat.size 缓存校验哈希，杜绝重复计算阻塞 Node 单线程）
let apkIntegrityCache: { path: string; mtimeMs: number; size: number; sha256: string } | null = null;

async function getOrComputeApkSha256(filePath: string): Promise<string> {
  const stat = await fs.promises.stat(filePath);
  if (
    apkIntegrityCache &&
    apkIntegrityCache.path === filePath &&
    apkIntegrityCache.mtimeMs === stat.mtimeMs &&
    apkIntegrityCache.size === stat.size
  ) {
    return apkIntegrityCache.sha256;
  }

  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  const sha256 = hash.digest('hex');
  apkIntegrityCache = {
    path: filePath,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    sha256,
  };
  return sha256;
}

app.get('/api/download/apk', async (_req: Request, res: Response) => {
  // 严格绑定版本规范：生产环境唯一分发与当前 release.json 严格一致的发行版 APK，禁止宽泛 fallback 穿透。
  const releaseStatus = getReleaseValidation();
  if (!releaseStatus.valid || !releaseStatus.config) {
    return res.status(503).json({
      ok: false,
      code: 'RELEASE_CONFIG_INVALID',
      message: 'Release configuration missing or invalid',
    });
  }
  const config = releaseStatus.config;
  // 当前 release.json 标记 apkReleased=false（新包尚未用原密钥签名）时，绝不回退分发旧版本安装包。
  if (!config.apkReleased || !config.apkSha256) {
    return res.status(404).json({
      ok: false,
      code: 'APK_NOT_RELEASED',
      message: `Android ${config.apkVersion} (versionCode ${config.apkVersionCode}) 安装包尚待使用原发布密钥签名后发布，请稍后再试；网页端不受影响。`,
    });
  }
  const canonicalApkFilename = `kaogong-potato-v${config.apkVersion}.apk`;
  const appRootApk = path.resolve(__dirname, '..', 'release', 'apk', canonicalApkFilename);
  const cwdApk = path.resolve(process.cwd(), 'release', 'apk', canonicalApkFilename);
  const canonicalApkPath = fs.existsSync(appRootApk) ? appRootApk : cwdApk;

  if (!fs.existsSync(canonicalApkPath)) {
    return res.status(404).json({
      ok: false,
      code: 'APK_NOT_FOUND',
      message: 'APK 安装包尚未放置于 release/apk 目录。',
    });
  }

  try {
    const actualSha256 = await getOrComputeApkSha256(canonicalApkPath);

    // 关键防御：运行时强校验安装包哈希，阻断磁盘被篡改/木马替换后的病毒传播
    if (actualSha256 !== config.apkSha256) {
      console.error(
        `🚨 [CRITICAL_SECURITY_ALERT] 磁盘 APK 文件哈希不匹配！疑似文件被篡改或木马替换！期望: ${config.apkSha256}, 实际: ${actualSha256}`
      );
      return res.status(500).json({
        ok: false,
        code: 'INTEGRITY_VIOLATION',
        message: '安全警告：安装包完整性校验不匹配，已拒绝传输以防恶意代码传播。',
      });
    }

    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', `attachment; filename="${canonicalApkFilename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, private');

    // 采用异步只读文件流发送，避免全量读入内存打爆 V8 堆内存导致 OOM 崩溃
    const stream = fs.createReadStream(canonicalApkPath);
    stream.pipe(res);
  } catch (err) {
    console.error('读取或分发 APK 异常:', err);
    res.status(500).json({
      ok: false,
      code: 'APK_READ_ERROR',
      message: '读取安装包发生异常，请稍后重试',
    });
  }
});

// ----------------------------------------------------------------------
// Auth Endpoints (/api/auth/*)
// ----------------------------------------------------------------------

app.post('/api/auth/register', async (req: Request, res: Response) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!checkEndpointRateLimit('register', ip, 30)) {
    res.status(429).json({ ok: false, code: 'TOO_MANY_ATTEMPTS', message: '注册尝试过于频繁，请稍后再试' });
    return;
  }
  recordEndpointAttempt('register', ip);

  const { username, password, nickname, inviteCode } = req.body || {};

  if (!username || typeof username !== 'string' || username.trim().length < 2) {
    res.status(400).json({ ok: false, code: 'INVALID_USERNAME', message: '用户名至少需要 2 位字符' });
    return;
  }
  // Enforce consistent 8-character minimum password policy across register and reset (Defect H)
  if (!password || typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ ok: false, code: 'INVALID_PASSWORD', message: '密码长度至少需要 8 位字符' });
    return;
  }
  if (!inviteCode || typeof inviteCode !== 'string') {
    res.status(400).json({ ok: false, code: 'MISSING_INVITE', message: '本系统为专属邀请制，请输入有效的注册邀请码' });
    return;
  }

  const cleanUsername = username.trim().toLowerCase();
  const cleanNickname = (nickname && typeof nickname === 'string' && nickname.trim()) ? nickname.trim() : cleanUsername;
  const db = getDb();

  // Pre-check invite code and username existence to fail fast before hashing
  const invite = db.prepare('SELECT * FROM invites WHERE code = ? AND used_at IS NULL').get(inviteCode) as any;
  if (!invite) {
    res.status(400).json({ ok: false, code: 'INVALID_INVITE_CODE', message: '邀请码无效或已被使用' });
    return;
  }

  const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername);
  if (existingUser) {
    res.status(409).json({ ok: false, code: 'USERNAME_EXISTS', message: '该用户名已被注册，请尝试其他用户名' });
    return;
  }

  // Hash password outside transaction
  const passwordHash = await hashPassword(password);
  const userId = `u_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const nowIso = new Date().toISOString();
  const currentGen = getCurrentGenerationId();

  // Create clean seed AppState for the new user (14 books, 7 courses, 22 library items, 0 progress, empty history)
  const seedState = createSeedState(cleanUsername, cleanNickname);
  const seedStateJson = JSON.stringify(seedState);

  // Atomic Registration Transaction:
  // 1. Conditionally claim invite (strictly verify used_at IS NULL and changes === 1 to defeat race double-spends)
  // 2. Insert user
  // 3. Atomically seed user workspace with revision: 1 and seed_version: 1
  try {
    const registerTx = db.transaction(() => {
      const inviteUpdate = db.prepare(`
        UPDATE invites SET used_by = ?, used_at = ? WHERE code = ? AND used_at IS NULL
      `).run(userId, nowIso, inviteCode);

      if (inviteUpdate.changes !== 1) {
        throw new Error('INVITE_ALREADY_USED');
      }

      db.prepare(`
        INSERT INTO users (id, username, nickname, password_hash, role, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'user', 1, ?, ?)
      `).run(userId, cleanUsername, cleanNickname, passwordHash, nowIso, nowIso);

      // R10：注册事务同时落库 init_choice='default'，服务端明确记录"已使用官方种子"，
      // 客户端换设备后无需依赖 localStorage 再次询问。
      db.prepare(`
        INSERT INTO workspaces (user_id, revision, generation_id, state_json, schema_version, seed_version, init_choice, updated_at)
        VALUES (?, 1, ?, ?, 3, 1, 'default', ?)
      `).run(userId, currentGen, seedStateJson, nowIso);
    });

    registerTx();
  } catch (err: any) {
    if (err.message === 'INVITE_ALREADY_USED') {
      res.status(400).json({ ok: false, code: 'INVALID_INVITE_CODE', message: '邀请码已被其他用户同时认领或已失效' });
      return;
    }
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || String(err).includes('UNIQUE')) {
      res.status(409).json({ ok: false, code: 'USERNAME_EXISTS', message: '该用户名已被注册，请尝试其他用户名' });
      return;
    }
    throw err;
  }

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

// 预先生成一条固定哑哈希，消除用户不存在时的 Argon2id 时序侧信道
const DUMMY_HASH = '$argon2id$v=19$m=65536,t=3,p=1$c29tZXNhbHQ$RdescudvJCsgqlfreSAeYQ';

app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { username, password } = req.body || {};
  const ip = req.ip || req.socket.remoteAddress || 'unknown';

  if (!username || !password) {
    res.status(400).json({ ok: false, code: 'BAD_REQUEST', message: '请输入用户名和密码' });
    return;
  }

  const cleanUsername = String(username).trim().toLowerCase();

  // 双桶防爆破校验 (账号桶 + IP 桶)
  if (!checkLoginRateLimit(ip, cleanUsername)) {
    res.status(429).json({ ok: false, code: 'TOO_MANY_ATTEMPTS', message: '密码错误次数过多，请 15 分钟后再试' });
    return;
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(cleanUsername) as any;

  // 关键防御：无论用户是否存在，均执行 verifyPassword，时延恒定消除用户名枚举与算力差
  const targetHash = user ? user.password_hash : DUMMY_HASH;
  const matches = await verifyPassword(targetHash, String(password));

  if (!user || user.is_active !== 1 || !matches) {
    recordLoginFailure(ip, cleanUsername);
    res.status(401).json({ ok: false, code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' });
    return;
  }

  resetLoginFailure(ip, cleanUsername);

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
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!checkEndpointRateLimit('reset', ip, 30)) {
    res.status(429).json({ ok: false, code: 'TOO_MANY_ATTEMPTS', message: '密码重置尝试过于频繁，请稍后再试' });
    return;
  }
  recordEndpointAttempt('reset', ip);

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
  const { expectedRevision, requestId, schemaVersion, generationId, state, reason, expectedContentHash } = req.body || {};

  if (typeof expectedRevision !== 'number' || !requestId || !state) {
    res.status(400).json({ ok: false, code: 'INVALID_SYNC_PAYLOAD', message: '同步快照请求参数不完整' });
    return;
  }

  const result = syncUserWorkspace({
    userId: req.user!.id,
    expectedRevision,
    expectedContentHash: typeof expectedContentHash === 'string' ? expectedContentHash : undefined,
    requestId: String(requestId),
    schemaVersion: schemaVersion || 3,
    generationId: String(generationId || ''),
    state,
    reason,
  });

  res.status(result.status).json(result);
});

/**
 * R10：空资料库一次性初始化选择（服务端持久化）。
 * - 'default'：事务内按稳定 seed ID 合并官方 14/7/22 资料库（保留自定义项与全部进度），revision+1；
 * - 'blank'：保留当前状态，仅持久化选择，revision+1；
 * - 已选择过 => 幂等返回当前 state（alreadyApplied: true），不会二次 bump。
 * 需要登录 + CSRF（requireAuth 对 POST 强制执行 CSRF 校验）。
 */
app.post('/api/workspace/init-choice', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const rawChoice = req.body?.choice;
  if (rawChoice !== 'default' && rawChoice !== 'blank') {
    res.status(400).json({ ok: false, code: 'INVALID_INIT_CHOICE', message: "choice 必须为 'default' 或 'blank'" });
    return;
  }

  const result = applyWorkspaceInitChoice({
    userId: req.user!.id,
    choice: rawChoice as InitChoice,
    username: req.user!.username,
    nickname: req.user!.nickname,
  });

  const status = result.status || (result.ok ? 200 : 400);
  res.status(status).json(result);
});

// ----------------------------------------------------------------------
// Media Endpoints (/api/media/*)
// ----------------------------------------------------------------------

const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

app.post('/api/media/upload', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!checkEndpointRateLimit(`upload:${req.user!.id}`, ip, 20, 60 * 1000)) {
    res.status(429).json({ ok: false, code: 'TOO_MANY_UPLOADS', message: '图片上传过于频繁，请稍候片刻再传' });
    return;
  }
  recordEndpointAttempt(`upload:${req.user!.id}`, ip, 60 * 1000);
  uploadMiddleware.single('file')(req, res, next);
}, (req: AuthenticatedRequest, res: Response) => {
  if (!req.file) {
    res.status(400).json({ ok: false, code: 'NO_FILE', message: '未检测到上传文件' });
    return;
  }

  const result = saveUserMedia(req.user!.id, req.file.buffer, req.file.originalname);
  if (!result.ok) {
    const status = result.status || (result.code === 'QUOTA_EXCEEDED' ? 413 : 400);
    res.status(status).json(result);
    return;
  }

  // R06：同账号同 sha256 重复上传返回既有记录（deduplicated: true），不重复占用配额；
  // url 为稳定读取地址 /api/media/<id>，前端可直接作为工作区媒体引用。
  res.json({
    ok: true,
    media: result.media,
    url: `/api/media/${result.media!.id}`,
    deduplicated: result.deduplicated === true,
    message: result.deduplicated ? '图片已存在，直接复用既有附件' : '图片上传成功',
  });
});

app.get('/api/media/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const mediaId = String(req.params.id);
  const media = getUserMediaFile(req.user!.id, mediaId);
  if (!media) {
    res.status(404).json({ ok: false, code: 'NOT_FOUND', message: '图片不存在或无权访问' });
    return;
  }

  res.setHeader('Content-Type', media.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  const stream = fs.createReadStream(media.diskPath);
  stream.on('error', (streamErr) => {
    console.error(`媒体流读取失败 [${mediaId}]:`, streamErr);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, code: 'MEDIA_STREAM_ERROR', message: '无法读取媒体附件' });
    } else {
      res.end();
    }
  });
  stream.pipe(res);
});

app.delete('/api/media/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const mediaId = String(req.params.id);
  const result = deleteUserMedia(req.user!.id, mediaId);
  if (!result.ok) {
    res.status(result.status || 400).json(result);
    return;
  }
  res.json({ ok: true, message: result.message || '图片已安全删除' });
});

// ----------------------------------------------------------------------
// User Backup & Version History Endpoints (/api/backups/*)
// ----------------------------------------------------------------------

app.get('/api/backups/export', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const backup = getUserBackupExport(req.user!.id);
  if (!backup) {
    res.status(404).json({ ok: false, code: 'EMPTY_WORKSPACE', message: '暂无可导出的工作台数据' });
    return;
  }
  const timestamp = Date.now();
  const safeAscii = `kaogong_backup_${req.user!.id}_${timestamp}.json`;
  const utf8Filename = `考公备考备份_${req.user!.username}_${timestamp}.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // RFC 5987 compliant Content-Disposition handling Unicode/Chinese usernames safely (Defect J)
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(utf8Filename)}`
  );
  res.json(backup);
});

app.get('/api/backups/history', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const history = getUserWorkspaceHistory(req.user!.id);
  res.json({ ok: true, history });
});

app.post('/api/backups/restore-history', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const { historyId } = req.body || {};
  if (!historyId) {
    res.status(400).json({ ok: false, code: 'BAD_REQUEST', message: '请提供要恢复的历史快照 ID' });
    return;
  }

  const result = restoreUserFromHistory(req.user!.id, String(historyId));
  res.status(result.status).json(result);
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

// 全局 4 参数标准错误拦截中间件 (彻底消除堆栈、文件系统物理路径外泄与 HTML 错误页渗透)
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  const requestId = (res.getHeader('x-request-id') as string) || 'unknown';
  console.error(`🚨 [SYSTEM_ERROR] [${requestId}] ${req.method} ${req.originalUrl}:`, err.message || err);

  let statusCode = 500;
  let errorCode = 'INTERNAL_SERVER_ERROR';
  let clientMessage = '服务器内部繁忙，请稍后再试';

  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    statusCode = 400;
    errorCode = 'BAD_JSON_PAYLOAD';
    clientMessage = '请求数据格式错误，无法解析 JSON 载荷';
  } else if (err.code === 'LIMIT_FILE_SIZE') {
    statusCode = 413;
    errorCode = 'FILE_TOO_LARGE';
    clientMessage = '上传的文件体积超出系统允许的上限 (10MB)';
  } else if (err.status && typeof err.status === 'number') {
    statusCode = err.status;
  }

  res.status(statusCode).json({
    ok: false,
    code: errorCode,
    message: clientMessage,
    requestId,
  });
});

export default app;
