import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-custom-server-'));
process.env.DATA_DIR = temp;

test('custom other round-trips through authenticated local sync and rejects invalid subjects by type', async () => {
  const { default: app } = await import('../server/app');
  const { createInviteCode } = await import('../server/admin');
  const { closeDb } = await import('../server/db');
  const { validateWorkspacePayload } = await import('../server/workspace');
  const { BLANK_STATE } = await import('../src/constants/initialData');
  const state: any = structuredClone(BLANK_STATE);
  state.plans = [{ id: 'custom-plan', type: 'custom', name: '整理备考计划', subject: '其他', date: '2026-10-28', libraryId: '', sourceId: '', plannedMinutes: 30, actualMinutes: 15, accumulatedMs: 900000, done: true, timerStart: 0, recordId: 'custom-record' }];
  state.records = [{ id: 'custom-record', planId: 'custom-plan', type: 'custom', subject: '其他', sourceId: '', date: '2026-10-28', minutes: 15, questions: 0, errors: 0 }];
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    assert.equal(validateWorkspacePayload(state, state.version).valid, true);
    for (const type of ['book', 'course']) {
      for (const field of ['plans', 'records']) {
        const invalid = structuredClone(state); invalid[field][0].type = type;
        assert.equal(validateWorkspacePayload(invalid, invalid.version).valid, false, `${field} ${type} must not accept other`);
      }
    }
    for (const subject of ['未知科目', '', null]) {
      const invalid = structuredClone(state); invalid.plans[0].subject = subject;
      assert.equal(validateWorkspacePayload(invalid, invalid.version).valid, false);
    }
    const library = structuredClone(state); library.library = [{ id: 'custom-library', type: 'custom', sourceId: '', name: '计划', subject: '其他', defaultMinutes: 15 }];
    assert.equal(validateWorkspacePayload(library, library.version).valid, true);
    for (const type of ['book', 'course']) {
      library.library[0].type = type;
      assert.equal(validateWorkspacePayload(library, library.version).valid, false);
    }
    const response = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'custom-test', password: 'test-password-only', inviteCode: createInviteCode() }) });
    assert.equal(response.status, 200);
    const auth = await response.json();
    const cookie = response.headers.get('set-cookie')!.split(';')[0];
    const headers = { 'content-type': 'application/json', cookie, 'x-csrf-token': auth.csrfToken, 'x-workspace-user': auth.user.id };
    const snapshot = await (await fetch(`${base}/api/workspace`, { headers })).json();
    const payload = { state, schemaVersion: state.version, requestId: 'custom-other-sync', expectedRevision: snapshot.revision, generationId: snapshot.generationId };
    const pushed = await fetch(`${base}/api/workspace`, { method: 'POST', headers, body: JSON.stringify(payload) });
    assert.equal(pushed.status, 200, await pushed.text());
    const cloud = await (await fetch(`${base}/api/workspace`, { headers })).json();
    assert.deepEqual(cloud.state.plans, state.plans);
    assert.deepEqual(cloud.state.records, state.records);
    const replay = await fetch(`${base}/api/workspace`, { method: 'POST', headers, body: JSON.stringify(payload) });
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).idempotent, true);
    const exported = await fetch(`${base}/api/backups/export`, { headers });
    assert.equal(exported.status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    closeDb();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
