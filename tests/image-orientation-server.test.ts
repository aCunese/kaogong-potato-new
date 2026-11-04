import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-orientation-route-'));
process.env.DATA_DIR = temp;

test('orientation POST authenticates, checks CSRF and ownership before any cached result', { timeout: 60_000 }, async () => {
  const { default: app } = await import('../server/app');
  const { createInviteCode } = await import('../server/admin');
  const { closeDb } = await import('../server/db');
  const { saveUserMedia } = await import('../server/media');
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const register = async (username: string) => {
    const response = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: 'orientation-test-only', inviteCode: createInviteCode() }) });
    assert.equal(response.status, 200);
    const auth = await response.json();
    return { id: auth.user.id, headers: { cookie: response.headers.get('set-cookie')!.split(';')[0], 'x-csrf-token': auth.csrfToken, 'x-workspace-user': auth.user.id } };
  };
  try {
    assert.equal((await fetch(`${base}/api/media/example/orientation`, { method: 'POST' })).status, 401);
    const first = await register('orientation-owner');
    const other = await register('orientation-other');
    // A valid tiny image should return unresolved rather than guessing an angle.
    const png = fs.readFileSync(path.resolve('tests/fixtures/image-orientation/blank.png'));
    const saved = saveUserMedia(first.id, png, 'blank.png');
    assert.equal(saved.ok, true);
    const url = `${base}/api/media/${saved.media!.id}/orientation`;
    const missingCsrf = await fetch(url, { method: 'POST', headers: { cookie: first.headers.cookie } });
    assert.equal(missingCsrf.status, 403);
    assert.equal((await fetch(url, { method: 'POST', headers: other.headers })).status, 404);
    const pending = fetch(url, { method: 'POST', headers: first.headers });
    await new Promise(resolve => setTimeout(resolve, 100));
    const busy = await fetch(url, { method: 'POST', headers: first.headers });
    assert.equal(busy.status, 429);
    assert.equal((await busy.json()).code, 'ORIENTATION_BUSY');
    assert.equal(busy.headers.get('retry-after'), '2');
    const resolved = await pending;
    assert.equal(resolved.status, 200, await resolved.clone().text());
    assert.deepEqual(await resolved.json(), { ok: true, mediaId: saved.media!.id, orientation: { status: 'unresolved', rotation: 0, version: 1 } });
    assert.equal(resolved.headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(url, { method: 'POST', headers: other.headers })).status, 404);
    assert.equal((await fetch(`${base}/api/media/missing/orientation`, { method: 'POST', headers: first.headers, body: JSON.stringify({ path: '/etc/passwd', url: 'https://example.com' }) })).status, 404);
    assert.equal((await fetch(url, { method: 'POST', headers: { ...first.headers, 'x-workspace-user': other.id } })).status, 409);
    const corrupt = saveUserMedia(first.id, Buffer.concat([png.subarray(0, 8), Buffer.alloc(32)]), 'corrupt.png');
    assert.equal(corrupt.ok, true);
    const failed = await fetch(`${base}/api/media/${corrupt.media!.id}/orientation`, { method: 'POST', headers: first.headers });
    assert.equal(failed.status, 503);
    assert.equal((await failed.json()).code, 'ORIENTATION_UNAVAILABLE');
    const textPage = saveUserMedia(first.id, fs.readFileSync(path.resolve('tests/fixtures/image-orientation/study-page.png')), 'page.png');
    assert.equal(textPage.ok, true);
    const pageUrl = `${base}/api/media/${textPage.media!.id}/orientation`;
    assert.equal((await fetch(pageUrl, { method: 'POST', headers: first.headers })).status, 200);
    // Further identical requests hit the result cache, but remain subject to endpoint guards.
    let limited: Response | undefined;
    for (let attempt = 0; attempt < 31; attempt++) {
      const response = await fetch(pageUrl, { method: 'POST', headers: first.headers });
      if (response.status === 429) { limited = response; break; }
      assert.equal(response.status, 200);
    }
    assert.ok(limited);
    assert.equal((await limited.json()).code, 'ORIENTATION_RATE_LIMITED');
    assert.equal(limited.headers.get('retry-after'), '60');
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    closeDb();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
