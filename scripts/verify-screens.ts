import { chromium, type Page } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ALL_50_SCREENS } from '../src/components/views/ScreenInspectorModal';
import { BLANK_STATE, DEMO_STATE } from '../src/constants/initialData';

// Use an isolated browser profile. No data from the user's browser is read or changed.
const outputDir = path.resolve(process.env.VERIFY_OUTPUT_DIR || '/tmp/potato-latest-audit/verified-screens');
const suppliedUrl = process.env.VERIFY_URL;
const baseUrl = suppliedUrl || 'http://127.0.0.1:4186';
const viewports = [{ width: 412, height: 915 }, { width: 393, height: 873 }, { width: 360, height: 800 }];
const screenText: Record<string, string | RegExp> = {
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
  'download-apk': '专属 Android 安装包', 'month-picker': '选择分析月份', 'overall-legend': '八科投入时间与图例详情',
  'focus-course': '听网课', 'focus-custom': '自定义事项',
};
const modalScreens = new Set(ALL_50_SCREENS.filter(s => !['today', 'library', 'books', 'courses', 'wrong', 'overall', 'monthly', 'settings', 'guest', 'today-empty', 'today-multi', 'states-empty', 'states-sync', 'states-form'].includes(s.id)).map(s => s.id));
const results: { name: string; passed: boolean; detail?: string }[] = [];
async function check(name: string, work: () => Promise<void>) {
  try { await work(); results.push({ name, passed: true }); }
  catch (error) { results.push({ name, passed: false, detail: String(error) }); console.error(`FAIL ${name}: ${error}`); }
}
async function seed(page: Page, source: typeof BLANK_STATE) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.evaluate(async state => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('kaogong_potato_v3', 1);
      req.onupgradeneeded = () => {
        for (const [name, keyPath] of [['snapshots', 'key'], ['media', 'id'], ['damaged_cache', 'id']]) {
          if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath });
        }
      };
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['snapshots', 'media'], 'readwrite');
        tx.objectStore('snapshots').put({ key: 'latest', state, version: 3, revision: 1, migratedFromV2: true, updatedAt: new Date().toISOString() });
        tx.objectStore('media').clear();
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  }, source);
  await page.reload({ waitUntil: 'networkidle' });
}
async function snapshot(page: Page) {
  return page.evaluate(async () => new Promise<any>((resolve, reject) => {
    const req = indexedDB.open('kaogong_potato_v3', 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result, tx = db.transaction('snapshots');
      const get = tx.objectStore('snapshots').get('latest');
      get.onsuccess = () => { resolve(get.result); db.close(); };
      get.onerror = () => reject(get.error);
    };
  }));
}
async function jump(page: Page, id: string) {
  await page.getByRole('button', { name: '50屏矩阵', exact: true }).click();
  await page.locator(`[data-screen-id="${id}"]`).click();
  await page.getByRole('heading', { name: '50 画面全矩阵导航与验收直达' }).waitFor({ state: 'hidden' });
}
async function metrics(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector('main')!.getBoundingClientRect();
    const nav = document.querySelector('nav')!.getBoundingClientRect();
    const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].map(el => {
      const rect = el.getBoundingClientRect();
      return { title: el.getAttribute('aria-label'), top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
    });
    return { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth,
      mainHeight: main.height, navBottom: nav.bottom, navTop: nav.top, dialogs };
  });
}

await fs.mkdir(outputDir, { recursive: true });
let server: ReturnType<typeof spawn> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  if (!suppliedUrl) {
    server = spawn('bun', ['run', 'preview', '--host', '127.0.0.1', '--port', '4186', '--strictPort'], { stdio: 'pipe' });
    let exited = false;
    server.on('exit', () => { exited = true; });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (exited) throw new Error('Isolated preview server exited; check port 4186');
      try { if ((await fetch(baseUrl)).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(ready, 'Isolated preview server must start');
  }
  browser = await chromium.launch({ headless: true });
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport, timezoneId: 'Asia/Tokyo' });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    await check(`normal viewport ${viewport.width}x${viewport.height}`, async () => {
      await page.goto(baseUrl, { waitUntil: 'networkidle' });
      assert.equal(await page.getByRole('button', { name: '50屏矩阵', exact: true }).count(), 0);
      assert.match(await page.locator('body').innerText(), /今天还没有日程/);
      const m = await metrics(page);
      assert.equal(m.mainHeight, viewport.height);
      assert(m.documentWidth <= viewport.width && m.navBottom <= viewport.height && m.navTop >= 0);
      await page.screenshot({ path: path.join(outputDir, `normal-${viewport.width}.png`) });
    });
    for (const screen of ALL_50_SCREENS) {
      await check(`${viewport.width} ${screen.id}`, async () => {
        await page.goto(`${baseUrl}/?preview=1`, { waitUntil: 'networkidle' });
        await jump(page, screen.id);
        const expected = screenText[screen.id];
        await page.getByText(expected).first().waitFor({ state: 'visible', timeout: 5000 });
        if (modalScreens.has(screen.id)) assert(await page.locator('[role="dialog"]').count() > 0, `${screen.id} must activate a dialog`);
        const m = await metrics(page);
        assert(m.documentWidth <= viewport.width, 'page must not overflow horizontally');
        assert(m.navBottom <= viewport.height + 1, 'navigation must fit viewport');
        for (const dialog of m.dialogs) assert(dialog.top >= -1 && dialog.bottom <= viewport.height + 1 && dialog.left >= -1 && dialog.right <= viewport.width + 1, `${screen.id} dialog must fit: ${JSON.stringify(dialog)}`);
        const broken = await page.locator('img').evaluateAll(images => images.filter(img => img.complete && img.naturalWidth === 0).map(img => img.src));
        assert.equal(broken.length, 0, 'images must load');
        await page.screenshot({ path: path.join(outputDir, `${viewport.width}-${screen.id}.png`) });
        const scrollables = page.locator('.overflow-y-auto');
        for (const element of await scrollables.all()) await element.evaluate(el => { el.scrollTop = el.scrollHeight; });
        if (modalScreens.has(screen.id)) {
          const lastButton = page.locator('[role="dialog"]').last().getByRole('button').last();
          if (await lastButton.count()) { await lastButton.scrollIntoViewIfNeeded(); const box = await lastButton.boundingBox(); assert(box && box.y >= 0 && box.y + box.height <= viewport.height + 1, 'final modal action must be reachable'); }
        }
      });
    }
    await check(`no page errors ${viewport.width}`, async () => assert.deepEqual(errors, []));
    await context.close();
    console.log(`Checked 50 screens at ${viewport.width}x${viewport.height}`);
  }

  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, timezoneId: 'Asia/Tokyo', acceptDownloads: true });
  const page = await context.newPage();
  page.on('dialog', dialog => dialog.dismiss());
  await check('orphan photo remains deletable and cancel preserves it', async () => {
    const state = structuredClone(BLANK_STATE);
    state.wrong = [{ id: 'orphan-audit', date: '2026-10-26', bookId: 'deleted-book', note: 'orphan audit', image: '' }];
    await seed(page, state);
    await page.getByRole('button', { name: '错题', exact: true }).click();
    await page.getByTitle('删除错题照片').click();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal((await snapshot(page)).state.wrong.length, 1);
    await page.getByTitle('删除错题照片').click();
    await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
    await page.getByText('暂无错题照片', { exact: true }).waitFor();
    assert.equal((await snapshot(page)).state.wrong.length, 0);
  });
  await check('preview changes do not change normal snapshot', async () => {
    await seed(page, structuredClone(DEMO_STATE));
    const before = await snapshot(page);
    await page.goto(`${baseUrl}/?preview=1`, { waitUntil: 'networkidle' });
    await jump(page, 'book-add');
    await page.locator('input[type="text"]').fill('PREVIEW ONLY');
    await page.getByRole('button', { name: '保存题本数据', exact: true }).click();
    await page.getByRole('heading', { name: '添加新题本' }).waitFor({ state: 'hidden' });
    assert.deepEqual(await snapshot(page), before);
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    assert.equal((await snapshot(page)).state.books.length, 14);
  });
  await check('save failure keeps book draft and shows no success', async () => {
    await seed(page, structuredClone(BLANK_STATE));
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
    await page.getByText(/AUDIT_WRITE_FAILED|空间不足|保存失败/).first().waitFor();
    assert.equal(await page.locator('input[type="text"]').inputValue(), 'FAILURE DRAFT');
    assert.equal((await snapshot(page)).state.books.length, 0);
    assert(!/题本已创建/.test(await page.locator('body').innerText()));
    await page.evaluate(() => (window as any).restoreAuditTransaction());
    await page.getByRole('button', { name: '保存题本数据', exact: true }).click();
    await page.getByRole('heading', { name: '添加新题本' }).waitFor({ state: 'hidden' });
    assert.equal((await snapshot(page)).state.books.length, 1);
  });
  await check('running plan completion pauses latest timer and uses recorded summary', async () => {
    const state = structuredClone(DEMO_STATE);
    const today = await page.evaluate(() => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`; });
    const plan = state.plans.find(p => p.type === 'book' && !p.done)!;
    assert(plan);
    state.plans = [{ ...plan, date: today, accumulatedMs: 45000, actualMinutes: 0, timerStart: Date.now() - 90000, done: false }];
    state.records = [];
    await seed(page, state);
    await page.getByRole('button', { name: /完成(登记|打卡)/, exact: true }).click();
    const minutes = page.locator('form input[type="number"]').last();
    await minutes.waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLInputElement>('form input[type="number"]')].at(-1)?.value === '2');
    assert.equal(await page.locator('form input[type="number"]').first().inputValue(), '0');
    assert.equal((await snapshot(page)).state.plans[0].timerStart, 0);
    await page.locator('form input[type="number"]').first().fill('13');
    await page.locator('form input[type="number"]').nth(1).fill('2');
    await page.locator('form button[type="submit"]').click();
    await page.getByText('登记成功', { exact: true }).waitFor();
    assert.match(await page.locator('body').innerText(), /13 题.*2 道/);
    assert.equal((await snapshot(page)).state.records.length, 1);
    await page.getByRole('button', { name: '返回今日工作台', exact: true }).click();
    await page.getByRole('button', { name: /查看.*总结|查看.*记录/ }).click();
    await page.getByText('登记成功', { exact: true }).waitFor();
    assert.match(await page.locator('body').innerText(), /13 题.*2 道/);
    assert.equal(await page.locator('form button[type="submit"]').count(), 0);
  });
  await context.close();
} finally {
  await browser?.close();
  server?.kill();
  await fs.writeFile(path.join(outputDir, 'results.json'), JSON.stringify({ baseUrl, checkedAt: new Date().toISOString(), total: results.length, passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length, results }, null, 2));
}
console.log(JSON.stringify({ total: results.length, passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed) }, null, 2));
if (results.some(result => !result.passed)) process.exitCode = 1;
