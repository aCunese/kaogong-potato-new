import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-experience-e2e-'));
process.env.DATA_DIR = path.join(temp, 'data');
const results: string[] = [];
const privateDb = path.join(process.cwd(), 'data/potato.db');
const hash = () => fs.existsSync(privateDb) ? crypto.createHash('sha256').update(fs.readFileSync(privateDb)).digest('hex') : null;
const originalHash = hash();
const { default: app } = await import('../server/app');
const { createInviteCode } = await import('../server/admin');
const { closeDb } = await import('../server/db');
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 393, height: 873 }, timezoneId: 'Asia/Tokyo', serviceWorkers: 'block' });
const page = await context.newPage();
await page.clock.install({ time: new Date('2026-10-27T12:00:00+09:00') });
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
const record = (name: string) => { results.push(name); console.log(`PASS ${name}`); };
const cloud = async () => {
  const response = await context.request.get(`${base}/api/workspace`);
  assert.equal(response.status(), 200); return response.json();
};
async function until(predicate: (s: any) => boolean) {
  for (let i = 0; i < 100; i++) { const s = await cloud(); if (predicate(s)) return s; await new Promise(r => setTimeout(r, 100)); }
  throw Error('Cloud condition timed out');
}
async function tab(name: string) { await page.getByRole('button', { name, exact: true }).click(); }
async function inject(state: any) {
  const current = await cloud();
  const auth = await (await context.request.get(`${base}/api/auth/me`)).json();
  const response = await context.request.post(`${base}/api/workspace`, { headers: { 'x-csrf-token': auth.csrfToken, 'x-workspace-user': auth.user.id }, data: { state, schemaVersion: state.version, requestId: crypto.randomUUID(), expectedRevision: current.revision, generationId: current.generationId } });
  assert.equal(response.status(), 200, await response.text());
}
try {
  await page.goto(`${base}/login`); await page.waitForLoadState('networkidle');
  const loginBox = await page.getByRole('button', { name: '登录学员空间', exact: true }).boundingBox();
  const registerBox = await page.getByRole('button', { name: '注册新学员', exact: true }).boundingBox();
  assert.ok(loginBox && registerBox && registerBox.y > loginBox.y); record('registration below login');
  await tab('注册新学员');
  await page.getByPlaceholder('请输入用户名').fill(`experience_${Date.now()}`);
  await page.getByPlaceholder('例如：土豆备考中').fill('Experience test');
  await page.getByPlaceholder('请输入密码').fill('test-password-only');
  await page.getByPlaceholder('请输入管理员提供的专属邀请码').fill(createInviteCode());
  await tab('注册并进入工作台');
  await page.getByRole('button', { name: '添加日程', exact: true }).waitFor(); record('real isolated registration');

  await tab('学习'); await tab('待办');
  await page.getByLabel('添加待办', { exact: true }).fill('Review an argument'); await tab('添加');
  await until(s => s.state.todos?.length === 1); record('todo auto-upload without manual sync');
  await page.reload(); await page.getByRole('button', { name: '添加日程', exact: true }).waitFor();
  await tab('学习'); await tab('待办'); await page.getByText('Review an argument', { exact: true }).waitFor();
  await page.getByRole('button', { name: '完成：Review an argument', exact: true }).click(); await until(s => s.state.todos?.[0].done); record('todo survives IDB reload and toggles');
  await context.setOffline(true); await page.getByLabel('添加待办', { exact: true }).fill('Offline todo'); await tab('添加');
  await page.getByText('Offline todo', { exact: true }).waitFor(); await context.setOffline(false);
  await until(s => s.state.todos?.length === 2); record('offline todo retries automatically on reconnect');
  await page.screenshot({ path: path.join(temp, 'todos.png'), fullPage: true });

  await tab('今日'); await tab('添加日程');
  let dialog = page.getByRole('dialog', { name: '添加今日日程', exact: true });
  await dialog.getByLabel('今日计划用时', { exact: true }).fill('');
  assert.equal(await dialog.getByLabel('今日计划用时', { exact: true }).inputValue(), ''); assert.equal(await dialog.getByRole('button', { name: '确认加入今日日程' }).isDisabled(), true);
  await dialog.getByLabel('今日计划用时', { exact: true }).fill('0'); assert.equal(await dialog.getByRole('button', { name: '确认加入今日日程' }).isDisabled(), true);
  await dialog.getByLabel('今日计划用时', { exact: true }).fill('30'); await dialog.getByRole('button', { name: '确认加入今日日程' }).click();
  let snapshot = await until(s => s.state.plans.length === 1); const bookPlanId = snapshot.state.plans[0].id;
  record('blank/zero time rejected, positive minutes accepted');
  await tab('番茄钟');
  dialog = page.getByRole('dialog', { name: '番茄钟', exact: true });
  for (const mode of ['正计时', '倒计时', '专注时间']) assert.equal(await dialog.getByRole('button', { name: mode, exact: true }).count(), 1);
  assert.equal(await dialog.getByText('选择学习日程').count(), 0);
  record('homepage timer opens directly with three explicit modes');
  await dialog.getByLabel('关闭弹窗').click();
  await tab('开始计时');
  dialog = page.getByRole('dialog', { name: '专注计时', exact: true });
  await dialog.getByRole('button', { name: '倒计时', exact: true }).click();
  await dialog.getByLabel('专注分钟', { exact: true }).fill('1'); await dialog.getByRole('button', { name: '应用计时设置' }).click(); await dialog.getByRole('button', { name: '开始计时', exact: true }).click();
  await until(s => s.state.plans.find((p: any) => p.id === bookPlanId)?.timerStart > 0);
  await dialog.getByLabel('关闭计时面板').click();
  await page.clock.fastForward(61000); await page.getByRole('status').filter({ hasText: '到点' }).waitFor();
  await tab('查看计时'); dialog = page.getByRole('dialog', { name: '专注计时', exact: true });
  await dialog.getByText('时间到，正在继续累计；完成后请手动登记').waitFor();
  assert.ok((await cloud()).state.plans[0].timerStart > 0); record('countdown overtime continues and remains incomplete');
  await dialog.getByRole('button', { name: '暂停', exact: true }).click();
  await dialog.getByRole('button', { name: '专注时间', exact: true }).click();
  await dialog.getByLabel('专注分钟', { exact: true }).fill('1'); await dialog.getByLabel('休息分钟', { exact: true }).fill('1');
  await dialog.getByRole('button', { name: '应用计时设置' }).click(); await dialog.getByRole('button', { name: '开始计时', exact: true }).click();
  await until(s => s.state.plans[0].timerMode === 'pomodoro' && s.state.plans[0].timerStart > 0);
  await page.clock.fastForward(61000); await dialog.getByText('时间到，正在继续累计；完成后请手动登记').waitFor();
  await dialog.getByRole('button', { name: '进入休息', exact: true }).click();
  const resting = await until(s => s.state.plans[0].restStart > 0); const studyBeforeRest = resting.state.plans[0].accumulatedMs;
  await page.clock.fastForward(61000);
  await until(s => s.state.plans[0].restStart === 0 && s.state.plans[0].timerPhase === 'rest');
  assert.equal((await cloud()).state.plans[0].accumulatedMs, studyBeforeRest);
  await dialog.getByRole('button', { name: '开始下一轮专注', exact: true }).click();
  await until(s => s.state.plans[0].timerStart > 0 && s.state.plans[0].timerPhase === 'focus');
  record('pomodoro overtime, rest exclusion, automatic rest stop and manual next focus');
  await dialog.getByRole('button', { name: '完成登记', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '完成登记', exact: true });
  for (const label of ['本次做题数', '本次错题数']) { const field = dialog.getByLabel(label, { exact: true }); await field.fill(''); assert.equal(await field.inputValue(), ''); assert.equal(await dialog.getByRole('button', { name: '保存并完成' }).isDisabled(), true); await field.fill('0'); }
  for (const value of ['0', '-1', '1.5']) { await dialog.getByLabel('本次做题数', { exact: true }).fill(value); assert.equal(await dialog.getByRole('button', { name: '保存并完成' }).isDisabled(), true); }
  await dialog.locator('input').nth(0).fill('20'); await dialog.locator('input').nth(1).fill('4'); await dialog.getByRole('button', { name: '保存并完成' }).click();
  await tab('返回今日工作台'); snapshot = await until(s => s.state.records.length === 1); assert.equal(snapshot.state.books.find((b: any) => b.id === snapshot.state.plans[0].sourceId).done, 20);
  await page.getByTitle('移除日程').click(); await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
  snapshot = await until(s => s.state.records.length === 0 && s.state.plans.length === 0); assert.equal(snapshot.state.books.reduce((n: number, b: any) => n + b.done + b.errors + b.minutes, 0), 0); record('manual plan deletion reverses all completed book statistics');

  await tab('添加日程'); dialog = page.getByRole('dialog', { name: '添加今日日程' });
  const course = snapshot.state.library.find((l: any) => l.type === 'course'); await dialog.getByRole('button', { name: '网课', exact: true }).click(); await dialog.getByLabel('选择事项', { exact: true }).selectOption(course.id);
  await dialog.getByLabel('本次计划节数').fill('2'); await dialog.getByLabel('今日计划用时').fill('35'); await dialog.getByRole('button', { name: '确认加入今日日程' }).click();
  await until(s => s.state.plans.length === 1); await tab('开始计时'); dialog = page.getByRole('dialog', { name: '专注计时' });
  await dialog.getByRole('button', { name: '开始计时', exact: true }).click(); await until(s => s.state.plans[0].timerStart > 0);
  await page.clock.fastForward(35 * 60000); await dialog.getByRole('button', { name: '完成登记', exact: true }).click(); dialog = page.getByRole('dialog', { name: '完成登记' });
  await page.waitForFunction(() => (document.querySelector('[aria-label="完成登记"] input') as HTMLInputElement)?.value === '2');
  const lessonInput = dialog.getByLabel('本次完成节数', { exact: true });
  assert.equal(await lessonInput.inputValue(), '2'); assert.equal(await dialog.locator('input').count(), 1);
  assert.match(await dialog.getByLabel('实际学习分钟（自动记录）').innerText(), /35/);
  await lessonInput.fill(''); assert.equal(await lessonInput.inputValue(), ''); assert.equal(await dialog.getByRole('button', { name: '保存并完成' }).isDisabled(), true);
  await lessonInput.fill('0'); assert.equal(await dialog.getByRole('button', { name: '保存并完成' }).isDisabled(), true);
  await lessonInput.fill('100000'); assert.equal(await dialog.getByRole('button', { name: '保存并完成' }).isDisabled(), true);
  await lessonInput.fill('2'); await dialog.getByRole('button', { name: '保存并完成' }).click(); await tab('返回今日工作台');
  record('completion duration is measured/read-only and lesson drafts allow blank but reject zero');
  snapshot = await until(s => s.state.records.length === 1); const learned = snapshot.state.courses.find((c: any) => c.id === course.sourceId); assert.equal(learned.completedLessons, 2); assert.equal(learned.minutes, 35); record('planned lessons confirmed once and course minutes synchronized');
  await tab('分析'); await page.getByRole('img', { name: '网课学习时间分布，共35分钟', exact: true }).waitFor(); record('analysis separates course and book minutes');
  await page.getByRole('heading', { name: '网课节数进度', exact: true }).waitFor();
  await page.getByRole('button', { name: new RegExp(`^${learned.subject} ·`) }).click();
  await page.getByRole('heading', { name: learned.name, exact: true }).waitFor();
  await page.screenshot({ path: path.join(temp, 'course-analysis.png'), fullPage: true });
  record('overall analysis integrates duration, lessons, folded progress and daily records');
  await tab('学习'); await tab('网课进度'); await page.getByRole('button', { name: new RegExp(`^${learned.subject} ·`) }).click(); await page.getByTitle('编辑课程').first().click();
  dialog = page.getByRole('dialog', { name: '修改网课信息', exact: true });
  assert.match(await dialog.getByLabel('累计用时（自动累计）').innerText(), /35/);
  const totalInput = dialog.getByLabel('总节数', { exact: true }); const completedInput = dialog.getByLabel('已完成节数', { exact: true });
  await totalInput.fill(''); assert.equal(await totalInput.inputValue(), ''); assert.equal(await dialog.getByRole('button', { name: '保存网课数据' }).isDisabled(), true);
  await totalInput.fill('0'); assert.equal(await dialog.getByRole('button', { name: '保存网课数据' }).isDisabled(), true);
  await totalInput.fill(String(learned.totalLessons)); await completedInput.fill(''); assert.equal(await completedInput.inputValue(), '');
  await completedInput.fill('3'); await page.screenshot({ path: path.join(temp, 'course-readonly.png'), fullPage: true });
  await dialog.getByRole('button', { name: '保存网课数据' }).click();
  snapshot = await until(s => s.state.courses.find((c: any) => c.id === course.sourceId)?.completedLessons === 3);
  assert.equal(snapshot.state.courses.find((c: any) => c.id === course.sourceId).minutes, 35);
  record('course edit cannot alter duration and accepts clearable lesson counts');


  const data = snapshot.state; const book = data.books[0];
  data.wrong = Array.from({ length: 15 }, (_, i) => ({ id: `w${i}`, date: '2026-10-27', bookId: book.id, note: i === 0 ? '增长率公式记混' : `其他思路 ${i}`, image: '' }));
  data.wrong.push({ id: 'orphan', date: '2026-10-26', bookId: 'deleted', note: '已解绑的公式思路', image: '' });
  data.plans.push({ id: 'old-running', date: '2026-10-26', libraryId: `lib-book-${book.id}`, name: 'Yesterday timer', sourceId: book.id, subject: book.subject, type: 'book', plannedMinutes: 30, actualMinutes: 0, accumulatedMs: 0, done: false, timerStart: new Date('2026-10-26T23:50:00+09:00').getTime() });
  await inject(data); await page.reload(); await page.getByRole('button', { name: '添加日程', exact: true }).waitFor();
  snapshot = await until(s => s.state.plans.find((p: any) => p.id === 'old-running')?.archived); const old = snapshot.state.plans.find((p: any) => p.id === 'old-running'); assert.equal(old.actualMinutes, 10); assert.equal(snapshot.state.records.length, 1);
  await page.getByRole('heading', { name: /学习登记记录/ }).waitFor();
  assert.equal(await page.getByLabel('查看历史日程').count(), 0);
  await page.getByRole('button', { name: '查看全部', exact: true }).click();
  const logDialog = page.getByRole('dialog', { name: '学习登记记录' });
  await logDialog.getByLabel('选择查看日期').waitFor();
  await logDialog.getByText('今天的日程与登记', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(temp, 'study-records.png') });
  await logDialog.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  record('today page lists study registrations and the log views one selected day');
  assert.equal(await page.getByText('Yesterday timer', { exact: true }).count(), 0); await page.getByRole('button', { name: /历史日程还没登记/ }).click(); await logDialog.getByText('Yesterday timer', { exact: true }).waitFor(); await logDialog.getByRole('button', { name: '关闭弹窗', exact: true }).click(); record('real persisted midnight cap and history without changing records');
  await tab('错题'); assert.equal(await page.getByRole('button', { name: '查看详情', exact: true }).count(), 0);
  await page.getByRole('button', { name: new RegExp(book.name) }).click(); assert.equal(await page.getByRole('button', { name: '查看详情', exact: true }).count(), 12); await tab('再显示 3 条'); assert.equal(await page.getByRole('button', { name: '查看详情', exact: true }).count(), 15);
  await page.getByLabel('搜索复盘原因和思路').fill('公式'); assert.equal(await page.getByRole('button', { name: '查看详情', exact: true }).count(), 2); await page.getByLabel('错题开始日期').fill('2026-10-27'); assert.equal(await page.getByRole('button', { name: '查看详情', exact: true }).count(), 1); record('folded photos, incremental rendering, note search, unlinked notes and date filter');
  await page.screenshot({ path: path.join(temp, 'wrong-search.png'), fullPage: true });
  for (const width of [360, 393, 412]) { await page.setViewportSize({ width, height: 873 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false); }
  record('three mobile widths without horizontal overflow');
  assert.deepEqual(errors, []); assert.equal(hash(), originalHash); record('no page errors and real local data unchanged');
} catch (error) {
  await page.screenshot({ path: path.join(temp, 'failure.png'), fullPage: true }).catch(() => {});
  fs.writeFileSync(path.join(temp, 'failure-dom.txt'), await page.locator('body').innerText().catch(() => ''));
  throw error;
} finally {
  fs.writeFileSync(path.join(temp, 'results.json'), JSON.stringify({ results, errors, realDataUnchanged: hash() === originalHash }, null, 2));
  await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); closeDb();
  console.log(`EVIDENCE ${temp}`);
}
