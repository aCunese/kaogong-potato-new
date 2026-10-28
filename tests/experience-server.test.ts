import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-experience-server-'));
process.env.DATA_DIR = temp;

test('schema4 round-trip, legacy idempotent replay, downgrade fence, seed merge and admin backup restore', async () => {
  const { default: app } = await import('../server/app');
  const admin = await import('../server/admin');
  const { closeDb } = await import('../server/db');
  const { BLANK_STATE } = await import('../src/constants/initialData');
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const invite = admin.createInviteCode();
  const register = (name: string) => fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: name, password: 'test-password-only', inviteCode: invite }) });
  try {
    const response = await register('experience-test'); assert.equal(response.status, 200);
    const auth = await response.json(); const cookie = response.headers.get('set-cookie')!.split(';')[0];
    const headers = { 'content-type': 'application/json', cookie, 'x-csrf-token': auth.csrfToken, 'x-workspace-user': auth.user.id };
    const snapshot = await (await fetch(`${base}/api/workspace`, { headers })).json();
    const legacy = { requestId: 'legacy-experience', expectedRevision: snapshot.revision, schemaVersion: 3, generationId: snapshot.generationId, state: structuredClone(BLANK_STATE) };
    const push = (body: any) => fetch(`${base}/api/workspace`, { method: 'POST', headers, body: JSON.stringify(body) });
    const accepted = await push(legacy); assert.equal(accepted.status, 200);
    const legacyResult = await accepted.json();
    const upgraded = { ...structuredClone(BLANK_STATE), version: 4, todos: [{ id: 't1', text: 'preserve me', date: '2026-10-27', done: false, createdAt: 1234, completedAt: 0 }] };
    const next = await push({ ...legacy, requestId: 'new-experience', expectedRevision: legacyResult.revision, schemaVersion: 4, state: upgraded }); assert.equal(next.status, 200);
    const nextResult = await next.json();
    assert.equal((await push({ ...legacy, requestId: 'downgrade-experience', expectedRevision: nextResult.revision })).status, 426);
    const replay = await push(legacy); assert.equal(replay.status, 200); assert.equal((await replay.json()).idempotent, true);
    const cloud = await (await fetch(`${base}/api/workspace`, { headers })).json(); assert.deepEqual(cloud.state, upgraded); assert.equal(cloud.schemaVersion, 4);
    const seedResponse = await fetch(`${base}/api/workspace/init-choice`, { method: 'POST', headers, body: JSON.stringify({ choice: 'default' }) }); assert.equal(seedResponse.status, 200);
    const seeded = await (await fetch(`${base}/api/workspace`, { headers })).json(); assert.equal(seeded.state.version, 4); assert.deepEqual(seeded.state.todos, upgraded.todos); assert.equal(seeded.schemaVersion, 4);
    const restored = admin.restoreUserWorkspace(auth.user.id, JSON.stringify(upgraded), 'experience-test'); assert.equal(restored.ok, true);
    const afterRestore = await (await fetch(`${base}/api/workspace`, { headers })).json(); assert.equal(afterRestore.schemaVersion, 4); assert.deepEqual(afterRestore.state.todos, upgraded.todos);
    const { applyCreateSession, applySessionAction } = await import('../src/utils/timerSessions');
    const v5 = structuredClone(upgraded) as any;
    const started = applyCreateSession(v5, { timerMode: 'pomodoro', focusMinutes: 25, restMinutes: 5 }, 1000000);
    assert.ok('value' in started);
    if ('value' in started) {
      applySessionAction(v5, started.value.id, 'focus', 1000000);
      applySessionAction(v5, started.value.id, 'rest', 2800000);
      applySessionAction(v5, started.value.id, 'finish', 3400000);
    }
    const v5push = await push({ ...legacy, requestId: 'schema-five', state: v5, schemaVersion: 5, expectedRevision: afterRestore.revision, generationId: afterRestore.generationId });
    assert.equal(v5push.status, 200, await v5push.text());
    const v5cloud = await (await fetch(`${base}/api/workspace`, { headers })).json();
    assert.deepEqual(v5cloud.state.timerSessions, v5.timerSessions); assert.equal(v5cloud.schemaVersion, 5);
    assert.equal((await push({ ...legacy, requestId: 'downgrade-five', state: upgraded, schemaVersion: 4, expectedRevision: v5cloud.revision, generationId: v5cloud.generationId })).status, 426);
    const v5restore = admin.restoreUserWorkspace(auth.user.id, JSON.stringify(v5), 'schema-five-test'); assert.equal(v5restore.ok, true);
    assert.equal((await register('friend-reused-code')).status, 400);
    // The disaster-recovery manifest describes the database container, while each workspace has its own format.
    const { execFileSync } = await import('node:child_process');
    const backupDir = path.join(temp, 'backup');
    execFileSync(process.execPath, ['--import', 'tsx', 'server/cli.ts', 'hot-backup', backupDir], { env: { ...process.env, DATA_DIR: temp }, stdio: 'pipe' });
    const { restoreOffline } = await import('../server/disasterRecovery');
    const restoredDir = path.join(temp, 'restored');
    await restoreOffline({ sourceDir: backupDir, dataDir: restoredDir, offlineConfirmed: true });
    const { default: Database } = await import('better-sqlite3');
    const restoredDb = new Database(path.join(restoredDir, 'potato.db'), { readonly: true });
    try {
      const row = restoredDb.prepare('SELECT state_json, schema_version FROM workspaces WHERE user_id = ?').get(auth.user.id) as any;
      assert.equal(row.schema_version, 5); assert.deepEqual(JSON.parse(row.state_json).timerSessions, v5.timerSessions);
    } finally { restoredDb.close(); }

  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); closeDb(); fs.rmSync(temp, { recursive: true, force: true });
  }
});
