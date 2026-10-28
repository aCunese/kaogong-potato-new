import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-custom-e2e-'));
process.env.DATA_DIR = path.join(temp, 'data');
const output = path.resolve('output/custom-schedule');
fs.mkdirSync(output, { recursive: true });
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
const click = async (name: string) => page.getByRole('button', { name, exact: true }).click();
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
  await page.goto(`${base}/login`);
  await click('注册新学员');
  await page.getByPlaceholder('请输入用户名').fill(`custom_${Date.now()}`);
  await page.getByPlaceholder('例如：土豆备考中').fill('自定义日程检查');
  await page.getByPlaceholder('请输入密码').fill('test-password-only');
  await page.getByPlaceholder('请输入管理员提供的专属邀请码').fill(createInviteCode());
  await click('注册并进入工作台');
  await page.getByRole('button', { name: '添加日程', exact: true }).waitFor();
  await inject(structuredClone(BLANK_STATE)); await page.reload();
  await click('分析'); await click('自定义学习');
  await page.getByText('完成自定义事项登记后，将在此展示学习用时').waitFor();
  record('Empty custom analysis has an actionable empty state');
  await click('今日'); await click('添加日程'); await click('自定义');
  const form = page.getByRole('dialog', { name: '添加今日日程' });
  assert.equal(await form.getByLabel('选择事项', { exact: true }).count(), 0);
  assert.equal(await form.getByLabel('自定义事项所属科目').inputValue(), '其他');
  assert.equal(await form.getByLabel('自定义事项所属科目').locator('option').count(), 9);
  assert.equal(await form.getByLabel('今日计划用时', { exact: true }).inputValue(), '30');
  assert.equal(await form.getByRole('button', { name: '确认加入今日日程' }).isDisabled(), true);
  await form.getByLabel('事项名称').fill(' '.repeat(3));
  assert.equal(await form.getByRole('button', { name: '确认加入今日日程' }).isDisabled(), true);
  await form.getByLabel('事项名称').fill('长名称检查'.repeat(40));
  for (const [width, height] of [[360, 800], [393, 873], [412, 915]]) {
    await page.setViewportSize({ width, height }); await noOverflow();
    await form.screenshot({ path: path.join(output, `custom-form-long-${width}.png`) });
  }
  await form.getByLabel('事项名称').fill('整理备考计划');
  for (const value of ['0', '1.5', '']) {
    await form.getByLabel('今日计划用时', { exact: true }).fill(value);
    assert.equal(await form.getByRole('button', { name: '确认加入今日日程' }).isDisabled(), true);
  }
  await form.getByLabel('今日计划用时', { exact: true }).fill('30');
  await page.setViewportSize({ width: 393, height: 873 });
  await form.screenshot({ path: path.join(output, 'custom-form-393.png') });
  record('Custom form defaults, nine categories, blank title and invalid-minute guards; long titles fit 360/393/412');
  // Force a real IndexedDB write failure to verify the existing mutation boundary preserves the draft.
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    (window as any).__restoreTransaction = () => { IDBDatabase.prototype.transaction = original; };
    IDBDatabase.prototype.transaction = function (...args: any[]) {
      if (args[1] === 'readwrite') throw new DOMException('Test save failure', 'UnknownError');
      return original.apply(this, args as any);
    };
  });
  await form.getByRole('button', { name: '确认加入今日日程' }).click();
  await form.getByRole('alert').waitFor();
  assert.equal(await form.getByLabel('事项名称').inputValue(), '整理备考计划');
  assert.equal((await cloud()).state.plans.length, 0);
  await page.evaluate(() => (window as any).__restoreTransaction());
  await form.getByLabel('事项名称').fill('背申论金句');
  await form.getByLabel('自定义事项所属科目').selectOption('申论');
  await form.getByRole('button', { name: '确认加入今日日程' }).click();
  await until(s => s.plans.length === 1);
  record('Failed local save keeps the draft and creates no partial plan; retry succeeds');

  const cases = [
    { name: '背申论金句', subject: '申论', minutes: 20, mode: '正计时' },
    { name: '晨读时政', subject: '政治理论', minutes: 30, mode: '倒计时' },
    { name: '整理备考计划', subject: '其他', minutes: 15, mode: '专注时间' },
  ];
  for (const [index, item] of cases.entries()) {
    if (index > 0) {
      await click('添加日程'); await click('自定义');
      await form.getByLabel('事项名称').fill(item.name);
      await form.getByLabel('自定义事项所属科目').selectOption(item.subject);
      await form.getByRole('button', { name: '确认加入今日日程' }).click();
      await until(s => s.plans.length === index + 1);
    }
    await page.getByRole('button', { name: '开始计时', exact: true }).last().click();
    const timer = page.getByRole('dialog', { name: '专注计时' });
    await timer.getByRole('button', { name: item.mode, exact: true }).click();
    const saveSettings = timer.getByRole('button', { name: '保存计时设置', exact: true });
    if (await saveSettings.count()) await saveSettings.click();
    await timer.getByRole('button', { name: '开始计时', exact: true }).click();
    await timer.getByRole('button', { name: '暂停', exact: true }).waitFor();
    await page.clock.fastForward(item.minutes * 60000);
    if (index === 2) {
      await timer.getByRole('button', { name: '进入休息', exact: true }).click();
      await page.clock.fastForward(5 * 60000);
    } else {
      await timer.getByRole('button', { name: '暂停', exact: true }).click();
      await page.clock.fastForward(2 * 60000);
    }
    await timer.getByRole('button', { name: '完成登记', exact: true }).click();
    const completion = page.getByRole('dialog', { name: '完成登记', exact: true });
    await completion.getByLabel('实际学习分钟（自动记录）').filter({ hasText: `${item.minutes} 分钟` }).waitFor();
    await completion.getByRole('button', { name: '保存并完成', exact: true }).click();
    await completion.getByRole('button', { name: '返回今日工作台', exact: true }).click();
    await until(s => s.records.length === index + 1);
  }
  const saved = await cloud();
  assert.equal(saved.state.library.length, 0);
  assert.deepEqual(saved.state.records.map((r: any) => [r.type, r.subject, r.minutes, r.questions, r.errors]), [['custom', '申论', 20, 0, 0], ['custom', '政治理论', 30, 0, 0], ['custom', '其他', 15, 0, 0]]);
  assert.equal(saved.state.records.reduce((n: number, r: any) => n + r.minutes, 0), 65);
  record('Countup/countdown/pomodoro register 20+30+15=65 minutes through real local sync; pause/rest excluded and library stays empty');
  await page.reload(); await click('分析'); await click('自定义学习');
  const chart = page.getByRole('img', { name: '自定义学习时间分布，共65分钟' });
  await chart.waitFor();
  for (const [width, height] of [[360, 800], [393, 873], [412, 915]]) {
    await page.setViewportSize({ width, height }); await noOverflow();
    const distribution = page.getByRole('region', { name: '用时分布' });
    // A named section is exposed as a region; capture just the analysis chart for review.
    await distribution.screenshot({ path: path.join(output, `custom-analysis-${width}.png`) });
  }
  await click('图例与明细');
  const legend = page.getByRole('dialog', { name: '科目投入时间与图例详情' });
  await legend.getByText('23.1%', { exact: true }).waitFor();
  await legend.screenshot({ path: path.join(output, 'custom-legend-412.png') });
  await legend.getByRole('button', { name: '关闭', exact: true }).click();
  await click('每月分析');
  await page.getByText('各科正确率与用时', { exact: true }).waitFor();
  await page.getByText('其他', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, 'custom-monthly-412.png'), fullPage: true });
  record('Reload retains records; custom chart, subject legend and monthly other agree at all three viewport widths');
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'e2e-results.json'), JSON.stringify({ passed: true, results, consoleErrors: errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  fs.writeFileSync(path.join(output, 'e2e-results.json'), JSON.stringify({ passed: false, results, consoleErrors: errors, error: String(error) }, null, 2));
  throw error;
} finally {
  await browser.close(); server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve())); closeDb();
  fs.rmSync(temp, { recursive: true, force: true });
}
