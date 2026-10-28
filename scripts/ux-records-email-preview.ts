/**
 * Visual preview for the 2026-10-28 UX round (not part of the release gate).
 * Seeds an isolated temporary workspace, then captures the real React UI:
 *   1. Today page: 学习登记记录 replaces the old inline 历史日程 dropdown
 *   2. Full log dialog: date grouping, range filter, incremental loading
 *   3. History schedules dialog: back-registration entry
 *   4. Email reminder dialog: bound mailbox chip top-left, no step stepper
 *   5. Reminder composer: title/body/time quick picks with bound recipient hint
 *   6. First-time binding dialog for an unbound account
 * Screenshots are written to output/ux-2026-10-28/.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import { chromium } from 'playwright';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-ux-preview-'));
process.env.DATA_DIR = path.join(temp, 'data');
const output = path.resolve('output/ux-2026-10-28');
fs.mkdirSync(output, { recursive: true });
const clock = new Date('2026-10-28T20:05:00+09:00').getTime();
const { getDb, closeDb, getCurrentGenerationId } = await import('../server/db');
const { createSession } = await import('../server/auth');
const { syncUserWorkspace } = await import('../server/workspace');
const { createEmailRouter } = await import('../server/emailRoutes');
const { default: app } = await import('../server/app');
const { BLANK_STATE, buildLibraryFromSources, getLocalDateString } = await import('../src/constants/initialData');
const { addDays, createUxPreviewFixture, createUxReminderFixture } = await import('./lib/ux-preview-fixture');
const db = getDb();

const today = getLocalDateString(new Date(clock));
const fixture = createUxPreviewFixture(today);
const { books, courses, records: richRecords, plans: fixturePlans } = fixture;

for (const id of ['preview', 'newbie']) {
  db.prepare('INSERT INTO users(id,username,nickname,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run(id, id, id === 'preview' ? '备考中的小土豆' : '新同学', 'test-only-no-login', new Date().toISOString(), new Date().toISOString());
  const state = structuredClone(BLANK_STATE);
  if (id === 'preview') {
    state.profile = { ...state.profile, name: '备考中的小土豆' };
    state.countdowns = fixture.countdowns;
    state.books = books;
    state.courses = courses;
    state.library = buildLibraryFromSources(books, courses);
    state.records = richRecords;
    state.plans = fixturePlans;
  }
  const pushed = syncUserWorkspace({ userId: id, expectedRevision: 0, requestId: crypto.randomUUID(), generationId: getCurrentGenerationId(), schemaVersion: 3, state });
  if (!pushed.ok) throw new Error(`seed failed: ${JSON.stringify(pushed)}`);
  db.prepare("UPDATE workspaces SET init_choice='blank' WHERE user_id=?").run(id);
}

// Bound mailbox for the main preview account, plus a few reminders in every state.
const generation = getCurrentGenerationId();
db.prepare('INSERT INTO account_email_bindings(user_id,email,verified_at) VALUES (?,?,?)').run('preview', 'gongkao.prepare@qq.com', clock);
const insertReminder = (data: { id: string; title: string; body: string; sendAt: number; status: string; revision?: number; created: number }) => {
  db.prepare(`INSERT INTO email_reminders(id,user_id,request_id,payload_hash,generation_id,title,body,send_at,timezone,status,revision,attempts,next_attempt_at,lease_token,lease_until,message_id,delayed,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    data.id, 'preview', `req-${data.id}`, 'seed', generation, data.title, data.body, data.sendAt, 'Asia/Tokyo', data.status,
    data.revision ?? 1, 0, data.sendAt, null, null, `<${data.id}@potato.local>`, 0, data.created, data.created,
  );
};
for (const reminder of createUxReminderFixture(clock)) {
  insertReminder({ ...reminder, status: reminder.status });
}

const harness = express();
harness.use(express.json(), cookieParser());
harness.use(createEmailRouter({ db, sender: { available: true, async send() { /* preview only */ } }, now: () => clock, secret: 'preview-only-mail-secret' }));
harness.use(app);
const server = harness.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
const browser = await chromium.launch({ headless: true });
const errors: string[] = [];
const shots: string[] = [];

async function openAccount(id: string) {
  const context = await browser.newContext({ viewport: { width: 393, height: 915 }, timezoneId: 'Asia/Tokyo', serviceWorkers: 'block' });
  const session = createSession(id);
  await context.addCookies([{ name: 'potato_session', value: session.token, url: base, httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(`${id}: ${error.message}`));
  await page.clock.install({ time: new Date(clock) });
  await page.goto(base);
  await page.getByRole('button', { name: '添加日程', exact: true }).waitFor();
  return { context, page };
}
async function shot(page: any, name: string) {
  const file = path.join(output, `${name}.png`);
  await page.screenshot({ path: file });
  shots.push(file);
  console.log(`SHOT ${path.relative(process.cwd(), file)}`);
}
async function scrollPageBottom(page: any) {
  await page.evaluate(() => {
    document.querySelectorAll<HTMLElement>('div').forEach(node => {
      if (node.scrollHeight > node.clientHeight + 40 && ['auto', 'scroll'].includes(getComputedStyle(node).overflowY)) node.scrollTop = node.scrollHeight;
    });
  });
}

try {
  const preview = await openAccount('preview');
  const page = preview.page;
  await page.clock.runFor(50);
  await scrollPageBottom(page);
  await shot(page, 'today-records-393');
  await page.getByRole('button', { name: '只看未完成', exact: true }).click();
  await shot(page, 'today-only-unfinished-393');
  await page.getByRole('button', { name: '只看未完成', exact: true }).click();

  await page.getByRole('button', { name: '查看全部', exact: true }).click();
  const records = page.getByRole('dialog', { name: '学习登记记录' });
  await records.getByLabel('选择查看日期').waitFor();
  await records.getByText('今天的日程与登记', { exact: true }).waitFor();
  await shot(page, 'records-dialog-393');
  await records.getByRole('button', { name: '前一天' }).click();
  await shot(page, 'records-dialog-yesterday-393');
  await records.getByLabel('选择查看日期').fill(addDays(today, -6));
  await shot(page, 'records-dialog-picked-date-393');
  await records.getByRole('button', { name: '关闭弹窗', exact: true }).click();

  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.getByRole('button', { name: '学习提醒', exact: true }).click();
  const mail = page.getByRole('dialog', { name: '学习提醒' });
  await mail.getByText('g***@qq.com', { exact: true }).waitFor();
  await shot(page, 'email-bound-393');
  await mail.locator('[role="button"][aria-expanded]').first().click();
  await shot(page, 'email-expanded-393');
  await mail.locator('[role="button"][aria-expanded]').first().click();
  await mail.getByRole('button', { name: '新建提醒', exact: true }).click();
  await mail.getByLabel('提醒标题').fill('明早复盘数量关系');
  await mail.getByLabel('提醒正文').fill('工程问题 10 道，先做后复盘。');
  await shot(page, 'email-composer-393');
  await mail.getByRole('button', { name: '收起提醒表单', exact: true }).click();
  await mail.getByRole('tab', { name: /^历史记录/ }).click();
  await shot(page, 'email-history-393');
  await mail.getByRole('tab', { name: /^待发送/ }).click();
  await mail.getByRole('button', { name: '邮箱管理', exact: true }).click();
  const manager = page.getByRole('dialog', { name: '邮箱管理' });
  await manager.getByRole('button', { name: '更换邮箱', exact: true }).waitFor();
  await shot(page, 'email-manage-393');
  await manager.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await mail.getByRole('button', { name: '关闭弹窗', exact: true }).click();

  const newbie = await openAccount('newbie');
  await newbie.page.getByRole('button', { name: '我的', exact: true }).click();
  await newbie.page.getByRole('button', { name: '学习提醒', exact: true }).click();
  const bind = newbie.page.getByRole('dialog', { name: '学习提醒' });
  await bind.getByRole('heading', { name: '先绑定收件邮箱', exact: true }).waitFor();
  await shot(newbie.page, 'email-bind-first-time-393');
  await newbie.context.close();
  await preview.context.close();
  if (errors.length) throw new Error(`browser errors: ${errors.join(' | ')}`);
  console.log(`PREVIEW OK ${shots.length} screenshots`);
} finally {
  await browser.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
  closeDb();
  fs.rmSync(temp, { recursive: true, force: true });
}
