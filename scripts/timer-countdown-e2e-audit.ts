import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-timer-countdown-e2e-'));
process.env.DATA_DIR = path.join(temp, 'data');
const output = path.resolve('output/timer-countdown');
fs.mkdirSync(output, { recursive: true });
const release = JSON.parse(fs.readFileSync(path.resolve('release.json'), 'utf-8'));
const results: string[] = [], errors: string[] = [];
const record = (name: string) => { results.push(name); console.log(`PASS ${name}`); };
const { default: app } = await import('../server/app');
const { createInviteCode } = await import('../server/admin');
const { closeDb } = await import('../server/db');
const { BLANK_STATE } = await import('../src/constants/initialData');
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 393, height: 873 }, timezoneId: 'Asia/Tokyo', serviceWorkers: 'block' });
const page = await context.newPage();
await page.clock.install({ time: new Date('2026-10-28T10:00:00+09:00') });
page.on('pageerror', e => errors.push(e.message));
const tab = async (name: string) => { await page.getByRole('button', { name, exact: true }).click(); };
const cloud = async () => { const r = await context.request.get(`${base}/api/workspace`); assert.equal(r.status(), 200); return r.json(); };
async function until(predicate: (s: any) => boolean) {
  for (let i = 0; i < 120; i++) { const value = await cloud(); if (predicate(value.state)) return value.state; await new Promise(r => setTimeout(r, 100)); }
  throw Error('Local sync condition timed out');
}
async function inject(state: any) {
  const current = await cloud(), auth = await (await context.request.get(`${base}/api/auth/me`)).json();
  const r = await context.request.post(`${base}/api/workspace`, { headers: { 'x-csrf-token': auth.csrfToken, 'x-workspace-user': auth.user.id }, data: { state, schemaVersion: state.version, expectedRevision: current.revision, generationId: current.generationId, requestId: crypto.randomUUID() } });
  assert.equal(r.status(), 200, await r.text());
}
async function noOverflow() {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'document must not overflow');
  const dialog = page.getByRole('dialog');
  if (await dialog.count()) {
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, 'dialog must not overflow horizontally');
    const box = await dialog.boundingBox(); assert.ok(box && box.x >= 0 && box.x + box.width <= page.viewportSize()!.width);
  }
}

try {
  const version = await (await context.request.get(`${base}/api/version?nonce=timer-countdown-audit`)).json();
  assert.equal(version.version, release.webVersion);
  assert.equal(version.build, release.webBuild);
  assert.equal(version.schemaVersion, release.schemaVersion);
  record('release metadata matches release.json');

  await page.goto(`${base}/login`);
  await tab('注册新学员');
  await page.getByPlaceholder('请输入用户名').fill(`tcd_${Date.now()}`);
  await page.getByPlaceholder('例如：土豆备考中').fill('番茄钟倒数日检查');
  await page.getByPlaceholder('请输入密码').fill('test-password-only');
  await page.getByPlaceholder('请输入管理员提供的专属邀请码').fill(createInviteCode());
  await tab('注册并进入工作台');
  await page.getByRole('button', { name: '添加日程', exact: true }).waitFor();
  await inject(structuredClone(BLANK_STATE)); await page.reload();
  await page.getByRole('button', { name: '番茄钟', exact: true }).waitFor();

  // ===== 1. 番茄钟：开始前选类别，结束自动登记 =====
  await tab('番茄钟');
  const dialog = page.getByRole('dialog', { name: '番茄钟', exact: true });
  await dialog.getByRole('group', { name: '学习类别' }).waitFor();
  assert.equal(await dialog.getByRole('group', { name: '学习类别' }).getByRole('button').count(), 9);
  assert.equal(await dialog.getByRole('button', { name: '开始专注', exact: true }).isDisabled(), true, 'start must be disabled before choosing a category');
  await page.screenshot({ path: path.join(output, 'timer-category-393.png') });
  await dialog.getByRole('button', { name: '申论', exact: true }).click();
  assert.equal(await dialog.getByRole('button', { name: '开始专注', exact: true }).isDisabled(), false);
  await dialog.getByRole('button', { name: '开始专注', exact: true }).click();
  await until(s => s.timerSessions?.[0]?.status === 'running' && s.timerSessions[0].subject === '申论');
  assert.equal(await dialog.getByText('已选：申论 · 已锁定').count(), 1);
  assert.equal(await dialog.getByRole('group', { name: '学习类别' }).count(), 0, 'category must be locked while running');
  assert.equal(await dialog.getByRole('button', { name: '正计时', exact: true }).isDisabled(), true);
  record('category chosen before start, 9 categories, locked once running');

  await page.clock.fastForward(20 * 60000);
  await dialog.getByRole('button', { name: '结束并自动登记', exact: true }).click();
  await dialog.getByText(/已记录：申论 · 20 分钟/).waitFor();
  let state = await until(s => s.records?.length === 1);
  assert.deepEqual(state.records[0] && [state.records[0].type, state.records[0].subject, state.records[0].minutes, state.records[0].questions, state.records[0].errors], ['custom', '申论', 20, 0, 0]);
  const timerPlan = state.plans.find((p: any) => p.sessionId === state.timerSessions[0].id);
  assert.deepEqual(timerPlan && [timerPlan.name, timerPlan.type, timerPlan.subject, timerPlan.done, timerPlan.actualMinutes], ['番茄钟 · 申论', 'custom', '申论', true, 20]);
  assert.equal(state.timerSessions[0].status, 'registered');
  assert.equal(state.books.length, 0);
  assert.equal(state.courses.length, 0);
  record('finish auto-registers exactly one custom record with the selected category (no question/lesson counters)');
  // 今日日程出现已完成的番茄钟条目
  await dialog.getByLabel('关闭弹窗').click();
  await tab('今日');
  await page.getByRole('heading', { name: '番茄钟 · 申论', exact: true }).waitFor();
  record('auto-registered pomodoro appears as a completed item on today agenda');

  // ===== 2. 分析：专注与休息 + 自定义学习 + 总时长只加一次 =====
  await tab('分析');
  await page.getByRole('button', { name: '自定义学习', exact: true }).click();
  await page.getByRole('img', { name: '自定义学习时间分布，共20分钟', exact: true }).waitFor();
  const breakdown = await page.getByText('总学习用时', { exact: true }).locator('..').innerText();
  assert.match(breakdown, /20 分钟/);
  assert.doesNotMatch(breakdown, /40 分钟/);
  await page.screenshot({ path: path.join(output, 'timer-analysis-custom-393.png') });
  await page.getByRole('button', { name: '专注与休息', exact: true }).click();
  await page.getByRole('img', { name: '专注与休息时间分布，共20分钟', exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, 'timer-analysis-focus-393.png') });
  record('analysis shows the same 20 minutes in focus/rest and custom-learning views, total counted once');

  // ===== 3. 倒数日：默认三项 + 自定义增删改 =====
  await tab('今日');
  const strip = page.getByRole('group', { name: '倒数日', exact: true });
  assert.equal(await strip.getByRole('button', { name: '添加倒数日', exact: true }).count(), 1);
  for (const name of ['国考', '省考', '事业编']) assert.equal(await strip.getByRole('button', { name: `${name} 倒数日`, exact: true }).count(), 1);
  await strip.getByRole('button', { name: '添加倒数日', exact: true }).click();
  let modal = page.getByRole('dialog', { name: '添加倒数日', exact: true });
  await modal.getByLabel('倒数日名称').fill('考研初试');
  await modal.getByLabel('倒数日目标日期').fill('2027-12-25');
  await modal.getByRole('button', { name: '添加', exact: true }).click();
  await until(s => s.countdowns?.length === 4);
  state = await cloud().then(v => v.state);
  const custom = state.countdowns.find((c: any) => c.name === '考研初试');
  assert.ok(custom, 'custom countdown saved');
  await page.getByRole('button', { name: '考研初试 倒数日', exact: true }).waitFor();
  record('add custom countdown with name and date');

  await page.getByRole('button', { name: '考研初试 倒数日', exact: true }).click();
  modal = page.getByRole('dialog', { name: '编辑倒数日', exact: true });
  await modal.getByLabel('倒数日名称').fill('考研面试');
  await modal.getByLabel('倒数日目标日期').fill('2027-12-20');
  await modal.getByRole('button', { name: '保存', exact: true }).click();
  await until(s => s.countdowns.some((c: any) => c.name === '考研面试' && c.date === '2027-12-20'));
  await page.getByRole('button', { name: '考研面试 倒数日', exact: true }).waitFor();
  record('rename and reschedule a custom countdown');

  // 补齐到 6 个后隐藏添加入口
  for (const [i, name] of ['目标A', '目标B'].entries()) {
    const add = page.getByRole('button', { name: '添加倒数日', exact: true });
    if (await add.count() === 0) break;
    await add.click();
    modal = page.getByRole('dialog', { name: '添加倒数日', exact: true });
    await modal.getByLabel('倒数日名称').fill(name);
    await modal.getByLabel('倒数日目标日期').fill(`2027-0${i + 1}-15`);
    await modal.getByRole('button', { name: '添加', exact: true }).click();
    await until(s => s.countdowns.some((c: any) => c.name === name));
  }
  state = await cloud().then(v => v.state);
  assert.equal(state.countdowns.length, 6);
  assert.equal(await page.getByRole('button', { name: '添加倒数日', exact: true }).count(), 0, 'add entry hidden at six items');
  record('six-countdown limit hides the add entry');

  // 过去日期显示“已结束”
  await page.getByRole('button', { name: '国考 倒数日', exact: true }).click();
  modal = page.getByRole('dialog', { name: '编辑倒数日', exact: true });
  await modal.getByLabel('倒数日目标日期').fill('2026-10-01');
  await modal.getByRole('button', { name: '保存', exact: true }).click();
  await until(s => s.countdowns.find((c: any) => c.id === 'exam-national')?.date === '2026-10-01');
  await page.getByRole('button', { name: '国考 倒数日', exact: true }).getByText('已结束').waitFor();
  record('past target renders "已结束"');

  // 删除一个自定义倒数日
  await page.getByRole('button', { name: '目标B 倒数日', exact: true }).click();
  modal = page.getByRole('dialog', { name: '编辑倒数日', exact: true });
  await modal.getByRole('button', { name: '删除倒数日', exact: true }).click();
  await modal.getByRole('button', { name: '确认删除', exact: true }).click();
  await until(s => s.countdowns.length === 5);
  assert.equal(await page.getByRole('button', { name: '添加倒数日', exact: true }).count(), 1);
  record('delete countdown with explicit confirmation and restore add entry');

  await page.reload();
  await page.getByRole('button', { name: '考研面试 倒数日', exact: true }).waitFor();
  await page.getByRole('button', { name: '国考 倒数日', exact: true }).getByText('已结束').waitFor();
  const stripEl = page.getByRole('group', { name: '倒数日', exact: true }).locator('div').first();
  assert.equal(await stripEl.evaluate(el => el.scrollWidth > el.clientWidth), true, 'countdown strip must scroll horizontally when more than three items');
  record('custom countdowns persist after reload and the strip scrolls horizontally');

  // ===== 4. 三档手机宽度截图与溢出检查 =====
  for (const [width, height] of [[360, 800], [393, 873], [412, 915]] as const) {
    await page.setViewportSize({ width, height }); await noOverflow();
    await page.screenshot({ path: path.join(output, `countdown-strip-${width}.png`) });
    await tab('番茄钟');
    const timerDialog = page.getByRole('dialog', { name: '番茄钟', exact: true });
    await timerDialog.waitFor(); await noOverflow();
    await timerDialog.screenshot({ path: path.join(output, `timer-picker-${width}.png`) });
    await timerDialog.getByLabel('关闭弹窗').click();
  }
  record('countdown strip and timer picker fit 360/393/412 without horizontal overflow');

  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'e2e-results.json'), JSON.stringify({ passed: true, results, consoleErrors: errors }, null, 2));
  console.log('ALL_TIMER_COUNTDOWN_CHECKS_PASSED');
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  fs.writeFileSync(path.join(output, 'e2e-results.json'), JSON.stringify({ passed: false, results, consoleErrors: errors, error: String(error) }, null, 2));
  console.error('TIMER_COUNTDOWN_AUDIT_FAILED:', String(error));
  process.exitCode = 1;
} finally {
  await browser.close(); server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve())); closeDb();
  fs.rmSync(temp, { recursive: true, force: true });
}
