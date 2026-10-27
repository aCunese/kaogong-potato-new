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

    // 6. EXECUTE RESTORE via restoreOffline
    const { restoreOffline } = await import('../server/disasterRecovery');
    const restoreResult = await restoreOffline({
      sourceDir: testBackupDir,
      dataDir: testDataDir,
      offlineConfirmed: true,
    });
    const nextGenId = restoreResult.generationId;
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
    assert.equal(restoredWorkspace.snapshotGenerationId, nextGenId);
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

  it('injected attachment copy / verification failure in staging aborts restore with non-zero exit and preserves original DB and attachments', async () => {
    const { execSync } = await import('node:child_process');
    const Database = (await import('better-sqlite3')).default;

    const testDir = path.join(testRoot, 'injected_failure_test');
    const liveDir = path.join(testDir, 'live_data');
    const backupDir = path.join(testDir, 'backup_source');
    fs.mkdirSync(path.join(liveDir, 'attachments'), { recursive: true });
    fs.mkdirSync(path.join(backupDir, 'attachments'), { recursive: true });

    // 1. Prepare live database with initial user and attachment
    const origDbFile = path.join(liveDir, 'potato.db');
    const origDb = new Database(origDbFile);
    origDb.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT);
      CREATE TABLE workspaces (user_id TEXT PRIMARY KEY, revision INTEGER, generation_id TEXT);
      CREATE TABLE media_records (id TEXT PRIMARY KEY, user_id TEXT, filename TEXT, byte_size INTEGER, sha256 TEXT);
      CREATE TABLE server_meta (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO users VALUES ('u_orig', 'orig_user');
      INSERT INTO workspaces VALUES ('u_orig', 10, 'gen_orig');
      INSERT INTO server_meta VALUES ('generation_id', 'gen_orig');
      INSERT INTO media_records VALUES ('m_orig', 'u_orig', 'original.png', 16, 'orig_hash');
    `);
    origDb.close();
    const origAttFile = path.join(liveDir, 'attachments', 'original.png');
    const origAttContent = Buffer.from('original-file-bytes-1234');
    fs.writeFileSync(origAttFile, origAttContent);
    const origDbHash = crypto.createHash('sha256').update(fs.readFileSync(origDbFile)).digest('hex');
    const origAttHash = crypto.createHash('sha256').update(origAttContent).digest('hex');

    // 2. Prepare backup source directory where media_records references a file whose hash doesn't match
    const backupDbFile = path.join(backupDir, 'potato.db');
    const backupDb = new Database(backupDbFile);
    backupDb.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT);
      CREATE TABLE workspaces (user_id TEXT PRIMARY KEY, revision INTEGER, generation_id TEXT);
      CREATE TABLE media_records (id TEXT PRIMARY KEY, user_id TEXT, filename TEXT, byte_size INTEGER, sha256 TEXT);
      CREATE TABLE server_meta (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO users VALUES ('u_new', 'restored_user');
      INSERT INTO workspaces VALUES ('u_new', 1, 'gen_backup');
      INSERT INTO server_meta VALUES ('generation_id', 'gen_backup');
      INSERT INTO media_records VALUES ('m_corrupt', 'u_new', 'corrupt.png', 20, 'expected_valid_hash_9999');
    `);
    backupDb.close();
    // Injected failure: file content has sha256 that does NOT match expected_valid_hash_9999
    fs.writeFileSync(path.join(backupDir, 'attachments', 'corrupt.png'), Buffer.from('injected-corrupt-data'));

    // 3. Attempt restore via scripts/restore.sh
    let scriptFailed = false;
    let output = '';
    try {
      execSync(`bash "${path.resolve(process.cwd(), 'scripts', 'restore.sh')}" "${backupDir}" --skip-pre-backup`, {
        env: { ...process.env, DATA_DIR: liveDir },
        stdio: 'pipe',
      });
    } catch (err: any) {
      scriptFailed = true;
      output = (err.stderr ? err.stderr.toString() : '') + (err.stdout ? err.stdout.toString() : '');
    }

    assert.equal(scriptFailed, true, 'restore script must exit non-zero on attachment verification/copy failure');
    assert.equal(output.includes('[SUCCESS] 灾难恢复完成！'), false, 'must NOT claim disaster recovery succeeded');
    assert.ok(output.includes('恢复校验失败') || output.includes('RESTORE_FAILED'), 'must output failure reason');

    // 4. Critical assertion: original database and attachments MUST BE PRESERVED
    assert.ok(fs.existsSync(origDbFile), 'original database must still exist');
    const currentDbHash = crypto.createHash('sha256').update(fs.readFileSync(origDbFile)).digest('hex');
    assert.equal(currentDbHash, origDbHash, 'original database bytes must be completely unchanged');

    assert.ok(fs.existsSync(origAttFile), 'original attachment must still exist');
    const currentAttHash = crypto.createHash('sha256').update(fs.readFileSync(origAttFile)).digest('hex');
    assert.equal(currentAttHash, origAttHash, 'original attachment bytes must be completely unchanged');

    // Verify DB logical content
    const verifyDb = new Database(origDbFile, { readonly: true });
    const userRow = verifyDb.prepare('SELECT username FROM users WHERE id = ?').get('u_orig') as { username: string };
    assert.equal(userRow?.username, 'orig_user', 'original logical data must be intact');
    const newUserRow = verifyDb.prepare('SELECT id FROM users WHERE id = ?').get('u_new');
    assert.equal(newUserRow, undefined, 'restored data must not have leaked into original database');
    verifyDb.close();

    // Check no staging directories left over
    const remainingEntries = fs.readdirSync(liveDir);
    const stagingLeftover = remainingEntries.filter(f => f.startsWith('.restore_staging_'));
    assert.equal(stagingLeftover.length, 0, 'staging directory must be cleaned up on failure');
  });

  it('successful offline restore with restoreOffline({ sourceDir, dataDir, offlineConfirmed: true }) correctly stages, rotates generation, revokes sessions, swaps DB atomically, and verifies all attachments', async () => {
    const { restoreOffline } = await import('../server/disasterRecovery');
    const Database = (await import('better-sqlite3')).default;

    const testDir = path.join(testRoot, 'successful_restore_test');
    const liveDir = path.join(testDir, 'live_data');
    const backupDir = path.join(testDir, 'backup_source');
    fs.mkdirSync(path.join(liveDir, 'attachments'), { recursive: true });
    fs.mkdirSync(path.join(backupDir, 'attachments'), { recursive: true });

    // 1. Pre-existing healthy database in liveDir
    const preDbFile = path.join(liveDir, 'potato.db');
    const preDb = new Database(preDbFile);
    preDb.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT);
      CREATE TABLE server_meta (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO users VALUES ('u_old', 'old_user');
      INSERT INTO server_meta VALUES ('generation_id', 'gen_old');
    `);
    preDb.close();

    // 2. Backup source with valid DB and attachments
    const backupDbFile = path.join(backupDir, 'potato.db');
    const backupDb = new Database(backupDbFile);
    const attData = Buffer.from('photo-bytes-for-successful-restore');
    const attHash = crypto.createHash('sha256').update(attData).digest('hex');
    fs.writeFileSync(path.join(backupDir, 'attachments', 'pic.png'), attData);

    backupDb.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT);
      CREATE TABLE workspaces (user_id TEXT PRIMARY KEY, revision INTEGER, generation_id TEXT);
      CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id TEXT);
      CREATE TABLE server_meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE media_records (id TEXT PRIMARY KEY, user_id TEXT, filename TEXT, original_name TEXT, mime_type TEXT, byte_size INTEGER, sha256 TEXT);

      INSERT INTO users VALUES ('u_restored', 'restored_user');
      INSERT INTO workspaces VALUES ('u_restored', 5, 'gen_pre_restore');
      INSERT INTO sessions VALUES ('sess_token_123', 'u_restored');
      INSERT INTO server_meta VALUES ('generation_id', 'gen_pre_restore');
      INSERT INTO media_records VALUES ('m_1', 'u_restored', 'pic.png', 'pic.png', 'image/png', ${attData.length}, '${attHash}');
    `);
    backupDb.close();

    // 3. Reject if offlineConfirmed is false
    await assert.rejects(
      async () => await restoreOffline({ sourceDir: backupDir, dataDir: liveDir, offlineConfirmed: false }),
      /OFFLINE_NOT_CONFIRMED/,
      'must reject when offlineConfirmed is not true'
    );

    // 4. Execute successful restore
    const res = await restoreOffline({
      sourceDir: backupDir,
      dataDir: liveDir,
      offlineConfirmed: true,
    });

    assert.equal(res.ok, true);
    assert.ok(res.generationId.startsWith('gen_'));
    assert.equal(res.attachmentsRestored, 1);
    assert.ok(res.safetyBackupDir && fs.existsSync(res.safetyBackupDir), 'safety backup of prior healthy db must be created');

    // 5. Verify restored database state
    const restoredDb = new Database(preDbFile, { readonly: true });
    const check = restoredDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
    assert.equal(check[0]?.integrity_check, 'ok');

    // Workspaces generation updated
    const wsRow = restoredDb.prepare('SELECT revision, generation_id FROM workspaces WHERE user_id = ?').get('u_restored') as any;
    assert.equal(wsRow.revision, 5);
    assert.equal(wsRow.generation_id, res.generationId, 'workspaces.generation_id must be updated to new generationId');

    // Meta generation updated
    const metaRow = restoredDb.prepare("SELECT value FROM server_meta WHERE key = 'generation_id'").get() as any;
    assert.equal(metaRow.value, res.generationId);

    // Sessions revoked
    const sessCount = restoredDb.prepare('SELECT COUNT(*) as cnt FROM sessions').get() as any;
    assert.equal(sessCount.cnt, 0, 'sessions must be completely cleared');

    restoredDb.close();

    // Attachment in place and readable
    const restoredAttPath = path.join(liveDir, 'attachments', 'pic.png');
    assert.ok(fs.existsSync(restoredAttPath));
    const restoredAttHash = crypto.createHash('sha256').update(fs.readFileSync(restoredAttPath)).digest('hex');
    assert.equal(restoredAttHash, attHash);
  });

  it('rejects existing attachment with same name but different SHA-256 (同名不同内容直接拒绝)', async () => {
    const { restoreOffline } = await import('../server/disasterRecovery');
    const Database = (await import('better-sqlite3')).default;

    const testDir = path.join(testRoot, 'conflict_attachment_test');
    const liveDir = path.join(testDir, 'live_data');
    const backupDir = path.join(testDir, 'backup_source');
    fs.mkdirSync(path.join(liveDir, 'attachments'), { recursive: true });
    fs.mkdirSync(path.join(backupDir, 'attachments'), { recursive: true });

    // 1. Live directory has photo.png with content AAA
    const liveDbFile = path.join(liveDir, 'potato.db');
    const liveDb = new Database(liveDbFile);
    liveDb.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT);
      INSERT INTO users VALUES ('u_original', 'orig');
    `);
    liveDb.close();
    const liveDbHash = crypto.createHash('sha256').update(fs.readFileSync(liveDbFile)).digest('hex');

    const livePhotoFile = path.join(liveDir, 'attachments', 'photo.png');
    const livePhotoBytes = Buffer.from('CONTENT_VERSION_AAA_OF_PHOTO');
    fs.writeFileSync(livePhotoFile, livePhotoBytes);

    // 2. Backup directory has photo.png with content BBB
    const backupDbFile = path.join(backupDir, 'potato.db');
    const backupDb = new Database(backupDbFile);
    const backupPhotoBytes = Buffer.from('CONTENT_VERSION_BBB_DIFFERENT_HASH');
    const backupPhotoHash = crypto.createHash('sha256').update(backupPhotoBytes).digest('hex');
    fs.writeFileSync(path.join(backupDir, 'attachments', 'photo.png'), backupPhotoBytes);

    backupDb.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT);
      CREATE TABLE media_records (id TEXT PRIMARY KEY, user_id TEXT, filename TEXT, byte_size INTEGER, sha256 TEXT);
      INSERT INTO users VALUES ('u_backup', 'backup_user');
      INSERT INTO media_records VALUES ('m_conflict', 'u_backup', 'photo.png', ${backupPhotoBytes.length}, '${backupPhotoHash}');
    `);
    backupDb.close();

    // 3. Attempt restore: must be directly rejected due to attachment conflict
    let failed = false;
    let errMsg = '';
    try {
      await restoreOffline({
        sourceDir: backupDir,
        dataDir: liveDir,
        offlineConfirmed: true,
      });
    } catch (err: any) {
      failed = true;
      errMsg = err.message;
    }

    assert.equal(failed, true, 'must throw on attachment conflict');
    assert.ok(errMsg.includes('ATTACHMENT_CONFLICT') || errMsg.includes('同名不同内容') || errMsg.includes('直接拒绝'), 'must indicate attachment conflict');

    // 4. Verify live database and attachment are preserved
    assert.ok(fs.existsSync(livePhotoFile));
    assert.deepEqual(fs.readFileSync(livePhotoFile), livePhotoBytes, 'live attachment must not be overwritten');

    const afterDbHash = crypto.createHash('sha256').update(fs.readFileSync(liveDbFile)).digest('hex');
    assert.equal(afterDbHash, liveDbHash, 'live database must not be overwritten');
  });
});
