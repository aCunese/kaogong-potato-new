import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-account-integration-'));
process.env.DATA_DIR = path.join(temp, 'data');
delete process.env.SMTP_PASS;
const { getDb, closeDb, backupDatabaseOnline } = await import('../server/db');
const { createSession } = await import('../server/auth');
const { default: app } = await import('../server/app');
const { validateRestoreDatabase, restoreOffline } = await import('../server/disasterRecovery');
const db = getDb();
db.prepare("INSERT INTO users (id,username,nickname,password_hash,created_at,updated_at) VALUES ('integration','integration','Integration','unused',datetime('now'),datetime('now'))").run();
const session = createSession('integration');
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
const headers = { cookie: `potato_session=${session.token}`, 'x-csrf-token': session.csrfToken, 'x-workspace-user': 'integration', 'content-type': 'application/json' };
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); closeDb(); fs.rmSync(temp, {recursive:true,force:true}); });

test('serves the built SPA when the checkout has a hidden parent directory', {skip:!fs.existsSync(path.resolve('dist/index.html'))}, async () => {
  assert.equal((await fetch(base + '/index.html')).status, 200);
  assert.equal((await fetch(base + '/')).status, 200);
});

test('normal database bootstrap migrates account features atomically and mounts their authenticated routes', async () => {
  const status = await fetch(base + '/api/account/email', {headers});
  assert.equal(status.status, 200);
  assert.equal((await status.json()).available, false);
  assert.deepEqual(db.prepare("SELECT value FROM server_meta WHERE key='account_features_schema'").get(), { value: '1' });
  assert.equal((await fetch(base + '/api/sharing/grants', {headers})).status, 200);
  assert.equal((await fetch(base + '/api/sharing/grants')).status, 401);
  assert.equal((await fetch(base + '/api/sharing/codes', {method:'POST', headers:{...headers, 'x-workspace-user':'another'}, body:'{}'})).status, 409);
});

test('backup schema validation rejects an incomplete new feature schema without changing its source', async () => {
  const backup = path.join(temp, 'check.db');
  await backupDatabaseOnline(backup);
  const copy = new Database(backup);
  try {
    validateRestoreDatabase(copy, 'source');
    copy.exec('DROP TABLE sharing_grants');
    assert.throws(() => validateRestoreDatabase(copy, 'source'), /ACCOUNT_FEATURE_SCHEMA/);
  } finally { copy.close(); }
});

test('a real offline restore invalidates sharing and pauses unsent mail without losing the verified binding', async () => {
  const {createReminderService} = await import('../server/reminders');
  const generation = (db.prepare("SELECT value FROM server_meta WHERE key='generation_id'").get() as any).value;
  db.prepare("INSERT INTO account_email_bindings VALUES ('integration','isolated@example.test',?)").run(Date.now());
  const reminder = createReminderService({db}).create('integration',{requestId:'restore-proof',title:'Recovery test',body:'',sendAt:new Date(Date.now()+3600000).toISOString(),timezone:'Asia/Tokyo'});
  db.prepare("INSERT INTO users(id,username,nickname,password_hash,created_at,updated_at) VALUES ('viewer','viewer','Viewer','unused',datetime('now'),datetime('now'))").run();
  db.prepare('INSERT INTO sharing_grants(id,owner_id,viewer_id,generation_id,created_at) VALUES (?,?,?,?,?)').run('restored-grant','integration','viewer',generation,new Date().toISOString());
  db.prepare('INSERT INTO email_challenges(id,user_id,email,code_hash,generation_id,created_at,expires_at) VALUES (?,?,?,?,?,?,?)').run('old-challenge','integration','isolated@example.test','test-hmac',generation,Date.now(),Date.now()+600000);
  const source=path.join(temp,'backup'),target=path.join(temp,'restored');fs.mkdirSync(source);
  const file=path.join(source,'potato.db');await backupDatabaseOnline(file);
  const bytes=fs.readFileSync(file);
  fs.writeFileSync(path.join(source,'manifest.json'),JSON.stringify({version:'1.0.9',schemaVersion:3,createdAt:new Date().toISOString(),generationId:generation,database:{filename:'potato.db',sha256:crypto.createHash('sha256').update(bytes).digest('hex'),byteSize:bytes.length},attachments:[]}));
  const restored=await restoreOffline({sourceDir:source,dataDir:target,offlineConfirmed:true});
  const copy=new Database(restored.databasePath,{readonly:true});
  try {
    assert.notEqual(restored.generationId,generation);
    assert.equal((copy.prepare('SELECT status FROM email_reminders WHERE id=?').get(reminder.id) as any).status,'needs_review');
    assert.equal((copy.prepare('SELECT COUNT(*) AS n FROM email_challenges').get() as any).n,0);
    assert.equal((copy.prepare('SELECT COUNT(*) AS n FROM sharing_grants WHERE generation_id=? AND revoked_at IS NULL').get(restored.generationId) as any).n,0);
    assert.equal((copy.prepare('SELECT COUNT(*) AS n FROM sessions').get() as any).n,0);
    assert.equal((copy.prepare("SELECT email FROM account_email_bindings WHERE user_id='integration'").get() as any).email,'isolated@example.test');
    validateRestoreDatabase(copy,'final');
  } finally {copy.close();}
});
