import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Server } from 'node:http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import releaseConfig from '../release.json';

// Isolate test database in temporary directory
const TEST_DATA_DIR = path.resolve('/tmp', `potato-test-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
process.env.DATA_DIR = TEST_DATA_DIR;

import app, { validateReleaseConfig } from '../server/app';
import { createInviteCode, createPasswordResetCode, restoreUserWorkspace } from '../server/admin';
import { getCurrentGenerationId, rotateGenerationId, closeDb, getDb, getAttachmentsDir } from '../server/db';
import { BLANK_STATE } from '../src/constants/initialData';
import {
  MAX_WORKSPACE_PAYLOAD_BYTES,
  WORKSPACE_STRING_LIMITS,
} from '../server/workspace';
import {
  WORKSPACE_HISTORY_KEEP_ROWS,
  WORKSPACE_HISTORY_MAX_BYTES,
  WORKSPACE_HISTORY_RECENT_WINDOW_MS,
  SYNC_IDEMPOTENCY_MAX_ROWS,
} from '../server/retention';
import { getUserTotalMediaUsage, MAX_USER_QUOTA_BYTES } from '../server/media';

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
    assert.equal(vJson.version, releaseConfig.webVersion);
    assert.equal(vJson.schemaVersion, releaseConfig.schemaVersion);
    assert.equal(vJson.build, releaseConfig.webBuild);
    assert.equal(vJson.apkVersion, releaseConfig.apkVersion);
    assert.equal(vJson.apkVersionCode, releaseConfig.apkVersionCode);

    const hRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(hRes.status, 200);
    const hJson = await hRes.json();
    assert.equal(hJson.ok, true);
    assert.equal(hJson.status, 'healthy');
    assert.ok(hJson.generationId.startsWith('gen_'));

    // Test /api/download/apk endpoint. While the new APK is not signed/released,
    // the endpoint must refuse to serve the stale previous package (R14).
    const apkRes = await fetch(`${baseUrl}/api/download/apk`);
    if (releaseConfig.apkReleased) {
      assert.equal(apkRes.status, 200);
      assert.equal(apkRes.headers.get('content-type'), 'application/vnd.android.package-archive');
      assert.ok(apkRes.headers.get('content-disposition')?.includes(`kaogong-potato-v${releaseConfig.apkVersion}.apk`));
    } else {
      assert.equal(apkRes.status, 404);
      const apkJson = await apkRes.json();
      assert.equal(apkJson.code, 'APK_NOT_RELEASED');
    }
  });

  test('Release configuration validation rules and failure handling (Phase 7 / V06)', async () => {
    // 1. Validation logic unit tests
    const validBase = {
      webVersion: '1.0.3',
      webBuild: '20261027.02',
      schemaVersion: 3,
      apkReleased: false,
    };
    assert.equal(validateReleaseConfig(validBase).valid, true);

    // Missing or unknown webVersion / webBuild
    assert.equal(validateReleaseConfig({ ...validBase, webVersion: '' }).valid, false);
    assert.equal(validateReleaseConfig({ ...validBase, webVersion: 'unknown' }).valid, false);
    assert.equal(validateReleaseConfig({ ...validBase, webBuild: '' }).valid, false);
    assert.equal(validateReleaseConfig({ ...validBase, webBuild: 'unknown' }).valid, false);

    // When apkReleased is true, require sha, size > 0, package name, fingerprint
    const releasedBase = {
      ...validBase,
      apkReleased: true,
      apkSha256: 'abc',
      apkSizeBytes: 12345,
      apkPackageName: 'com.ruyne.kaogong',
      apkCertFingerprint: 'AA:BB',
    };
    assert.equal(validateReleaseConfig(releasedBase).valid, true);
    assert.equal(validateReleaseConfig({ ...releasedBase, apkSha256: '' }).valid, false);
    assert.equal(validateReleaseConfig({ ...releasedBase, apkSizeBytes: 0 }).valid, false);
    assert.equal(validateReleaseConfig({ ...releasedBase, apkPackageName: '' }).valid, false);
    assert.equal(validateReleaseConfig({ ...releasedBase, apkCertFingerprint: '' }).valid, false);

    // 2. Health check and version check respond 503 when release config is missing/invalid
    const prevEnv = process.env.RELEASE_CONFIG_PATH;
    try {
      process.env.RELEASE_CONFIG_PATH = '/nonexistent/path/to/release.json';
      const hFail = await fetch(`${baseUrl}/api/health`);
      assert.equal(hFail.status, 503);
      const hFailJson = await hFail.json();
      assert.equal(hFailJson.ok, false);
      assert.equal(hFailJson.status, 'unhealthy');
      assert.equal(hFailJson.code, 'RELEASE_CONFIG_INVALID');
      assert.equal(hFailJson.error, 'Release configuration missing or invalid');
      assert.ok(hFailJson.generationId.startsWith('gen_'));

      const vFail = await fetch(`${baseUrl}/version.json`);
      assert.equal(vFail.status, 503);
      const vFailJson = await vFail.json();
      assert.equal(vFailJson.ok, false);
      assert.equal(vFailJson.code, 'RELEASE_CONFIG_INVALID');
    } finally {
      if (prevEnv) {
        process.env.RELEASE_CONFIG_PATH = prevEnv;
      } else {
        delete process.env.RELEASE_CONFIG_PATH;
      }
    }

    // After restoring, health check returns 200 healthy
    const hRestored = await fetch(`${baseUrl}/api/health`);
    assert.equal(hRestored.status, 200);
    const hRestoredJson = await hRestored.json();
    assert.equal(hRestoredJson.ok, true);
    assert.equal(hRestoredJson.status, 'healthy');

    // 3. Precache manifest / public/sw.js matches release.json build
    const swPath = path.resolve(__dirname, '../public/sw.js');
    const swContent = fs.readFileSync(swPath, 'utf-8');
    assert.ok(
      swContent.includes(`const RELEASE_BUILD = '${releaseConfig.webBuild}';`),
      `public/sw.js must contain RELEASE_BUILD = '${releaseConfig.webBuild}'`
    );
    assert.ok(
      swContent.includes(`const RELEASE_VERSION = '${releaseConfig.webVersion}';`),
      `public/sw.js must contain RELEASE_VERSION = '${releaseConfig.webVersion}'`
    );
    assert.ok(
      swContent.includes('kaogong-shell-v3-${RELEASE_VERSION}-${RELEASE_BUILD}') ||
        swContent.includes(`kaogong-shell-v3-${releaseConfig.webVersion}-${releaseConfig.webBuild}`),
      'public/sw.js CACHE_NAME must bind to release identity'
    );
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

// ==========================================================================
// Server contracts suite — R06 / R18 / R10 / media dedupe / version nonce
// 只使用隔离 tmp DATA_DIR（文件顶部已设置），绝不触碰真实 data/potato.db
// ==========================================================================

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;

const sha256Hex = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const cloneState = (state: any) => JSON.parse(JSON.stringify(state));
const makeBase64Image = (mime: string, payloadChars: number) => `data:image/${mime};base64,` + 'A'.repeat(payloadChars);

interface RegisteredUser {
  username: string;
  cookie: string;
  csrfToken: string;
  user: { id: string; username: string; nickname: string };
}

async function registerTestUser(prefix: string): Promise<RegisteredUser> {
  const username = `${prefix}_${Math.random().toString(36).substring(2, 7)}`;
  const invite = createInviteCode('test_admin');
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'password12345', nickname: `${prefix} 考生`, inviteCode: invite }),
  });
  assert.equal(res.status, 200, `register(${prefix}) must succeed`);
  const json: any = await res.json();
  const setCookie = res.headers.get('set-cookie');
  assert.ok(setCookie && setCookie.includes('potato_session='));
  return { username, cookie: setCookie!, csrfToken: json.csrfToken, user: json.user };
}

async function getWorkspace(cookie: string): Promise<any> {
  const res = await fetch(`${baseUrl}/api/workspace`, { headers: { cookie } });
  assert.equal(res.status, 200, 'GET /api/workspace must succeed');
  return res.json();
}

async function postWorkspace(opts: {
  cookie: string;
  csrfToken: string;
  expectedRevision: number;
  requestId: string;
  state: any;
  generationId?: string;
}): Promise<{ res: any; json: any }> {
  const res = await fetch(`${baseUrl}/api/workspace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': opts.csrfToken, cookie: opts.cookie },
    body: JSON.stringify({
      expectedRevision: opts.expectedRevision,
      requestId: opts.requestId,
      schemaVersion: 3,
      generationId: opts.generationId ?? getCurrentGenerationId(),
      state: opts.state,
    }),
  });
  return { res, json: await res.json() };
}

async function postInitChoice(opts: {
  cookie: string;
  csrfToken?: string | null;
  choice: any;
}): Promise<{ res: any; json: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', cookie: opts.cookie };
  if (typeof opts.csrfToken === 'string') headers['x-csrf-token'] = opts.csrfToken;
  const res = await fetch(`${baseUrl}/api/workspace/init-choice`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ choice: opts.choice }),
  });
  return { res, json: await res.json() };
}

async function uploadTinyPng(cookie: string, csrfToken: string, filename = 'tiny.png'): Promise<{ res: any; json: any }> {
  const form = new FormData();
  form.append('file', new Blob([Buffer.from(TINY_PNG_BASE64, 'base64')], { type: 'image/png' }), filename);
  const res = await fetch(`${baseUrl}/api/media/upload`, {
    method: 'POST',
    headers: { 'x-csrf-token': csrfToken, cookie },
    body: form,
  });
  return { res, json: await res.json() };
}

function buildValidPlan(id: string, overrides: Record<string, any> = {}): any {
  return {
    id,
    date: '2026-10-26',
    libraryId: 'lib-book-b-1',
    name: '资料分析 30 分钟',
    type: 'book',
    sourceId: 'b-1',
    subject: '资料分析',
    plannedMinutes: 30,
    actualMinutes: 0,
    accumulatedMs: 0,
    done: false,
    timerStart: 0,
    ...overrides,
  };
}

function buildValidRecord(id: string, overrides: Record<string, any> = {}): any {
  return {
    id,
    planId: 'plan-1',
    date: '2026-10-26',
    type: 'book',
    sourceId: 'b-1',
    subject: '资料分析',
    minutes: 30,
    questions: 10,
    errors: 1,
    ...overrides,
  };
}

function buildWrongRecord(bookId: string, extra: Record<string, any> = {}): any {
  return {
    id: `wrong-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    date: '2026-10-26',
    bookId,
    note: '错题复盘',
    ...extra,
  };
}

/** 直接把账号模拟成"历史空库账号"（seed_version=0, init_choice=NULL），不改 revision */
function forceLegacyEmptyWorkspace(userId: string, state: any): void {
  const db = getDb();
  const updated = db.prepare(`
    UPDATE workspaces SET state_json = ?, seed_version = 0, init_choice = NULL, updated_at = ?
    WHERE user_id = ?
  `).run(JSON.stringify(state), new Date().toISOString(), userId);
  assert.equal(updated.changes, 1, 'legacy workspace simulation must update exactly one row');
}

function getWorkspaceRow(userId: string): any {
  return getDb().prepare('SELECT * FROM workspaces WHERE user_id = ?').get(userId);
}

describe('Server contracts: R06 media/avatar, R18 validation+quota+retention, R10 init choice, version nonce', () => {
  test('I) version endpoints echo ?nonce= (max 64 chars) and add servedAt while keeping legacy fields', async () => {
    const noNonceRes = await fetch(`${baseUrl}/version.json`);
    assert.equal(noNonceRes.status, 200);
    const noNonceJson: any = await noNonceRes.json();
    assert.equal(noNonceJson.version, releaseConfig.webVersion);
    assert.equal(noNonceJson.build, releaseConfig.webBuild);
    assert.equal(noNonceJson.schemaVersion, 3);
    // APK metadata is only populated once the new package has been signed with the
    // original release key; until then the endpoint must stay honest and empty.
    if (releaseConfig.apkReleased) {
      assert.ok(noNonceJson.apkSha256);
      assert.equal(noNonceJson.apkVersionCode, releaseConfig.apkVersionCode);
    } else {
      assert.equal(noNonceJson.apkSha256, '');
      assert.equal(noNonceJson.apkReleased, false);
      assert.equal(noNonceJson.apkVersionCode, releaseConfig.apkVersionCode);
    }
    assert.equal(typeof noNonceJson.servedAt, 'string');
    assert.ok(!Number.isNaN(Date.parse(noNonceJson.servedAt)), 'servedAt must be a valid ISO timestamp');
    assert.equal('nonce' in noNonceJson, false, 'no nonce must be echoed when request has none');

    const nonceRes = await fetch(`${baseUrl}/version.json?nonce=client-abc-123`);
    assert.equal(nonceRes.status, 200);
    assert.equal(nonceRes.headers.get('cache-control'), 'no-cache, no-store, must-revalidate');
    const nonceJson: any = await nonceRes.json();
    assert.equal(nonceJson.nonce, 'client-abc-123');
    assert.equal(typeof nonceJson.servedAt, 'string');

    const longNonce = 'n'.repeat(100);
    const apiVerRes = await fetch(`${baseUrl}/api/version?nonce=${longNonce}`);
    assert.equal(apiVerRes.status, 200);
    const apiVerJson: any = await apiVerRes.json();
    assert.equal(apiVerJson.nonce.length, 64, 'nonce echo must be capped at 64 chars');
    assert.equal(apiVerJson.nonce, 'n'.repeat(64));
    assert.equal(apiVerJson.version, releaseConfig.webVersion);
  });

  test('C/D) GET contentHash + needsInitChoice/initChoice; POST 200/409 add contentHash, 409 adds serverContentHash/snapshotGenerationId', async () => {
    const user = await registerTestUser('hash');
    const ws = await getWorkspace(user.cookie);

    // 注册即写入官方种子：init_choice='default'，不需要初始化选择
    assert.equal(ws.needsInitChoice, false);
    assert.equal(ws.initChoice, 'default');
    assert.equal(typeof ws.contentHash, 'string');
    assert.match(ws.contentHash, /^[0-9a-f]{64}$/);
    const rowBefore = getWorkspaceRow(user.user.id);
    assert.equal(ws.contentHash, sha256Hex(rowBefore.state_json), 'GET contentHash must be sha256 of stored state_json');

    // 成功同步 200 => contentHash 为新写入 state_json 的 sha256
    const nextState = cloneState(ws.state);
    nextState.plans = [buildValidPlan('plan-hash-1')];
    const push = await postWorkspace({
      cookie: user.cookie,
      csrfToken: user.csrfToken,
      expectedRevision: ws.revision,
      requestId: `req-hash-${Date.now()}`,
      state: nextState,
    });
    assert.equal(push.res.status, 200, JSON.stringify(push.json));
    assert.match(String(push.json.contentHash), /^[0-9a-f]{64}$/);
    const rowAfter = getWorkspaceRow(user.user.id);
    assert.equal(push.json.contentHash, sha256Hex(rowAfter.state_json));

    // 冲突 409 => contentHash/serverContentHash = 服务端当前 state_json 哈希；附 snapshotGenerationId
    const conflict = await postWorkspace({
      cookie: user.cookie,
      csrfToken: user.csrfToken,
      expectedRevision: ws.revision, // stale
      requestId: `req-hash-conflict-${Date.now()}`,
      state: nextState,
    });
    assert.equal(conflict.res.status, 409);
    assert.equal(conflict.json.code, 'REVISION_CONFLICT');
    assert.equal(conflict.json.serverRevision, rowAfter.revision);
    assert.equal(conflict.json.contentHash, sha256Hex(rowAfter.state_json));
    assert.equal(conflict.json.serverContentHash, sha256Hex(rowAfter.state_json));
    assert.equal(conflict.json.snapshotGenerationId, rowAfter.generation_id);
    assert.ok(Array.isArray(conflict.json.serverState.plans));

    // GENERATION_MISMATCH 409 同样带 contentHash / serverContentHash / snapshotGenerationId
    const genMismatch = await postWorkspace({
      cookie: user.cookie,
      csrfToken: user.csrfToken,
      expectedRevision: rowAfter.revision,
      requestId: `req-hash-gen-${Date.now()}`,
      state: nextState,
      generationId: 'gen_definitely_stale',
    });
    assert.equal(genMismatch.res.status, 409);
    assert.equal(genMismatch.json.code, 'GENERATION_MISMATCH');
    assert.equal(genMismatch.json.serverContentHash, sha256Hex(rowAfter.state_json));
    assert.equal(genMismatch.json.snapshotGenerationId, rowAfter.generation_id);
  });

  test('E/R10) POST /api/workspace/init-choice: default merge preserves custom items+progress (stable seed ids), once-only, blank path, CSRF + enum guards', async () => {
    // --- default 分支 A：旧空资料库 + 已有自定义事项（R10 空库选择场景）---
    const user = await registerTestUser('initchoice');
    const legacyState = {
      ...cloneState(BLANK_STATE),
      profile: { name: '旧账号备考空间', username: user.username, avatar: '' },
      books: [],
      courses: [],
      library: [
        { id: 'lib-custom-own', type: 'custom', sourceId: '', name: '我的自定义晨读', subject: '政治理论', defaultMinutes: 15 },
      ],
      plans: [{ id: 'plan-legacy-1', name: '历史计划', date: '2026-10-25', done: false }],
    };
    forceLegacyEmptyWorkspace(user.user.id, legacyState);

    const legacyGet = await getWorkspace(user.cookie);
    assert.equal(legacyGet.needsInitChoice, true);
    assert.equal(legacyGet.initChoice, null);
    assert.equal(legacyGet.seedVersion, 0);
    assert.equal(typeof legacyGet.contentHash, 'string');

    // 无 CSRF => 403
    const noCsrf = await postInitChoice({ cookie: user.cookie, choice: 'default' });
    assert.equal(noCsrf.res.status, 403);

    // 非法枚举 => 400
    const badChoice = await postInitChoice({ cookie: user.cookie, csrfToken: user.csrfToken, choice: 'overwrite' });
    assert.equal(badChoice.res.status, 400);
    assert.equal(badChoice.json.code, 'INVALID_INIT_CHOICE');

    const defaultRes = await postInitChoice({ cookie: user.cookie, csrfToken: user.csrfToken, choice: 'default' });
    assert.equal(defaultRes.res.status, 200, JSON.stringify(defaultRes.json));
    const defaultJson = defaultRes.json;
    assert.equal(defaultJson.ok, true);
    assert.equal(defaultJson.alreadyApplied, false);
    assert.equal(defaultJson.initChoice, 'default');
    assert.equal(defaultJson.seedVersion, 1);
    assert.equal(defaultJson.revision, legacyGet.revision + 1);
    assert.match(String(defaultJson.contentHash), /^[0-9a-f]{64}$/);
    assert.equal(defaultJson.contentHash, sha256Hex(getWorkspaceRow(user.user.id).state_json));

    const merged = defaultJson.state;
    assert.equal(merged.books.length, 14, 'all 14 default books added');
    assert.equal(merged.courses.length, 7);
    assert.equal(merged.library.length, 23, '22 stable seed items + 1 user custom item');
    assert.ok(merged.library.some((l: any) => l.id === 'lib-custom-1'), 'seed custom morning-reading item added');
    assert.ok(merged.library.some((l: any) => l.id === 'lib-custom-own'), 'user custom item preserved');
    assert.equal(merged.plans.length, 1, 'plans preserved');
    assert.equal(merged.plans[0].id, 'plan-legacy-1');
    assert.equal(merged.profile.name, '旧账号备考空间', 'profile preserved');
    assert.equal(defaultJson.generationId, getCurrentGenerationId());

    // 幂等：二次调用不再 bump revision，也不覆盖成其它选择
    const again = await postInitChoice({ cookie: user.cookie, csrfToken: user.csrfToken, choice: 'blank' });
    assert.equal(again.res.status, 200);
    assert.equal(again.json.alreadyApplied, true);
    assert.equal(again.json.revision, defaultJson.revision);
    assert.equal(again.json.initChoice, 'default');

    const afterGet = await getWorkspace(user.cookie);
    assert.equal(afterGet.needsInitChoice, false);
    assert.equal(afterGet.initChoice, 'default');
    assert.equal(afterGet.seedVersion, 1);

    // --- default 分支 B：旧库非空（已有题本进度/改名）也保留，needsInitChoice 不会误报 ---
    const userProgress = await registerTestUser('initprogress');
    forceLegacyEmptyWorkspace(userProgress.user.id, {
      ...cloneState(BLANK_STATE),
      profile: { name: '有进度旧账号', username: userProgress.username, avatar: '' },
      books: [
        { id: 'b-1', name: '资料分析高分宝典', subject: '资料分析', total: 600, pages: 280, done: 321, errors: 12, minutes: 456 },
      ],
      courses: [],
      library: [
        { id: 'lib-book-b-1', type: 'book', sourceId: 'b-1', name: '我改名的题本', subject: '资料分析', defaultMinutes: 25 },
      ],
    });
    const progressBefore = await getWorkspace(userProgress.cookie);
    assert.equal(progressBefore.needsInitChoice, false, '非空 books 不应触发空库选择弹窗');
    const progressRes = await postInitChoice({ cookie: userProgress.cookie, csrfToken: userProgress.csrfToken, choice: 'default' });
    assert.equal(progressRes.res.status, 200, JSON.stringify(progressRes.json));
    assert.equal(progressRes.json.alreadyApplied, false);
    const progressState = progressRes.json.state;
    assert.equal(progressState.books.length, 14, 'existing b-1 + 13 missing defaults');
    const preservedBook = progressState.books.find((b: any) => b.id === 'b-1');
    assert.equal(preservedBook.done, 321, 'book progress preserved');
    assert.equal(preservedBook.errors, 12);
    assert.equal(preservedBook.minutes, 456);
    const preservedLibItem = progressState.library.find((l: any) => l.id === 'lib-book-b-1');
    assert.equal(preservedLibItem.name, '我改名的题本', 'custom library rename preserved');
    assert.equal(preservedLibItem.defaultMinutes, 25, 'custom defaultMinutes preserved');
    assert.equal(progressState.courses.length, 7);

    // --- blank 分支：保留原空白状态，仅持久化选择并 bump revision ---
    const userBlank = await registerTestUser('initblank');
    forceLegacyEmptyWorkspace(userBlank.user.id, {
      ...cloneState(BLANK_STATE),
      profile: { name: '空白空间', username: userBlank.username, avatar: '' },
    });
    const blankBefore = await getWorkspace(userBlank.cookie);
    assert.equal(blankBefore.needsInitChoice, true);

    const blankRes = await postInitChoice({ cookie: userBlank.cookie, csrfToken: userBlank.csrfToken, choice: 'blank' });
    assert.equal(blankRes.res.status, 200);
    assert.equal(blankRes.json.alreadyApplied, false);
    assert.equal(blankRes.json.initChoice, 'blank');
    assert.equal(blankRes.json.seedVersion, 1);
    assert.equal(blankRes.json.revision, blankBefore.revision + 1);
    assert.equal(blankRes.json.state.books.length, 0, 'blank choice must not inject seed books');
    assert.equal(blankRes.json.state.library.length, 0);

    const blankGet = await getWorkspace(userBlank.cookie);
    assert.equal(blankGet.needsInitChoice, false);
    assert.equal(blankGet.initChoice, 'blank');
    assert.equal(blankGet.seedVersion, 1);
  });

  test('A/B/R06) frontend WrongRecord.image + bounded legacy avatar data URLs sync successfully; images[] legacy shape accepted', async () => {
    const user = await registerTestUser('wrongphoto');
    const ws = await getWorkspace(user.cookie);
    const nextState = cloneState(ws.state);
    nextState.wrong = [
      buildWrongRecord(nextState.books[0].id, { image: TINY_PNG_DATA_URL }),
      buildWrongRecord(nextState.books[0].id, { images: [TINY_PNG_DATA_URL] }),
    ];
    nextState.profile.avatar = TINY_PNG_DATA_URL; // ~3KB legacy data URL that used to be rejected by 2048-char limit

    const push = await postWorkspace({
      cookie: user.cookie,
      csrfToken: user.csrfToken,
      expectedRevision: ws.revision,
      requestId: `req-r06-photo-${Date.now()}`,
      state: nextState,
    });
    assert.equal(push.res.status, 200, JSON.stringify(push.json));
    assert.equal(push.json.ok, true);

    const after = await getWorkspace(user.cookie);
    assert.equal(after.state.wrong.length, 2);
    assert.equal(after.state.wrong[0].image, TINY_PNG_DATA_URL);
    assert.deepEqual(after.state.wrong[1].images, [TINY_PNG_DATA_URL]);
    assert.equal(after.state.profile.avatar, TINY_PNG_DATA_URL);

    // 有界：单个旧版 data URL 超上限（>3,000,000 字符）=> 400，不允许无限内联图片
    const oversized = buildWrongRecord(after.state.books[0].id, { image: makeBase64Image('png', 3_000_000) });
    const oversizedState = cloneState(after.state);
    oversizedState.wrong = [oversized];
    const oversizedRes = await postWorkspace({
      cookie: user.cookie,
      csrfToken: user.csrfToken,
      expectedRevision: after.revision,
      requestId: `req-r06-big-${Date.now()}`,
      state: oversizedState,
    });
    assert.equal(oversizedRes.res.status, 400);
    assert.equal(oversizedRes.json.code, 'INVALID_WORKSPACE_STATE');
    assert.match(oversizedRes.json.message, /旧版内联图片超过上限/);

    // 有界：avatar 旧版 data URL 超上限（>2,000,000 字符）=> 400
    const bigAvatarState = cloneState(after.state);
    bigAvatarState.profile.avatar = makeBase64Image('jpeg', 2_000_000);
    const bigAvatarRes = await postWorkspace({
      cookie: user.cookie,
      csrfToken: user.csrfToken,
      expectedRevision: after.revision,
      requestId: `req-r06-bigavatar-${Date.now()}`,
      state: bigAvatarState,
    });
    assert.equal(bigAvatarRes.res.status, 400);
    assert.equal(bigAvatarRes.json.code, 'INVALID_WORKSPACE_STATE');
  });

  test('A/R06) media refs (/api/media/<id>, media:<id>) require ownership => unknown/cross-account 400 INVALID_MEDIA_REF; blob:/file:/other data: rejected', async () => {
    const owner = await registerTestUser('mediaowner');
    const other = await registerTestUser('mediaother');
    const upload = await uploadTinyPng(owner.cookie, owner.csrfToken);
    assert.equal(upload.res.status, 200);
    const mediaId = upload.json.media.id;
    assert.ok(mediaId.startsWith('media_'));
    assert.equal(upload.json.url, `/api/media/${mediaId}`);

    // /api/media/<id> + media:<id> 引用合法（图片、旧版 images[] 数组与头像）
    const ws = await getWorkspace(owner.cookie);
    const withRefs = cloneState(ws.state);
    withRefs.wrong = [
      buildWrongRecord(withRefs.books[0].id, { image: `/api/media/${mediaId}` }),
      buildWrongRecord(withRefs.books[0].id, { image: `media:${mediaId}` }),
      buildWrongRecord(withRefs.books[0].id, { images: [`/api/media/${mediaId}`, `media:${mediaId}`] }),
    ];
    withRefs.profile.avatar = `/api/media/${mediaId}`;
    const refPush = await postWorkspace({
      cookie: owner.cookie,
      csrfToken: owner.csrfToken,
      expectedRevision: ws.revision,
      requestId: `req-r06-ref-${Date.now()}`,
      state: withRefs,
    });
    assert.equal(refPush.res.status, 200, JSON.stringify(refPush.json));

    // 未知媒体 ID => 400 INVALID_MEDIA_REF
    const unknownState = cloneState(withRefs);
    unknownState.wrong = [buildWrongRecord(unknownState.books[0].id, { image: 'media:media_doesnotexist_9999' })];
    const unknownRes = await postWorkspace({
      cookie: owner.cookie,
      csrfToken: owner.csrfToken,
      expectedRevision: refPush.json.revision,
      requestId: `req-r06-unknown-${Date.now()}`,
      state: unknownState,
    });
    assert.equal(unknownRes.res.status, 400);
    assert.equal(unknownRes.json.code, 'INVALID_MEDIA_REF');

    // 跨账号引用他人媒体（image 与旧版 images[] 数组同样校验归属）=> 400 INVALID_MEDIA_REF
    const otherWs = await getWorkspace(other.cookie);
    const crossState = cloneState(otherWs.state);
    crossState.wrong = [buildWrongRecord(crossState.books[0].id, { image: `/api/media/${mediaId}` })];
    const crossRes = await postWorkspace({
      cookie: other.cookie,
      csrfToken: other.csrfToken,
      expectedRevision: otherWs.revision,
      requestId: `req-r06-cross-${Date.now()}`,
      state: crossState,
    });
    assert.equal(crossRes.res.status, 400);
    assert.equal(crossRes.json.code, 'INVALID_MEDIA_REF');

    const crossImagesState = cloneState(otherWs.state);
    crossImagesState.wrong = [buildWrongRecord(crossImagesState.books[0].id, { images: [`media:${mediaId}`] })];
    const crossImagesRes = await postWorkspace({
      cookie: other.cookie,
      csrfToken: other.csrfToken,
      expectedRevision: otherWs.revision,
      requestId: `req-r06-cross-images-${Date.now()}`,
      state: crossImagesState,
    });
    assert.equal(crossImagesRes.res.status, 400);
    assert.equal(crossImagesRes.json.code, 'INVALID_MEDIA_REF');

    // 明令禁止的引用形式一律 400（blob: / file: / 非图片 data: / 未知相对路径）
    const forbiddenForms = [
      'blob:http://127.0.0.1:5174/deadbeef',
      'file:///tmp/photo.png',
      'data:text/html;base64,PHNjcmlwdD4=',
      'photos/local-image.png',
    ];
    for (let i = 0; i < forbiddenForms.length; i++) {
      const badState = cloneState(ws.state);
      badState.wrong = [buildWrongRecord(badState.books[0].id, { image: forbiddenForms[i] })];
      const badRes = await postWorkspace({
        cookie: owner.cookie,
        csrfToken: owner.csrfToken,
        expectedRevision: ws.revision,
        requestId: `req-r06-forbidden-${i}-${Date.now()}`,
        state: badState,
      });
      assert.equal(badRes.res.status, 400, `forbidden image form must be rejected: ${forbiddenForms[i]}`);
      assert.equal(badRes.json.code, 'INVALID_WORKSPACE_STATE');
    }
  });

  test('H/R18) strict field validation rejects illegal values; missing legacy fields stay tolerated (Lead decision)', async () => {
    const user = await registerTestUser('strictval');
    const ws = await getWorkspace(user.cookie);
    const baseRevision = ws.revision;
    let seq = 0;
    const expectInvalid = async (label: string, state: any) => {
      const res = await postWorkspace({
        cookie: user.cookie,
        csrfToken: user.csrfToken,
        expectedRevision: baseRevision,
        requestId: `req-strict-${seq++}-${Date.now()}`,
        state,
      });
      assert.equal(res.res.status, 400, `${label} must be rejected with 400 (got ${res.res.status}: ${JSON.stringify(res.json)})`);
      assert.equal(res.json.code, 'INVALID_WORKSPACE_STATE', `${label} must be INVALID_WORKSPACE_STATE`);
    };

    // state.version 非法值（存在时必须 === 3）
    await expectInvalid('state.version=999', { ...cloneState(ws.state), version: 999 });
    await expectInvalid('state.version="3"', { ...cloneState(ws.state), version: '3' });

    const withPlan = (plan: any) => {
      const s = cloneState(ws.state);
      s.plans = [plan];
      return s;
    };
    await expectInvalid('plan.type illegal enum', withPlan(buildValidPlan('p-1', { type: 'webinar' })));
    await expectInvalid('plan.type numeric', withPlan(buildValidPlan('p-1', { type: 7 })));
    await expectInvalid('plan.timerStart string', withPlan(buildValidPlan('p-1', { timerStart: '123' })));
    await expectInvalid('plan.timerStart negative', withPlan(buildValidPlan('p-1', { timerStart: -1 })));
    await expectInvalid('plan.accumulatedMs negative', withPlan(buildValidPlan('p-1', { accumulatedMs: -5 })));
    await expectInvalid('plan.plannedMinutes negative', withPlan(buildValidPlan('p-1', { plannedMinutes: -30 })));
    await expectInvalid('plan.actualMinutes non-finite', withPlan(buildValidPlan('p-1', { actualMinutes: 'NaN' })));
    await expectInvalid('plan.date bad format', withPlan(buildValidPlan('p-1', { date: '2026/10/26' })));
    await expectInvalid('plan.name empty', withPlan(buildValidPlan('p-1', { name: '   ' })));
    await expectInvalid('plan.done non-boolean', withPlan(buildValidPlan('p-1', { done: 'yes' })));

    const withRecord = (record: any) => {
      const s = cloneState(ws.state);
      s.records = [record];
      return s;
    };
    await expectInvalid('record.date bad format', withRecord(buildValidRecord('r-1', { date: '26-10-2026' })));
    await expectInvalid('record.type illegal enum', withRecord(buildValidRecord('r-1', { type: 'quiz' })));
    await expectInvalid('record.minutes negative', withRecord(buildValidRecord('r-1', { minutes: -1 })));
    await expectInvalid('record.questions negative', withRecord(buildValidRecord('r-1', { questions: -2 })));

    const withBook = (book: any) => {
      const s = cloneState(ws.state);
      s.books = [book];
      return s;
    };
    const validBook = { id: 'b-x', name: '题本', subject: '常识判断', total: 100, pages: 50, done: 0, errors: 0, minutes: 0 };
    await expectInvalid('book.name > 120 chars', withBook({ ...validBook, name: '题'.repeat(WORKSPACE_STRING_LIMITS.bookName + 1) }));
    await expectInvalid('book.done negative', withBook({ ...validBook, done: -1 }));
    await expectInvalid('book.subject illegal', withBook({ ...validBook, subject: '未知科目' }));

    const withCountdown = (cd: any) => {
      const s = cloneState(ws.state);
      s.countdowns = [cd];
      return s;
    };
    await expectInvalid('countdown.name > 40 chars', withCountdown({ id: 'cd-x', name: '考'.repeat(41), date: '' }));
    await expectInvalid('countdown.date bad format', withCountdown({ id: 'cd-x', name: '国考', date: '2026.11.29' }));

    const withWrong = (wrong: any) => {
      const s = cloneState(ws.state);
      s.wrong = [wrong];
      return s;
    };
    await expectInvalid('wrong.note > 2000 chars', withWrong(buildWrongRecord(ws.state.books[0].id, { note: 'n'.repeat(2001) })));
    await expectInvalid('wrong.date bad format', withWrong(buildWrongRecord(ws.state.books[0].id, { date: '2026-1-1' })));
    await expectInvalid('unknown root key', { ...cloneState(ws.state), unknownExtension: { a: 1 } });

    // --- 旧版字段缺失应被容忍（Lead 决策；test:dr 亦依赖）---
    const legacyTolerant = cloneState(ws.state);
    legacyTolerant.plans = [{ id: 'plan-legacy-no-type', title: '旧版计划', done: false, date: '2026-10-26' }];
    const legacyPush = await postWorkspace({
      cookie: user.cookie,
      csrfToken: user.csrfToken,
      expectedRevision: baseRevision,
      requestId: `req-strict-legacy-${Date.now()}`,
      state: legacyTolerant,
    });
    assert.equal(legacyPush.res.status, 200, JSON.stringify(legacyPush.json));
    const legacyRevision = legacyPush.json.revision;

    // state.version 缺失同样按旧版快照容忍
    const noVersion = cloneState(legacyTolerant);
    delete noVersion.version;
    const noVersionPush = await postWorkspace({
      cookie: user.cookie,
      csrfToken: user.csrfToken,
      expectedRevision: legacyRevision,
      requestId: `req-strict-noversion-${Date.now()}`,
      state: noVersion,
    });
    assert.equal(noVersionPush.res.status, 200, JSON.stringify(noVersionPush.json));
  });

  test('G/R18) workspace payload byte cap: >12MiB => structured 413 WORKSPACE_TOO_LARGE; just-under-cap still accepted', async () => {
    const user = await registerTestUser('payloadcap');
    const ws = await getWorkspace(user.cookie);
    const oneImageChars = 2_900_000; // each data URL stays under the 3,000,000 per-image bound
    const buildBigState = (imageCount: number) => {
      const s = cloneState(ws.state);
      s.wrong = Array.from({ length: imageCount }, (_, i) =>
        buildWrongRecord(s.books[0].id, { id: `wrong-big-${i}-${Date.now()}`, image: makeBase64Image('png', oneImageChars) })
      );
      return s;
    };

    // 5 × 2.9MB ≈ 14.5MB > 12MiB => 413
    const tooBig = buildBigState(5);
    assert.ok(Buffer.byteLength(JSON.stringify(tooBig)) > MAX_WORKSPACE_PAYLOAD_BYTES);
    const overRes = await postWorkspace({
      cookie: user.cookie,
      csrfToken: user.csrfToken,
      expectedRevision: ws.revision,
      requestId: `req-payload-over-${Date.now()}`,
      state: tooBig,
    });
    assert.equal(overRes.res.status, 413, JSON.stringify(overRes.json));
    assert.equal(overRes.json.code, 'WORKSPACE_TOO_LARGE');
    assert.equal(overRes.json.ok, false);
    assert.ok(overRes.json.message.includes(String(MAX_WORKSPACE_PAYLOAD_BYTES)));
    assert.equal(getWorkspaceRow(user.user.id).revision, ws.revision, 'rejected payload must not bump revision');

    // 4 × 2.9MB ≈ 11.6MB < 12MiB => 接受
    const underState = buildBigState(4);
    assert.ok(Buffer.byteLength(JSON.stringify(underState)) < MAX_WORKSPACE_PAYLOAD_BYTES);
    const underRes = await postWorkspace({
      cookie: user.cookie,
      csrfToken: user.csrfToken,
      expectedRevision: ws.revision,
      requestId: `req-payload-under-${Date.now()}`,
      state: underState,
    });
    assert.equal(underRes.res.status, 200, JSON.stringify({ status: underRes.res.status, code: underRes.json.code, msg: underRes.json.message }));
    assert.equal(underRes.json.revision, ws.revision + 1);
  });

  test('F) POST /api/media/upload deduplicates by (user_id, sha256): stable id, deduplicated flag, stable url, no double quota', async () => {
    const user = await registerTestUser('uploaddedupe');
    const first = await uploadTinyPng(user.cookie, user.csrfToken);
    assert.equal(first.res.status, 200);
    assert.equal(first.json.deduplicated, false);
    const mediaId = first.json.media.id;
    assert.equal(first.json.url, `/api/media/${mediaId}`);
    assert.equal(first.json.media.url, `/api/media/${mediaId}`);

    const usageAfterFirst = getUserTotalMediaUsage(user.user.id);
    assert.equal(usageAfterFirst, Buffer.from(TINY_PNG_BASE64, 'base64').length);

    const second = await uploadTinyPng(user.cookie, user.csrfToken, 'tiny-copy.png');
    assert.equal(second.res.status, 200);
    assert.equal(second.json.deduplicated, true);
    assert.equal(second.json.media.id, mediaId, 'dedup must return the existing stable media id');
    assert.equal(second.json.url, `/api/media/${mediaId}`);
    assert.equal(getUserTotalMediaUsage(user.user.id), usageAfterFirst, 'dedup must not double media quota');
    const rowCount = getDb().prepare('SELECT COUNT(*) as cnt FROM media_records WHERE user_id = ?').get(user.user.id) as { cnt: number };
    assert.equal(rowCount.cnt, 1, 'dedup must not create a second media_records row');
  });

  test('G/R18) retention: history keeps 7-day window, prunes only >7-day rows beyond 30 rows/8MiB; idempotency keeps 200 rows/30 days', async () => {
    const user = await registerTestUser('retention');
    const db = getDb();
    const userId = user.user.id;
    let ws = await getWorkspace(user.cookie);
    let revision = ws.revision;

    // 3 次真实同步 => 3 条 7 天窗口内的历史
    for (let i = 0; i < 3; i++) {
      const state = cloneState(ws.state);
      state.plans = [buildValidPlan(`plan-ret-${i}`)];
      const push = await postWorkspace({
        cookie: user.cookie,
        csrfToken: user.csrfToken,
        expectedRevision: revision,
        requestId: `req-ret-small-${i}-${Date.now()}`,
        state,
      });
      assert.equal(push.res.status, 200, JSON.stringify(push.json));
      revision = push.json.revision;
      ws = await getWorkspace(user.cookie);
    }

    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    const insertHistory = db.prepare(`
      INSERT INTO workspace_history (id, user_id, revision, reason, state_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    // 40 条 10 天前的微型旧历史
    for (let i = 0; i < 40; i++) {
      insertHistory.run(`hist_old_${userId}_${i}`, userId, 100 + i, 'fake_old', JSON.stringify({ i }), iso(now - 10 * 24 * 3600 * 1000));
    }
    // 3 条 10 天前的 4MiB 旧历史（合计 12MiB > 8MiB 字节上限）
    const bigPayload = 'x'.repeat(4 * 1024 * 1024);
    for (let i = 0; i < 3; i++) {
      insertHistory.run(
        `hist_big_${userId}_${i}`,
        userId,
        200 + i,
        'fake_big',
        JSON.stringify({ big: bigPayload }),
        iso(now - 10 * 24 * 3600 * 1000 + i * 1000)
      );
    }

    // 再同步一次触发惰性裁剪
    const finalState = cloneState(ws.state);
    finalState.plans = [buildValidPlan('plan-ret-final')];
    const finalPush = await postWorkspace({
      cookie: user.cookie,
      csrfToken: user.csrfToken,
      expectedRevision: revision,
      requestId: `req-ret-final-${Date.now()}`,
      state: finalState,
    });
    assert.equal(finalPush.res.status, 200, JSON.stringify(finalPush.json));

    const retained = db.prepare(`
      SELECT id, created_at, LENGTH(CAST(state_json AS BLOB)) as bytes FROM workspace_history WHERE user_id = ?
    `).all(userId) as Array<{ id: string; created_at: string; bytes: number }>;
    const cutoffIso = iso(now - WORKSPACE_HISTORY_RECENT_WINDOW_MS);
    const recentRows = retained.filter(r => r.created_at >= cutoffIso);
    const oldRows = retained.filter(r => r.created_at < cutoffIso);
    const oldBytes = oldRows.reduce((sum, r) => sum + r.bytes, 0);

    assert.equal(recentRows.length, 4, '7-day recovery window rows must never be pruned (3 pushes + final push history)');
    assert.ok(retained.length <= WORKSPACE_HISTORY_KEEP_ROWS, `history rows (${retained.length}) must be <= ${WORKSPACE_HISTORY_KEEP_ROWS}`);
    assert.ok(oldBytes <= WORKSPACE_HISTORY_MAX_BYTES, `old history bytes (${oldBytes}) must be <= ${WORKSPACE_HISTORY_MAX_BYTES}`);
    const bigRowsRetained = retained.filter(r => String(r.id).startsWith('hist_big_')).length;
    assert.ok(bigRowsRetained <= 1, '8MiB byte cap must prune most of the 12MiB fake old snapshots');
    assert.ok(retained.length < 40 + 3 + 4, 'retention must actually prune >7-day excess rows');

    // --- 同步幂等记录：30 天 TTL + 每账号最多 200 行 ---
    const insertIdem = db.prepare(`
      INSERT INTO sync_idempotency (user_id, request_id, expected_revision, result_revision, payload_sha256, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const staleIso = iso(now - 40 * 24 * 3600 * 1000);
    for (let i = 0; i < 250; i++) {
      insertIdem.run(userId, `fake_idem_${i}`, 1, 1, 'x'.repeat(64), iso(now - 1000));
    }
    for (let i = 0; i < 10; i++) {
      insertIdem.run(userId, `old_idem_${i}`, 1, 1, 'x'.repeat(64), staleIso);
    }

    ws = await getWorkspace(user.cookie);
    const idemPushState = cloneState(ws.state);
    idemPushState.plans = [buildValidPlan('plan-ret-idem')];
    const idemPush = await postWorkspace({
      cookie: user.cookie,
      csrfToken: user.csrfToken,
      expectedRevision: ws.revision,
      requestId: `req-ret-idem-${Date.now()}`,
      state: idemPushState,
    });
    assert.equal(idemPush.res.status, 200, JSON.stringify(idemPush.json));

    const idemRows = db.prepare('SELECT request_id, created_at FROM sync_idempotency WHERE user_id = ?').all(userId) as Array<{ request_id: string; created_at: string }>;
    assert.equal(idemRows.length, SYNC_IDEMPOTENCY_MAX_ROWS, 'idempotency rows must be capped at 200 per user');
    const ttlCutoff = iso(now - 30 * 24 * 3600 * 1000);
    assert.equal(idemRows.filter(r => r.created_at < ttlCutoff).length, 0, 'idempotency rows older than 30 days must be pruned');
    assert.ok(idemRows.some(r => String(r.request_id).startsWith('req-ret-idem-')), 'new idempotency record must be retained');
  });

  test('A09) Unified pure media reference extraction, false media rejection, delete protection and corrupted JSON handling', async () => {
    const db = getDb();
    // 1. Setup user and upload real media
    const user = await registerTestUser('user_a09');
    const uploadRes = await uploadTinyPng(user.cookie, user.csrfToken);
    const mediaId = uploadRes.json.media.id;

    // 2. Set profile.name to 'media:plain-note', wrong[].note to 'media:fake-image', courses[0].url to 'https://example.com/media:foo'
    const curWs = await getWorkspace(user.cookie);
    const stateWithPseudoMedia = cloneState(curWs.state);
    stateWithPseudoMedia.profile.name = 'media:plain-note';
    stateWithPseudoMedia.wrong = [
      buildWrongRecord(stateWithPseudoMedia.books[0].id, {
        note: `media:${mediaId}_fake`,
        image: '',
      }),
    ];
    stateWithPseudoMedia.courses[0].url = 'https://study.example.com/media:video';

    // Push revision with pseudo media text
    const pushPseudo = await postWorkspace({
      cookie: user.cookie,
      csrfToken: user.csrfToken,
      expectedRevision: curWs.revision,
      requestId: `req-a09-pseudo-${Date.now()}`,
      state: stateWithPseudoMedia,
    });
    assert.equal(pushPseudo.res.status, 200);

    // Push clear revision to create history entry
    const clearState = cloneState(curWs.state);
    const pushClear = await postWorkspace({
      cookie: user.cookie,
      csrfToken: user.csrfToken,
      expectedRevision: pushPseudo.json.revision,
      requestId: `req-a09-clear-${Date.now()}`,
      state: clearState,
    });
    assert.equal(pushClear.res.status, 200);

    // Retrieve history record for pseudo media revision
    const historyRes = await fetch(`${baseUrl}/api/backups/history`, {
      headers: { cookie: user.cookie },
    });
    const { history } = await historyRes.json();
    const pseudoHistory = history.find((h: any) => h.revision === pushPseudo.json.revision);
    assert.ok(pseudoHistory);

    // Restore from history - MUST SUCCEED with 200 (not 409 RESTORE_MEDIA_UNAVAILABLE)
    const restoreRes = await fetch(`${baseUrl}/api/backups/restore-history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': user.csrfToken, cookie: user.cookie },
      body: JSON.stringify({ historyId: pseudoHistory.id }),
    });
    assert.equal(restoreRes.status, 200);
    const restoreData = await restoreRes.json();
    assert.equal(restoreData.ok, true);

    // 3. Delete protection: ordinary text with 'media:' does NOT block deleting another media
    const deleteRes = await fetch(`${baseUrl}/api/media/${mediaId}`, {
      method: 'DELETE',
      headers: { 'x-csrf-token': user.csrfToken, cookie: user.cookie },
    });
    assert.equal(deleteRes.status, 200);

    // 4. Corrupted history JSON explicitly refuses restore (400 CORRUPTED_HISTORY_JSON)
    const corruptHistId = `hist_corrupt_${Date.now()}`;
    db.prepare(`
      INSERT INTO workspace_history (id, user_id, revision, reason, state_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(corruptHistId, user.user.id, 999, 'corrupt_test', 'INVALID_JSON{broken', new Date().toISOString());

    const corruptRestoreRes = await fetch(`${baseUrl}/api/backups/restore-history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': user.csrfToken, cookie: user.cookie },
      body: JSON.stringify({ historyId: corruptHistId }),
    });
    assert.equal(corruptRestoreRes.status, 400);
    const corruptData = await corruptRestoreRes.json();
    assert.equal(corruptData.code, 'CORRUPTED_HISTORY_JSON');

    // 5. Corrupted history JSON explicitly protects deletion (409 MEDIA_REFERENCE_CHECK_FAILED)
    const newUpload = await uploadTinyPng(user.cookie, user.csrfToken);
    const newMediaId = newUpload.json.media.id;
    const deleteBlockedRes = await fetch(`${baseUrl}/api/media/${newMediaId}`, {
      method: 'DELETE',
      headers: { 'x-csrf-token': user.csrfToken, cookie: user.cookie },
    });
    assert.equal(deleteBlockedRes.status, 409);
    const deleteBlockedJson = await deleteBlockedRes.json();
    assert.equal(deleteBlockedJson.code, 'MEDIA_REFERENCE_CHECK_FAILED');

    // Clean up corrupted test history row
    db.prepare('DELETE FROM workspace_history WHERE id = ?').run(corruptHistId);
  });

  test('A05) Deduplication runs before quota check, prevents false 413, and retry repairs corrupted disk file with verified bytes', async () => {
    const db = getDb();
    const user = await registerTestUser('user_a05');
    const attachmentsDir = getAttachmentsDir();

    // 1. Upload initial PNG
    const firstUpload = await uploadTinyPng(user.cookie, user.csrfToken);
    assert.equal(firstUpload.res.status, 200);
    assert.equal(firstUpload.json.deduplicated, false);
    const mediaId = firstUpload.json.media.id;
    const mediaRow = db.prepare('SELECT filename, byte_size, sha256 FROM media_records WHERE id = ?').get(mediaId) as { filename: string; byte_size: number; sha256: string };
    assert.ok(mediaRow);

    // 2. Artificially inflate user quota usage to MAX_USER_QUOTA_BYTES using a dummy record
    const dummyId = `media_dummy_${Date.now()}`;
    db.prepare(`
      INSERT INTO media_records (id, user_id, filename, original_name, mime_type, byte_size, sha256, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(dummyId, user.user.id, 'dummy.png', 'dummy.png', 'image/png', MAX_USER_QUOTA_BYTES, 'dummy_sha', new Date().toISOString());

    // 3. Retry uploading the exact same PNG - must succeed (200, deduplicated: true) despite quota being exhausted
    const retryUnderFullQuota = await uploadTinyPng(user.cookie, user.csrfToken);
    assert.equal(retryUnderFullQuota.res.status, 200, 'Deduplicated retry must not be blocked by quota check');
    assert.equal(retryUnderFullQuota.json.deduplicated, true);
    assert.equal(retryUnderFullQuota.json.media.id, mediaId);

    // Remove dummy quota filler
    db.prepare('DELETE FROM media_records WHERE id = ?').run(dummyId);

    // 4. Corrupt the disk file with bad bytes
    const diskPath = path.join(attachmentsDir, mediaRow.filename);
    assert.ok(fs.existsSync(diskPath));
    const corruptBytes = Buffer.alloc(mediaRow.byte_size, 0x7f);
    fs.writeFileSync(diskPath, corruptBytes);

    // Verify disk file is currently corrupted
    assert.ok(!fs.readFileSync(diskPath).equals(Buffer.from(TINY_PNG_BASE64, 'base64')));

    // 5. Retry upload - server must repair the corrupted disk file using the verified incoming buffer
    const retryRepair = await uploadTinyPng(user.cookie, user.csrfToken);
    assert.equal(retryRepair.res.status, 200);
    assert.equal(retryRepair.json.deduplicated, true);
    assert.equal(retryRepair.json.media.id, mediaId);

    // 6. Verify disk file has been repaired with genuine PNG bytes
    const repairedBytes = fs.readFileSync(diskPath);
    assert.ok(repairedBytes.equals(Buffer.from(TINY_PNG_BASE64, 'base64')), 'Corrupted disk file must be repaired with verified bytes on retry');
  });
});

