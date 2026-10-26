import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { Server } from 'node:http';

// Isolate test database in temporary directory
const TEST_DATA_DIR = path.resolve('/tmp', `potato-test-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
process.env.DATA_DIR = TEST_DATA_DIR;

import app from '../server/app';
import { createInviteCode, createPasswordResetCode, restoreUserWorkspace } from '../server/admin';
import { getCurrentGenerationId, rotateGenerationId, closeDb } from '../server/db';
import { BLANK_STATE } from '../src/constants/initialData';

let server: Server;
let baseUrl: string;

before(async () => {
  await new Promise<void>(resolve => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

after(() => {
  server?.close();
  closeDb();
  if (fs.existsSync(TEST_DATA_DIR)) {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
});

describe('Backend Server API & Security Suite', () => {
  test('GET /version.json and GET /api/health return structured system telemetry', async () => {
    const vRes = await fetch(`${baseUrl}/version.json`);
    assert.equal(vRes.status, 200);
    const vJson = await vRes.json();
    assert.equal(vJson.version, '1.0.0');
    assert.equal(vJson.schemaVersion, 3);
    assert.ok(vJson.build);

    const hRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(hRes.status, 200);
    const hJson = await hRes.json();
    assert.equal(hJson.ok, true);
    assert.equal(hJson.status, 'healthy');
    assert.ok(hJson.generationId.startsWith('gen_'));
  });

  test('Single-use invitation registration, Argon2id hashing and uniqueness', async () => {
    const userSuffix = Math.random().toString(36).substring(2, 7);
    const uAlice = `alice_${userSuffix}`;
    // 1. Invalid invite fails
    const failRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: uAlice, password: 'password123', nickname: 'Alice', inviteCode: 'invalid_code' }),
    });
    assert.equal(failRes.status, 400);

    // 2. Generate genuine invite
    const inviteA = createInviteCode('test_admin');
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: uAlice, password: 'password123', nickname: 'Alice Study', inviteCode: inviteA }),
    });
    assert.equal(regRes.status, 200);
    const regJson = await regRes.json();
    assert.equal(regJson.ok, true);
    assert.equal(regJson.user.username, uAlice.toLowerCase());
    assert.ok(regJson.csrfToken);
    const setCookie = regRes.headers.get('set-cookie');
    assert.ok(setCookie && setCookie.includes('potato_session='));
    assert.ok(setCookie.includes('HttpOnly'));

    // 3. Re-using same invite code fails
    const reuseRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `bob_${userSuffix}`, password: 'password123', nickname: 'Bob', inviteCode: inviteA }),
    });
    assert.equal(reuseRes.status, 400);

    // 4. Duplicate username fails
    const inviteB = createInviteCode('test_admin');
    const dupRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: uAlice.toUpperCase(), password: 'password123', nickname: 'Alice2', inviteCode: inviteB }),
    });
    assert.equal(dupRes.status, 409);
  });

  test('Login failure rate limiting and CSRF protection', async () => {
    const userSuffix = Math.random().toString(36).substring(2, 7);
    const uCharlie = `charlie_${userSuffix}`;
    const inviteC = createInviteCode('test_admin');
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: uCharlie, password: 'secretpassword', nickname: 'Charlie', inviteCode: inviteC }),
    });

    // Failed login attempts
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: uCharlie, password: 'wrongpassword' }),
      });
      assert.equal(res.status, 401);
    }

    // 6th failed attempt is rate limited
    const rateLimitRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: uCharlie, password: 'wrongpassword' }),
    });
    assert.equal(rateLimitRes.status, 429);
    const rlJson = await rateLimitRes.json();
    assert.equal(rlJson.code, 'TOO_MANY_ATTEMPTS');
  });

  test('Workspace revision sync, idempotency, and 409 conflict detection', async () => {
    const userSuffix = Math.random().toString(36).substring(2, 7);
    const uDavid = `david_${userSuffix}`;
    const invite = createInviteCode('test_admin');
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: uDavid, password: 'davidpassword', nickname: 'David', inviteCode: invite }),
    });
    const { csrfToken } = await regRes.json();
    const cookie = regRes.headers.get('set-cookie')!;

    // 1. Initial workspace get: no cloud data yet
    const getRes = await fetch(`${baseUrl}/api/workspace`, {
      headers: { cookie },
    });
    assert.equal(getRes.status, 200);
    const getJson = await getRes.json();
    assert.equal(getJson.hasCloudData, false);
    assert.equal(getJson.revision, 0);

    // 2. Push revision 1 without CSRF token -> rejected with 403
    const noCsrfRes = await fetch(`${baseUrl}/api/workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ expectedRevision: 0, requestId: 'req-sync-1', state: BLANK_STATE }),
    });
    assert.equal(noCsrfRes.status, 403);

    // 3. Push revision 1 with CSRF token -> success
    const push1Res = await fetch(`${baseUrl}/api/workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken, cookie },
      body: JSON.stringify({ expectedRevision: 0, requestId: 'req-sync-1', state: BLANK_STATE }),
    });
    assert.equal(push1Res.status, 200);
    const push1Json = await push1Res.json();
    assert.equal(push1Json.ok, true);
    assert.equal(push1Json.revision, 1);

    // 4. Idempotent retry with identical payload and requestId -> returns revision 1 without incrementing
    const retryRes = await fetch(`${baseUrl}/api/workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken, cookie },
      body: JSON.stringify({ expectedRevision: 0, requestId: 'req-sync-1', state: BLANK_STATE }),
    });
    assert.equal(retryRes.status, 200);
    const retryJson = await retryRes.json();
    assert.equal(retryJson.revision, 1);
    assert.equal(retryJson.idempotent, true);

    // 5. Same requestId with different state -> rejected with 400
    const tamperRes = await fetch(`${baseUrl}/api/workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken, cookie },
      body: JSON.stringify({ expectedRevision: 0, requestId: 'req-sync-1', state: { ...BLANK_STATE, profile: { name: 'Tampered', targetExam: '', examYear: '', avatar: '' } } }),
    });
    assert.equal(tamperRes.status, 400);
    assert.equal((await tamperRes.json()).code, 'DUPLICATE_REQUEST_ID_DIFFERENT_PAYLOAD');

    // 6. Push with stale expectedRevision (0 instead of 1) -> rejected with 409 Conflict
    const conflictRes = await fetch(`${baseUrl}/api/workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken, cookie },
      body: JSON.stringify({ expectedRevision: 0, requestId: 'req-sync-2', state: BLANK_STATE }),
    });
    assert.equal(conflictRes.status, 409);
    const confJson = await conflictRes.json();
    assert.equal(confJson.code, 'REVISION_CONFLICT');
    assert.equal(confJson.serverRevision, 1);
  });

  test('Multi-user isolation: User A cannot read User B media attachments', async () => {
    const userSuffix = Math.random().toString(36).substring(2, 7);
    const uE = `usere_${userSuffix}`;
    const uF = `userf_${userSuffix}`;

    // Register User E
    const inviteE = createInviteCode('test_admin');
    const resE = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: uE, password: 'userepass', nickname: 'User E', inviteCode: inviteE }),
    });
    const { csrfToken: csrfE } = await resE.json();
    const cookieE = resE.headers.get('set-cookie')!;

    // Register User F
    const inviteF = createInviteCode('test_admin');
    const resF = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: uF, password: 'userfpass', nickname: 'User F', inviteCode: inviteF }),
    });
    const cookieF = resF.headers.get('set-cookie')!;

    // User E uploads a valid 1x1 PNG image
    const validPngBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const formData = new FormData();
    formData.append('file', new Blob([validPngBuffer], { type: 'image/png' }), 'test-dot.png');

    const uploadRes = await fetch(`${baseUrl}/api/media/upload`, {
      method: 'POST',
      headers: { 'x-csrf-token': csrfE, cookie: cookieE },
      body: formData,
    });
    assert.equal(uploadRes.status, 200);
    const { media } = await uploadRes.json();
    assert.ok(media.id);

    // User E can read their own uploaded image
    const readOwnRes = await fetch(`${baseUrl}/api/media/${media.id}`, {
      headers: { cookie: cookieE },
    });
    assert.equal(readOwnRes.status, 200);
    assert.equal(readOwnRes.headers.get('content-type'), 'image/png');

    // User F tries to read User E's uploaded image -> 404 Forbidden/Not Found
    const crossReadRes = await fetch(`${baseUrl}/api/media/${media.id}`, {
      headers: { cookie: cookieF },
    });
    assert.equal(crossReadRes.status, 404);

    // Non-image upload rejected by magic bytes
    const badForm = new FormData();
    badForm.append('file', new Blob([Buffer.from('not an image data text file')], { type: 'text/plain' }), 'evil.txt');
    const badUploadRes = await fetch(`${baseUrl}/api/media/upload`, {
      method: 'POST',
      headers: { 'x-csrf-token': csrfE, cookie: cookieE },
      body: badForm,
    });
    assert.equal(badUploadRes.status, 400);
    assert.equal((await badUploadRes.json()).code, 'INVALID_IMAGE_TYPE');
  });

  test('Admin password reset, session revocation, single-user restore, and generation rotation', async () => {
    const userSuffix = Math.random().toString(36).substring(2, 7);
    const uG = `userg_${userSuffix}`;

    // Register User G
    const inviteG = createInviteCode('test_admin');
    const resG = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: uG, password: 'oldpassword123', nickname: 'User G', inviteCode: inviteG }),
    });
    const { user: userG } = await resG.json();
    const oldCookieG = resG.headers.get('set-cookie')!;

    // 1. Admin generates one-time reset code
    const resetInfo = createPasswordResetCode(userG.id, 'admin');
    assert.ok(resetInfo?.code);

    // 2. User resets password using code
    const resetRes = await fetch(`${baseUrl}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: resetInfo.code, newPassword: 'newsecurepassword456' }),
    });
    assert.equal(resetRes.status, 200);

    // 3. Old session cookie is now revoked
    const checkOldSession = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { cookie: oldCookieG },
    });
    assert.equal(checkOldSession.status, 401);

    // 4. Login with new password succeeds
    const newLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: uG, password: 'newsecurepassword456' }),
    });
    assert.equal(newLoginRes.status, 200);

    // 5. Single user restore: increments user revision without affecting others
    const restored = restoreUserWorkspace(userG.id, JSON.stringify({ version: 3, state: BLANK_STATE }));
    assert.equal(restored.ok, true);
    assert.equal(restored.revision, 1);

    // 6. Generation rotation: rotates generation ID and revokes all active sessions
    const oldGen = getCurrentGenerationId();
    const newGen = rotateGenerationId();
    assert.notEqual(oldGen, newGen);

    const postGenCheck = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { cookie: newLoginRes.headers.get('set-cookie')! },
    });
    assert.equal(postGenCheck.status, 401); // Revoked on generation rotation
  });
});
