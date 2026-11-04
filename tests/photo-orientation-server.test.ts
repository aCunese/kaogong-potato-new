import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-orientation-sync-'));
process.env.DATA_DIR = temp;

test('orientation and repeatable edits survive authenticated sync and portable backup restore on schema 5', async () => {
  const { default: app } = await import('../server/app');
  const { createInviteCode } = await import('../server/admin');
  const { closeDb } = await import('../server/db');
  const { saveUserMedia } = await import('../server/media');
  const { validateWorkspacePayload } = await import('../server/workspace');
  const { validateAndMigrateBackup } = await import('../src/utils/backupValidator');
  const { BLANK_STATE } = await import('../src/constants/initialData');
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const response = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'photo-sync-test', password: 'local-test-only', inviteCode: createInviteCode() }) });
    assert.equal(response.status, 200);
    const auth = await response.json();
    const headers = { 'content-type': 'application/json', cookie: response.headers.get('set-cookie')!.split(';')[0], 'x-csrf-token': auth.csrfToken, 'x-workspace-user': auth.user.id };
    const png = fs.readFileSync(path.resolve('tests/fixtures/image-orientation/blank.png'));
    const media = saveUserMedia(auth.user.id, png, 'photo.png').media!;
    const ref = `/api/media/${media.id}`;
    const state = structuredClone(BLANK_STATE); state.version = 5;
    state.wrong = [{ id: 'w', bookId: '申论', subject: '申论', date: '2026-11-04', note: '初稿', image: ref, images: [ref, ref], imageOrientations: [{ status: 'resolved', rotation: 270, version: 1 }, null] }];
    const validation = validateWorkspacePayload(state, 5);
    assert.equal(validation.valid, true, validation.message);
    for (const value of [[{ status: 'resolved', rotation: 45, version: 1 }], [null, null, null], [{ status: 'unresolved', rotation: 90, version: 1 }]]) {
      const invalid = structuredClone(state); invalid.wrong[0].imageOrientations = value as any;
      assert.equal(validateWorkspacePayload(invalid, 5).valid, false);
    }
    let cloud = await (await fetch(`${base}/api/workspace`, { headers })).json();
    for (let revision = 0; revision < 2; revision++) {
      state.wrong[0].note = `第${revision + 1}次修改`;
      state.wrong[0].subject = revision === 0 ? '资料分析' : '言语理解';
      const pushed = await fetch(`${base}/api/workspace`, { method: 'POST', headers, body: JSON.stringify({ state, schemaVersion: 5, requestId: `photo-sync-${revision}`, expectedRevision: cloud.revision, generationId: cloud.generationId }) });
      assert.equal(pushed.status, 200, await pushed.text());
      cloud = await (await fetch(`${base}/api/workspace`, { headers })).json();
      assert.deepEqual(cloud.state.wrong, state.wrong);
    }
    const exported = await fetch(`${base}/api/backups/export`, { headers });
    assert.equal(exported.status, 200);
    const restored = validateAndMigrateBackup(await exported.text());
    assert.equal(restored.valid, true, restored.errors?.join(','));
    assert.deepEqual(restored.migratedState!.wrong[0].imageOrientations, state.wrong[0].imageOrientations);
    assert.equal(restored.migratedState!.wrong[0].note, '第2次修改');
    assert.equal(restored.migratedState!.wrong[0].subject, '言语理解');
    assert.equal(Buffer.from(restored.migratedState!.wrong[0].images![0].split(',')[1], 'base64').equals(png), true);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    closeDb(); fs.rmSync(temp, { recursive: true, force: true });
  }
});
