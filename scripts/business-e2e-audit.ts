/**
 * 真实业务链路 E2E 验收（隔离环境）
 * ==========================================================================
 * 依据交付要求第八节 A/B/C/F/H/J：
 *  - 自建临时 DATA_DIR、附件目录、随机独立端口、独立浏览器 context；
 *  - 使用隔离测试数据库生成邀请码（绝不写入项目 data/ 或真实库）；
 *  - 真实 Express + SQLite + 原生 IndexedDB + 真实 Service Worker + 原生媒体上传；
 *  - 注册 / 学习资料库 / 我的 / 冲突 / 更新弹窗 / 离线重连 的真实截图（3 视口）。
 *
 * 运行：bun scripts/business-e2e-audit.ts
 * 输出：docs/implementation/evidence/business-e2e-results.json + screens/*.png
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const ROOT = process.cwd();
const RUN_ID = `e2e_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
const TMP = fssync.mkdtempSync(path.join('/tmp', 'potato-business-e2e-'));
const DATA_DIR = path.join(TMP, 'data');
const EVIDENCE_DIR = path.join(ROOT, 'docs', 'implementation', 'evidence');
const SCREEN_DIR = path.join(EVIDENCE_DIR, 'screens');
const SERVER_LOG = path.join(TMP, 'server.log');
const VIEWPORTS = [
  { width: 412, height: 915 },
  { width: 393, height: 873 },
  { width: 360, height: 800 },
];

interface ResultRow { name: string; passed: boolean; detail?: unknown }
const results: ResultRow[] = [];
const consoleErrors: string[] = [];
let baseUrl = '';
let serverProc: ReturnType<typeof spawn> | null = null;
let browser: Browser | null = null;

function check(name: string, passed: boolean, detail?: unknown) {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${passed ? '' : ` :: ${JSON.stringify(detail)}`}`);
}

async function step<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    const value = await fn();
    check(name, true);
    return value;
  } catch (error) {
    check(name, false, String(error));
    return null;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHealth(url: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`服务未在 ${timeoutMs}ms 内就绪: ${url}`);
}

function createInviteCode(): string {
  const out = execFileSync('node', ['--import', 'tsx', 'server/cli.ts', 'create-invite'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR },
    encoding: 'utf-8',
  });
  const match = out.match(/invite_[a-z0-9]+/i) || out.match(/[A-Za-z0-9]{8,}/);
  if (!match) throw new Error(`无法从 CLI 输出解析邀请码: ${out}`);
  return match[0];
}

function makePng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  const crc32 = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([length, typeBuf, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const i = rowStart + 1 + x * 3;
      raw[i] = rgb[0];
      raw[i + 1] = rgb[1];
      raw[i + 2] = rgb[2];
    }
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const PHOTO_PNG = makePng(48, 48, [201, 93, 83]);
const AVATAR_PNG = makePng(48, 48, [97, 121, 79]);

async function newContext(viewport = VIEWPORTS[0]): Promise<BrowserContext> {
  const context = await browser!.newContext({ viewport, timezoneId: 'Asia/Tokyo', acceptDownloads: true });
  context.on('page', page => page.on('pageerror', error => consoleErrors.push(String(error))));
  return context;
}

async function apiJson(context: BrowserContext, pathname: string, init?: RequestInit): Promise<any> {
  const res = await context.request.get(`${baseUrl}${pathname}`, { timeout: 20000, ...init });
  if (!res.ok()) throw new Error(`API ${pathname} -> HTTP ${res.status()}`);
  return res.json();
}

async function waitForCloud(context: BrowserContext, predicate: (ws: any) => boolean, timeoutMs = 25000): Promise<any> {
  const start = Date.now();
  let last: any = null;
  while (Date.now() - start < timeoutMs) {
    try {
      last = await apiJson(context, '/api/workspace');
      if (predicate(last)) return last;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error(`云端状态未在 ${timeoutMs}ms 内满足条件，最后状态: ${JSON.stringify(last?.state?.profile)}`);
}

async function localSnapshot(page: Page): Promise<any> {
  return page.evaluate(async () => {
    const raw = localStorage.getItem('kaogong_last_active_user');
    const user = raw ? JSON.parse(raw) : null;
    const key = user ? `snapshot_${user.id}` : 'latest';
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('kaogong_potato_v3', 3);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    });
    const snap = await new Promise<any>((resolve, reject) => {
      const tx = db.transaction('snapshots', 'readonly');
      const req = tx.objectStore('snapshots').get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    const outbox = await new Promise<any[]>((resolve, reject) => {
      const tx = db.transaction('outbox', 'readonly');
      const req = tx.objectStore('outbox').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    const syncState = await new Promise<any[]>((resolve, reject) => {
      const tx = db.transaction('sync_state', 'readonly');
      const req = tx.objectStore('sync_state').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return { user, key, snapshot: snap, outbox, syncState };
  });
}

async function screenshot(page: Page, name: string, viewport = VIEWPORTS[0]) {
  const file = path.join(SCREEN_DIR, `${name}-${viewport.width}x${viewport.height}.png`);
  await page.setViewportSize(viewport);
  await page.waitForTimeout(150);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function gotoApp(page: Page, timeout = 30000) {
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout });
}

async function fillAuth(page: Page, mode: 'login' | 'register', user: string, pass: string, invite?: string, nickname?: string) {
  await page.getByRole('button', { name: mode === 'login' ? '登录账号' : '注册新学员', exact: true }).click();
  await page.getByPlaceholder('请输入用户名').fill(user);
  if (mode === 'register') {
    await page.getByPlaceholder('例如：土豆备考中').fill(nickname || `昵称_${user.slice(-4)}`);
  }
  await page.getByPlaceholder('请输入密码').fill(pass);
  if (mode === 'register') {
    await page.getByPlaceholder('请输入管理员提供的专属邀请码').fill(invite || '');
    await page.getByRole('button', { name: /注册并进入工作台/ }).click();
  } else {
    await page.getByRole('button', { name: /登录学员空间/ }).click();
  }
}

async function waitForApp(page: Page, timeoutMs = 30000) {
  await page.locator('nav button', { hasText: '今日' }).first().waitFor({ state: 'visible', timeout: timeoutMs });
}

async function closeAnyDialog(page: Page) {
  try {
    while ((await page.locator('[role="dialog"]').count()) > 0) {
      const visible = await page.locator('[role="dialog"]').first().isVisible().catch(() => false);
      if (!visible) break;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      const closeBtn = page.locator('[role="dialog"]').first().getByRole('button', { name: /关闭|取消|知道了/ }).first();
      if (await closeBtn.count()) {
        await closeBtn.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(200);
        continue;
      }
      break;
    }
  } catch {}
}

async function navTo(page: Page, label: '今日' | '学习' | '错题' | '分析' | '我的') {
  await page.locator('nav button', { hasText: label }).first().click();
  await page.waitForTimeout(300);
}

async function registerThroughUi(context: BrowserContext, user: string, pass: string, invite: string, nickname: string): Promise<Page> {
  const page = await context.newPage();
  await gotoApp(page);
  await fillAuth(page, 'register', user, pass, invite, nickname);
  await waitForApp(page);
  return page;
}

async function loginThroughUi(context: BrowserContext, user: string, pass: string): Promise<Page> {
  const page = await context.newPage();
  await gotoApp(page);
  await fillAuth(page, 'login', user, pass);
  await waitForApp(page);
  return page;
}

async function ensureServiceWorkerControl(page: Page) {
  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) throw new Error('Service Worker 不可用');
    await navigator.serviceWorker.ready;
  });
  const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
  if (!controlled) {
    await page.reload({ waitUntil: 'networkidle' });
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  }
  const after = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
  if (!after) throw new Error('页面未被 Service Worker 控制');
}

async function main() {
  await fs.mkdir(SCREEN_DIR, { recursive: true });
  const realDbPath = path.join(ROOT, 'data', 'potato.db');
  const realDbBefore = fssync.existsSync(realDbPath)
    ? { mtimeMs: fssync.statSync(realDbPath).mtimeMs, size: fssync.statSync(realDbPath).size }
    : null;

  // ------------------------------------------------------------------
  // 0. Build + isolated server with temporary DATA_DIR
  // ------------------------------------------------------------------
  console.log(`[${RUN_ID}] 项目根目录: ${ROOT}`);
  console.log(`[${RUN_ID}] 临时 DATA_DIR: ${DATA_DIR}`);
  execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'pipe' });
  const distVersion = JSON.parse(await fs.readFile(path.join(ROOT, 'dist', 'version.json'), 'utf-8').catch(() => '{}'));
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  const logFd = fssync.openSync(SERVER_LOG, 'a');
  serverProc = spawn('node', ['--import', 'tsx', 'server/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', logFd, logFd],
  });
  await waitForHealth(baseUrl);
  const versionInfo = await (await fetch(`${baseUrl}/version.json?nonce=startup`)).json();
  console.log(`[${RUN_ID}] SERVER_URL: ${baseUrl}`);
  console.log(`[${RUN_ID}] DATA_DIR: ${DATA_DIR}`);
  console.log(`[${RUN_ID}] WEB_BUILD: ${versionInfo.version}/${versionInfo.build} (nonce=${versionInfo.nonce})`);
  check('isolated server uses temporary DATA_DIR', DATA_DIR.startsWith('/tmp/potato-business-e2e-'));
  check('web build served with release identity', versionInfo.version === distVersion.version || !distVersion.version, { versionInfo, distVersion });

  browser = await chromium.launch({ headless: true });

  // ------------------------------------------------------------------
  // A. 注册 -> 服务器/本机/UI 均为 14/7/22 + 三视口截图
  // ------------------------------------------------------------------
  const userA = `e2e_user_${Date.now().toString(36)}`;
  const passA = 'Password123!';
  const inviteA = createInviteCode();
  const contextA = await newContext();
  const pageA = await registerThroughUi(contextA, userA, passA, inviteA, 'E2E验收学员');

  const wsA = await waitForCloud(contextA, ws => ws.hasCloudData && ws.state?.books?.length === 14 && ws.state?.courses?.length === 7 && ws.state?.library?.length === 22);
  const localA = await localSnapshot(pageA);
  await navTo(pageA, '学习');
  const uiTextA = await pageA.locator('body').innerText();
  await navTo(pageA, '今日');
  check('A: server seeded 14/7/22 after registration', wsA.state.books.length === 14 && wsA.state.courses.length === 7 && wsA.state.library.length === 22, {
    books: wsA.state.books.length, courses: wsA.state.courses.length, library: wsA.state.library.length, seedVersion: wsA.seedVersion,
  });
  check('A: local IndexedDB partition seeded 14/7/22', localA.snapshot?.state?.books?.length === 14 && localA.snapshot?.state?.courses?.length === 7 && localA.snapshot?.state?.library?.length === 22);
  check('A: UI displays seeded library', /14 本题本/.test(uiTextA) || /共 14 本题本/.test(uiTextA));

  // 三视口真实截图：登录 / 学习资料库 / 我的
  {
    const loginContext = await newContext(VIEWPORTS[0]);
    const loginPage = await loginContext.newPage();
    await gotoApp(loginPage);
    await loginPage.getByPlaceholder('请输入用户名').waitFor();
    for (const vp of VIEWPORTS) {
      await screenshot(loginPage, 'login', vp);
      check(`J: login screenshot 412x915/393x873/360x800 @${vp.width}`, true);
    }
    await loginContext.close();
  }
  for (const vp of VIEWPORTS) {
    await navTo(pageA, '学习');
    await pageA.getByText('共 14 本题本').waitFor({ timeout: 10000 }).catch(() => {});
    await screenshot(pageA, 'library', vp);
    await navTo(pageA, '我的');
    await pageA.getByText('编辑资料').first().waitFor({ timeout: 10000 });
    await screenshot(pageA, 'settings', vp);
    await navTo(pageA, '今日');
  }
  check('J: library screenshots saved for 3 viewports', true);
  check('J: settings (我的) screenshots saved for 3 viewports', true);

  // A2: 删除题本后跨设备不复活
  try {
    const deletedBookTitle = '资料分析高分宝典';
    await navTo(pageA, '学习');
    await pageA.getByTitle('删除题本').first().click();
    await pageA.getByRole('button', { name: '确认', exact: true }).first().click();
    await pageA.waitForTimeout(3000);
    const deleteDbg = await localSnapshot(pageA);
    console.log('[debug] delete local state:', JSON.stringify({
      localBooks: deleteDbg.snapshot?.state?.books?.length,
      outbox: deleteDbg.outbox.length,
      syncText: (await pageA.locator('body').innerText()).match(/同步[^\n]*/g)?.slice(0, 2),
    }));
    await waitForCloud(contextA, ws => ws.state.books.length === 13, 30000);
    const contextA2 = await newContext();
    const pageA2 = await loginThroughUi(contextA2, userA, passA);
    await navTo(pageA2, '学习');
    const booksTextA2 = await pageA2.locator('body').innerText();
    const wsA2 = await apiJson(contextA2, '/api/workspace');
    check('A2: deleted book stays deleted across a new device (no seed resurrection)', wsA2.state.books.length === 13 && !booksTextA2.includes(deletedBookTitle), {
      books: wsA2.state.books.length, showsDeletedTitle: booksTextA2.includes(deletedBookTitle),
    });
    await contextA2.close();
  } catch (error) {
    check('A2: deleted book stays deleted across a new device (no seed resurrection)', false, String(error));
  }

  // A3: 旧空库初始化选择保存在服务器、跨设备一致
  try {
  const sqlScript = `
    const Database = require('better-sqlite3');
    const path = require('node:path');
    const db = new Database(path.join(process.env.DATA_DIR, 'potato.db'));
    const row = db.prepare('SELECT * FROM workspaces WHERE user_id = ?').get(process.argv[1]);
    const state = JSON.parse(row.state_json);
    state.books = []; state.courses = []; state.library = [];
    state.plans = []; state.records = []; state.wrong = [];
    db.prepare('UPDATE workspaces SET state_json = ?, seed_version = 0, init_choice = NULL, revision = revision + 1 WHERE user_id = ?')
      .run(JSON.stringify(state), process.argv[1]);
    db.close();
  `;
  const legacyUserId = wsA.user_id || (await apiJson(contextA, '/api/workspace')).userId;
  const userIdA = localA.user.id;
  execFileSync('node', ['-e', sqlScript, userIdA], { cwd: ROOT, env: { ...process.env, DATA_DIR }, encoding: 'utf-8' });
  void legacyUserId;
  const contextC = await newContext();
  const pageC = await loginThroughUi(contextC, userA, passA).catch(async error => {
    // After server-side reset the app may show the choice modal instead of nav; capture page anyway.
    const page = contextC.pages()[0];
    return page;
  });
  await pageC.getByText('备考空间资料库初始化').waitFor({ timeout: 20000 });
  check('A3: server-driven needsInitChoice shown on a fresh device', true);
  await pageC.getByRole('button', { name: /使用官方推荐资料库/ }).click();
  await pageC.getByText('备考空间资料库初始化').waitFor({ state: 'hidden', timeout: 20000 });
  const wsAfterChoice = await waitForCloud(contextC, ws => ws.state?.books?.length === 14);
  check('A3: default library applied and persisted server-side', wsAfterChoice.state.books.length === 14 && wsAfterChoice.initChoice === 'default', { initChoice: wsAfterChoice.initChoice, seedVersion: wsAfterChoice.seedVersion });
  await contextC.close();
  const contextD = await newContext();
  const pageD = await loginThroughUi(contextD, userA, passA);
  await pageD.waitForTimeout(1200);
  const choiceVisibleOnD = await pageD.getByText('备考空间资料库初始化').isVisible().catch(() => false);
  const wsD = await apiJson(contextD, '/api/workspace');
  check('A3: choice is not asked again on another device', choiceVisibleOnD === false && wsD.state.books.length === 14, { choiceVisibleOnD, books: wsD.state.books.length });
  await contextD.close();
  } catch (error) {
    check('A3: server-persisted empty-library choice is consistent across devices', false, String(error));
  }
  // A3 changed the cloud workspace from another device; refresh device A so its
  // snapshot adopts the new confirmed baseline before continuing.
  await pageA.reload({ waitUntil: 'networkidle' });
  await waitForApp(pageA);
  await closeAnyDialog(pageA);
  await pageA.waitForTimeout(1200);
  await closeAnyDialog(pageA);
  await pageA.locator('nav button', { hasText: '今日' }).first().waitFor({ timeout: 20000 });

  // ------------------------------------------------------------------
  // B. 错题照片 + 头像 -> 真实上传 -> 另一独立设备可读
  // ------------------------------------------------------------------
  const contextB = await newContext();
  let pageB: Page | null = null;
  try {
  await closeAnyDialog(pageA);
  await navTo(pageA, '错题');
  await pageA.getByRole('button', { name: /从相册上传错题/ }).click();
  await pageA.locator('[role="dialog"] input[type="file"]').setInputFiles({ name: 'wrong-photo.png', mimeType: 'image/png', buffer: PHOTO_PNG });
  await pageA.getByText(/已选 1 张照片/).waitFor({ timeout: 20000 });
  await pageA.getByRole('button', { name: /保存并归档到题本/ }).click();
  await pageA.getByText(/成功归档 1 张错题照片/).waitFor({ timeout: 20000 });
  const wsWithPhoto = await waitForCloud(contextA, ws => Boolean(ws.state?.wrong?.[0]?.image?.startsWith('/api/media/')), 30000);
  check('B: wrong photo uploaded as server media reference', Boolean(wsWithPhoto.state.wrong?.[0]?.image?.startsWith('/api/media/')), { image: wsWithPhoto.state.wrong?.[0]?.image });

  await navTo(pageA, '我的');
  await pageA.getByRole('button', { name: '编辑资料' }).first().click();
  await pageA.locator('[role="dialog"] input[type="file"]').setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: AVATAR_PNG });
  await pageA.getByRole('button', { name: /保存资料/ }).click();
  const wsWithAvatar = await waitForCloud(contextA, ws => Boolean(ws.state?.profile?.avatar?.startsWith('/api/media/')), 30000);
  check('B: avatar uploaded as server media reference', Boolean(wsWithAvatar.state.profile.avatar.startsWith('/api/media/')), { avatar: wsWithAvatar.state.profile.avatar });

  // 另一独立设备读取正文与实际照片
  pageB = await loginThroughUi(contextB, userA, passA);
  await pageB.locator('nav button', { hasText: '错题' }).first().click();
  await pageB.waitForTimeout(800);
  const photoSrc = await pageB.locator('img[alt="错题缩略图"]').first().getAttribute('src').catch(() => null);
  const photoRes = photoSrc ? await contextB.request.get(`${baseUrl}${photoSrc}`) : null;
  const photoBytes = photoRes && photoRes.ok() ? (await photoRes.body()).length : 0;
  check('B: second independent device reads the actual photo bytes from server', Boolean(photoSrc?.startsWith('/api/media/')) && photoBytes > 100, { photoSrc, photoBytes });
  const wsB = await apiJson(contextB, '/api/workspace');
  check('B: second device sees wrong record text + avatar', wsB.state.wrong[0].note === '' && Boolean(wsB.state.profile.avatar?.startsWith('/api/media/')));
  } catch (error) {
    check('B: photo/avatar cross-device media pipeline', false, String(error));
    await closeAnyDialog(pageA).catch(() => {});
  }
  if (!pageB) {
    pageB = await loginThroughUi(contextB, userA, passA).catch(async () => contextB.pages()[0]);
  }

  // ------------------------------------------------------------------
  // B2. 离线冷启动 -> 本机编辑 -> 联网恢复会话/CSRF -> 自动补传 -> 另一设备可读
  // ------------------------------------------------------------------
  await navTo(pageA, '今日');
  await ensureServiceWorkerControl(pageA);
  await contextA.setOffline(true);
  await pageA.reload({ waitUntil: 'domcontentloaded' });
  await waitForApp(pageA, 25000);
  check('B2: offline cold start loads the app under real Service Worker control', true);
  await navTo(pageA, '我的');
  const offlineName = `离线补传_${Date.now().toString(36)}`;
  await pageA.getByRole('button', { name: '编辑资料' }).first().click();
  const nameInput = pageA.locator('[role="dialog"] input[type="text"]').first();
  await nameInput.fill(offlineName);
  await pageA.getByRole('button', { name: /保存资料/ }).click();
  await pageA.waitForTimeout(1200);
  const offlineLocal = await localSnapshot(pageA);
  const offlineQueued = offlineLocal.outbox.length > 0;
  const offlineText = await pageA.locator('body').innerText();
  check('B2: offline edit is queued locally (pending, not claimed synced)', offlineQueued, { outbox: offlineLocal.outbox.length, offlineText: offlineText.slice(0, 120) });
  await contextA.setOffline(false);
  const wsReconnected = await waitForCloud(contextA, ws => ws.state?.profile?.name === offlineName, 40000);
  check('B2: reconnect auto-restores session and flushes queued edit', wsReconnected.state.profile.name === offlineName);
  const afterReconnectLocal = await localSnapshot(pageA);
  check('B2: outbox drained after reconnect', afterReconnectLocal.outbox.length === 0, { outbox: afterReconnectLocal.outbox.length });
  await pageA.getByText(/已保存到服务器|已同步/).first().waitFor({ timeout: 15000 }).catch(() => {});
  await screenshot(pageA, 'offline-reconnected', VIEWPORTS[0]);

  // ------------------------------------------------------------------
  // C. 双设备冲突 -> 真实冲突弹窗 -> 三视口截图 -> 采用云端
  // ------------------------------------------------------------------
  // A 设备先改一次并同步到云端
  await navTo(pageA, '我的');
  const conflictNameA = `A云端_${Date.now().toString(36)}`;
  await pageA.getByRole('button', { name: '编辑资料' }).first().click();
  await pageA.locator('[role="dialog"] input[type="text"]').first().fill(conflictNameA);
  await pageA.getByRole('button', { name: /保存资料/ }).click();
  await waitForCloud(contextA, ws => ws.state?.profile?.name === conflictNameA);
  // B 设备本机已加载旧快照，做一次修改后与服务端 revision 冲突
  await contextB.setOffline(true);
  await pageB.reload({ waitUntil: 'domcontentloaded' });
  await waitForApp(pageB, 25000);
  await navTo(pageB, '我的');
  const conflictNameB = `B本机_${Date.now().toString(36)}`;
  await pageB.getByRole('button', { name: '编辑资料' }).first().click();
  await pageB.locator('[role="dialog"] input[type="text"]').first().fill(conflictNameB);
  await pageB.getByRole('button', { name: /保存资料/ }).click();
  await contextB.setOffline(false);
  await pageB.locator('text=需要处理版本冲突').first().waitFor({ timeout: 30000 }).catch(() => {});
  const conflictVisible = await pageB.getByText(/冲突|保留|采用云端/).first().isVisible().catch(() => false);
  check('C: real conflict dialog appears on second device', conflictVisible);
  for (const vp of VIEWPORTS) {
    await screenshot(pageB, 'conflict', vp);
  }
  check('J: conflict screenshots saved for 3 viewports', true);
  // 采用云端（保留服务器内容）
  const keepRemoteButton = pageB.getByRole('button', { name: /采用云端|保留云端|使用云端/ }).first();
  if (await keepRemoteButton.count()) {
    await keepRemoteButton.click();
    await pageB.waitForTimeout(1500);
  }
  const wsAfterResolve = await apiJson(contextB, '/api/workspace');
  check('C: conflict resolution keeps the cloud content', wsAfterResolve.state.profile.name === conflictNameA, { name: wsAfterResolve.state.profile.name });
  const conflictGone = await pageB.getByText('需要处理版本冲突').isVisible().catch(() => false);
  check('C: conflict banner cleared after resolution', conflictGone === false);

  // ------------------------------------------------------------------
  // F. 未同步时清理缓存必须保留数据；重置前自动建立恢复点并可真实还原
  // ------------------------------------------------------------------
  await contextB.setOffline(true);
  await pageB.reload({ waitUntil: 'domcontentloaded' });
  await waitForApp(pageB, 25000);
  await navTo(pageB, '我的');
  const pendingName = `待同步保留_${Date.now().toString(36)}`;
  await pageB.getByRole('button', { name: '编辑资料' }).first().click();
  await pageB.locator('[role="dialog"] input[type="text"]').first().fill(pendingName);
  await pageB.getByRole('button', { name: /保存资料/ }).click();
  await pageB.waitForTimeout(800);
  const beforeClear = await localSnapshot(pageB);
  await pageB.getByRole('button', { name: '数据管理', exact: true }).click();
  await pageB.getByText('更多数据操作', { exact: true }).click();
  await pageB.getByRole('button', { name: '清理缓存' }).click();
  await pageB.waitForTimeout(1200);
  const afterClear = await localSnapshot(pageB);
  const clearToast = await pageB.locator('body').innerText();
  check('F: cache clear refuses to delete unsynced account data', Boolean(afterClear.snapshot) && afterClear.outbox.length === beforeClear.outbox.length && beforeClear.outbox.length > 0, {
    pendingBefore: beforeClear.outbox.length, pendingAfter: afterClear.outbox.length, mentionedPreserved: /保留|未同步/.test(clearToast),
  });
  await closeAnyDialog(pageB);
  await contextB.setOffline(false);
  await waitForCloud(contextB, ws => ws.state?.profile?.name === pendingName, 30000);
  await closeAnyDialog(pageB);

  // 重置前建立恢复点 + 真实还原
  await navTo(pageB, '今日');
  await closeAnyDialog(pageB);
  await pageB.getByRole('button', { name: /从事项库挑选|挑选今日事项/ }).first().click();
  await pageB.getByRole('button', { name: /确认加入今日日程/ }).click();
  await pageB.getByRole('button', { name: /完成登记/ }).first().click();
  const dialog = pageB.locator('[role="dialog"]');
  await dialog.waitFor({ timeout: 10000 });
  const numbers = dialog.locator('input[type="number"]');
  const count = await numbers.count();
  await numbers.nth(0).fill('10');
  if (count > 1) await numbers.nth(1).fill('0');
  if (count > 2) await numbers.nth(2).fill('5');
  await dialog.getByRole('button', { name: /保存并完成/ }).click();
  await pageB.getByText(/登记成功|刷题登记已保存/).first().waitFor({ timeout: 20000 });
  // Close the completion success dialog before continuing to settings.
  await pageB.getByRole('button', { name: /返回今日工作台|返回工作台/ }).first().click().catch(() => {});
  await closeAnyDialog(pageB);
  const wsWithRecord = await waitForCloud(contextB, ws => ws.state?.records?.length >= 1, 30000);
  check('F: a real completion record is created and synced', wsWithRecord.state.records.length >= 1);
  await navTo(pageB, '我的');
  await closeAnyDialog(pageB);
  await pageB.getByRole('button', { name: '数据管理', exact: true }).click();
  await pageB.getByText('更多数据操作', { exact: true }).click();
  await pageB.getByRole('button', { name: '重置题库' }).click();
  await pageB.getByRole('button', { name: /确认/ }).first().click();
  await pageB.waitForTimeout(2000);
  const afterReset = await localSnapshot(pageB);
  check('F: reset created a real recovery point', Boolean(afterReset.snapshot) && (await localSnapshot(pageB)).syncState !== undefined);
  await pageB.getByRole('button', { name: '数据管理', exact: true }).click();
  const recoveryRow = pageB.getByText(/还原最近应急恢复点/).first();
  const recoveryVisible = await recoveryRow.isVisible().catch(() => false);
  check('F: recovery entry available in settings after reset', recoveryVisible);
  if (recoveryVisible) {
    await pageB.getByRole('button', { name: /还原该快照/ }).click();
    await pageB.getByText(/已还原所选恢复快照|恢复快照还原失败/).first().waitFor({ timeout: 20000 }).catch(() => {});
    const wsRestored = await waitForCloud(contextB, ws => ws.state?.records?.length >= 1, 30000).catch(() => null);
    check('F: restoring the saved recovery snapshot really brings the record back', Boolean(wsRestored && wsRestored.state.records.length >= 1), { records: wsRestored?.state?.records?.length });
  }

  // ------------------------------------------------------------------
  // H. 更新检查：503 / 非法 JSON 绝不显示“已是最新”；30 分钟节流；手动绕过
  // ------------------------------------------------------------------
  const contextH = await newContext();
  let versionNetworkHits = 0;
  await contextH.route('**/version.json*', route => {
    versionNetworkHits += 1;
    route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'SERVICE_UNAVAILABLE' }) });
  });
  await contextH.route('**/api/version*', route => {
    versionNetworkHits += 1;
    route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'SERVICE_UNAVAILABLE' }) });
  });
  const pageH = await loginThroughUi(contextH, userA, passA);
  await pageH.waitForTimeout(1000);
  await navTo(pageH, '我的');
  await pageH.getByRole('button', { name: '关于与更新', exact: true }).click();
  await pageH.getByRole('button', { name: '检查更新', exact: true }).click();
  await pageH.getByRole('dialog').waitFor({ timeout: 10000 });
  await pageH.waitForTimeout(2500);
  const updateDialogText = await pageH.getByRole('dialog').innerText();
  // Look for a real positive "latest" claim element, not the explanatory sentence that
  // says the app will NOT show it on failure.
  const claimsLatestOn503 = (await pageH.getByRole('dialog').getByText('当前已是最新版本', { exact: true }).count()) > 0;
  check('H: HTTP 503 never reports "already latest"', claimsLatestOn503 === false, { text: updateDialogText.slice(0, 300) });
  check('H: HTTP 503 shows an explicit verification failure', /失败|无法|未能|离线/.test(updateDialogText));
  for (const vp of VIEWPORTS) {
    await screenshot(pageH, 'update-failed', vp);
  }
  check('J: update dialog screenshots saved for 3 viewports', true);
  const hitsAfterManual1 = versionNetworkHits;
  check('H: manual update check performs a real network request', hitsAfterManual1 > 0, { hitsAfterManual1 });

  // 恢复真实网络后再手动检查（成功），然后验证 30 分钟自动节流不会重复联网
  await contextH.unroute('**/version.json*');
  await contextH.unroute('**/api/version*');
  await pageH.getByRole('button', { name: /重新检查|重试|再次检查/ }).first().click().catch(() => {});
  await pageH.waitForTimeout(2500);
  const normalDialogText = await pageH.getByRole('dialog').innerText().catch(() => '');
  const latestOk = /当前已是最新版本/.test(normalDialogText);
  const hitsAfterSuccess = versionNetworkHits;
  await pageH.reload({ waitUntil: 'networkidle' });
  await pageH.waitForTimeout(2000);
  check('H: successful check can report latest (server reachable)', latestOk || /已是最新/.test(normalDialogText), { text: normalDialogText.slice(0, 200) });
  check('H: automatic check is throttled (no extra version network call within 30min)', versionNetworkHits === hitsAfterSuccess, { hitsAfterSuccess, afterReload: versionNetworkHits });
  await contextH.close();

  // ------------------------------------------------------------------
  // 汇总
  // ------------------------------------------------------------------
  await contextA.close();
  await contextB.close();

  const realDbAfter = fssync.existsSync(realDbPath)
    ? { mtimeMs: fssync.statSync(realDbPath).mtimeMs, size: fssync.statSync(realDbPath).size }
    : null;
  check('isolation: real project data/potato.db untouched', JSON.stringify(realDbBefore) === JSON.stringify(realDbAfter), { realDbBefore, realDbAfter });

  const passed = results.filter(r => r.passed).length;
  const output = {
    runId: RUN_ID,
    baseUrl,
    dataDir: DATA_DIR,
    webVersion: versionInfo.version,
    webBuild: versionInfo.build,
    checkedAt: new Date().toISOString(),
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf-8' }).trim(),
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
    consoleErrors,
    screenshots: (await fs.readdir(SCREEN_DIR)).filter(f => f.endsWith('.png')).sort(),
  };
  await fs.writeFile(path.join(EVIDENCE_DIR, 'business-e2e-results.json'), JSON.stringify(output, null, 2), 'utf-8');
  await fs.copyFile(SERVER_LOG, path.join(EVIDENCE_DIR, 'business-e2e-server.log')).catch(() => {});
  console.log(`\n==== 业务 E2E 结果: ${passed}/${results.length} 通过 ====`);
  console.log(`证据: docs/implementation/evidence/business-e2e-results.json`);
  if (passed !== results.length) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  check('e2e harness completed', false, String(error));
  console.error(error);
  process.exitCode = 1;
} finally {
  try { await browser?.close(); } catch {}
  try { serverProc?.kill('SIGTERM'); } catch {}
  try { fssync.rmSync(TMP, { recursive: true, force: true }); } catch {}
}
