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
    assert.equal(vJson.version, '1.0.1');
    assert.equal(vJson.schemaVersion, 3);
    assert.equal(vJson.build, '20261026.02');

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

    // 1. Initial workspace get: newly registered user has atomic seed data at revision 1
    const getRes = await fetch(`${baseUrl}/api/workspace`, {
      headers: { cookie },
    });
    assert.equal(getRes.status, 200);
    const getJson = await getRes.json();
    assert.equal(getJson.hasCloudData, true);
    assert.equal(getJson.revision, 1);
    assert.equal(getJson.seedVersion, 1);
    assert.ok(getJson.generationId);
    const currentGen = getJson.generationId;

    // Verify formal seed data contents (14 books, 7 courses, 22 library, 0 progress, empty history)
    assert.equal(getJson.state.books.length, 14);
    assert.equal(getJson.state.courses.length, 7);
    assert.equal(getJson.state.library.length, 22);
    assert.equal(getJson.state.plans.length, 0);
    assert.equal(getJson.state.records.length, 0);
    assert.equal(getJson.state.wrong.length, 0);
    assert.equal(getJson.state.books[0].done, 0);
    assert.equal(getJson.state.books[0].minutes, 0);
    assert.equal(getJson.state.courses[0].completedLessons, 0);
    assert.equal(getJson.state.courses[0].url, ''); // Placeholder URLs cleared

    // 2. Push without CSRF token -> rejected with 403
    const noCsrfRes = await fetch(`${baseUrl}/api/workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ expectedRevision: 1, generationId: currentGen, requestId: 'req-sync-1', state: getJson.state }),
    });
    assert.equal(noCsrfRes.status, 403);

    // 3. Push with invalid generationId or empty generationId -> rejected with 409 GENERATION_MISMATCH (Defect I)
    const badGenRes = await fetch(`${baseUrl}/api/workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken, cookie },
      body: JSON.stringify({ expectedRevision: 1, generationId: '', requestId: 'req-sync-1', state: getJson.state }),
    });
    assert.equal(badGenRes.status, 409);
    assert.equal((await badGenRes.json()).code, 'GENERATION_MISMATCH');

    // 4. Push with malformed state payload -> rejected with 400 INVALID_WORKSPACE_STATE (Defect J)
    const badPayloadRes = await fetch(`${baseUrl}/api/workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken, cookie },
      body: JSON.stringify({ expectedRevision: 1, generationId: currentGen, requestId: 'req-sync-1', state: 'invalid_string_state' }),
    });
    assert.equal(badPayloadRes.status, 400);
    assert.equal((await badPayloadRes.json()).code, 'INVALID_WORKSPACE_STATE');

    // 5. Valid push with expectedRevision: 1 -> increments revision to 2
    const push1Res = await fetch(`${baseUrl}/api/workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken, cookie },
      body: JSON.stringify({ expectedRevision: 1, generationId: currentGen, requestId: 'req-sync-1', state: getJson.state }),
    });
    assert.equal(push1Res.status, 200);
    const push1Json = await push1Res.json();
    assert.equal(push1Json.ok, true);
    assert.equal(push1Json.revision, 2);

    // 6. Idempotent retry with identical payload and requestId -> returns revision 2 without incrementing
    const retryRes = await fetch(`${baseUrl}/api/workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken, cookie },
      body: JSON.stringify({ expectedRevision: 1, generationId: currentGen, requestId: 'req-sync-1', state: getJson.state }),
    });
    assert.equal(retryRes.status, 200);
    const retryJson = await retryRes.json();
    assert.equal(retryJson.revision, 2);
    assert.equal(retryJson.idempotent, true);

    // 7. Same requestId with different state -> rejected with 400
    const tamperRes = await fetch(`${baseUrl}/api/workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken, cookie },
      body: JSON.stringify({ expectedRevision: 1, generationId: currentGen, requestId: 'req-sync-1', state: { ...getJson.state, profile: { name: 'Tampered', username: 'david', avatar: '' } } }),
    });
    assert.equal(tamperRes.status, 400);
    assert.equal((await tamperRes.json()).code, 'DUPLICATE_REQUEST_ID_DIFFERENT_PAYLOAD');

    // 8. Push with stale expectedRevision (1 instead of 2) -> rejected with 409 Conflict
    const conflictRes = await fetch(`${baseUrl}/api/workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken, cookie },
      body: JSON.stringify({ expectedRevision: 1, generationId: currentGen, requestId: 'req-sync-2', state: getJson.state }),
    });
    assert.equal(conflictRes.status, 409);
    const confJson = await conflictRes.json();
    assert.equal(confJson.code, 'REVISION_CONFLICT');
    assert.equal(confJson.serverRevision, 2);
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

    // 5. Single user restore: increments user revision without affecting others (initial rev 1 -> restored rev 2)
    const restored = restoreUserWorkspace(userG.id, JSON.stringify({ version: 3, state: BLANK_STATE }));
    assert.equal(restored.ok, true);
    assert.equal(restored.revision, 2);

    // 6. Generation rotation: rotates generation ID and revokes all active sessions
    const oldGen = getCurrentGenerationId();
    const newGen = rotateGenerationId();
    assert.notEqual(oldGen, newGen);

    const postGenCheck = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { cookie: newLoginRes.headers.get('set-cookie')! },
    });
    assert.equal(postGenCheck.status, 401); // Revoked on generation rotation
  });

  test('User backup export, history tracking, and history restore endpoints (/api/backups/*)', async () => {
    const userSuffix = Math.random().toString(36).substring(2, 7);
    const uH = `userh_${userSuffix}`;

    const inviteH = createInviteCode('test_admin');
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: uH, password: 'userhpassword123', nickname: '考生小明', inviteCode: inviteH }),
    });
    const { csrfToken: csrfH } = await regRes.json();
    const cookieH = regRes.headers.get('set-cookie')!;
    const curGenH = getCurrentGenerationId();

    // 1. User H starts at seeded rev 1 -> Push rev 2
    const stateRev2 = {
      ...BLANK_STATE,
      plans: [{ id: 'plan-h-1', title: '版本1计划', done: false, date: '2026-10-26' }],
    };
    const pushH1 = await fetch(`${baseUrl}/api/workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfH, cookie: cookieH },
      body: JSON.stringify({ expectedRevision: 1, generationId: curGenH, requestId: 'req-h-1', state: stateRev2 }),
    });
    assert.equal(pushH1.status, 200);

    // 2. Push rev 3 (creates history entry for rev 2)
    const stateRev3 = {
      ...BLANK_STATE,
      plans: [{ id: 'plan-h-2', title: '版本2计划', done: true, date: '2026-10-26' }],
    };
    const pushH2 = await fetch(`${baseUrl}/api/workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfH, cookie: cookieH },
      body: JSON.stringify({ expectedRevision: 2, generationId: curGenH, requestId: 'req-h-2', state: stateRev3 }),
    });
    assert.equal(pushH2.status, 200);

    // 3. GET /api/backups/export with Unicode username (Defect J)
    const exportRes = await fetch(`${baseUrl}/api/backups/export`, {
      headers: { cookie: cookieH },
    });
    assert.equal(exportRes.status, 200);
    const contentDisp = exportRes.headers.get('content-disposition') || '';
    assert.ok(contentDisp.includes('filename*=UTF-8'));
    const exportedData = await exportRes.json();
    assert.equal(exportedData.version, 3);
    assert.equal(exportedData.revision, 3);
    assert.equal(exportedData.state.plans[0].id, 'plan-h-2');

    // 4. GET /api/backups/history
    const historyRes = await fetch(`${baseUrl}/api/backups/history`, {
      headers: { cookie: cookieH },
    });
    assert.equal(historyRes.status, 200);
    const { history } = await historyRes.json();
    assert.ok(Array.isArray(history));
    assert.equal(history.length >= 2, true); // Rev 1 and Rev 2 saved into history
    assert.equal(history[0].revision, 2); // Latest history entry is rev 2
    assert.equal(history[1].revision, 1); // Previous history entry is rev 1

    // 5. POST /api/backups/restore-history (revert to rev 2)
    const targetRev2 = history.find((h: any) => h.revision === 2)!;
    const restoreRes = await fetch(`${baseUrl}/api/backups/restore-history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfH, cookie: cookieH },
      body: JSON.stringify({ historyId: targetRev2.id }),
    });
    assert.equal(restoreRes.status, 200);
    const restoreData = await restoreRes.json();
    assert.equal(restoreData.ok, true);
    assert.equal(restoreData.revision, 4); // Revision incremented from 3 to 4
    assert.equal(restoreData.state.plans[0].id, 'plan-h-1'); // Restored state matches rev 2
  });

  test('Concurrent double-spend protection for invite codes and password resets (Defect H)', async () => {
    // 1. Race two registrations concurrently on the exact same single-use invite code
    const sharedInvite = createInviteCode('race_admin');
    const uRace1 = `race1_${Math.random().toString(36).substring(2, 7)}`;
    const uRace2 = `race2_${Math.random().toString(36).substring(2, 7)}`;

    const [res1, res2] = await Promise.all([
      fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: uRace1, password: 'password12345', nickname: 'Race 1', inviteCode: sharedInvite }),
      }),
      fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: uRace2, password: 'password12345', nickname: 'Race 2', inviteCode: sharedInvite }),
      }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    assert.deepEqual(statuses, [200, 400], 'Exactly one registration must succeed and one must fail');

    // 2. Race two password resets concurrently on the exact same reset code
    const inviteUser = createInviteCode('race_admin');
    const uReset = `reset_${Math.random().toString(36).substring(2, 7)}`;
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: uReset, password: 'originalpassword123', nickname: 'Reset User', inviteCode: inviteUser }),
    });
    const regData = await regRes.json();
    const resetInfo = createPasswordResetCode(regData.user.id, 'admin')!;

    const [resetRes1, resetRes2] = await Promise.all([
      fetch(`${baseUrl}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: resetInfo.code, newPassword: 'newsecurepass1' }),
      }),
      fetch(`${baseUrl}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: resetInfo.code, newPassword: 'newsecurepass2' }),
      }),
    ]);

    const resetStatuses = [resetRes1.status, resetRes2.status].sort();
    assert.deepEqual(resetStatuses, [200, 400], 'Exactly one password reset must succeed and one must fail');
  });
});
