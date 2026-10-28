import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-timer-v5-e2e-'));
process.env.DATA_DIR = path.join(temp, 'data');
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

try {
  const version = await (await context.request.get(`${base}/api/version?nonce=release-audit`)).json();
  assert.equal(version.version, release.webVersion);
  assert.equal(version.build, release.webBuild);
  assert.equal(version.schemaVersion, release.schemaVersion);
  assert.match((await context.request.get(`${base}/api/version?nonce=x`)).headers()['cache-control'], /no-store/);
  assert.equal(version.apkVersion, release.apkVersion);
  record(`Web${version.version} release metadata, Schema ${version.schemaVersion}, fresh version API and unchanged verified APK`);

  await page.goto(`${base}/login`);
  await tab('注册新学员');
  await page.getByPlaceholder('请输入用户名').fill(`timer_${Date.now()}`);
  await page.getByPlaceholder('例如：土豆备考中').fill('Timer audit');
  await page.getByPlaceholder('请输入密码').fill('test-password-only');
  await page.getByPlaceholder('请输入管理员提供的专属邀请码').fill(createInviteCode());
  await tab('注册并进入工作台');
  await page.getByRole('button', { name: '添加日程', exact: true }).waitFor();
  await inject(structuredClone(BLANK_STATE)); await page.reload();
  await page.getByRole('button', { name: '番茄钟', exact: true }).waitFor();

  // ===== 开始前必选类别；三个专注模式与四种模式的校验 =====
  await tab('番茄钟');
  const dialog = page.getByRole('dialog', { name: '番茄钟', exact: true });
  for (const mode of ['正计时', '倒计时', '专注时间', '休息']) assert.equal(await dialog.getByRole('button', { name: mode, exact: true }).count(), 1);
  assert.equal(await dialog.getByRole('group', { name: '学习类别' }).count(), 1);
  assert.equal(await dialog.getByRole('button', { name: '开始专注', exact: true }).isDisabled(), true);
  await dialog.getByRole('button', { name: '申论', exact: true }).click();
  await dialog.getByRole('button', { name: '专注时间', exact: true }).click();
  const focus = dialog.getByLabel('专注时长', { exact: true });
  for (const value of ['', '0', '1.5']) { await focus.fill(value); assert.equal(await dialog.getByRole('button', { name: '开始专注', exact: true }).isDisabled(), true); }
  await focus.fill('1');
  record('four modes, category required before start, blank/zero/decimal focus duration rejected');

  // ===== 计时：超时静默累计、暂停保留毫秒、休息到点自动停 =====
  await dialog.getByRole('button', { name: '开始专注', exact: true }).click();
  await until(s => s.timerSessions?.[0]?.status === 'running');
  assert.equal(await dialog.getByRole('group', { name: '学习类别' }).count(), 0);
  await page.clock.fastForward(65000);
  await dialog.getByLabel('计时读数', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '关闭到点提醒' }).count(), 0);
  await dialog.getByRole('button', { name: '暂停', exact: true }).click();
  let snapshot = await until(s => s.timerSessions[0].status === 'paused');
  assert.ok(Math.abs(snapshot.timerSessions[0].segments.reduce((n: number, s: any) => n + s.end - s.start, 0) - 65000) < 2000);
  record('focus overtime is silent, accumulates real milliseconds and pause keeps the session');

  await dialog.getByRole('button', { name: '倒计时', exact: true }).click();
  await focus.fill('1');
  await dialog.getByRole('button', { name: '开始专注', exact: true }).click();
  await until(s => s.timerSessions[0].timerMode === 'countdown' && s.timerSessions[0].status === 'running');
  await page.clock.fastForward(65000);
  await dialog.getByRole('button', { name: '暂停', exact: true }).click();
  await until(s => s.timerSessions[0].status === 'paused');

  await dialog.getByRole('button', { name: '休息', exact: true }).click();
  const rest = dialog.getByLabel('休息时长', { exact: true });
  for (const value of ['', '0', '1.5', '-1']) { await rest.fill(value); assert.equal(await dialog.getByRole('button', { name: '开始休息', exact: true }).isDisabled(), true); }
  await rest.fill('1');
  await dialog.getByRole('button', { name: '开始休息', exact: true }).click();
  await until(s => s.timerSessions[0].phase === 'rest' && s.timerSessions[0].status === 'running');
  await page.clock.fastForward(120000);
  snapshot = await until(s => s.timerSessions[0].status === 'paused');
  const session = snapshot.timerSessions[0];
  assert.ok(Math.abs(session.segments.filter((s: any) => s.phase === 'focus').reduce((n: number, s: any) => n + s.end - s.start, 0) - 130000) < 2000);
  assert.equal(session.segments.filter((s: any) => s.phase === 'rest').reduce((n: number, s: any) => n + s.end - s.start, 0), 60000);
  record('mode change retains learning, rest stops at its exact deadline and never counts as learning time');

  // ===== 关闭重开仍保留计时，结束时自动登记 =====
  await dialog.getByLabel('关闭弹窗').click();
  await page.reload(); await page.getByRole('button', { name: '番茄钟', exact: true }).waitFor(); await tab('番茄钟');
  const dialog2 = page.getByRole('dialog', { name: '番茄钟', exact: true });
  assert.equal(await dialog2.getByText('已选：申论 · 已锁定').count(), 1);
  await dialog2.getByRole('button', { name: '结束并自动登记', exact: true }).click();
  await dialog2.getByText(/已记录：申论 · 2 分钟/).waitFor();
  let state = await until(s => s.records?.length === 1);
  assert.deepEqual([state.records[0].type, state.records[0].subject, state.records[0].minutes, state.records[0].questions, state.records[0].errors], ['custom', '申论', 2, 0, 0]);
  const plan = state.plans.find((p: any) => p.sessionId === state.timerSessions[0].id);
  assert.deepEqual([plan.name, plan.type, plan.done], ['番茄钟 · 申论', 'custom', true]);
  assert.equal(state.timerSessions[0].status, 'registered');
  record('paused timer survives IndexedDB reload and finishes into one auto-registered custom record');

  // ===== 分析口径：专注与休息 + 自定义学习，总学习用时只加一次 =====
  await dialog2.getByLabel('关闭弹窗').click();
  await tab('今日');
  await page.getByRole('heading', { name: '番茄钟 · 申论', exact: true }).waitFor();
  await tab('分析');
  await page.getByRole('button', { name: '自定义学习', exact: true }).click();
  await page.getByRole('img', { name: '自定义学习时间分布，共2分钟', exact: true }).waitFor();
  const breakdown = await page.getByText('总学习用时', { exact: true }).locator('..').innerText();
  assert.match(breakdown, /2 分钟/);
  await page.getByRole('button', { name: '专注与休息', exact: true }).click();
  await page.getByRole('img', { name: '专注与休息时间分布，共3.2分钟', exact: true }).waitFor();
  record('analysis keeps focus/rest and custom-learning views consistent without double-counting the total');
  assert.equal(await page.getByRole('heading', { name: '网课节数进度', exact: true }).count(), 0);

  // ===== 删除已完成日程：撤销记录并作废计时统计 =====
  await tab('今日');
  await page.getByTitle('移除日程').last().click();
  await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
  await until(s => s.timerSessions[0].status === 'voided');
  state = await cloud().then(v => v.state);
  assert.equal(state.records.length, 0);
  await tab('分析');
  await page.getByRole('button', { name: '专注与休息', exact: true }).click();
  await page.getByText('结束一次计时后生成专注与休息统计', { exact: true }).waitFor();
  record('deleting the completed pomodoro plan reverses its record and voids the session from analysis');

  // ===== 纯休息：不产生学习记录，也不留下待登记 =====
  await tab('今日'); await tab('番茄钟');
  const restDialog = page.getByRole('dialog', { name: '番茄钟', exact: true });
  await restDialog.getByRole('button', { name: '休息', exact: true }).click();
  await restDialog.getByLabel('休息时长', { exact: true }).fill('1');
  await restDialog.getByRole('button', { name: '开始休息', exact: true }).click();
  await until(s => s.timerSessions.at(-1).status === 'running');
  assert.equal(await restDialog.getByRole('button', { name: '正计时', exact: true }).isDisabled(), true);
  await page.clock.fastForward(65000);
  await until(s => s.timerSessions.at(-1).status === 'paused');
  assert.equal(await restDialog.getByLabel('计时读数', { exact: true }).innerText(), '00:00');
  await restDialog.getByRole('button', { name: '结束', exact: true }).click();
  await restDialog.getByText('休息已保存，无须登记学习事项。', { exact: true }).waitFor();
  assert.equal(await restDialog.getByLabel('关联学习事项').count(), 0);
  assert.equal(await restDialog.getByRole('button', { name: /^补登记/ }).count(), 0);
  await restDialog.getByLabel('关闭弹窗').click();
  await page.reload(); await tab('番茄钟');
  assert.equal(await page.getByRole('dialog', { name: '番茄钟', exact: true }).getByRole('button', { name: /^补登记/ }).count(), 0);
  await page.getByRole('dialog', { name: '番茄钟', exact: true }).getByLabel('关闭弹窗').click();
  record('fourth rest mode ends without learning registration or pending leftovers, including after reload');

  for (const width of [360, 393, 412]) {
    await page.setViewportSize({ width, height: 873 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  await page.goto(`${base}/?preview=1`);
  await page.getByRole('button', { name: '添加日程', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  record('three phone widths, preview loads and zero runtime errors');
  fs.writeFileSync(path.join(temp, 'results.json'), JSON.stringify({ passed: true, results, consoleErrors: errors }, null, 2));
  console.log('ALL_LEARNING_TIMER_CHECKS_PASSED');
} catch (error) {
  await page.screenshot({ path: path.join(temp, 'failure.png'), fullPage: true }).catch(() => {});
  fs.writeFileSync(path.join(temp, 'failure-dom.txt'), await page.locator('body').innerText().catch(() => ''));
  fs.writeFileSync(path.join(temp, 'results.json'), JSON.stringify({ passed: false, results, consoleErrors: errors, error: String(error) }, null, 2));
  console.error('LEARNING_TIMER_AUDIT_FAILED:', String(error));
  process.exitCode = 1;
} finally {
  await browser.close(); server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve())); closeDb();
  console.log(`EVIDENCE ${temp}`);
}
