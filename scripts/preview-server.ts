/**
 * Interactive local preview for the 2026-10-28 UX round (not part of the release gate).
 *
 *   npm run preview:ux        →  http://127.0.0.1:3100
 *
 * Uses an isolated, disposable data directory (data/preview-ux) that is re-seeded on
 * every start, so it never touches data/potato.db or production. Two demo accounts:
 *
 *   preview / potato-preview   rich study records + bound mailbox + pending reminders
 *   newbie  / potato-preview   empty workspace, mailbox not bound (first-time binding flow)
 *
 * A dummy-but-valid SMTP config is injected only to enable the reminder dialogs; no
 * real mail is sent because the background reminder worker is not started.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const workspace = process.cwd();
const dataDir = path.resolve(workspace, 'data/preview-ux');
if (!dataDir.startsWith(path.resolve(workspace, 'data') + path.sep)) throw new Error('Refusing to reset a data directory outside data/');
fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
process.env.DATA_DIR = dataDir;
process.env.NODE_ENV = process.env.NODE_ENV ?? 'development';
// UI-only mail configuration: makes the reminder feature available, never used to deliver.
process.env.SMTP_HOST = 'smtp.preview.invalid';
process.env.SMTP_PORT = '465';
process.env.SMTP_USER = 'preview@preview.invalid';
process.env.SMTP_PASS = 'preview-only';
process.env.SMTP_FROM = 'preview@preview.invalid';
process.env.EMAIL_CODE_SECRET = 'preview-only-email-code-secret-32chars';

const port = Number(process.env.PORT) || 3100;
const host = process.env.HOST || '127.0.0.1';
const password = 'potato-preview';
const accounts = [
  { id: 'preview', username: 'preview', nickname: '备考中的小土豆', bound: true },
  { id: 'newbie', username: 'newbie', nickname: '新同学', bound: false },
];

const { getDb, closeDb, getCurrentGenerationId } = await import('../server/db');
const { hashPassword } = await import('../server/auth');
const { syncUserWorkspace } = await import('../server/workspace');
const { BLANK_STATE, buildLibraryFromSources, getLocalDateString } = await import('../src/constants/initialData');
const { createUxPreviewFixture, createUxReminderFixture } = await import('./lib/ux-preview-fixture');
const { default: app } = await import('../server/app');

const db = getDb();
const now = Date.now();
const today = getLocalDateString(new Date(now));
const fixture = createUxPreviewFixture(today);

for (const account of accounts) {
  const passwordHash = await hashPassword(password);
  db.prepare('INSERT INTO users(id,username,nickname,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run(account.id, account.username, account.nickname, passwordHash, new Date(now).toISOString(), new Date(now).toISOString());
  const state = structuredClone(BLANK_STATE);
  if (account.id === 'preview') {
    state.profile = { ...state.profile, name: account.nickname };
    state.countdowns = fixture.countdowns;
    state.books = fixture.books;
    state.courses = fixture.courses;
    state.library = buildLibraryFromSources(fixture.books, fixture.courses);
    state.records = fixture.records;
    state.plans = fixture.plans;
  }
  const pushed = syncUserWorkspace({ userId: account.id, expectedRevision: 0, requestId: crypto.randomUUID(), generationId: getCurrentGenerationId(), schemaVersion: 3, state });
  if (!pushed.ok) throw new Error(`Failed to seed preview workspace for ${account.id}: ${JSON.stringify(pushed)}`);
  db.prepare("UPDATE workspaces SET init_choice='blank' WHERE user_id=?").run(account.id);
}

// Preview account arrives already verified; the reminder dialogs therefore open in their normal state.
db.prepare('INSERT OR REPLACE INTO account_email_bindings(user_id,email,verified_at) VALUES (?,?,?)').run('preview', 'gongkao.prepare@qq.com', now);
const generation = getCurrentGenerationId();
for (const reminder of createUxReminderFixture(now)) {
  db.prepare(`INSERT INTO email_reminders(id,user_id,request_id,payload_hash,generation_id,title,body,send_at,timezone,status,revision,attempts,next_attempt_at,lease_token,lease_until,message_id,delayed,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    reminder.id, 'preview', `req-${reminder.id}`, 'seed', generation, reminder.title, reminder.body, reminder.sendAt, 'Asia/Tokyo', reminder.status,
    reminder.revision ?? 1, 0, reminder.sendAt, null, null, `<${reminder.id}@potato.local>`, 0, reminder.created, reminder.created,
  );
}

const server = app.listen(port, host, () => {
  console.log('\n========================================');
  console.log('🥔 考公工作台 · 新版本预览（隔离数据，不影响正式数据）');
  console.log(`🌐 打开地址: http://${host}:${port}`);
  console.log('👤 主预览账号: preview / potato-preview');
  console.log('    → 26 条学习登记、已绑定 g***@qq.com、3 条待发送提醒');
  console.log('👤 首次绑定账号: newbie / potato-preview');
  console.log('    → 空工作台、邮箱未绑定');
  console.log('🔁 每次重启会重置预览数据；不会发送真实邮件，不连接线上环境');
  console.log('========================================\n');
});

async function shutdown(signal: string) {
  console.log(`收到 ${signal}，正在关闭预览服务…`);
  server.close(() => {
    try { closeDb(); } catch { /* ignore */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
