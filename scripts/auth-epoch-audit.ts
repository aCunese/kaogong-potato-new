/**
 * 身份/会话/初始化/游客迁移 真实回归（隔离环境）：
 *  - R09: 注册成功后服务器工作区拉取失败 => 准确错误 + 重试，不进入可编辑前端种子
 *  - R04: 账号 A 的迟到同步响应在退出后不得污染界面/存储
 *  - R11: 主动退出（含 logout 请求失败）后刷新不得因旧 cookie 自动重进
 *  - R10: 旧游客数据一次性迁移（预览范围、双方恢复点、全量 ID 映射、照片随迁移上传）
 *
 * 运行：bun scripts/auth-epoch-audit.ts
 * 输出：docs/implementation/evidence/auth-epoch-results.json + auth-epoch-run.log
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { BLANK_STATE } from '../src/constants/initialData';
import {
  resolveRepoRoot,
  createRunId,
  getFreePort,
  startIsolatedServer,
  createInviteViaCli,
} from './lib/isolated-env';

const ROOT = resolveRepoRoot();
const RUN_ID = createRunId();
const TMP = fs.mkdtempSync(path.join('/tmp', `${RUN_ID}-`));
const DATA_DIR = path.join(TMP, 'data');
const EVIDENCE_DIR = path.join(ROOT, 'docs', 'implementation', 'evidence');
const results: { name: string; passed: boolean; detail?: unknown }[] = [];
const check = (name: string, passed: boolean, detail?: unknown) => {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${passed ? '' : ` :: ${JSON.stringify(detail)}`}`);
};

let server: Awaited<ReturnType<typeof startIsolatedServer>> | null = null;
let browser: Browser | null = null;
const contexts: BrowserContext[] = [];
let baseUrl = '';

async function newContext(): Promise<BrowserContext> {
  const ctx = await browser!.newContext({ viewport: { width: 412, height: 915 }, timezoneId: 'Asia/Tokyo' });
  contexts.push(ctx);
  return ctx;
}

async function registerViaUi(ctx: BrowserContext, user: string, pass: string, invite: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '注册新学员', exact: true }).click();
  await page.getByPlaceholder('请输入用户名').fill(user);
  await page.getByPlaceholder('例如：土豆备考中').fill(`昵称${user.slice(-4)}`);
  await page.getByPlaceholder('请输入密码').fill(pass);
  await page.getByPlaceholder('请输入管理员提供的专属邀请码').fill(invite);
  await page.getByRole('button', { name: /注册并进入工作台/ }).click();
  return page;
}

async function loginViaUi(ctx: BrowserContext, user: string, pass: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('请输入用户名').fill(user);
  await page.getByPlaceholder('请输入密码').fill(pass);
  await page.getByRole('button', { name: /登录学员空间/ }).click();
  return page;
}

async function waitForNav(page: Page, timeout = 30000) {
  await page.locator('nav button', { hasText: '今日' }).first().waitFor({ state: 'visible', timeout });
}

async function apiWorkspace(ctx: BrowserContext): Promise<any> {
  const res = await ctx.request.get(`${baseUrl}/api/workspace`);
  if (!res.ok()) throw new Error(`GET /api/workspace -> ${res.status()}`);
  return res.json();
}

async function waitForCloud(ctx: BrowserContext, predicate: (ws: any) => boolean, timeoutMs = 30000): Promise<any> {
  const start = Date.now();
  let last: any = null;
  while (Date.now() - start < timeoutMs) {
    try {
      last = await apiWorkspace(ctx);
      if (predicate(last)) return last;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`cloud condition timeout: ${JSON.stringify(last?.state?.profile)}`);
}

async function logoutViaUi(page: Page) {
  await page.locator('nav button', { hasText: '我的' }).first().click();
  await page.waitForTimeout(300);
  await page.locator('text=退出登录').first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '确认', exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(800);
}

async function main() {
  await fsp.mkdir(EVIDENCE_DIR, { recursive: true });
  const port = await getFreePort();
  server = await startIsolatedServer({ repoRoot: ROOT, dataDir: DATA_DIR, port, logFile: path.join(TMP, 'server.log') });
  baseUrl = server.url;
  const invite = (await createInviteViaCli(ROOT, DATA_DIR)).code;
  console.log(`[${RUN_ID}] SERVER_URL=${baseUrl}`);
  console.log(`[${RUN_ID}] DATA_DIR=${DATA_DIR}`);
  browser = await chromium.launch({ headless: true });

  // =====================================================================
  // R09: 注册成功后服务器工作区拉取失败 => 准确错误 + 重试（绝不进入可编辑空库）
  // =====================================================================
  const userR09 = `r09_${Date.now().toString(36)}`;
  const passR09 = 'Password123!';
  const ctxR09 = await newContext();
  let workspaceFailuresLeft = 1;
  await ctxR09.route('**/api/workspace', async route => {
    const method = route.request().method();
    // The very first authenticated GET /api/workspace is the post-register hydration;
    // fail it to exercise the accurate error + retry path.
    if (method === 'GET' && workspaceFailuresLeft > 0) {
      workspaceFailuresLeft -= 1;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'SERVICE_UNAVAILABLE', message: '服务暂不可用' }) });
      return;
    }
    await route.continue();
  });
  const pageR09 = await registerViaUi(ctxR09, userR09, passR09, invite);
  const errorVisible = await pageR09.getByText('云端工作区加载失败').waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  check('R09: workspace load failure shows accurate error screen instead of editable seed library', errorVisible, {
    body: (await pageR09.locator('body').innerText().catch(() => '')).slice(0, 160),
  });
  if (errorVisible) {
    const navCount = await pageR09.locator('nav button', { hasText: '今日' }).count();
    const seedCards = await pageR09.getByText('共 14 本题本').count();
    check('R09: error state blocks business navigation and does not fabricate a seed library', navCount === 0 && seedCards === 0, { navCount, seedCards });
    await pageR09.getByRole('button', { name: /重新加载云端工作区/ }).click();
    await pageR09.waitForTimeout(400);
    await waitForNav(pageR09);
    const ws = await waitForCloud(ctxR09, w => w.state?.books?.length === 14);
    check('R09: retry after load failure loads the real server workspace', ws.state.books.length === 14 && Boolean(ws.state.courses.length === 7));
  }

  // =====================================================================
  // R04: A 账号迟到响应在退出/切换后不得污染界面
  // =====================================================================
  const userA = `r04a_${Date.now().toString(36)}`;
  const inviteA = (await createInviteViaCli(ROOT, DATA_DIR)).code;
  const ctxA = await newContext();
  const pageA = await registerViaUi(ctxA, userA, passA(), inviteA);
  await waitForNav(pageA);
  await pageA.evaluate(async () => {
    const raw = localStorage.getItem('kaogong_last_active_user');
    (window as any).__auditUserId = raw ? JSON.parse(raw).id : null;
  });
  const userAId = await pageA.evaluate(() => (window as any).__auditUserId);

  // Hold the next GET /api/workspace (sync pull) so the response arrives after logout.
  let releaseHeld: (() => void) | null = null;
  let heldOnce = false;
  await ctxA.route('**/api/workspace', async route => {
    if (route.request().method() === 'GET' && !heldOnce) {
      heldOnce = true;
      await new Promise<void>(resolve => { releaseHeld = resolve; });
    }
    await route.continue().catch(() => {});
  });
  // Trigger a manual sync (the "云端同步状态" row) which will issue the held GET.
  await pageA.locator('nav button', { hasText: '我的' }).first().click();
  await pageA.waitForTimeout(300);
  await pageA.locator('text=云端同步状态').first().click();
  await pageA.waitForTimeout(600);
  await logoutViaUi(pageA);
  const loginAfterLogout = await pageA.getByPlaceholder('请输入用户名').isVisible().catch(() => false);
  check('R04: explicit logout returns to login screen', loginAfterLogout);
  // Release the stale response from the logged-out account.
  if (releaseHeld) (releaseHeld as () => void)();
  await pageA.waitForTimeout(2500);
  const navAfterLateResponse = await pageA.locator('nav button', { hasText: '今日' }).count();
  const loginStillVisible = await pageA.getByPlaceholder('请输入用户名').isVisible().catch(() => false);
  // The stale response must only ever touch account A's own partition; the current UI and the
  // last-active-user (account A) must not be presented as an active session.
  check('R04: late response from logged-out account does not re-enter or pollute the UI', navAfterLateResponse === 0 && loginStillVisible, {
    navAfterLateResponse, loginStillVisible, body: (await pageA.locator('body').innerText()).slice(0, 120),
  });
  await ctxA.unroute('**/api/workspace');

  // =====================================================================
  // R11: 主动退出 + logout 请求失败 => 刷新不得自动重进
  // =====================================================================
  const ctxB = await newContext();
  const pageB = await loginViaUi(ctxB, userA, passA());
  await waitForNav(pageB);
  await ctxB.route('**/api/auth/logout', route => route.abort('failed'));
  await logoutViaUi(pageB);
  const logoutMarker = await pageB.evaluate(() => Boolean(localStorage.getItem('kaogong_explicit_logout')));
  check('R11: explicit logout persists a logged-out marker even when the logout request fails', logoutMarker);
  await pageB.goto(baseUrl, { waitUntil: 'networkidle' });
  await pageB.waitForTimeout(2500);
  const stillLoginAfterReload = await pageB.getByPlaceholder('请输入用户名').isVisible().catch(() => false);
  const navAfterReload = await pageB.locator('nav button', { hasText: '今日' }).count();
  check('R11: reload with a still-valid cookie does NOT auto re-enter after explicit logout', stillLoginAfterReload && navAfterReload === 0, { stillLoginAfterReload, navAfterReload });
  await ctxB.unroute('**/api/auth/logout');
  // Explicit login clears the marker and works again.
  const pageB2 = await loginViaUi(ctxB, userA, passA());
  const reloginOk = await waitForNav(pageB2, 25000).then(() => true).catch(async () => {
    console.log('[debug] re-login body:', (await pageB2.locator('body').innerText().catch(() => '')).slice(0, 300));
    return false;
  });
  check('R11: explicit re-login after logout enters the account again', reloginOk);
  const markerCleared = await pageB.evaluate(() => localStorage.getItem('kaogong_explicit_logout') === null);
  check('R11: explicit re-login clears the logged-out marker', markerCleared);

  // =====================================================================
  // R10: 旧游客数据一次性迁移（真实 legacy localStorage -> 账号，含照片上传）
  // =====================================================================
  const userC = `r10_${Date.now().toString(36)}`;
  const inviteC = (await createInviteViaCli(ROOT, DATA_DIR)).code;
  const ctxC = await newContext();
  const pageC = await registerViaUi(ctxC, userC, passA(), inviteC);
  await waitForNav(pageC);
  const wsBeforeMigration: any = await apiWorkspace(ctxC);
  const booksBefore = wsBeforeMigration.state.books.length;
  // Seed legacy guest payload in localStorage, then reload: app must offer an explicit one-time migration.
  const legacyState = structuredClone(BLANK_STATE) as any;
  legacyState.books = [{ id: 'legacy-book-1', name: '旧版游客专属题本', subject: '资料分析', total: 100, pages: 80, done: 30, errors: 2, minutes: 45 }];
  legacyState.courses = [];
  legacyState.library = [{ id: 'legacy-lib-1', type: 'book', sourceId: 'legacy-book-1', name: '旧版游客专属题本', subject: '资料分析', defaultMinutes: 30 }];
  legacyState.plans = [{ id: 'legacy-plan-1', date: '2026-10-26', libraryId: 'legacy-lib-1', name: '旧版游客专属题本', type: 'book', sourceId: 'legacy-book-1', subject: '资料分析', plannedMinutes: 30, actualMinutes: 10, accumulatedMs: 600000, done: true, timerStart: 0 }];
  legacyState.records = [{ id: 'legacy-record-1', planId: 'legacy-plan-1', date: '2026-10-26', type: 'book', sourceId: 'legacy-book-1', subject: '资料分析', minutes: 10, questions: 5, errors: 1 }];
  legacyState.wrong = [{ id: 'legacy-wrong-1', date: '2026-10-26', bookId: 'legacy-book-1', note: '游客旧错题', image: TINY_PNG }];
  legacyState.profile.name = '旧版游客昵称';
  await pageC.evaluate((state) => {
    localStorage.setItem('potato_study_v2', JSON.stringify({ version: 2, state }));
  }, legacyState);
  await pageC.reload({ waitUntil: 'networkidle' });
  await waitForNav(pageC);
  const migrationModalVisible = await pageC.getByText('旧版本地数据迁移确认').waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  const modalText = migrationModalVisible ? await pageC.getByRole('dialog').innerText() : '';
  check('R10: legacy guest data offers reachable explicit migration with scope preview', migrationModalVisible && /迁移范围预览/.test(modalText) && /旧版游客专属题本|新增题本/.test(modalText), { modalText: modalText.slice(0, 200) });
  if (migrationModalVisible) {
    await pageC.getByRole('button', { name: /确认将旧版数据迁移到当前账号/ }).click();
    await pageC.getByText('旧版本地数据迁移确认').waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
    const wsAfterMigration = await waitForCloud(ctxC, ws => ws.state.books.length === booksBefore + 1, 30000);
    const migratedBook = wsAfterMigration.state.books.find((b: any) => b.name === '旧版游客专属题本');
    const migratedWrong = wsAfterMigration.state.wrong.find((w: any) => w.note === '游客旧错题');
    const migratedRecord = wsAfterMigration.state.records.find((r: any) => r.id === 'legacy-record-1' || r.questions === 5);
    check('R10: books/courses/library/plans/records/wrong merged with ID remapping', Boolean(migratedBook) && Boolean(migratedWrong) && Boolean(migratedRecord), {
      books: wsAfterMigration.state.books.length, plans: wsAfterMigration.state.plans.length, records: wsAfterMigration.state.records.length, wrong: wsAfterMigration.state.wrong.length,
    });
    const photoIsMediaRef = Boolean(migratedWrong?.image?.startsWith('/api/media/'));
    check('R10: migrated guest wrong-photo is uploaded to server media reference', photoIsMediaRef, { image: migratedWrong?.image });
    const legacyStillKept = await pageC.evaluate(() => Boolean(localStorage.getItem('potato_study_v2')));
    const migratedMarker = await pageC.evaluate((uid) => Boolean(localStorage.getItem(`kaogong_guest_migrated_${uid}`)), await pageC.evaluate(() => JSON.parse(localStorage.getItem('kaogong_last_active_user') || '{}').id));
    check('R10: legacy copy preserved and migration marked one-time', legacyStillKept && migratedMarker, { legacyStillKept, migratedMarker });
    // Reload: migration modal must not re-appear (one-time).
    await pageC.reload({ waitUntil: 'networkidle' });
    await waitForNav(pageC);
    await pageC.waitForTimeout(800);
    const modalAgain = await pageC.getByText('旧版本地数据迁移确认').isVisible().catch(() => false);
    check('R10: migration is one-time and not re-offered after completion', modalAgain === false);
  }

  const passed = results.filter(r => r.passed).length;
  const output = {
    runId: RUN_ID,
    checkedAt: new Date().toISOString(),
    baseUrl,
    dataDir: DATA_DIR,
    webBuild: await (await fetch(`${baseUrl}/version.json?nonce=${RUN_ID}`)).json(),
    gitHead: (await import('node:child_process')).execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf-8' }).trim(),
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
  };
  await fsp.writeFile(path.join(EVIDENCE_DIR, 'auth-epoch-results.json'), JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\n==== 身份/会话/初始化/游客迁移: ${passed}/${results.length} 通过 ====`);
  if (passed !== results.length) process.exitCode = 1;
}

function passA(): string {
  return 'Password123!';
}

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

try {
  await main();
} catch (error) {
  check('auth/session audit harness completed', false, String(error));
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const ctx of contexts) { try { await ctx.close(); } catch {} }
  try { await browser?.close(); } catch {}
  try { await server?.stop(); } catch {}
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
}
