import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-companion-'));
process.env.DATA_DIR = temp;

test('companion note and nudge system with 30-min cooldown and rich HTML email', async t => {
  const { getDb, closeDb, getCurrentGenerationId } = await import('../server/db');
  const { createSession } = await import('../server/auth');
  const { initSharingSchema, pokeCompanion, listSharingGrants, createCompanionNote, listCompanionNotes, heartCompanionNote } = await import('../server/sharing');
  const { sharingRouter } = await import('../server/sharingRoutes');
  const { generatePokeEmailContent } = await import('../server/pokeEmailTemplate');
  const { BLANK_STATE } = await import('../src/constants/initialData');

  const db = getDb();
  initSharingSchema(db);

  const app = express();
  app.use((req, res, next) => {
    const isWorkspaceSync = req.path === '/api/workspace';
    const isCompanionNote = req.path === '/api/sharing/notes' || req.path.startsWith('/api/sharing/notes');
    const limit = isWorkspaceSync ? '50mb' : isCompanionNote ? '10mb' : '64kb';
    express.json({ limit })(req, res, next);
  });
  app.use(cookieParser());
  app.use(sharingRouter);

  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  let userSeq = 0;
  const createUser = (nickname = '同学') => {
    const id = `user-${++userSeq}`;
    const now = new Date().toISOString();
    db.prepare('INSERT INTO users (id,username,nickname,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run(id, `login-${userSeq}`, nickname, 'test-hash', now, now);
    const session = createSession(id);
    const headers = {
      'content-type': 'application/json',
      cookie: `potato_session=${session.token}`,
      'x-csrf-token': session.csrfToken,
      'x-workspace-user': id,
    };
    return { id, nickname, headers };
  };

  const createGrant = (owner: { id: string }, viewer: { id: string }) => {
    const grantId = `grant-${++userSeq}`;
    const now = new Date().toISOString();
    const generation = getCurrentGenerationId();
    db.prepare('INSERT INTO sharing_grants (id, owner_id, viewer_id, generation_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(grantId, owner.id, viewer.id, generation, now);
    return grantId;
  };

  try {
    await t.test('generatePokeEmailContent produces complete HTML and text with exam context', () => {
      const { subject, text, html } = generatePokeEmailContent({
        senderNickname: '阿土同学',
        recipientNickname: '小豆子',
        loginUrl: 'https://potato.study',
      });
      assert.match(subject, /阿土同学/);
      assert.match(subject, /学习打卡/);
      assert.match(text, /小豆子/);
      assert.match(text, /行测/);
      assert.match(text, /申论/);
      assert.match(text, /https:\/\/potato\.study/);
      assert.match(html, /阿土同学/);
      assert.match(html, /小豆子/);
      assert.match(html, /行测/);
      assert.match(html, /申论/);
      assert.match(html, /立即回桌前开始学习/);
      assert.match(html, /#4B6240/); // Potato Sage Brand Color
    });

    await t.test('pokeCompanion sends HTML email and respects 30-minute cooldown', async () => {
      const sender = createUser('阿土同学');
      const receiver = createUser('小豆子');
      const grantId = createGrant(receiver, sender); // receiver is owner, sender is viewer

      // Bind receiver email
      db.prepare('INSERT INTO account_email_bindings (user_id, email, verified_at) VALUES (?, ?, ?)')
        .run(receiver.id, 'bean@example.com', Date.now());

      const sentMails: any[] = [];
      const mockSender = {
        available: true,
        send: async (msg: any) => {
          sentMails.push(msg);
        },
      };

      // 1. First poke: should succeed and send mail
      const result1 = await pokeCompanion(sender.id, grantId, { sender: mockSender as any });
      assert.equal(result1.ok, true);
      assert.equal(result1.delivered, true);
      assert.equal(result1.recipientEmail, 'bean@example.com');
      assert.equal(sentMails.length, 1);
      assert.equal(sentMails[0].to, 'bean@example.com');
      assert.match(sentMails[0].subject, /阿土同学/);
      assert.match(sentMails[0].html, /学习打卡提醒/);

      // Verify a companion note was also automatically created for the recipient
      const notes = listCompanionNotes(receiver.id);
      assert.equal(notes.notes.length >= 1, true);
      assert.match(notes.notes[0].message, /催学提醒/);

      // 2. Second poke within 30 min: must throw SharingError with status 429
      await assert.rejects(
        () => pokeCompanion(sender.id, grantId, { sender: mockSender as any }),
        (err: any) => {
          assert.equal(err.status, 429);
          assert.equal(err.code, 'NUDGE_COOLDOWN');
          assert.match(err.message, /30 分钟后再戳吧/);
          return true;
        }
      );

      // 3. Simulated time travel: after 31 minutes, poke succeeds again
      const futureNow = Date.now() + 31 * 60 * 1000;
      const result2 = await pokeCompanion(sender.id, grantId, { sender: mockSender as any, now: () => futureNow });
      assert.equal(result2.ok, true);
      assert.equal(sentMails.length, 2);
    });

    await t.test('companion notes CRUD and heart reaction', () => {
      const sender = createUser('阿土同学');
      const receiver = createUser('小豆子');
      const grantId = createGrant(receiver, sender);

      // Create a companion note with text and custom sticker image
      const note = createCompanionNote(sender.id, {
        toUserId: receiver.id,
        grantId,
        message: '今天行测做完真题一套，一起冲！',
        imageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      });
      assert.equal(note.message, '今天行测做完真题一套，一起冲！');
      assert.ok(note.imageUrl);
      assert.equal(note.hearts, 0);

      // List notes
      const list = listCompanionNotes(receiver.id);
      assert.equal(list.notes.some(n => n.id === note.id), true);

      // Verify creating note when toUserId is accidentally passed as grantId
      const noteByGrant = createCompanionNote(sender.id, {
        toUserId: grantId,
        message: '通过授权ID发送给伙伴',
      });
      assert.equal(noteByGrant.toUserId, receiver.id);
      assert.equal(noteByGrant.grantId, grantId);
      const listAfterGrantNote = listCompanionNotes(receiver.id);
      assert.equal(listAfterGrantNote.notes.some(n => n.id === noteByGrant.id), true);

      // Heart the note
      const hearts1 = heartCompanionNote(receiver.id, note.id);
      assert.equal(hearts1, 1);
      const hearts2 = heartCompanionNote(receiver.id, note.id);
      assert.equal(hearts2, 2);
    });

    await t.test('listSharingGrants populates partner liveStatus for focusing and missed states', async () => {
      const viewer = createUser('查看者');
      const focusingOwner = createUser('专注同学');
      const missedOwner = createUser('摸鱼同学');

      const grantFocus = createGrant(focusingOwner, viewer);
      const grantMissed = createGrant(missedOwner, viewer);

      // Set focusingOwner's workspace to have a running plan
      const focusingState: any = structuredClone(BLANK_STATE);
      focusingState.plans = [
        {
          id: 'p1',
          name: '行测真题 5000 题',
          date: new Date().toISOString().slice(0, 10),
          type: 'book',
          subject: '资料分析',
          done: false,
          timerStart: Date.now() - 34 * 60 * 1000, // 34 mins ago
          accumulatedMs: 0,
        },
      ];
      db.prepare("INSERT OR REPLACE INTO workspaces (user_id, generation_id, state_json, schema_version, updated_at) VALUES (?, ?, ?, 5, datetime('now'))")
        .run(focusingOwner.id, getCurrentGenerationId(), JSON.stringify(focusingState));

      // Set missedOwner's workspace to have unfinished plan with no timer
      const missedState: any = structuredClone(BLANK_STATE);
      missedState.plans = [
        {
          id: 'p2',
          name: '申论大作文',
          date: new Date().toISOString().slice(0, 10),
          type: 'custom',
          subject: '申论',
          done: false,
          timerStart: 0,
          accumulatedMs: 0,
        },
      ];
      db.prepare("INSERT OR REPLACE INTO workspaces (user_id, generation_id, state_json, schema_version, updated_at) VALUES (?, ?, ?, 5, datetime('now'))")
        .run(missedOwner.id, getCurrentGenerationId(), JSON.stringify(missedState));

      // Set missedOwner target time to 00:00 so it is guaranteed to be past schedule
      db.prepare("INSERT INTO companion_settings (user_id, target_study_time, updated_at) VALUES (?, '00:00', datetime('now'))")
        .run(missedOwner.id);

      // Create an idleOwner with target time 23:59 (not yet overdue)
      const idleOwner = createUser('尚未开学同学');
      const grantIdle = createGrant(idleOwner, viewer);
      db.prepare("INSERT INTO companion_settings (user_id, target_study_time, updated_at) VALUES (?, '23:59', datetime('now'))")
        .run(idleOwner.id);
      db.prepare("INSERT OR REPLACE INTO workspaces (user_id, generation_id, state_json, schema_version, updated_at) VALUES (?, ?, ?, 5, datetime('now'))")
        .run(idleOwner.id, getCurrentGenerationId(), JSON.stringify(missedState));

      const grants = listSharingGrants(viewer.id);
      const focusGrant = grants.received.find(g => g.id === grantFocus);
      const missGrant = grants.received.find(g => g.id === grantMissed);
      const idleGrant = grants.received.find(g => g.id === grantIdle);

      assert.ok(focusGrant);
      assert.equal(focusGrant.partnerId, focusingOwner.id);
      assert.equal(focusGrant.liveStatus?.state, 'focusing');
      assert.equal(focusGrant.liveStatus?.focusTitle, '行测真题 5000 题');
      assert.equal(focusGrant.liveStatus?.focusMinutes, 34);

      assert.ok(missGrant);
      assert.equal(missGrant.partnerId, missedOwner.id);
      assert.equal(missGrant.liveStatus?.state, 'missed');
      assert.match(missGrant.liveStatus?.missedText || '', /约定 00:00 学习/);
      assert.equal(missGrant.liveStatus?.canPoke, true);

      assert.ok(idleGrant);
      assert.equal(idleGrant.partnerId, idleOwner.id);
      assert.equal(idleGrant.liveStatus?.state, 'idle');
      assert.match(idleGrant.liveStatus?.missedText || '', /约定 23:59 学习/);
      assert.equal(idleGrant.liveStatus?.canPoke, true);

      // Verify rule: Poking a partner who is currently focusing must be rejected
      await assert.rejects(
        () => pokeCompanion(viewer.id, grantFocus),
        (err: any) => {
          assert.equal(err.status, 400);
          assert.equal(err.code, 'PARTNER_FOCUSING');
          assert.match(err.message, /专注学习中/);
          return true;
        }
      );

      // Poking an idle partner succeeds
      const idlePokeResult = await pokeCompanion(viewer.id, grantIdle);
      assert.equal(idlePokeResult.ok, true);
    });

    await t.test('liveStatus accurately detects active timer, pomodoro sessions, resting exclusion and sanitizes titles', async () => {
      const viewer = createUser('查看者B');
      const pomodoroOwner = createUser('番茄专注同学');
      const restingOwner = createUser('休息阶段同学');
      const sanitizedOwner = createUser('防脏标题同学');

      const grantPomo = createGrant(pomodoroOwner, viewer);
      const grantRest = createGrant(restingOwner, viewer);
      const grantSanitized = createGrant(sanitizedOwner, viewer);

      // 1. Pomodoro owner: has active standalone timerSession in focus phase
      const pomoState: any = structuredClone(BLANK_STATE);
      pomoState.timerSessions = [
        {
          id: 'session-1',
          timerMode: 'pomodoro',
          focusMinutes: 25,
          restMinutes: 5,
          subject: '申论',
          phase: 'focus',
          phaseMs: 0,
          status: 'running',
          createdAt: Date.now() - 15 * 60 * 1000,
          runningSince: Date.now() - 15 * 60 * 1000,
          segments: [],
        },
      ];
      db.prepare("INSERT OR REPLACE INTO workspaces (user_id, generation_id, state_json, schema_version, updated_at) VALUES (?, ?, ?, 5, datetime('now'))")
        .run(pomodoroOwner.id, getCurrentGenerationId(), JSON.stringify(pomoState));

      // 2. Resting owner: plan is in rest phase (timerPhase === 'rest' or restStart > 0)
      const restState: any = structuredClone(BLANK_STATE);
      restState.plans = [
        {
          id: 'p-rest',
          name: '粉笔行测真题',
          date: new Date().toISOString().slice(0, 10),
          type: 'book',
          subject: '资料分析',
          done: false,
          timerStart: 0,
          restStart: Date.now() - 3 * 60 * 1000,
          timerPhase: 'rest',
          accumulatedMs: 25 * 60 * 1000,
        },
      ];
      db.prepare("INSERT OR REPLACE INTO workspaces (user_id, generation_id, state_json, schema_version, updated_at) VALUES (?, ?, ?, 5, datetime('now'))")
        .run(restingOwner.id, getCurrentGenerationId(), JSON.stringify(restState));

      // 3. Sanitized owner: plan has a bad name like "今日已学习 310 分钟", but has linked book or subject
      const badState: any = structuredClone(BLANK_STATE);
      badState.plans = [
        {
          id: 'p-bad',
          name: '今日已学习 310 分钟',
          date: new Date().toISOString().slice(0, 10),
          type: 'book',
          sourceId: 'b-good',
          subject: '判断推理',
          done: false,
          timerStart: Date.now() - 20 * 60 * 1000,
          accumulatedMs: 0,
        },
      ];
      badState.books = [
        { id: 'b-good', name: '图形推理专项刷题', subject: '判断推理', total: 500, pages: 100, done: 50, errors: 5, minutes: 20 },
      ];
      db.prepare("INSERT OR REPLACE INTO workspaces (user_id, generation_id, state_json, schema_version, updated_at) VALUES (?, ?, ?, 5, datetime('now'))")
        .run(sanitizedOwner.id, getCurrentGenerationId(), JSON.stringify(badState));

      const grants = listSharingGrants(viewer.id);
      const pomoGrant = grants.received.find(g => g.id === grantPomo);
      const restGrant = grants.received.find(g => g.id === grantRest);
      const sanitGrant = grants.received.find(g => g.id === grantSanitized);

      // Pomodoro session is detected as focusing
      assert.ok(pomoGrant);
      assert.equal(pomoGrant.liveStatus?.state, 'focusing');
      assert.equal(pomoGrant.liveStatus?.focusTitle, '申论 专注');
      assert.equal(pomoGrant.liveStatus?.focusMinutes, 15);
      assert.equal(pomoGrant.liveStatus?.canPoke, false);

      // Resting owner is NOT focusing (liveStatus.state !== 'focusing', focusTitle is undefined)
      assert.ok(restGrant);
      assert.notEqual(restGrant.liveStatus?.state, 'focusing');
      assert.equal(restGrant.liveStatus?.focusTitle, undefined);
      assert.equal(restGrant.liveStatus?.canPoke, true);

      // Sanitized title does not contain "今日已学" and falls back to book name
      assert.ok(sanitGrant);
      assert.equal(sanitGrant.liveStatus?.state, 'focusing');
      assert.doesNotMatch(sanitGrant.liveStatus?.focusTitle || '', /今日已学/);
      assert.equal(sanitGrant.liveStatus?.focusTitle, '图形推理专项刷题');
    });

    await t.test('generatePokeEmailContent sanitizes malicious tags and CRLF headers', () => {
      const { subject, text, html } = generatePokeEmailContent({
        senderNickname: '黑客<script>alert(1)</script>\r\nBcc: evil@victim.com',
        recipientNickname: '学友" onmouseover="alert(2)" <test@test.com>',
        loginUrl: 'javascript:alert(1)',
      });

      // Subject must strip CRLF to prevent SMTP header injection
      assert.doesNotMatch(subject, /[\r\n]/);
      assert.match(subject, /黑客/);

      // HTML must escape <script> and dangerous attributes
      assert.doesNotMatch(html, /<script>/);
      assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
      assert.match(html, /&quot; onmouseover=&quot;/);
      assert.match(html, /&lt;test@test\.com&gt;/);

      // Malicious scheme URL must fallback to default safe url
      assert.doesNotMatch(html, /href="javascript:/);
      assert.match(html, /https:\/\/work\.ruyne\.space/);
    });

    await t.test('createSmtpMailSender formats sender display name, normalizes messageId and attaches anti-spam headers', async () => {
      const { createSmtpMailSender } = await import('../server/mailTransport');
      const nodemailer = (await import('nodemailer')).default;
      const original = nodemailer.createTransport;
      let sentOptions: any = null;
      nodemailer.createTransport = (() => ({
        sendMail: async (opts: any) => {
          sentOptions = opts;
          return { accepted: [opts.to] };
        },
        close: () => {},
      })) as any;

      try {
        const sender = createSmtpMailSender({
          SMTP_HOST: 'smtp.qq.com',
          SMTP_PORT: '465',
          SMTP_USER: '946265043@qq.com',
          SMTP_PASS: 'secret',
          SMTP_FROM: '946265043@qq.com',
        });
        await sender.send({
          to: 'target@example.com',
          subject: '测试',
          text: '内容',
          messageId: '<nudge-12345@potato.local>',
        });
        assert.ok(sentOptions);
        assert.equal(sentOptions.from, '"土豆考公" <946265043@qq.com>');
        assert.equal(sentOptions.messageId, '<nudge-12345@qq.com>');
        assert.equal(sentOptions.headers['X-Auto-Response-Suppress'], 'All');
        assert.equal(sentOptions.headers['X-Mailer'], 'Potato-Study-Workspace');
        assert.equal(sentOptions.headers['Reply-To'], '946265043@qq.com');
      } finally {
        nodemailer.createTransport = original;
      }
    });

    await t.test('createCompanionNote strictly enforces generation isolation and ignores revoked grants', () => {
      const sender = createUser('发送方');
      const receiver = createUser('接收方');
      const grantId = createGrant(receiver, sender);

      // Revoke the grant
      db.prepare("UPDATE sharing_grants SET revoked_at = datetime('now') WHERE id = ?").run(grantId);

      // createCompanionNote specifying revoked grantId should not route to revoked grant
      const note = createCompanionNote(sender.id, {
        grantId,
        message: '尝试发给已撤销的授权',
      });
      // Fallback target should not be the revoked grant's receiver if no active grant exists
      assert.notEqual(note.grantId, grantId);
    });

    await t.test('API route POST /api/sharing/nudge endpoint works through express router', async () => {
      const sender = createUser('阿土');
      const receiver = createUser('小豆');
      const grantId = createGrant(receiver, sender);

      const res = await fetch(`${base}/api/sharing/nudge`, {
        method: 'POST',
        headers: sender.headers,
        body: JSON.stringify({ grantId }),
      });
      assert.equal(res.status, 200);
      const data = await res.json() as any;
      assert.equal(data.ok, true);

      // Second attempt within 30 min gives 429
      const res2 = await fetch(`${base}/api/sharing/nudge`, {
        method: 'POST',
        headers: sender.headers,
        body: JSON.stringify({ grantId }),
      });
      assert.equal(res2.status, 429);
      const data2 = await res2.json() as any;
      assert.equal(data2.code, 'NUDGE_COOLDOWN');
    });

    await t.test('companion settings get and put target study time', async () => {
      const user = createUser('自律土豆');

      // Default is 14:00
      const getRes1 = await fetch(`${base}/api/sharing/settings`, { headers: user.headers });
      assert.equal(getRes1.status, 200);
      const data1 = await getRes1.json() as any;
      assert.equal(data1.targetStudyTime, '14:00');

      // Update to 10:00
      const putRes = await fetch(`${base}/api/sharing/settings`, {
        method: 'PUT',
        headers: user.headers,
        body: JSON.stringify({ targetStudyTime: '10:00' }),
      });
      assert.equal(putRes.status, 200);
      const data2 = await putRes.json() as any;
      assert.equal(data2.targetStudyTime, '10:00');

      // Verify update persisted
      const getRes2 = await fetch(`${base}/api/sharing/settings`, { headers: user.headers });
      const data3 = await getRes2.json() as any;
      assert.equal(data3.targetStudyTime, '10:00');

      // Invalid format rejected
      const putBad = await fetch(`${base}/api/sharing/settings`, {
        method: 'PUT',
        headers: user.headers,
        body: JSON.stringify({ targetStudyTime: 'invalid' }),
      });
      assert.equal(putBad.status, 400);
    });

    await t.test('API route POST /api/sharing/notes accepts companion note with large image (>100KB)', async () => {
      const sender = createUser('拍照土豆');
      const receiver = createUser('收信豆子');
      const grantId = createGrant(receiver, sender);

      // A 150KB base64 JPEG payload (which definitely exceeds the default 64KB body parser limit)
      const largeBase64Image = 'data:image/jpeg;base64,' + 'B'.repeat(150_000);

      const res = await fetch(`${base}/api/sharing/notes`, {
        method: 'POST',
        headers: sender.headers,
        body: JSON.stringify({
          toUserId: receiver.id,
          grantId,
          message: '复习累了吃点好吃的，给你发张高清真题图！',
          imageUrl: largeBase64Image,
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json() as any;
      assert.equal(data.ok, true);
      assert.equal(data.note.imageUrl, largeBase64Image);
      assert.equal(data.note.message, '复习累了吃点好吃的，给你发张高清真题图！');

      // Reject image exceeding 5,000,000 chars
      const oversizedImage = 'data:image/jpeg;base64,' + 'C'.repeat(5_000_100);
      const resOversized = await fetch(`${base}/api/sharing/notes`, {
        method: 'POST',
        headers: sender.headers,
        body: JSON.stringify({
          toUserId: receiver.id,
          grantId,
          message: '超大图测试',
          imageUrl: oversizedImage,
        }),
      });
      assert.equal(resOversized.status, 400);
      const errData = await resOversized.json() as any;
      assert.equal(errData.code, 'IMAGE_TOO_LARGE');

      // Empty message and empty imageUrl rejected
      const resEmpty = await fetch(`${base}/api/sharing/notes`, {
        method: 'POST',
        headers: sender.headers,
        body: JSON.stringify({
          toUserId: receiver.id,
          grantId,
          message: '   ',
        }),
      });
      assert.equal(resEmpty.status, 400);
      const emptyErr = await resEmpty.json() as any;
      assert.equal(emptyErr.code, 'INVALID_NOTE');
    });

  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    closeDb();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
