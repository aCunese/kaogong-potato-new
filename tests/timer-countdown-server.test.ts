import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-timer-countdown-server-'));
process.env.DATA_DIR = temp;

test('timer categories and custom countdowns round-trip through authenticated local sync', async () => {
  const { default: app } = await import('../server/app');
  const { createInviteCode } = await import('../server/admin');
  const { closeDb } = await import('../server/db');
  const { validateWorkspacePayload } = await import('../server/workspace');
  const { BLANK_STATE } = await import('../src/constants/initialData');
  const sessions = await import('../src/utils/timerSessions');
  const { applyAddCountdown, applyDeleteCountdown, applyUpdateCountdown } = await import('../src/utils/workflowMutators');

  const now = new Date('2026-10-28T10:00:00').getTime();
  const state: any = structuredClone(BLANK_STATE);
  // 番茄钟：开始前选类别 → 结束自动登记为自定义学习记录
  const created = sessions.applyCreateSession(state, { timerMode: 'countup', focusMinutes: 20, restMinutes: 5 }, now, '申论');
  assert.ok(!('error' in created));
  const sessionId = (created as any).value.id;
  sessions.applySessionAction(state, sessionId, 'focus', now);
  const finished = sessions.applyFinishAndAutoRegister(state, sessionId, now + 20 * 60000);
  assert.ok(!('error' in finished));
  // 倒数日：删除默认项并新增自定义项
  assert.ok(!('error' in applyDeleteCountdown(state, 'exam-national')));
  assert.ok(!('error' in applyUpdateCountdown(state, 'exam-provincial', '2027-03-14', '省考（联考）')));
  assert.ok(!('error' in applyAddCountdown(state, '考研', '2027-12-25')));

  assert.equal(validateWorkspacePayload(state, state.version).valid, true);

  // 非法番茄钟类别与非法倒数日必须被拒绝
  const invalidSubject = structuredClone(state);
  invalidSubject.timerSessions[0].subject = '综合';
  assert.equal(validateWorkspacePayload(invalidSubject, invalidSubject.version).valid, false);
  const invalidCountdownName = structuredClone(state);
  invalidCountdownName.countdowns.push({ id: 'cd-bad', name: '名'.repeat(41), date: '' });
  assert.equal(validateWorkspacePayload(invalidCountdownName, invalidCountdownName.version).valid, false);
  const invalidCountdownDate = structuredClone(state);
  invalidCountdownDate.countdowns.push({ id: 'cd-bad-date', name: '目标', date: '2026.12.01' });
  assert.equal(validateWorkspacePayload(invalidCountdownDate, invalidCountdownDate.version).valid, false);

  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const response = await fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'timer-countdown-test', password: 'test-password-only', inviteCode: createInviteCode() }),
    });
    assert.equal(response.status, 200);
    const auth = await response.json();
    const cookie = response.headers.get('set-cookie')!.split(';')[0];
    const headers = { 'content-type': 'application/json', cookie, 'x-csrf-token': auth.csrfToken, 'x-workspace-user': auth.user.id };
    const snapshot = await (await fetch(`${base}/api/workspace`, { headers })).json();
    const payload = { state, schemaVersion: state.version, requestId: 'timer-countdown-sync', expectedRevision: snapshot.revision, generationId: snapshot.generationId };
    const pushed = await fetch(`${base}/api/workspace`, { method: 'POST', headers, body: JSON.stringify(payload) });
    assert.equal(pushed.status, 200, await pushed.text());
    const cloud = await (await fetch(`${base}/api/workspace`, { headers })).json();
    const wire = (value: unknown) => JSON.parse(JSON.stringify(value)); // 与 HTTP JSON 传输保持一致（undefined 字段被省略）
    assert.deepEqual(wire(cloud.state.timerSessions), wire(state.timerSessions));
    assert.deepEqual(wire(cloud.state.countdowns), wire(state.countdowns));
    assert.deepEqual(wire(cloud.state.records), wire(state.records));
    assert.deepEqual(wire(cloud.state.plans), wire(state.plans));
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
