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
  app.use(express.json());
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
      assert.match(subject, /夺命连环催/);
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
      assert.match(sentMails[0].html, /夺命连环催/);

      // Verify a companion note was also automatically created for the recipient
      const notes = listCompanionNotes(receiver.id);
      assert.equal(notes.notes.length >= 1, true);
      assert.match(notes.notes[0].message, /夺命连环催/);

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

      // Heart the note
      const hearts1 = heartCompanionNote(receiver.id, note.id);
      assert.equal(hearts1, 1);
      const hearts2 = heartCompanionNote(receiver.id, note.id);
      assert.equal(hearts2, 2);
    });

    await t.test('listSharingGrants populates partner liveStatus for focusing and missed states', () => {
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

      const grants = listSharingGrants(viewer.id);
      const focusGrant = grants.received.find(g => g.id === grantFocus);
      const missGrant = grants.received.find(g => g.id === grantMissed);

      assert.ok(focusGrant);
      assert.equal(focusGrant.liveStatus?.state, 'focusing');
      assert.equal(focusGrant.liveStatus?.focusTitle, '行测真题 5000 题');
      assert.equal(focusGrant.liveStatus?.focusMinutes, 34);

      assert.ok(missGrant);
      assert.equal(missGrant.liveStatus?.state, 'missed');
      assert.match(missGrant.liveStatus?.missedText || '', /约定 14:00 学习/);
      assert.equal(missGrant.liveStatus?.canPoke, true);
    });

    await t.test('generatePokeEmailContent sanitizes malicious tags and CRLF headers', () => {
      const { subject, text, html } = generatePokeEmailContent({
        senderNickname: '黑客<script>alert(1)</script>\r\nBcc: evil@victim.com',
        recipientNickname: '研友" onmouseover="alert(2)" <test@test.com>',
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

  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    closeDb();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
