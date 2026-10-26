/**
 * 50-Screen Playwright verification harness — isolated rewrite.
 *
 * What this script guarantees (see docs/implementation/evidence/test-isolation-baseline.md):
 * - VISUAL MATRIX (3 viewports × 50 screens): rendered from `?preview=1`, i.e. the
 *   in-memory DEMO/preview state. It verifies layout/dialog/overflow/screenshot only
 *   and NEVER asserts that preview-mode interactions persisted to real IndexedDB.
 * - BUSINESS FLOWS: run in a dedicated browser context (native IndexedDB + real
 *   service worker) against a real Express server whose DATA_DIR is a disposable
 *   temp directory created by scripts/lib/isolated-env.ts. No `sqlite3` calls, no
 *   writes to the repository `data/` directory, no implicit default data dir.
 * - EXTERNAL URL MODE: when `VERIFY_URL` is provided the harness performs
 *   read-only checks only (login page / version / health / visual matrix) unless
 *   the URL is explicitly declared disposable with `VERIFY_ISOLATED=1`
 *   (and then `VERIFY_INVITE_CODE` must be supplied for the business phase).
 *
 * Run (isolated, full):
 *   bun scripts/verify-screens.ts
 * Run the evidence wrapper:
 *   bun scripts/run-isolated-audit.ts
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ALL_50_SCREENS } from '../src/components/views/ScreenInspectorModal';
import { BLANK_STATE, DEMO_STATE } from '../src/constants/initialData';
import {
  createIsolatedEnvironment,
  createRunId,
  diffDirectories,
  fetchJson,
  getGitFingerprint,
  getWebBuildStamp,
  resolveRepoRoot,
  snapshotDirectory,
  type DirectoryFingerprint,
  type IsolatedEnvironment,
  type WebBuildStamp,
} from './lib/isolated-env';

// ---------------------------------------------------------------------------
// Result bookkeeping
// ---------------------------------------------------------------------------
type CheckStatus = 'passed' | 'failed' | 'skipped';
interface CheckResult {
  name: string;
  status: CheckStatus;
  detail?: string;
  durationMs: number;
}
const results: CheckResult[] = [];

async function check(name: string, work: () => Promise<void>, timeoutMs = 180_000): Promise<void> {
  const started = Date.now();
  console.log(`[RUN ] ${name}`);
  let timer: NodeJS.Timeout | undefined;
  try {
    // Hard per-check ceiling so one wedged Playwright locator can never hang the
    // whole evidence run. Failing checks still run/report normally.
    await Promise.race([
      work(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`check timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    results.push({ name, status: 'passed', durationMs: Date.now() - started });
    console.log(`[PASS] ${name} (${Date.now() - started}ms)`);
  } catch (error) {
    results.push({ name, status: 'failed', detail: error instanceof Error ? (error.stack || error.message) : String(error), durationMs: Date.now() - started });
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function skip(name: string, reason: string): void {
  results.push({ name, status: 'skipped', detail: reason, durationMs: 0 });
  console.log(`[SKIP] ${name}: ${reason}`);
}

const count = (status: CheckStatus) => results.filter(result => result.status === status).length;

// ---------------------------------------------------------------------------
// Harness configuration
// ---------------------------------------------------------------------------
const REPO_ROOT = resolveRepoRoot();
const RUN_ID = process.env.VERIFY_RUN_ID || createRunId();
const SUPPLIED_URL = (process.env.VERIFY_URL || '').trim().replace(/\/+$/, '');
const EXTERNAL_WRITES_ALLOWED = process.env.VERIFY_ISOLATED === '1';
const WRITES_ALLOWED = Boolean(SUPPLIED_URL) ? EXTERNAL_WRITES_ALLOWED : true;
const MODE = !SUPPLIED_URL ? 'isolated-auto' : EXTERNAL_WRITES_ALLOWED ? 'external-isolated' : 'external-readonly';
const SCOPE = (process.env.VERIFY_SCOPE || 'all').toLowerCase();
const RUN_VISUAL = SCOPE === 'all' || SCOPE === 'visual';
const RUN_BUSINESS = SCOPE === 'all' || SCOPE === 'business';
const REBUILD = process.env.VERIFY_REBUILD !== '0';
const TMP_OUTPUT_DIR = path.join(os.tmpdir(), `potato-isolated-${RUN_ID}`, 'verified-screens');
const OUTPUT_DIR = path.resolve(process.env.VERIFY_OUTPUT_DIR || (SUPPLIED_URL ? TMP_OUTPUT_DIR : TMP_OUTPUT_DIR));
const EVIDENCE_DIR = process.env.VERIFY_EVIDENCE_DIR ? path.resolve(process.env.VERIFY_EVIDENCE_DIR) : '';
const EVIDENCE_STEM = process.env.VERIFY_EVIDENCE_STEM || 'test-isolation-baseline';

const REAL_DATA_DIR = path.join(REPO_ROOT, 'data');
const VIEWPORTS = [
  { width: 412, height: 915 },
  { width: 393, height: 873 },
  { width: 360, height: 800 },
];

const MODAL_SCREEN_IDS = new Set(
  ALL_50_SCREENS
    .filter(screen => !['today', 'library', 'books', 'courses', 'wrong', 'overall', 'monthly', 'settings', 'guest', 'today-empty', 'today-multi', 'states-empty', 'states-sync', 'states-form'].includes(screen.id))
    .map(screen => screen.id)
);

// Primary visible text expected for every screen in the 50-screen matrix.
// These are UI assertions for the preview (memory) matrix only.
const SCREEN_TEXT: Record<string, string | RegExp> = {
  today: '今日已累计学习', library: '事项库', books: /共\s*14\s*本题本/, courses: /共\s*7\s*门(网课|课程)/,
  wrong: '错题照片复盘', overall: '八科时间投入分布', monthly: '月度报表', settings: '编辑资料',
  focus: /正向计时中|计时已暂停/, 'add-plan': '从事项库挑选加入今天', 'complete-book': '刷题登记',
  'complete-course': '网课登记', 'complete-custom': '事项登记', 'complete-success': '登记成功',
  'book-edit': '修改题本数据', 'course-edit': '修改网课信息', 'custom-add': '添加自定义备考事项',
  'photo-import': '从相册上传错题照片', 'wrong-detail': '错题复盘大图详情', countdown: '考试日期',
  guest: /未登录|离线/, login: '登录学员专属空间', register: '注册新备考账号', sync: '云端同步管理',
  backup: '数据备份与恢复', profile: '编辑个人资料', 'today-empty': '今天还没有日程',
  'delete-confirm': '移除这项日程', 'book-add': '添加新题本', 'course-add': '添加新网课',
  'today-multi': '暂停', 'focus-paused': '计时已暂停', 'complete-course-success': '登记成功',
  'complete-custom-success': '登记成功', 'states-empty': '今天还没有安排日程',
  'states-sync': '正在同步最新学情', 'states-form': '校验', 'confirm-book': '删除题本确认',
  'confirm-course': '删除网课确认', 'confirm-photo': '删除错题照片确认', 'confirm-reset': '恢复初始数据危险确认',
  'confirm-import': '导入备份覆盖确认', 'confirm-upload': '上传本机数据覆盖云端',
  'confirm-pull': '从云端拉取覆盖本机', 'confirm-logout': '退出账号登录确认',
  'download-apk': 'Android 安装包', 'month-picker': '选择分析月份', 'overall-legend': '八科投入时间与图例详情',
  'focus-course': '听网课', 'focus-custom': '自定义事项',
};

// ---------------------------------------------------------------------------
// Generic page helpers
// ---------------------------------------------------------------------------
async function jumpToScreen(page: Page, id: string): Promise<void> {
  await page.getByRole('button', { name: '50屏矩阵', exact: true }).click();
  await page.locator(`[data-screen-id="${id}"]`).click();
  await page.getByRole('heading', { name: '50 画面全矩阵导航与验收直达' }).waitFor({ state: 'hidden' });
}

/**
 * Opens the preview shell and jumps to one screen. One bounded retry is allowed
 * for a navigation/mount hiccup (slow CI machine); a genuinely broken screen or
 * missing preview control fails both attempts and is reported as a real failure.
 */
async function openPreviewScreen(page: Page, baseUrl: string, id: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto(`${baseUrl}/?preview=1`, { waitUntil: 'load' });
      await page.getByRole('button', { name: '50屏矩阵', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
      await jumpToScreen(page, id);
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 1) {
        console.warn(`[retry] ${id} preview navigation hiccup, retrying once: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
        await page.waitForTimeout(500);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function layoutMetrics(page: Page) {
  return page.evaluate(() => {
    const mainEl = document.querySelector('main');
    const main = mainEl ? mainEl.getBoundingClientRect() : { height: innerHeight, top: 0, bottom: innerHeight };
    const navEl = document.querySelector('nav');
    const nav = navEl ? navEl.getBoundingClientRect() : { bottom: innerHeight, top: innerHeight };
    const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].map(el => {
      const rect = el.getBoundingClientRect();
      return { title: el.getAttribute('aria-label'), top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
    });
    return {
      width: innerWidth,
      height: innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      mainHeight: main.height,
      navBottom: nav.bottom,
      navTop: nav.top,
      dialogs,
    };
  });
}

async function waitForAppReady(page: Page): Promise<void> {
  await page.getByRole('button', { name: '今日', exact: true }).waitFor({ state: 'visible', timeout: 25_000 });
  await page.waitForFunction(
    () => {
      const nav = document.querySelector('nav');
      const todayButton = [...(nav?.querySelectorAll('button') ?? [])].find(button => button.textContent?.trim() === '今日');
      if (!(todayButton instanceof HTMLButtonElement) || todayButton.disabled) return false;
      return !document.body.innerText.includes('正在载入本地工作台');
    },
    undefined,
    { timeout: 25_000 }
  );
  await page.waitForTimeout(300);
}

// ---------------------------------------------------------------------------
// Phase 1 — 50-screen visual matrix (preview / memory state only)
// ---------------------------------------------------------------------------
async function runVisualMatrix(browser: Browser, baseUrl: string): Promise<void> {
  console.log(`\n=== PHASE visual: 50 screens x ${VIEWPORTS.length} viewports against ${baseUrl}?preview=1 (in-memory preview state) ===`);
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport,
      timezoneId: 'Asia/Tokyo',
      serviceWorkers: 'block', // preview matrix must not be influenced by SW caching
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(String(error)));

    await check(`normal viewport ${viewport.width}x${viewport.height}`, async () => {
      await page.goto(baseUrl, { waitUntil: 'load' });
      await page.getByRole('button', { name: '注册新学员', exact: true }).waitFor({ state: 'visible', timeout: 20_000 });
      assert.equal(await page.getByRole('button', { name: '50屏矩阵', exact: true }).count(), 0, 'preview inspector must not exist on the real entry');
      assert.match(await page.locator('body').innerText(), /登录学员空间|登录账号|登录学员专属空间/);
      const metrics = await layoutMetrics(page);
      assert(metrics.documentWidth <= viewport.width, `login page must not overflow horizontally: ${metrics.documentWidth} > ${viewport.width}`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, `normal-${viewport.width}.png`) });
    });

    for (const screen of ALL_50_SCREENS) {
      await check(`${viewport.width} ${screen.id}`, async () => {
        await openPreviewScreen(page, baseUrl, screen.id);
        const expected = SCREEN_TEXT[screen.id];
        await page.getByText(expected).first().waitFor({ state: 'visible', timeout: 8_000 });
        if (MODAL_SCREEN_IDS.has(screen.id)) {
          assert((await page.locator('[role="dialog"]').count()) > 0, `${screen.id} must activate a dialog`);
        }
        const metrics = await layoutMetrics(page);
        assert(metrics.documentWidth <= viewport.width, 'page must not overflow horizontally');
        assert(metrics.navBottom <= viewport.height + 1, 'navigation must fit viewport');
        for (const dialog of metrics.dialogs) {
          assert(
            dialog.top >= -1 && dialog.bottom <= viewport.height + 1 && dialog.left >= -1 && dialog.right <= viewport.width + 1,
            `${screen.id} dialog must fit viewport: ${JSON.stringify(dialog)}`
          );
        }
        const brokenImages = await page.locator('img').evaluateAll(images => images.filter(img => img.complete && img.naturalWidth === 0).map(img => img.src));
        assert.equal(brokenImages.length, 0, `images must load: ${brokenImages.join(', ')}`);
        await page.screenshot({ path: path.join(OUTPUT_DIR, `${viewport.width}-${screen.id}.png`) });

        const scrollables = page.locator('.overflow-y-auto');
        for (const element of await scrollables.all()) await element.evaluate(el => { el.scrollTop = el.scrollHeight; });
        if (MODAL_SCREEN_IDS.has(screen.id)) {
          const lastButton = page.locator('[role="dialog"]').last().getByRole('button').last();
          if (await lastButton.count()) {
            await lastButton.scrollIntoViewIfNeeded();
            const box = await lastButton.boundingBox();
            assert(box && box.y >= 0 && box.y + box.height <= viewport.height + 1, 'final modal action must be reachable');
          }
        }
        // Visual matrix is in-memory preview mode: no IndexedDB persistence assertions are made here.
      });
    }

    await check(`no page errors ${viewport.width}`, async () => assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`));
    await context.close();
    console.log(`Checked 50 screens at ${viewport.width}x${viewport.height}`);
  }
}

// ---------------------------------------------------------------------------
// Phase 2 — business flows against the real isolated server
// ---------------------------------------------------------------------------
interface BusinessSession {
  context: BrowserContext;
  page: Page;
  baseUrl: string;
  userId: string;
  username: string;
  nickname: string;
  generationId: string;
  serverRevision: number;
}

interface ApiResult<T = any> {
  status: number;
  body: T;
}

async function apiJson<T = any>(
  context: BrowserContext,
  url: string,
  opts: { method?: 'GET' | 'POST'; data?: unknown; headers?: Record<string, string> } = {}
): Promise<ApiResult<T>> {
  const method = opts.method || 'GET';
  const response = method === 'POST'
    ? await context.request.post(url, { data: opts.data, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } })
    : await context.request.get(url, { headers: opts.headers });
  const body = await response.json().catch(async () => ({ raw: await response.text() })) as T;
  return { status: response.status(), body };
}

async function getServerWorkspace(context: BrowserContext, baseUrl: string): Promise<ApiResult<any>> {
  return apiJson(context, `${baseUrl}/api/workspace`);
}

/** Reads the native partitioned IndexedDB snapshot for the currently logged-in user. */
async function readLocalSnapshot(page: Page): Promise<{ state: any; revision: number | null }> {
  return page.evaluate(async () => new Promise<any>((resolve, reject) => {
    const userRaw = localStorage.getItem('kaogong_last_active_user');
    const user = userRaw ? JSON.parse(userRaw) : null;
    const uid = user ? user.id : 'latest';
    // Open without forcing a schema version: src/utils/db.ts owns DB_VERSION and
    // may be changing while this harness runs, so the app must create/upgrade it.
    const req = indexedDB.open('kaogong_potato_v3');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('snapshots')) { db.close(); resolve({ state: null, revision: null }); return; }
      const tx = db.transaction('snapshots', 'readonly');
      const get = tx.objectStore('snapshots').get(`snapshot_${uid}`);
      get.onerror = () => { db.close(); reject(get.error); };
      get.onsuccess = () => {
        const record = get.result;
        db.close();
        if (!record) { resolve({ state: null, revision: null }); return; }
        resolve({ state: record.state, revision: record.revision ?? null });
      };
    };
  }));
}

/**
 * Writes a full native IndexedDB snapshot (business context only). The database
 * version is NOT pinned: the app has already created/upgraded it, and we open the
 * existing version so a concurrent schema bump in src/utils/db.ts cannot make the
 * harness fail with VersionError.
 */
async function writeLocalSnapshot(
  page: Page,
  input: { state: any; revision: number; userId: string; username: string; nickname: string; generationId: string }
): Promise<void> {
  await page.evaluate(async payload => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('kaogong_potato_v3');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const stores = ['snapshots', 'media', 'outbox', 'damaged_cache', 'sync_state'].filter(name => db.objectStoreNames.contains(name));
        if (!stores.includes('snapshots')) { db.close(); reject(new Error('snapshots object store is missing')); return; }
        const tx = db.transaction(stores, 'readwrite');
        const base = {
          state: payload.state,
          version: 3 as const,
          revision: payload.revision,
          confirmedRevision: payload.revision,
          generationId: payload.generationId,
          migratedFromV2: true,
          updatedAt: new Date().toISOString(),
        };
        tx.objectStore('snapshots').put({ ...base, key: `snapshot_${payload.userId}` });
        tx.objectStore('snapshots').put({ ...base, key: 'latest' });
        tx.objectStore('snapshots').put({ ...base, key: 'snapshot_latest' });
        for (const name of ['media', 'outbox', 'damaged_cache', 'sync_state']) {
          if (stores.includes(name)) tx.objectStore(name).clear();
        }
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
    localStorage.setItem('kaogong_last_active_user', JSON.stringify({
      id: payload.userId,
      username: payload.username,
      nickname: payload.nickname,
      role: 'user',
      lastActiveAt: new Date().toISOString(),
    }));
    localStorage.setItem(`kaogong_active_gen_${payload.userId}`, payload.generationId);
    localStorage.setItem(`kaogong_empty_choice_${payload.userId}`, 'seed');
  }, input);
}

async function openBusinessSession(browser: Browser, baseUrl: string, inviteCode: string, healthGenerationId: string): Promise<BusinessSession> {
  const context = await browser.newContext({
    viewport: { width: 360, height: 800 },
    timezoneId: 'Asia/Tokyo',
    acceptDownloads: true,
    // Native service worker is intentionally allowed here: these are real business flows.
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
  const username = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const nickname = `审计学员${username.slice(-4)}`;

  await page.goto(baseUrl, { waitUntil: 'load', timeout: 30_000 });
  const registerTab = page.getByRole('button', { name: '注册新学员', exact: true });
  await registerTab.waitFor({ state: 'visible', timeout: 20_000 });
  await registerTab.click();
  await page.getByPlaceholder('请输入管理员提供的专属邀请码').waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByPlaceholder('请输入用户名').fill(username);
  await page.getByPlaceholder('例如：土豆备考中').fill(nickname);
  await page.getByPlaceholder('请输入密码').fill('AuditPass123!');
  await page.getByPlaceholder('请输入管理员提供的专属邀请码').fill(inviteCode);
  await page.getByRole('button', { name: /注册并进入工作台/ }).click();
  await waitForAppReady(page);

  const me = await apiJson(context, `${baseUrl}/api/auth/me`);
  assert.equal(me.status, 200, `session must be authenticated after UI registration: ${JSON.stringify(me.body)}`);
  assert.equal(me.body.ok, true);
  assert.equal(me.body.user.username, username.toLowerCase());
  return {
    context,
    page,
    baseUrl,
    userId: me.body.user.id as string,
    username: me.body.user.username as string,
    nickname: me.body.user.nickname as string,
    generationId: healthGenerationId,
    serverRevision: 0,
  };
}

/**
 * Seeds a native-IndexedDB scenario and reloads the app. The app is reloaded from
 * its real cold-start path (`/api/auth/me` → partitioned IndexedDB snapshot).
 * `/api/workspace*` is blocked at the browser level for these UI-behaviour
 * scenarios (see runBusinessFlows), so a synthetic record shape can never turn
 * into a synthetic server write and cloud sync cannot race the assertions.
 */
async function seedBusinessScenario(session: BusinessSession, state: any): Promise<void> {
  const { page, baseUrl, userId, username, nickname, generationId } = session;
  const existing = await readLocalSnapshot(page);
  const revision = Math.max(1, Number(existing.revision || 0) + 1);
  await writeLocalSnapshot(page, { state, revision, userId, username, nickname, generationId });
  await page.goto(baseUrl, { waitUntil: 'load' });
  await waitForAppReady(page);
  const loaded = await readLocalSnapshot(page);
  assert(loaded.state, 'native IndexedDB snapshot must load after seeding');
}

async function runBusinessFlows(browser: Browser, baseUrl: string, inviteCode: string, healthGenerationId: string): Promise<void> {
  console.log(`\n=== PHASE business: real isolated server ${baseUrl} (native IndexedDB + real service worker) ===`);
  let session: BusinessSession | null = null;
  let registrationFailed = false;

  await check('register through UI: server seeds 14 books / 7 courses / 22 library items and client hydrates indexedDB', async () => {
    assert(inviteCode, 'isolated business phase requires an invite code (created via DATA_DIR=<isolated> node --import tsx server/cli.ts create-invite)');
    session = await openBusinessSession(browser, baseUrl, inviteCode, healthGenerationId);
    const local = await readLocalSnapshot(session.page);
    assert(local.state, 'local IndexedDB snapshot must exist after registration');
    assert.equal(local.state.books.length, 14, 'local IndexedDB must hydrate 14 seeded books');
    assert.equal(local.state.courses.length, 7, 'local IndexedDB must hydrate 7 seeded courses');
    assert.equal(local.state.library.length, 22, 'local IndexedDB must hydrate 22 seeded library items');
    const server = await getServerWorkspace(session.context, baseUrl);
    assert.equal(server.status, 200);
    assert.equal(server.body.hasCloudData, true, 'server workspace must be initialized at registration');
    assert(Number(server.body.revision) >= 1, `server workspace revision must be >= 1 right after registration, got ${server.body.revision}`);
    assert.equal(server.body.state.books.length, 14);
    assert.equal(server.body.state.courses.length, 7);
    assert.equal(server.body.state.library.length, 22);
    session.serverRevision = Number(server.body.revision);
  });

  if (count('failed') > 0 && !session) registrationFailed = true;
  const requireSession = () => {
    if (!session) throw new Error('business session unavailable: UI registration against the isolated server failed earlier');
    return session;
  };
  const businessCheck = async (name: string, work: (session: BusinessSession) => Promise<void>) => {
    if (registrationFailed) {
      skip(name, 'skipped because the isolated registration prerequisite failed');
      return;
    }
    await check(name, async () => { await work(requireSession()); });
  };

  // Real end-to-end sync check: a UI edit must reach the isolated server workspace.
  // This runs right after registration, with the app's own fresh seed state and no
  // synthetic snapshots, so it exercises the real auto-sync path end to end.
  await businessCheck('UI edit (add book) auto-syncs to the isolated server workspace', async activeSession => {
    const page = activeSession.page;
    await page.getByRole('button', { name: '学习', exact: true }).click();
    await page.getByRole('button', { name: '添加题本', exact: true }).click();
    await page.getByPlaceholder('例如：行测高分必刷1000题').fill('AUDIT_SYNC_BOOK');
    await page.getByRole('button', { name: '保存题本数据', exact: true }).click();
    await page.getByRole('heading', { name: '添加新题本' }).waitFor({ state: 'hidden' });
    const local = await readLocalSnapshot(page);
    assert(local.state.books.some((book: any) => book.name === 'AUDIT_SYNC_BOOK'), 'local IndexedDB must contain the new book');
    let synced = false;
    let lastBody: any = null;
    for (let attempt = 0; attempt < 25; attempt++) {
      const server = await getServerWorkspace(activeSession.context, activeSession.baseUrl);
      lastBody = server.body;
      if (server.status === 200 && server.body.state?.books?.some((book: any) => book.name === 'AUDIT_SYNC_BOOK')) { synced = true; break; }
      await page.waitForTimeout(300);
    }
    assert(synced, `UI edit was not auto-synced to the isolated server workspace within 7.5s; last server response: ${JSON.stringify(lastBody)}`);
  });

  // From here on, scenario checks are UI/IndexedDB behaviour checks. Block the
  // workspace API at the browser level so synthetic scenario snapshots can never
  // become synthetic cloud writes and cloud sync cannot race the assertions.
  if (session) {
    await (session as BusinessSession).context.route('**/api/workspace*', route => route.abort('failed'));
    console.log('[business] scenario isolation: /api/workspace* requests from the page are blocked (local IndexedDB behaviour only)');
  }

  // Requirement: after a successful session restore the client must read/verify the
  // server workspace and cache it locally before entering "today" (HANDOVER §2). This
  // second-device check uses a browser context that has ONLY the real session cookie
  // and no local IndexedDB/localStorage cache.
  await businessCheck('second device with only a valid session cookie hydrates the server workspace into indexedDB', async activeSession => {
    const server = await getServerWorkspace(activeSession.context, activeSession.baseUrl);
    assert.equal(server.status, 200, `server workspace must be readable: ${JSON.stringify(server.body)}`);
    const expectedBooks = server.body.state?.books?.length ?? 0;
    assert(expectedBooks > 0, 'server workspace must already contain seeded books');
    const cookies = await activeSession.context.cookies();
    const freshContext = await browser.newContext({ viewport: { width: 360, height: 800 }, timezoneId: 'Asia/Tokyo' });
    try {
      await freshContext.addCookies(cookies);
      const freshPage = await freshContext.newPage();
      let workspaceRequests = 0;
      freshPage.on('request', request => { if (request.url().includes('/api/workspace')) workspaceRequests += 1; });
      await freshPage.goto(activeSession.baseUrl, { waitUntil: 'load' });
      await waitForAppReady(freshPage);
      let local: { state: any; revision: number | null } = { state: null, revision: null };
      for (let attempt = 0; attempt < 40; attempt++) {
        local = await readLocalSnapshot(freshPage);
        if (local.state?.books?.length) break;
        await freshPage.waitForTimeout(250);
      }
      assert(local.state, `second-device cold start did not hydrate any IndexedDB snapshot (workspaceRequests=${workspaceRequests}); it must not enter an editable empty local seed`);
      assert.equal(local.state.books.length, expectedBooks, `second-device cold start must hydrate the ${expectedBooks}-book server workspace, got ${local.state.books.length} (workspaceRequests=${workspaceRequests})`);
      assert.equal(local.state.courses.length, 7, 'second-device hydration must preserve the 7 seeded courses');
      assert.equal(local.state.library.length, 22 + (expectedBooks - 14), 'second-device hydration must preserve the seeded library (22 items + synced additions)');
    } finally {
      await freshContext.close();
    }
  });

  await businessCheck('orphan photo remains deletable and cancel preserves it', async activeSession => {
    const state: any = structuredClone(BLANK_STATE);
    state.wrong = [{ id: 'orphan-audit', date: '2026-10-26', bookId: 'deleted-book', note: 'orphan audit', image: '' }];
    await seedBusinessScenario(activeSession, state);
    const page = activeSession.page;
    await page.getByRole('button', { name: '错题', exact: true }).click();
    await page.getByTitle('删除错题照片').first().click();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal((await readLocalSnapshot(page)).state.wrong.length, 1, 'cancel must preserve the orphan photo record');
    await page.getByTitle('删除错题照片').first().click();
    await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
    await page.getByText('暂无错题照片', { exact: true }).waitFor({ timeout: 10_000 });
    assert.equal((await readLocalSnapshot(page)).state.wrong.length, 0, 'confirm must delete the orphan photo record');
  });

  await businessCheck('preview changes do not change normal snapshot', async activeSession => {
    const page = activeSession.page;
    await seedBusinessScenario(activeSession, structuredClone(DEMO_STATE));
    const before = await readLocalSnapshot(page);
    await page.goto(`${activeSession.baseUrl}/?preview=1`, { waitUntil: 'load' });
    await jumpToScreen(page, 'book-add');
    await page.locator('input[type="text"]').fill('PREVIEW ONLY');
    await page.getByRole('button', { name: '保存题本数据', exact: true }).click();
    await page.getByRole('heading', { name: '添加新题本' }).waitFor({ state: 'hidden' });
    assert.deepEqual(await readLocalSnapshot(page), before, 'preview-mode edits must never touch the native IndexedDB snapshot');
    await page.goto(`${activeSession.baseUrl}/?preview=1`, { waitUntil: 'load' });
    assert.equal((await readLocalSnapshot(page)).state.books.length, 14);
  });

  await businessCheck('save failure keeps book draft and shows no success', async activeSession => {
    const page = activeSession.page;
    await seedBusinessScenario(activeSession, structuredClone(BLANK_STATE));
    await page.getByRole('button', { name: '学习', exact: true }).click();
    await page.getByRole('button', { name: '添加题本', exact: true }).click();
    await page.locator('input[type="text"]').fill('FAILURE DRAFT');
    await page.evaluate(() => {
      const original = IDBDatabase.prototype.transaction;
      (window as any).restoreAuditTransaction = () => { IDBDatabase.prototype.transaction = original; };
      IDBDatabase.prototype.transaction = function (...args: any[]) {
        if (args[1] === 'readwrite') throw new DOMException('AUDIT_WRITE_FAILED', 'QuotaExceededError');
        return (original as any).apply(this, args);
      };
    });
    await page.getByRole('button', { name: '保存题本数据', exact: true }).click();
    await page.getByText(/AUDIT_WRITE_FAILED|空间不足|保存失败/).first().waitFor({ timeout: 10_000 });
    assert.equal(await page.locator('input[type="text"]').inputValue(), 'FAILURE DRAFT', 'book draft must survive a storage failure');
    assert.equal((await readLocalSnapshot(page)).state.books.length, 0, 'failed save must not create a book');
    assert(!/题本已创建/.test(await page.locator('body').innerText()), 'failed save must not show a success message');
    await page.evaluate(() => (window as any).restoreAuditTransaction());
    await page.getByRole('button', { name: '保存题本数据', exact: true }).click();
    await page.getByRole('heading', { name: '添加新题本' }).waitFor({ state: 'hidden' });
    assert.equal((await readLocalSnapshot(page)).state.books.length, 1, 'retry after restoring storage must persist the book');
  });

  await businessCheck('running plan completion pauses latest timer and uses recorded summary', async activeSession => {
    const page = activeSession.page;
    const state: any = structuredClone(DEMO_STATE);
    const today = await page.evaluate(() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    });
    const plan = state.plans.find((candidate: any) => candidate.type === 'book' && !candidate.done);
    assert(plan, 'DEMO_STATE must contain an open book plan');
    state.plans = [{ ...plan, date: today, accumulatedMs: 45000, actualMinutes: 0, timerStart: Date.now() - 90000, done: false }];
    state.records = [];
    await seedBusinessScenario(activeSession, state);
    await page.getByRole('button', { name: /完成(登记|打卡)/, exact: true }).first().click();
    await page.locator('form input[type="number"]').last().waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForFunction(
      () => [...document.querySelectorAll<HTMLInputElement>('form input[type="number"]')].at(-1)?.value === '2',
      undefined,
      { timeout: 10_000 }
    );
    assert.equal(await page.locator('form input[type="number"]').first().inputValue(), '0', 'book completion form starts with 0 questions');
    assert.equal((await readLocalSnapshot(page)).state.plans[0].timerStart, 0, 'opening completion must pause and persist the running timer');
    await page.locator('[role="dialog"] form input[type="number"]').first().fill('13');
    await page.locator('[role="dialog"] form input[type="number"]').nth(1).fill('2');
    await page.locator('[role="dialog"] form button[type="submit"]').click();
    await page.getByText('登记成功', { exact: true }).waitFor({ timeout: 10_000 });
    assert.match(await page.locator('body').innerText(), /13 题.*2 道/);
    assert.equal((await readLocalSnapshot(page)).state.records.length, 1, 'completion must persist exactly one study record');
    await page.getByRole('button', { name: '返回今日工作台', exact: true }).click();
    await page.getByRole('button', { name: /查看.*总结|查看.*记录/ }).first().click();
    await page.getByText('登记成功', { exact: true }).waitFor({ timeout: 10_000 });
    assert.match(await page.locator('body').innerText(), /13 题.*2 道/);
    assert.equal(await page.locator('form button[type="submit"]').count(), 0, 'completed plan summary must be read-only');
  });

  if (session) await (session as BusinessSession).context.close();
}

// ---------------------------------------------------------------------------
// Main flow: prep env → visual → business → isolation proof → artifacts
// ---------------------------------------------------------------------------
const startedAt = new Date();
const gitBefore = getGitFingerprint(REPO_ROOT);
const realDataBefore: DirectoryFingerprint = await snapshotDirectory(REAL_DATA_DIR);
await fs.mkdir(OUTPUT_DIR, { recursive: true });
if (EVIDENCE_DIR) await fs.mkdir(EVIDENCE_DIR, { recursive: true });

function printHeader(): void {
  console.log('============================================================');
  console.log(' POTATO 50-SCREEN ISOLATED VERIFICATION');
  console.log('============================================================');
  console.log(`RUN_ID:          ${RUN_ID}`);
  console.log(`MODE:            ${MODE}`);
  console.log(`REPO_ROOT:       ${REPO_ROOT}`);
  console.log(`STARTED_AT:      ${startedAt.toISOString()}`);
  console.log(`SCOPE:           ${SCOPE} (visual=${RUN_VISUAL}, business=${RUN_BUSINESS}, writes_allowed=${WRITES_ALLOWED})`);
  console.log(`GIT_HEAD:        ${gitBefore.head} (${gitBefore.branch})`);
  console.log(`GIT_WORKTREE_SHA256: ${gitBefore.worktreeSha256}`);
  console.log(`REAL_DATA_DIR:   ${REAL_DATA_DIR} (before: exists=${realDataBefore.exists}, files=${realDataBefore.files.length}, sha256=${realDataBefore.aggregateSha256})`);
  if (SUPPLIED_URL) console.log(`EXTERNAL_URL:    ${SUPPLIED_URL}`);
}
printHeader();

let env: IsolatedEnvironment | undefined;
let browser: Browser | undefined;
let baseUrl = SUPPLIED_URL || '';
let webBuild: WebBuildStamp | null = null;
let healthGenerationId = '';
let inviteCode = process.env.VERIFY_INVITE_CODE || '';
let prepError: string | null = null;
let buildSummary: Record<string, unknown> | null = null;

try {
  if (!SUPPLIED_URL) {
    env = await createIsolatedEnvironment({ repoRoot: REPO_ROOT, runId: RUN_ID, rebuild: REBUILD, outputDir: OUTPUT_DIR });
    baseUrl = env.serverUrl;
    webBuild = env.webBuild;
    inviteCode = env.invite.code;
    buildSummary = { ...env.build };
  } else {
    const health = await fetchJson<{ ok: boolean; status: string; generationId: string }>(`${SUPPLIED_URL}/api/health`, 10_000);
    if (!health.ok || health.status !== 'healthy') throw new Error(`external URL health check failed: ${JSON.stringify(health)}`);
    healthGenerationId = health.generationId;
    webBuild = await getWebBuildStamp(SUPPLIED_URL);
  }

  if (!SUPPLIED_URL && env) {
    const health = await fetchJson<{ ok: boolean; status: string; generationId: string }>(`${env.serverUrl}/api/health`, 10_000);
    healthGenerationId = health.generationId;
  }

  console.log('------------------------------------------------------------');
  console.log(`SERVER_URL:      ${baseUrl}`);
  console.log(`DATA_DIR:        ${env ? env.dataDir : '<external server; not managed by harness>'}`);
  console.log(`INVITE_CODE:     ${inviteCode || '<none>'}`);
  console.log(`WEB_BUILD:       version=${webBuild?.version} build=${webBuild?.build} schema=${webBuild?.schemaVersion} source=${webBuild?.source}`);
  if (env) {
    console.log(`BUILD_STRATEGY:  ${env.build.strategy} (typecheck=${String(env.build.typecheckPassed)}, npm_build_exit=${String(env.build.npmBuildExitCode)}, vite_build_exit=${String(env.build.viteBuildExitCode)})`);
    console.log(`ISOLATED_PID:    ${env.server.pid}`);
    console.log(`SERVER_LOG:      ${env.server.logFile}`);
  }
  console.log(`OUTPUT_DIR:      ${OUTPUT_DIR}`);
  console.log(`EVIDENCE_DIR:    ${EVIDENCE_DIR || '<none>'}`);
  console.log('------------------------------------------------------------');

  browser = await chromium.launch({ headless: true });

  if (RUN_VISUAL) await runVisualMatrix(browser, baseUrl);
  if (RUN_BUSINESS) {
    if (!WRITES_ALLOWED) {
      const businessChecks = [
        'register through UI: server seeds 14 books / 7 courses / 22 library items and client hydrates indexedDB',
        'UI edit (add book) auto-syncs to the isolated server workspace',
        'second device with only a valid session cookie hydrates the server workspace into indexedDB',
        'orphan photo remains deletable and cancel preserves it',
        'preview changes do not change normal snapshot',
        'save failure keeps book draft and shows no success',
        'running plan completion pauses latest timer and uses recorded summary',
      ];
      for (const name of businessChecks) skip(name, 'external read-only mode: business writes are forbidden unless VERIFY_ISOLATED=1');
      console.log('[business] skipped: external read-only mode (pass VERIFY_ISOLATED=1 and VERIFY_INVITE_CODE to allow writes on a disposable server)');
    } else {
      await runBusinessFlows(browser, baseUrl, inviteCode, healthGenerationId);
    }
  }
} catch (error) {
  prepError = error instanceof Error ? (error.stack || error.message) : String(error);
  console.error(`[HARNESS] PREP_FAILURE: ${prepError}`);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (env) await env.cleanup().catch(() => {});
}

// ---------------------------------------------------------------------------
// Isolation proof + artifacts
// ---------------------------------------------------------------------------
const gitAfter = getGitFingerprint(REPO_ROOT);
const realDataAfter: DirectoryFingerprint = await snapshotDirectory(REAL_DATA_DIR);
const realDataDiff = diffDirectories(realDataBefore, realDataAfter);
const sourceChangedDuringRun = gitBefore.head !== gitAfter.head || gitBefore.trackedDiffSha256 !== gitAfter.trackedDiffSha256;

const summary = {
  runId: RUN_ID,
  mode: MODE,
  scope: SCOPE,
  baseUrl,
  dataDir: env ? env.dataDir : null,
  serverUrl: env ? env.serverUrl : baseUrl,
  webBuild,
  build: buildSummary,
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAt.getTime(),
  realDataDir: REAL_DATA_DIR,
  realDataBefore: { exists: realDataBefore.exists, files: realDataBefore.files.length, aggregateSha256: realDataBefore.aggregateSha256 },
  realDataAfter: { exists: realDataAfter.exists, files: realDataAfter.files.length, aggregateSha256: realDataAfter.aggregateSha256 },
  realDataUnchanged: realDataDiff.unchanged,
  realDataDiff,
  gitBefore,
  gitAfter,
  sourceChangedDuringRun,
  total: results.length,
  passed: count('passed'),
  failed: count('failed'),
  skipped: count('skipped'),
  results,
  prepError,
};

function printIsolationProof(): void {
  console.log('\n=== ISOLATION PROOF ===');
  console.log(`REAL_DATA_DIR:   ${REAL_DATA_DIR}`);
  console.log(`BEFORE:          exists=${realDataBefore.exists} files=${realDataBefore.files.length} sha256=${realDataBefore.aggregateSha256}`);
  console.log(`AFTER:           exists=${realDataAfter.exists} files=${realDataAfter.files.length} sha256=${realDataAfter.aggregateSha256}`);
  if (realDataDiff.unchanged) {
    console.log('ISOLATION_PROOF: PASS — repository data/ directory fingerprint (size+mtime+sha256 per file) is unchanged.');
  } else {
    console.log('ISOLATION_PROOF: FAIL — repository data/ directory changed during this run!');
    console.log(`  added=${JSON.stringify(realDataDiff.added)} removed=${JSON.stringify(realDataDiff.removed)} modified=${JSON.stringify(realDataDiff.modified.map(entry => entry.path))}`);
  }
  console.log(`ISOLATED_ENV:    ${env ? `DATA_DIR=${env.dataDir} (outside repo, removed on cleanup)` : 'external server, harness wrote no local data dir'}`);
  console.log(`SOURCE_CHANGED_DURING_RUN: ${sourceChangedDuringRun} (head+tracked diff before/after; other agents may be editing)`);
  if (prepError) console.log(`PREP_ERROR: ${prepError}`);
}

printIsolationProof();
console.log(`\n=== RESULT SUMMARY: total=${summary.total} passed=${summary.passed} failed=${summary.failed} skipped=${summary.skipped} duration=${(summary.durationMs / 1000).toFixed(1)}s ===`);
for (const result of results) {
  if (result.status !== 'passed') console.log(`  ${result.status.toUpperCase()}: ${result.name}${result.detail ? ` — ${String(result.detail).split('\n')[0]}` : ''}`);
}

await fs.writeFile(path.join(OUTPUT_DIR, 'results.json'), JSON.stringify(summary, null, 2));
if (EVIDENCE_DIR) {
  await fs.writeFile(path.join(EVIDENCE_DIR, `${EVIDENCE_STEM}-results.json`), JSON.stringify(summary, null, 2));
  const proof = {
    runId: RUN_ID,
    mode: MODE,
    generatedAt: new Date().toISOString(),
    realDataDir: REAL_DATA_DIR,
    realDataBefore,
    realDataAfter,
    realDataDiff,
    realDataUnchanged: realDataDiff.unchanged,
    isolatedEnv: env
      ? { repoRoot: env.repoRoot, dataDir: env.dataDir, tmpRoot: env.tmpRoot, serverUrl: env.serverUrl, serverPid: env.server.pid, webBuild: env.webBuild, build: env.build, inviteCreated: Boolean(env.invite.code) }
      : null,
    gitBefore,
    gitAfter,
    sourceChangedDuringRun,
  };
  await fs.writeFile(path.join(EVIDENCE_DIR, `${EVIDENCE_STEM}-isolation.json`), JSON.stringify(proof, null, 2));
}
console.log(`ARTIFACTS: results.json -> ${path.join(OUTPUT_DIR, 'results.json')}`);
console.log(`SCREENSHOTS: ${OUTPUT_DIR}`);

const failures = count('failed');
let exitCode = 0;
if (prepError) {
  exitCode = 2;
} else if (!realDataDiff.unchanged) {
  exitCode = 3;
} else if (sourceChangedDuringRun) {
  exitCode = 4;
} else if (failures > 0) {
  exitCode = 1;
}
console.log(`EXIT_CODE: ${exitCode}${prepError ? ' (prep failure)' : !realDataDiff.unchanged ? ' (real data changed)' : sourceChangedDuringRun ? ' (source changed during run)' : failures > 0 ? ` (${failures} failed checks)` : ''}`);
process.exit(exitCode);
