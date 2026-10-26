import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

describe('Disaster Recovery & Hot Backup Drill', () => {
  const testRoot = path.resolve(process.cwd(), 'tests', '.tmp_dr_' + Date.now());
  const testDataDir = path.join(testRoot, 'live_data');
  const testBackupDir = path.join(testRoot, 'backup_target');

  before(() => {
    fs.mkdirSync(testDataDir, { recursive: true });
    fs.mkdirSync(testBackupDir, { recursive: true });
    process.env.DATA_DIR = testDataDir;
  });

  after(() => {
    try {
      const { closeDb } = require('../server/db');
      closeDb();
    } catch {}
    if (fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it('performs end-to-end hot backup, simulates disaster, executes restore and rotates generation ID', async () => {
    const { getDb, getCurrentGenerationId, rotateGenerationId, backupDatabaseOnline, getAttachmentsDir, closeDb } = await import('../server/db');
    const { hashPassword, createSession } = await import('../server/auth');
    const { syncUserWorkspace, getUserWorkspace } = await import('../server/workspace');
    const { saveUserMedia, getUserMediaFile } = await import('../server/media');
    const { BLANK_STATE } = await import('../src/constants/initialData');

    const db = getDb();
    const initialGenId = getCurrentGenerationId();
    assert.ok(initialGenId.startsWith('gen_'), 'initial generation ID must be present');

    // 1. Create a user and push initial workspace
    const userId = 'u_dr_test_1001';
    const passwordHash = await hashPassword('ValidPass123!');
    db.prepare(`
      INSERT INTO users (id, username, nickname, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(userId, 'dr_tester', '灾备演练测试员', passwordHash);

    const session = createSession(userId);

    // Initial state: Revision 1
    const initialWorkspace = {
      ...BLANK_STATE,
      profile: { name: '灾备演练测试员', username: 'dr_tester', avatar: 'pose-1' },
      plans: [{ id: 'plan-dr-1', libraryId: 'lib-1', name: '灾备前核心计划', type: 'book', sourceId: 'b-1', subject: '资料分析', plannedMinutes: 30, actualMinutes: 0, accumulatedMs: 0, done: false, timerStart: 0, date: '2026-10-26' }],
    };

    const sync1 = syncUserWorkspace({
      userId,
      expectedRevision: 0,
      requestId: 'req_dr_1',
      schemaVersion: 3,
      generationId: initialGenId,
      state: initialWorkspace as any,
    });
    assert.equal(sync1.ok, true);
    assert.equal(sync1.revision, 1);

    // 2. Add an attachment
    const validPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const mediaRes = saveUserMedia(userId, validPng, 'test.png');
    assert.equal(mediaRes.ok, true);
    assert.ok(mediaRes.media);
    const mediaId = mediaRes.media.id;
    assert.ok(mediaId.startsWith('media_'));

    // 3. Perform Online Hot Backup
    const backupDbFile = path.join(testBackupDir, 'potato.db');
    await backupDatabaseOnline(backupDbFile);
    assert.ok(fs.existsSync(backupDbFile), 'Backup database file must exist');

    // Copy attachments and build manifest
    const backupAttDir = path.join(testBackupDir, 'attachments');
    fs.mkdirSync(backupAttDir, { recursive: true });
    const liveAttFile = getUserMediaFile(userId, mediaId);
    assert.ok(liveAttFile && fs.existsSync(liveAttFile.diskPath));
    fs.copyFileSync(liveAttFile.diskPath, path.join(backupAttDir, path.basename(liveAttFile.diskPath)));

    const dbBuf = fs.readFileSync(backupDbFile);
    const dbHash = crypto.createHash('sha256').update(dbBuf).digest('hex');
    const attBuf = fs.readFileSync(liveAttFile.diskPath);
    const attHash = crypto.createHash('sha256').update(attBuf).digest('hex');

    const manifest = {
      version: '1.0.0',
      schemaVersion: 3,
      createdAt: new Date().toISOString(),
      generationId: initialGenId,
      database: { filename: 'potato.db', sha256: dbHash, byteSize: dbBuf.length },
      attachments: [{ filename: path.basename(liveAttFile.diskPath), sha256: attHash, byteSize: attBuf.length }],
    };
    fs.writeFileSync(path.join(testBackupDir, 'manifest.json'), JSON.stringify(manifest), 'utf8');

    // 4. Simulate dirty modifications after backup (e.g. rev 2 that will get lost in disaster)
    const dirtyWorkspace = {
      ...initialWorkspace,
      plans: [{ id: 'plan-dr-corrupt', title: '脏数据计划', done: true, date: '2026-10-26' }],
    };
    const sync2 = syncUserWorkspace({
      userId,
      expectedRevision: 1,
      requestId: 'req_dr_2',
      schemaVersion: 3,
      generationId: initialGenId,
      state: dirtyWorkspace as any,
    });
    assert.equal(sync2.ok, true);
    assert.equal(sync2.revision, 2);

    // 5. SIMULATE DISASTER: Live database destroyed
    closeDb();
    const liveDbFile = path.join(testDataDir, 'potato.db');
    fs.writeFileSync(liveDbFile, 'CORRUPTED_ZERO_BYTES');

    // 6. EXECUTE RESTORE
    // Re-verify manifest and copy restored file over
    const restoredManifest = JSON.parse(fs.readFileSync(path.join(testBackupDir, 'manifest.json'), 'utf8'));
    assert.equal(restoredManifest.generationId, initialGenId);

    // Restore DB file from backup
    fs.copyFileSync(backupDbFile, liveDbFile);
    // Remove stale wal/shm
    try { fs.unlinkSync(liveDbFile + '-wal'); } catch {}
    try { fs.unlinkSync(liveDbFile + '-shm'); } catch {}

    // 7. CRITICAL ROTATION: rotate generation ID after restore
    const nextGenId = rotateGenerationId();
    assert.notEqual(nextGenId, initialGenId, 'New generation ID must differ from pre-disaster generation ID');

    // 8. VERIFY RESTORED INTEGRITY
    const restoredDb = getDb();
    const integrityCheck = restoredDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
    assert.equal(integrityCheck[0].integrity_check, 'ok');

    // Check workspace state reverted to backup state (Revision 1)
    const restoredWorkspace = getUserWorkspace(userId);
    assert.ok(restoredWorkspace);
    assert.equal(restoredWorkspace.revision, 1);
    assert.equal(restoredWorkspace.generationId, nextGenId);
    assert.equal(restoredWorkspace.snapshotGenerationId, initialGenId);
    assert.equal(restoredWorkspace.state.plans[0].id, 'plan-dr-1');
    assert.equal(restoredWorkspace.state.plans[0].name, '灾备前核心计划');

    // Check sessions were revoked by rotateGenerationId
    const activeSessions = restoredDb.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
    assert.equal(activeSessions.count, 0, 'All active sessions must be revoked on disaster recovery');

    // Check attachment is preserved
    const restoredAtt = getUserMediaFile(userId, mediaId);
    assert.ok(restoredAtt && fs.existsSync(restoredAtt.diskPath));

    // 9. VERIFY STALE CLIENT PROTECTION:
    // A client holding the dirty state (attempting expectedRevision 1 or with old generation ID)
    // is blocked from silently overwriting the restored state!
    const stalePush = syncUserWorkspace({
      userId,
      expectedRevision: 2, // client thinks server is at rev 2
      requestId: 'stale_req_after_dr',
      schemaVersion: 3,
      generationId: initialGenId, // client sends old generation
      state: dirtyWorkspace as any,
    });

    assert.equal(stalePush.ok, false);
    assert.equal(stalePush.status, 409);
    assert.equal(stalePush.code, 'GENERATION_MISMATCH');
    assert.equal(stalePush.generationId, nextGenId);

    console.log('✅ Disaster Recovery drill passed all assertions with full data isolation and generation protection.');
    closeDb();
  });

  it('hot-backup strictly rejects missing attachments referenced in media_records and leaves no incomplete backup', async () => {
    const { getDb, closeDb } = await import('../server/db');
    const db = getDb();

    // Insert a dangling media_records entry that points to a non-existent file on disk
    const fakeMediaId = 'media_missing_' + Date.now();
    const fakeFilename = 'non_existent_attachment.png';
    db.prepare(`
      INSERT INTO media_records (id, user_id, filename, original_name, mime_type, byte_size, sha256, created_at)
      VALUES (?, 'u_dr_test_1001', ?, 'non_existent.png', 'image/png', 1024, 'dummyhash', datetime('now'))
    `).run(fakeMediaId, fakeFilename);

    closeDb();

    // Run hot-backup via child_process
    const { execSync } = await import('node:child_process');
    const faultyBackupDir = path.join(testRoot, 'faulty_backup_' + Date.now());

    let failed = false;
    try {
      execSync(`node --import tsx "${path.resolve(process.cwd(), 'server', 'cli.ts')}" hot-backup "${faultyBackupDir}"`, {
        env: { ...process.env, DATA_DIR: testDataDir },
        stdio: 'pipe',
      });
    } catch (err: any) {
      failed = true;
      const errOut = err.stderr ? err.stderr.toString() : '';
      assert.ok(errOut.includes('CRITICAL_ATTACHMENT_MISSING') || err.stdout.toString().includes('CRITICAL_ATTACHMENT_MISSING'), 'must report missing attachment');
    }

    assert.equal(failed, true, 'hot-backup must fail and reject backup when attachment is missing');
    assert.equal(fs.existsSync(faultyBackupDir), false, 'incomplete backup directory must be deleted');

    // Clean up the fake row so it doesn't affect other tests
    const db2 = getDb();
    db2.prepare('DELETE FROM media_records WHERE id = ?').run(fakeMediaId);
    closeDb();
  });

  it('restore script strictly rejects backup if an attachment referenced in db is missing', async () => {
    const { execSync } = await import('node:child_process');
    const Database = (await import('better-sqlite3')).default;

    // Create a mock backup directory with a database that references an attachment, but the attachment is missing
    const mockBackupDir = path.join(testRoot, 'mock_incomplete_backup');
    const mockAttDir = path.join(mockBackupDir, 'attachments');
    fs.mkdirSync(mockAttDir, { recursive: true });

    const mockDbFile = path.join(mockBackupDir, 'potato.db');
    const mockDb = new Database(mockDbFile);
    mockDb.exec(`
      CREATE TABLE media_records (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        sha256 TEXT NOT NULL
      );
      INSERT INTO media_records VALUES ('m_missing', 'ghost.png', 100, 'somehash');
    `);
    mockDb.close();

    const dbBuf = fs.readFileSync(mockDbFile);
    const dbHash = crypto.createHash('sha256').update(dbBuf).digest('hex');
    const manifest = {
      version: '1.0.1',
      database: { filename: 'potato.db', sha256: dbHash },
      attachments: [],
    };
    fs.writeFileSync(path.join(mockBackupDir, 'manifest.json'), JSON.stringify(manifest), 'utf8');

    let restoreFailed = false;
    try {
      execSync(`bash "${path.resolve(process.cwd(), 'scripts', 'restore.sh')}" "${mockBackupDir}" --skip-pre-backup`, {
        env: { ...process.env, DATA_DIR: testDataDir },
        stdio: 'pipe',
      });
    } catch (err: any) {
      restoreFailed = true;
      const combined = (err.stderr ? err.stderr.toString() : '') + (err.stdout ? err.stdout.toString() : '');
      assert.ok(combined.includes('恢复校验失败: 数据库引用的媒体文件在备份中缺失'), 'must fail with missing attachment message');
    }

    assert.equal(restoreFailed, true, 'restore script must reject backup when database-referenced attachment is missing');
  });
});
