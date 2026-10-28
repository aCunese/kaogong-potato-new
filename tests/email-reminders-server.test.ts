import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';
import cookieParser from 'cookie-parser';
import nodemailer from 'nodemailer';
import net from 'node:net';
import { initEmailSchema, createAccountEmailService } from '../server/accountEmail';
import { createReminderService, startReminderWorker } from '../server/reminders';
import { createEmailRouter } from '../server/emailRoutes';
import { MailDeliveryError, createSmtpMailSender, type MailMessage } from '../server/mailTransport';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-email-test-'));
  const db = new Database(path.join(dir, 'test.db'));
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, is_active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE server_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO server_meta VALUES ('generation_id', 'generation-a');
    INSERT INTO users (id) VALUES ('alice'), ('bob');`);
  let clock = Date.parse('2030-01-01T00:00:00.000Z');
  let failure: Error | undefined;
  const messages: MailMessage[] = [];
  const sender = {
    available: true,
    async send(message: MailMessage) { if (failure) throw failure; messages.push(message); },
  };
  initEmailSchema(db);
  const deps = { db, sender, now: () => clock, secret: 'fixture-only-code-hmac-key-32-characters' };
  const email = createAccountEmailService(deps);
  const reminders = createReminderService(deps);
  const input = (requestId = 'request-one', delay = 60_000) => ({ requestId, title: 'Read chapter one', body: 'Practice ten questions', sendAt: new Date(clock + delay).toISOString(), timezone: 'Asia/Tokyo' });
  const code = () => messages.at(-1)!.text.match(/\b\d{6}\b/)![0];
  const bind = async (userId = 'alice', address = 'reader@example.invalid') => {
    const challenge = await email.requestCode(userId, '127.0.0.1', address);
    email.verifyCode(userId, challenge.challengeId, code());
  };
  return { db, deps, email, reminders, sender, messages, input, code, bind,
    advance: (ms: number) => { clock += ms; },
    fail: (error?: Error) => { failure = error; },
    close: () => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('SMTP transport treats a lost DATA acknowledgement reported as CONN as unknown', async () => {
  const original=nodemailer.createTransport;
  try {
    for (const [smtp,kind] of [
      [{code:'ECONNECTION',command:'CONN'},'unknown'],
      [{code:'ETIMEDOUT',command:'CONN'},'unknown'],
      [{code:'ESOCKET',command:'CONN'},'unknown'],
      [{responseCode:421,command:'DATA'},'transient'],
      [{responseCode:550,command:'DATA'},'permanent'],
    ] as const) {
      nodemailer.createTransport=(()=>({sendMail:async()=>{throw smtp;},close:()=>{}})) as any;
      const sender=createSmtpMailSender({SMTP_HOST:'smtp.example.invalid',SMTP_PORT:'465',SMTP_USER:'sender',SMTP_PASS:'test-only',SMTP_FROM:'sender@example.invalid'});
      await assert.rejects(sender.send({to:'recipient@example.invalid',subject:'Test',text:'Test',messageId:'<isolated@test.invalid>'}),error=>error instanceof MailDeliveryError && error.kind===kind);
    }
  } finally {nodemailer.createTransport=original;}
});

test('real Nodemailer socket loss after complete DATA is never retried automatically', async () => {
  let receivedData=false;
  const sockets=new Set<net.Socket>();
  const server=net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.setEncoding('utf8');socket.write('220 localhost SMTP\r\n');
    let buffer='', data=false;
    socket.on('data',chunk=>{
      buffer+=chunk;
      if(data){if(buffer.includes('\r\n.\r\n')){receivedData=true;socket.destroy();}return;}
      while(buffer.includes('\r\n')){
        const end=buffer.indexOf('\r\n'),line=buffer.slice(0,end);buffer=buffer.slice(end+2);
        if(line.startsWith('EHLO')||line.startsWith('HELO'))socket.write('250 localhost\r\n');
        else if(line.startsWith('MAIL FROM')||line.startsWith('RCPT TO'))socket.write('250 OK\r\n');
        else if(line==='DATA'){data=true;socket.write('354 End with dot\r\n');break;}
        else if(line==='QUIT')socket.end('221 Bye\r\n');
      }
    });
  });
  server.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const original=nodemailer.createTransport;
  try {
    // Redirect only the external connection settings; exercise real Nodemailer DATA and socket handling.
    nodemailer.createTransport=((options:any)=>original({...options,host:'127.0.0.1',port:(server.address() as net.AddressInfo).port,secure:false,requireTLS:false,ignoreTLS:true,auth:undefined})) as any;
    const sender=createSmtpMailSender({SMTP_HOST:'smtp.example.invalid',SMTP_PORT:'465',SMTP_USER:'sender',SMTP_PASS:'test-only',SMTP_FROM:'sender@example.invalid'});
    await assert.rejects(sender.send({to:'recipient@example.invalid',subject:'Isolated test',text:'Complete DATA accepted then acknowledgement lost',messageId:'<loopback@test.invalid>'}),error=>error instanceof MailDeliveryError&&error.kind==='unknown');
    assert.equal(receivedData,true);
  } finally {nodemailer.createTransport=original;for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('all active reminders remain manageable after more than two hundred newer completed reminders', async () => {
  const f=fixture();
  try {
    await f.bind();
    const pending=f.reminders.create('alice',f.input('long-term',86400000));
    for(let index=0;index<205;index++) {
      f.advance(1);
      const historical=f.reminders.create('alice',f.input('history-'+index));
      f.db.prepare("UPDATE email_reminders SET status='sent' WHERE id=?").run(historical.id);
    }
    const visible=f.reminders.list('alice');
    const active=visible.find(reminder=>reminder.id===pending.id);
    assert.ok(active);
    assert.equal(active.status,'pending');
    assert.equal(f.reminders.cancel('alice',active.id,active.revision).status,'cancelled');
  } finally {f.close();}
});

// Removing the challenge owner, TTL, cooldown, or attempt checks must fail these cases.
test('verification is owner scoped, expiring, hashed, cooldown limited and locks after five attempts', async () => {
  const f = fixture();
  try {
    const challenge = await f.email.requestCode('alice', '127.0.0.1', 'reader@example.invalid');
    const code = f.code();
    const row = f.db.prepare('SELECT * FROM email_challenges WHERE id = ?').get(challenge.challengeId) as any;
    assert.notEqual(row.code_hash, code);
    assert.equal(row.code_hash.includes(code), false);
    assert.throws(() => f.email.verifyCode('bob', challenge.challengeId, code), { code: 'INVALID_CODE' });
    await assert.rejects(f.email.requestCode('alice', '127.0.0.1', 'second@example.invalid'), { code: 'CODE_COOLDOWN' });
    const wrongCode = code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) assert.throws(() => f.email.verifyCode('alice', challenge.challengeId, wrongCode), { code: 'INVALID_CODE' });
    assert.throws(() => f.email.verifyCode('alice', challenge.challengeId, code), { code: 'INVALID_CODE' });
    f.advance(60_001);
    const expiring = await f.email.requestCode('alice', '127.0.0.1', 'reader@example.invalid');
    const expiringCode = f.code();
    f.advance(600_000);
    assert.throws(() => f.email.verifyCode('alice', expiring.challengeId, expiringCode), { code: 'INVALID_CODE' });
    assert.equal(f.email.status('alice').bound, false);
  } finally { f.close(); }
});

test('binding only changes after new address verifies and status masks the recipient', async () => {
  const f = fixture();
  try {
    await f.bind();
    assert.equal(f.email.status('alice').bound, true);
    assert.equal(f.email.status('alice').maskedEmail, 'r***@example.invalid');
    assert.equal(JSON.stringify(f.email.status('alice')).includes('reader@'), false);
    f.advance(60_001);
    const replacement = await f.email.requestCode('alice', '127.0.0.1', 'next@example.invalid');
    assert.equal(f.email.verifiedAddress('alice'), 'reader@example.invalid');
    f.email.verifyCode('alice', replacement.challengeId, f.code());
    assert.equal(f.email.verifiedAddress('alice'), 'next@example.invalid');
    assert.throws(() => f.email.verifyCode('alice', replacement.challengeId, f.code()), { code: 'INVALID_CODE' });
  } finally { f.close(); }
});

test('persistent address and user request limits prevent resend abuse after cooldown', async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 5; i++) {
      await f.email.requestCode('alice', `ip-${i}`, 'reader@example.invalid');
      f.advance(60_001);
    }
    await assert.rejects(f.email.requestCode('bob', 'other-ip', 'reader@example.invalid'), { code: 'RATE_LIMITED' });
    await assert.rejects(f.email.requestCode('alice', 'other-ip', 'other@example.invalid'), { code: 'RATE_LIMITED' });
  } finally { f.close(); }
});

test('one-shot create is idempotent only for same payload and edits/cancels use owner plus revision', async () => {
  const f = fixture();
  try {
    await f.bind();
    const input = f.input();
    const first = f.reminders.create('alice', input);
    const replay = f.reminders.create('alice', input);
    assert.equal(first.id, replay.id);
    assert.equal(f.reminders.list('alice').length, 1);
    assert.throws(() => f.reminders.create('alice', { ...input, title: 'Different payload' }), { code: 'IDEMPOTENCY_CONFLICT' });
    assert.throws(() => f.reminders.update('bob', first.id, { ...input, revision: first.revision }), { code: 'NOT_FOUND' });
    const edited = f.reminders.update('alice', first.id, { ...input, title: 'Revised title', revision: first.revision });
    assert.equal(edited.revision, first.revision + 1);
    assert.throws(() => f.reminders.cancel('alice', first.id, first.revision), { code: 'REVISION_CONFLICT' });
    assert.equal(f.reminders.cancel('alice', first.id, edited.revision).status, 'cancelled');
    assert.equal(f.reminders.list('bob').length, 0);
  } finally { f.close(); }
});

test('schedule validation rejects missing binding, past time, invalid timezone and more than fifty pending', async () => {
  const f = fixture();
  try {
    assert.throws(() => f.reminders.create('alice', f.input()), { code: 'EMAIL_NOT_BOUND' });
    await f.bind();
    for (const patch of [{ title: '' }, { title: 'x'.repeat(101) }, { body: 'x'.repeat(1001) }, { sendAt: '2020-01-01T00:00:00.000Z' }, { timezone: 'invalid/zone' }, { sendAt: '2030-01-01T02:00:00' }]) {
      assert.throws(() => f.reminders.create('alice', { ...f.input(), ...patch }), { code: 'INVALID_REMINDER' });
    }
    for (let i = 0; i < 50; i++) f.reminders.create('alice', f.input(`quota-${i}`));
    assert.throws(() => f.reminders.create('alice', f.input('overflow')), { code: 'REMINDER_LIMIT' });
  } finally { f.close(); }
});

test('worker sends to the latest verified address exactly once across competing polls', async () => {
  const f = fixture();
  let worker: ReturnType<typeof startReminderWorker> | undefined;
  try {
    await f.bind();
    const reminder = f.reminders.create('alice', f.input());
    f.advance(60_001);
    const c = await f.email.requestCode('alice', '127.0.0.1', 'next@example.invalid');
    f.email.verifyCode('alice', c.challengeId, f.code());
    f.messages.length = 0;
    worker = startReminderWorker({ ...f.deps, autoStart: false });
    await Promise.all([worker.poll(), worker.poll()]);
    assert.equal(f.reminders.list('alice')[0].status, 'sent');
    assert.equal(f.messages.length, 1);
    assert.equal(f.messages[0].to, 'next@example.invalid');
    assert.equal(f.messages[0].messageId, reminder.messageId);
    await worker.poll();
    assert.equal(f.messages.length, 1);
  } finally { await worker?.stop(); f.close(); }
});

test('definite transient rejection retries at one and five minutes; uncertain delivery never auto retries', async () => {
  const f = fixture();
  let worker: ReturnType<typeof startReminderWorker> | undefined;
  try {
    await f.bind();
    f.reminders.create('alice', f.input());
    f.advance(60_001);
    f.fail(new MailDeliveryError('transient'));
    worker = startReminderWorker({ ...f.deps, autoStart: false });
    await worker.poll();
    assert.equal(f.reminders.list('alice')[0].status, 'retry');
    assert.equal(f.reminders.list('alice')[0].attempts, 1);
    f.advance(59_999);
    await worker.poll();
    assert.equal(f.reminders.list('alice')[0].attempts, 1);
    f.advance(1);
    await worker.poll();
    assert.equal(f.reminders.list('alice')[0].attempts, 2);
    f.advance(300_000);
    await worker.poll();
    assert.equal(f.reminders.list('alice')[0].status, 'failed');
    const second = f.reminders.create('alice', f.input('uncertain'));
    f.advance(60_001);
    f.fail(new MailDeliveryError('unknown'));
    await worker.poll();
    assert.equal(f.reminders.list('alice').find(r => r.id === second.id)?.status, 'unknown');
    f.fail(); f.advance(3_600_000); await worker.poll();
    assert.equal(f.reminders.list('alice').find(r => r.id === second.id)?.attempts, 1);
  } finally { await worker?.stop(); f.close(); }
});

test('interrupted sends recover to unknown and restore generation invalidates queued jobs and codes', async () => {
  const f = fixture();
  let worker: ReturnType<typeof startReminderWorker> | undefined;
  try {
    await f.bind();
    const interrupted = f.reminders.create('alice', f.input('interrupted'));
    f.db.prepare("UPDATE email_reminders SET status = 'sending', lease_token = 'old-fence', lease_until = ? WHERE id = ?").run(Date.parse('2029-12-31T23:59:59Z'), interrupted.id);
    worker = startReminderWorker({ ...f.deps, autoStart: false });
    assert.equal(f.reminders.list('alice')[0].status, 'unknown');
    const pending = f.reminders.create('alice', f.input('restored'));
    f.advance(60_001);
    const c = await f.email.requestCode('alice', '127.0.0.1', 'other@example.invalid');
    const oldCode = f.code();
    f.db.prepare("UPDATE server_meta SET value = 'generation-b' WHERE key = 'generation_id'").run();
    initEmailSchema(f.db);
    assert.equal(f.reminders.list('alice').find(r => r.id === pending.id)?.status, 'needs_review');
    assert.throws(() => f.email.verifyCode('alice', c.challengeId, oldCode), { code: 'INVALID_CODE' });
    await worker.poll();
    assert.equal(f.reminders.list('alice').find(r => r.id === pending.id)?.attempts, 0);
  } finally { await worker?.stop(); f.close(); }
});

test('unbinding cancels queued deliveries while keeping in-flight state and prevents further claims', async () => {
  const f = fixture();
  let worker: ReturnType<typeof startReminderWorker> | undefined;
  try {
    await f.bind();
    const first = f.reminders.create('alice', f.input('first'));
    const second = f.reminders.create('alice', f.input('second'));
    worker = startReminderWorker({ ...f.deps, autoStart: false });
    f.db.prepare("UPDATE email_reminders SET status = 'sending' WHERE id = ?").run(first.id);
    assert.throws(() => f.reminders.cancel('alice', first.id, first.revision), { code: 'REMINDER_LOCKED' });
    f.email.unbind('alice');
    assert.equal(f.reminders.list('alice').find(r => r.id === first.id)?.status, 'sending');
    assert.equal(f.reminders.list('alice').find(r => r.id === second.id)?.status, 'cancelled');
    f.advance(60_001); await worker.poll();
    assert.equal(f.email.status('alice').bound, false);
  } finally { await worker?.stop(); f.close(); }
});

test('late reminders within one day send marked delayed; older reminders become missed', async () => {
  const f = fixture();
  let worker: ReturnType<typeof startReminderWorker> | undefined;
  try {
    await f.bind();
    const old = f.reminders.create('alice', f.input('old'));
    f.advance(86_400_001);
    const recent = f.reminders.create('alice', f.input('recent'));
    f.advance(120_001); f.messages.length = 0;
    worker = startReminderWorker({ ...f.deps, autoStart: false });
    await worker.poll();
    assert.equal(f.reminders.list('alice').find(r => r.id === old.id)?.status, 'missed');
    assert.equal(f.reminders.list('alice').find(r => r.id === recent.id)?.status, 'sent');
    assert.equal(f.reminders.list('alice').find(r => r.id === recent.id)?.delayed, true);
    assert.equal(f.messages.length, 1);
  } finally { await worker?.stop(); f.close(); }
});

test('shutdown stops new claims and fences late completion of an uncertain in-flight delivery', async () => {
  const f = fixture();
  let complete!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const stuck = new Promise<void>(resolve => { complete = resolve; });
  let worker: ReturnType<typeof startReminderWorker> | undefined;
  try {
    await f.bind();
    f.reminders.create('alice', f.input('stuck'));
    f.reminders.create('alice', f.input('queued'));
    f.advance(60_001);
    worker = startReminderWorker({ ...f.deps, sender: { available: true, async send() { entered(); await stuck; } }, autoStart: false, drainTimeoutMs: 30 });
    const polling = worker.poll();
    await started;
    const before = performance.now();
    await worker.stop();
    assert.ok(performance.now() - before < 1000);
    assert.deepEqual(f.reminders.list('alice').map(r => r.status).sort(), ['pending', 'unknown']);
    complete(); await polling;
    assert.deepEqual(f.reminders.list('alice').map(r => r.status).sort(), ['pending', 'unknown']);
  } finally { complete?.(); await worker?.stop(); f.close(); }
});

test('SMTP missing or insecure configuration is unavailable without breaking account read access', () => {
  assert.equal(createSmtpMailSender({}).available, false);
  assert.equal(createSmtpMailSender({ SMTP_HOST: 'smtp.example.invalid', SMTP_PORT: '25', SMTP_USER: 'fixture-user', SMTP_PASS: 'fixture-password', SMTP_FROM: 'sender@example.invalid' }).available, false);
});

test('HTTP boundary enforces login, CSRF, session owner and never returns recipient or SMTP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-email-routes-'));
  process.env.DATA_DIR = dir;
  const { getDb, closeDb } = await import('../server/db');
  const { createSession } = await import('../server/auth');
  const db = getDb(); initEmailSchema(db);
  for (const id of ['route-alice', 'route-bob']) db.prepare('INSERT INTO users (id, username, nickname, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, id, id, 'unused-fixture-hash', new Date().toISOString(), new Date().toISOString());
  const session = createSession('route-alice');
  const app = express(); app.use(express.json(), cookieParser());
  app.use(createEmailRouter({ db, sender: { available: true, async send() { throw new Error('sensitive-smtp-response'); } }, secret: 'fixture-secret-for-route-tests' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const headers = { 'content-type': 'application/json', cookie: `potato_session=${session.token}`, 'x-csrf-token': session.csrfToken, 'x-workspace-user': 'route-alice' };
  try {
    assert.equal((await fetch(`${base}/api/account/email`)).status, 401);
    assert.equal((await fetch(`${base}/api/account/email/code`, { method: 'POST', headers: { ...headers, 'x-csrf-token': '' }, body: JSON.stringify({ email: 'reader@example.invalid' }) })).status, 403);
    assert.equal((await fetch(`${base}/api/reminders`, { headers: { ...headers, 'x-workspace-user': 'route-bob' } })).status, 409);
    const response = await fetch(`${base}/api/account/email/code`, { method: 'POST', headers, body: JSON.stringify({ email: 'reader@example.invalid', userId: 'route-bob' }) });
    assert.equal(response.status, 503);
    assert.equal((await response.text()).includes('sensitive-smtp-response'), false);
    assert.equal(db.prepare('SELECT user_id FROM email_challenges WHERE user_id = ?').get('route-bob'), undefined);
    const status = await fetch(`${base}/api/account/email`, { headers });
    assert.equal(status.status, 200);
    assert.equal((await status.json()).available, true);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    closeDb(); fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('another worker preserves an unexpired sending lease and cannot duplicate the delivery', async () => {
  const f = fixture();
  let complete!: () => void;
  let entered!: () => void;
  let sends = 0;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const awaiting = new Promise<void>(resolve => { complete = resolve; });
  let first: ReturnType<typeof startReminderWorker> | undefined;
  let second: ReturnType<typeof startReminderWorker> | undefined;
  try {
    await f.bind();
    f.reminders.create('alice', f.input('shared-lease'));
    f.advance(60_001);
    const sender = { available: true, async send() { sends++; entered(); await awaiting; } };
    first = startReminderWorker({ ...f.deps, sender, autoStart: false });
    const polling = first.poll();
    await started;
    second = startReminderWorker({ ...f.deps, sender, autoStart: false });
    assert.equal(f.reminders.list('alice')[0].status, 'sending');
    await second.poll();
    assert.equal(sends, 1);
    complete(); await polling;
    assert.equal(f.reminders.list('alice')[0].status, 'sent');
  } finally { complete?.(); await first?.stop(); await second?.stop(); f.close(); }
});

test('routine poll lateness within sixty seconds is not presented as an outage delay', async () => {
  const f = fixture();
  let worker: ReturnType<typeof startReminderWorker> | undefined;
  try {
    await f.bind();
    f.reminders.create('alice', f.input('normal-poll'));
    f.advance(90_000); f.messages.length = 0;
    worker = startReminderWorker({ ...f.deps, autoStart: false });
    await worker.poll();
    assert.equal(f.reminders.list('alice')[0].delayed, false);
    assert.equal(f.messages[0].text.includes('延后发送'), false);
  } finally { await worker?.stop(); f.close(); }
});

test('calendar overflow is rejected and omitted reminder body means an empty message', async () => {
  const f = fixture();
  try {
    await f.bind();
    assert.throws(() => f.reminders.create('alice', { ...f.input('calendar'), sendAt: '2030-02-30T00:00:00.000Z' }), { code: 'INVALID_REMINDER' });
    const { body: _body, ...withoutBody } = f.input('optional-body');
    assert.equal(f.reminders.create('alice', withoutBody).body, '');
  } finally { f.close(); }
});

test('shutdown keeps a definitely rejected transient send retryable without claiming another reminder', async () => {
  const f = fixture();
  let reject!: (error: Error) => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const sending = new Promise<void>((_resolve, decline) => { reject = decline; });
  let worker: ReturnType<typeof startReminderWorker> | undefined;
  try {
    await f.bind();
    f.reminders.create('alice', f.input('shutdown-retry'));
    f.reminders.create('alice', f.input('shutdown-pending'));
    f.advance(60_001);
    worker = startReminderWorker({ ...f.deps, sender: { available: true, async send() { entered(); await sending; } }, autoStart: false });
    const polling = worker.poll(); await started;
    const stopping = worker.stop(); reject(new MailDeliveryError('transient'));
    await stopping; await polling;
    assert.deepEqual(f.reminders.list('alice').map(r => r.status).sort(), ['pending', 'retry']);
  } finally { await worker?.stop(); f.close(); }
});
