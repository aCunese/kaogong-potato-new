import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-sharing-'));
process.env.DATA_DIR = temp;

test('sharing codes establish isolated read-only grants over validated cloud study data', async t => {
  const { getDb, closeDb, getCurrentGenerationId, rotateGenerationId } = await import('../server/db');
  const { createSession } = await import('../server/auth');
  const { initSharingSchema } = await import('../server/sharing');
  const { sharingRouter } = await import('../server/sharingRoutes');
  const { BLANK_STATE } = await import('../src/constants/initialData');
  const db = getDb(); initSharingSchema(db);
  const app = express(); app.use(express.json()); app.use(cookieParser()); app.use(sharingRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let actorNumber = 0;
  const actor = (nickname = '测试昵称') => {
    const id = `sharing-actor-${++actorNumber}`;
    const now = new Date().toISOString();
    db.prepare('INSERT INTO users (id,username,nickname,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(id, `private-user-${actorNumber}`, nickname, 'unused-test-hash', now, now);
    const session = createSession(id);
    const headers = { 'content-type': 'application/json', cookie: `potato_session=${session.token}`, 'x-csrf-token': session.csrfToken, 'x-workspace-user': id };
    return { id, headers };
  };
  const request = async (user: ReturnType<typeof actor>, route: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${base}/api/sharing${route}`, { method, headers: user.headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, headers: response.headers, data: await response.json() as any };
  };
  const createCode = async (owner: ReturnType<typeof actor>) => {
    const result = await request(owner, '/codes', 'POST');
    assert.equal(result.status, 200); return result.data.code;
  };
  const grant = async (owner: ReturnType<typeof actor>, viewer: ReturnType<typeof actor>) => {
    const code = await createCode(owner);
    const result = await request(viewer, '/redeem', 'POST', { code: code.value });
    assert.equal(result.status, 200); return result.data.grant;
  };
  const workspace = (owner: ReturnType<typeof actor>, version = 5, recordCount = 3) => {
    const state: any = structuredClone(BLANK_STATE); state.version = version;
    state.profile = { name: '私人空间名', username: 'PRIVATE_PROFILE', avatar: 'https://example.com/PRIVATE_AVATAR' };
    state.books = [{ id: 'b1', name: '资料题库', subject: '资料分析', total: 100, pages: 20, done: 40, errors: 8, minutes: 70, note: 'PRIVATE_BOOK_NOTE' }];
    state.courses = [{ id: 'c1', name: '判断课程', subject: '判断推理', totalLessons: 12, completedLessons: 3, minutes: 60, url: 'https://example.com/PRIVATE_COURSE' }];
    state.plans = [
      { id: 'future', name: 'PRIVATE_FUTURE_PLAN', date: '2099-10-28', type: 'custom', subject: '其他', done: false, plannedMinutes: 5 },
      { id: 'done-custom', name: '复盘当日学习', date: '2026-10-03', type: 'custom', subject: '其他', done: true, plannedMinutes: 15 },
    ];
    state.todos = [{ id: 'todo', text: 'PRIVATE_TODO', date: '2026-10-01', done: false, createdAt: 1, completedAt: 0 }];
    state.wrong = [{ id: 'wrong', bookId: 'b1', date: '2026-10-01', note: 'PRIVATE_WRONG_NOTE', image: 'https://example.com/PRIVATE_PHOTO' }];
    state.records = [
      { id: 'r1', date: '2026-10-01', type: 'book', subject: '资料分析', sourceId: 'b1', minutes: 20, questions: 10, errors: 2, note: 'PRIVATE_RECORD_NOTE' },
      { id: 'r2', date: '2026-10-02', type: 'course', subject: '判断推理', sourceId: 'c1', minutes: 30, questions: 99, errors: 9, lessons: 2 },
      { id: 'r3', planId: 'done-custom', date: '2026-10-03', type: 'custom', subject: '其他', sourceId: '', minutes: 15, questions: 99, errors: 9 },
    ];
    if (recordCount > 3) state.records = Array.from({ length: recordCount }, (_, i) => ({ id: `page-${i}`, date: '2026-10-01', type: 'book', subject: '资料分析', sourceId: 'b1', minutes: 1, questions: 1, errors: 0 }));
    if (version === 3) delete state.todos;
    db.prepare('INSERT OR REPLACE INTO workspaces (user_id,generation_id,state_json,schema_version,updated_at) VALUES (?,?,?,?,?)').run(owner.id, getCurrentGenerationId(), JSON.stringify(state), version, '2026-10-10T10:00:00.000Z');
    return state;
  };

  try {
    await t.test('codes require authenticated CSRF, store only a digest, and cannot spoof owner identity', async () => {
      const owner = actor('分享者'); const viewer = actor('查看者');
      const unauth = await fetch(`${base}/api/sharing/codes`, { method: 'POST' }); assert.equal(unauth.status, 401);
      const noCsrf = await fetch(`${base}/api/sharing/codes`, { method: 'POST', headers: { cookie: owner.headers.cookie } }); assert.equal(noCsrf.status, 403);
      const mismatched = await fetch(`${base}/api/sharing/codes`, { method: 'POST', headers: { ...owner.headers, 'x-workspace-user': viewer.id } }); assert.equal(mismatched.status, 409);
      const generated = await request(owner, '/codes', 'POST', { ownerId: viewer.id });
      assert.equal(generated.status, 200); const code = generated.data.code;
      assert.match(code.value, /^[A-Za-z0-9_-]{22,}$/);
      assert.ok(Date.parse(code.expiresAt) - Date.now() <= 600_000);
      assert.ok(Date.parse(code.expiresAt) - Date.now() > 590_000);
      const stored = db.prepare('SELECT * FROM sharing_codes WHERE id = ?').get(code.id) as any;
      assert.equal(stored.owner_id, owner.id); assert.equal(JSON.stringify(stored).includes(code.value), false);
      const listing = await request(owner, '/grants'); assert.equal(JSON.stringify(listing.data).includes(code.value), false);
      assert.equal((await request(viewer, `/codes/${code.id}`, 'DELETE')).status, 404);
      assert.equal((await request(owner, `/codes/${code.id}`, 'DELETE')).status, 200);
      assert.equal((await request(viewer, '/redeem', 'POST', { code: code.value })).status, 400);
    });

    await t.test('self redemption preserves the code, simultaneous redemption consumes it once, and pair grants remain unique', async () => {
      const owner = actor('主人'); const viewer = actor('朋友'); const third = actor('路人'); const code = await createCode(owner);
      assert.equal((await request(owner, '/redeem', 'POST', { code: code.value })).status, 400);
      const attempts = await Promise.all([request(viewer, '/redeem', 'POST', { code: code.value }), request(third, '/redeem', 'POST', { code: code.value })]);
      assert.deepEqual(attempts.map(r => r.status).sort(), [200, 400]);
      const winner = attempts[0].status === 200 ? viewer : third;
      const firstGrant = attempts.find(r => r.status === 200)!.data.grant;
      const secondGrant = await grant(owner, winner);
      assert.equal(secondGrant.id, firstGrant.id);
      assert.equal((await request(owner, '/grants')).data.owned.length, 1);
      assert.equal((await request(winner, '/grants')).data.received.length, 1);
      assert.equal((await request(winner, '/redeem', 'POST', { code: code.value })).status, 400);
    });

    await t.test('expired codes fail and codes from disabled owners cannot create grants', async () => {
      const owner = actor(); const viewer = actor(); const code = await createCode(owner);
      db.prepare('UPDATE sharing_codes SET expires_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', code.id);
      assert.equal((await request(viewer, '/redeem', 'POST', { code: code.value })).status, 400);
      const next = await createCode(owner); db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(owner.id);
      assert.equal((await request(viewer, '/redeem', 'POST', { code: next.value })).status, 400);
    });

    await t.test('overview excludes private fields, separates range totals from catalogue progress, and supports legacy versions', async () => {
      const owner = actor('可见昵称'); const viewer = actor(); workspace(owner); const permission = await grant(owner, viewer);
      const result = await request(viewer, `/grants/${permission.id}/overview?from=2026-10-02&to=2026-10-03`);
      assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'no-store');
      const overview = result.data.overview;
      assert.equal(overview.ownerNickname, '可见昵称'); assert.equal(overview.updatedAt, '2026-10-10T10:00:00.000Z');
      assert.deepEqual(overview.selectedTotals, { minutes: 45, questions: 0, errors: 0, accuracy: null, lessons: 2 });
      assert.deepEqual(overview.allTimeTotals, { minutes: 65, questions: 10, errors: 2, accuracy: 80, lessons: 2 });
      assert.deepEqual(overview.books[0], { name: '资料题库', subject: '资料分析', total: 100, done: 40, errors: 8, minutes: 70 });
      assert.deepEqual(overview.courses[0], { name: '判断课程', subject: '判断推理', total: 12, done: 3, errors: 0, minutes: 60 });
      assert.deepEqual(overview.records.items.map((r: any) => [r.date, r.sourceName, r.quantity]), [['2026-10-03', '复盘当日学习', 0], ['2026-10-02', '判断课程', 2]]);
      const serialized = JSON.stringify(overview);
      for (const privateValue of ['PRIVATE_', 'PRIVATE', '私人空间名', 'password', 'username', 'avatar', 'url', 'note', 'sourceId', 'planId', 'todo', 'future', 'state_json']) assert.equal(serialized.includes(privateValue), false, privateValue);
      for (const version of [3, 4]) { workspace(owner, version); assert.equal((await request(viewer, `/grants/${permission.id}/overview`)).status, 200); }
    });

    await t.test('includes completed local-day records even when their date is ahead of the UTC server day', async () => {
      const owner = actor(); const viewer = actor(); const state = workspace(owner);
      const localDate = new Date(Date.now()+86400000).toISOString().slice(0,10);
      state.records = [{id:'local-receipt',planId:'local-complete',date:localDate,type:'custom',sourceId:'',subject:'其他',minutes:7,questions:0,errors:0}];
      state.plans.push({id:'local-complete',name:'当地凌晨学习',date:localDate,type:'custom',subject:'其他',done:true,plannedMinutes:7});
      db.prepare('UPDATE workspaces SET state_json=? WHERE user_id=?').run(JSON.stringify(state),owner.id);
      const permission = await grant(owner,viewer);
      const response=await request(viewer,'/grants/'+permission.id+'/overview');
      assert.equal(response.status,200);
      assert.equal(response.data.overview.allTimeTotals.minutes,7);
      assert.equal(response.data.overview.records.total,1);
      assert.equal(response.data.overview.records.items[0].sourceName,'当地凌晨学习');
      assert.equal(JSON.stringify(response.data).includes('PRIVATE_FUTURE_PLAN'),false);
    });

    await t.test('daily records use bounded pages while summaries cover the full date range and invalid data fails closed', async () => {
      const owner = actor(); const viewer = actor(); const state = workspace(owner, 5, 205); const permission = await grant(owner, viewer);
      const first = (await request(viewer, `/grants/${permission.id}/overview?pageSize=500`)).data.overview;
      assert.equal(first.records.items.length, 100); assert.equal(first.records.total, 205); assert.equal(first.records.pageSize, 100);
      assert.equal(first.selectedTotals.questions, 205);
      const third = (await request(viewer, `/grants/${permission.id}/overview?page=3&pageSize=100`)).data.overview;
      assert.equal(third.records.items.length, 5);
      for (const query of ['from=2026-02-30', 'from=2026-99-99', 'from=2026-10-03&to=2026-10-01', 'page=0', 'pageSize=-1']) assert.equal((await request(viewer, `/grants/${permission.id}/overview?${query}`)).status, 400);
      state.records[0].minutes = 'PRIVATE_INVALID';
      db.prepare('UPDATE workspaces SET state_json = ? WHERE user_id = ?').run(JSON.stringify(state), owner.id);
      const invalid = await request(viewer, `/grants/${permission.id}/overview`); assert.equal(invalid.status, 422); assert.equal(JSON.stringify(invalid.data).includes('PRIVATE_INVALID'), false);
    });

    await t.test('only the authorized viewer can read, only owner can revoke, and owner disabling is checked on every read', async () => {
      const owner = actor(); const otherOwner = actor(); const viewer = actor(); workspace(owner); const permission = await grant(owner, viewer);
      assert.equal((await request(otherOwner, `/grants/${permission.id}/overview`)).status, 403);
      assert.equal((await request(owner, `/grants/${permission.id}/overview`)).status, 403);
      assert.equal((await request(viewer, `/grants/${permission.id}`, 'DELETE')).status, 404);
      db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(owner.id);
      const disabled = await request(viewer, `/grants/${permission.id}/overview`); assert.equal(disabled.status, 403); assert.equal(disabled.headers.get('cache-control'), 'no-store');
      db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(owner.id);
      assert.equal((await request(owner, `/grants/${permission.id}`, 'DELETE')).status, 200);
      assert.equal((await request(viewer, `/grants/${permission.id}/overview`)).status, 403);
      assert.equal((await request(viewer, '/grants')).data.received.length, 0);
    });

    await t.test('real-time overview includes unrecorded plans and active Pomodoro focus across timezones without double counting or leaking private fields', async () => {
      const { getSharedStudyOverview } = await import('../server/sharing');
      const owner = actor('阿土同学');
      const viewer = actor('看学友');
      const permission = await grant(owner, viewer);

      // Server UTC clock is 2026-11-12T22:30:00Z, which is 2026-11-13 06:30:00 in Asia/Shanghai (tzOffset = -480)
      const nowMs = Date.parse('2026-11-12T22:30:00.000Z');
      const localToday = '2026-11-13';
      const localYesterday = '2026-11-12';

      const state: any = structuredClone(BLANK_STATE);
      state.version = 5;
      state.records = [
        { id: 'rec-yesterday', date: localYesterday, type: 'book', subject: '资料分析', sourceId: 'b1', minutes: 40, questions: 20, errors: 2, note: 'PRIVATE_YESTERDAY_NOTE' },
        { id: 'rec-today', planId: 'plan-done-today', date: localToday, type: 'custom', subject: '申论', sourceId: '', minutes: 20, questions: 0, errors: 0, note: 'PRIVATE_TODAY_NOTE' },
        { id: 'rec-sess-done', planId: 'plan-sess-done', sessionId: 'sess-registered', date: localToday, type: 'custom', subject: '判断推理', sourceId: '', minutes: 25, questions: 0, errors: 0 },
      ];
      state.plans = [
        // Already recorded via rec-today -> must NOT double count
        { id: 'plan-done-today', name: '已完成计划', date: localToday, type: 'custom', subject: '申论', plannedMinutes: 20, actualMinutes: 20, accumulatedMs: 20 * 60_000, done: true },
        // Plan generated by registered TimerSession -> must NOT double count
        { id: 'plan-sess-done', name: '已登记番茄钟', date: localToday, type: 'custom', subject: '判断推理', plannedMinutes: 25, actualMinutes: 25, accumulatedMs: 25 * 60_000, done: true, sessionId: 'sess-registered' },
        // Paused unrecorded plan on localToday: 15m accumulatedMs
        { id: 'plan-running', name: 'PRIVATE_RUNNING_PLAN', date: localToday, type: 'book', sourceId: 'b1', subject: '资料分析', plannedMinutes: 30, actualMinutes: 0, accumulatedMs: 15 * 60_000, timerStart: 0, done: false },
        // Paused unrecorded legacy plan on localToday: omits accumulatedMs, actualMinutes = 12m
        { id: 'plan-paused-legacy', name: '暂停计划', date: localToday, type: 'custom', subject: '常识判断', plannedMinutes: 30, actualMinutes: 12, timerStart: 0, done: false },
        // Archived plan -> must NOT count
        { id: 'plan-archived', name: '已归档计划', date: localToday, type: 'custom', subject: '常识判断', plannedMinutes: 30, actualMinutes: 50, accumulatedMs: 50 * 60_000, done: false, archived: true },
      ];
      state.timerSessions = [
        // Running standalone Pomodoro crossing midnight in UTC+8 (23:50 on 2026-11-12 -> 00:05 on 2026-11-13 = 10m yesterday, 5m today + 5m live runningSince = 10m today) + 10m rest (excluded!)
        {
          id: 'sess-live-pomo',
          title: 'PRIVATE_POMO_TITLE',
          subject: '判断推理',
          timerMode: 'pomodoro',
          focusMinutes: 25,
          restMinutes: 5,
          phase: 'focus',
          phaseMs: 5 * 60_000,
          status: 'running',
          createdAt: Date.parse('2026-11-12T15:50:00.000Z'),
          endedAt: 0,
          runningSince: nowMs - 5 * 60_000,
          segments: [
            { phase: 'focus', start: Date.parse('2026-11-12T15:50:00.000Z'), end: Date.parse('2026-11-12T16:05:00.000Z') }, // 10m on 11-12, 5m on 11-13
            { phase: 'rest', start: Date.parse('2026-11-12T16:05:00.000Z'), end: Date.parse('2026-11-12T16:15:00.000Z') }, // 10m rest excluded
          ],
        },
        // Registered session -> must NOT double count
        {
          id: 'sess-registered',
          title: '已登记番茄钟',
          subject: '判断推理',
          timerMode: 'pomodoro',
          focusMinutes: 25,
          restMinutes: 5,
          phase: 'focus',
          phaseMs: 25 * 60_000,
          status: 'registered',
          planId: 'plan-sess-done',
          createdAt: nowMs - 3_600_000,
          endedAt: nowMs - 2_100_000,
          runningSince: 0,
          segments: [{ phase: 'focus', start: nowMs - 3_600_000, end: nowMs - 2_100_000 }],
        },
      ];

      db.prepare('INSERT OR REPLACE INTO workspaces (user_id,generation_id,state_json,schema_version,updated_at) VALUES (?,?,?,?,?)')
        .run(owner.id, getCurrentGenerationId(), JSON.stringify(state), 5, new Date(nowMs).toISOString());

      // 1. Today's view (2026-11-13 in tzOffset=-480):
      // Recorded today = rec-today (20) + rec-sess-done (25) = 45m
      // Pending today = plan-running (15) + plan-paused-legacy (12) + sess-live-pomo today segment (10) = 37m
      // Selected today total = 45 + 37 = 82m
      // All-time total = 40 (yesterday rec) + 45 (today rec) + 15 + 12 + 20 (full 20m focus of sess-live-pomo) = 132m
      const todayOverview = getSharedStudyOverview(
        viewer.id,
        permission.id,
        { from: localToday, to: localToday, localDate: localToday, tzOffset: '-480' },
        { now: () => nowMs }
      );
      assert.equal(todayOverview.recordedMinutes, 45);
      assert.equal(todayOverview.pendingMinutes, 37);
      assert.equal(todayOverview.selectedTotals.minutes, 82);
      assert.equal(todayOverview.allTimeTotals.minutes, 132);

      // Ensure private titles/notes never leak
      const rawJson = JSON.stringify(todayOverview);
      assert.equal(rawJson.includes('PRIVATE_'), false);
      assert.deepEqual(Object.keys(todayOverview.selectedTotals).sort(), ['accuracy', 'errors', 'lessons', 'minutes', 'questions']);

      // 2. Yesterday's view (2026-11-12):
      // Recorded yesterday = 40m; sess-live-pomo had 10m before midnight, NOT today's pending plans
      const yesterdayOverview = getSharedStudyOverview(
        viewer.id,
        permission.id,
        { from: localYesterday, to: localYesterday, localDate: localToday, tzOffset: '-480' },
        { now: () => nowMs }
      );
      assert.equal(yesterdayOverview.recordedMinutes, 40);
      assert.equal(yesterdayOverview.selectedTotals.minutes, 50);
      assert.equal(yesterdayOverview.allTimeTotals.minutes, 132);

      // 3. Running plan (10m accumulated + 5m live = 15m) + paused Pomodoro (same 20m focus) -> identical real-time totals
      state.plans[2].accumulatedMs = 10 * 60_000;
      state.plans[2].timerStart = nowMs - 5 * 60_000;
      state.timerSessions[0].status = 'paused';
      state.timerSessions[0].runningSince = 0;
      state.timerSessions[0].segments[0].end = Date.parse('2026-11-12T16:10:00.000Z'); // 10m on 11-12, 10m on 11-13
      state.timerSessions[0].segments[1].start = Date.parse('2026-11-12T16:10:00.000Z');
      state.timerSessions[0].segments[1].end = Date.parse('2026-11-12T16:20:00.000Z');
      db.prepare('INSERT OR REPLACE INTO workspaces (user_id,generation_id,state_json,schema_version,updated_at) VALUES (?,?,?,?,?)')
        .run(owner.id, getCurrentGenerationId(), JSON.stringify(state), 5, new Date(nowMs).toISOString());

      const runningPlanOverview = getSharedStudyOverview(
        viewer.id,
        permission.id,
        { from: localToday, to: localToday, localDate: localToday, tzOffset: '-480' },
        { now: () => nowMs }
      );
      assert.equal(runningPlanOverview.pendingMinutes, 37);
      assert.equal(runningPlanOverview.selectedTotals.minutes, 82);
    });

    await t.test('rate limiting bounds repeated redemption attempts for the same user and IP', async () => {
      const viewer = actor(); let limited = false;
      for (let i = 0; i < 65; i++) { const response = await request(viewer, '/redeem', 'POST', { code: 'invalid_code_with_enough_length' }); if (response.status === 429) { limited = true; break; } }
      assert.equal(limited, true);
    });

    await t.test('generation rotation invalidates both unused codes and existing grants even with fresh sessions', async () => {
      const owner = actor(); const viewer = actor(); workspace(owner); const permission = await grant(owner, viewer); const code = await createCode(owner);
      rotateGenerationId();
      for (const user of [owner, viewer]) { const session = createSession(user.id); user.headers.cookie = `potato_session=${session.token}`; user.headers['x-csrf-token'] = session.csrfToken; }
      assert.equal((await request(viewer, `/grants/${permission.id}/overview`)).status, 403);
      assert.equal((await request(viewer, '/redeem', 'POST', { code: code.value })).status, 400);
      const list = await request(owner, '/grants'); assert.deepEqual(list.data.owned, []); assert.deepEqual(list.data.codes, []);
    });

    await t.test('one IP cannot bypass redemption rate limits by rotating authenticated users', async () => {
      let limited = false;
      for (let users = 0; users < 10 && !limited; users++) {
        const viewer = actor();
        for (let attempts = 0; attempts < 15; attempts++) {
          const response = await request(viewer, '/redeem', 'POST', { code: 'invalid_code_with_enough_length' });
          if (response.status === 429) { limited = true; break; }
        }
      }
      assert.equal(limited, true);
    });
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); closeDb(); fs.rmSync(temp, { recursive: true, force: true });
  }
});
