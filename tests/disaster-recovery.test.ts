import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { BLANK_STATE } from '../src/constants/initialData';

describe('Disaster Recovery & Hot Backup Drill', () => {
  const testRoot = path.resolve(process.cwd(), 'tests', '.tmp_dr_' + Date.now());
  const testDataDir = path.join(testRoot, 'live_data');
  const testBackupDir = path.join(testRoot, 'backup_target');

  function initTestAppDb(dbPath: string): DatabaseType {
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
      CREATE TABLE IF NOT EXISTS server_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        nickname TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS invites (
        code TEXT PRIMARY KEY,
        created_by TEXT NOT NULL,
        used_by TEXT,
        used_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        csrf_token TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reset_codes (
        code TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT
      );

      CREATE TABLE IF NOT EXISTS workspaces (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL DEFAULT 0,
        generation_id TEXT NOT NULL,
        state_json TEXT NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 3,
        seed_version INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_idempotency (
        user_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        expected_revision INTEGER NOT NULL,
        result_revision INTEGER NOT NULL,
        payload_sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, request_id)
      );

      CREATE TABLE IF NOT EXISTS media_records (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspace_history (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        reason TEXT NOT NULL,
        state_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_media_user ON media_records(user_id);
      CREATE INDEX IF NOT EXISTS idx_history_user_rev ON workspace_history(user_id, revision);
      CREATE INDEX IF NOT EXISTS idx_history_user_created ON workspace_history(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_idempotency_user_created ON sync_idempotency(user_id, created_at);
    `);

    try {
      db.exec('ALTER TABLE workspaces ADD COLUMN seed_version INTEGER NOT NULL DEFAULT 0');
    } catch {}
    try {
      db.exec('ALTER TABLE workspaces ADD COLUMN init_choice TEXT');
    } catch {}

    const initialGenId = `gen_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    db.prepare("INSERT OR REPLACE INTO server_meta (key, value) VALUES ('generation_id', ?)").run(initialGenId);

    return db;
  }

  function writeValidManifest(
    targetDir: string,
    dbFile: string,
    attachments: Array<{ filename: string; sha256: string; byteSize: number }> = [],
    overrides?: Record<string, any>
  ) {
    const dbBuf = fs.readFileSync(dbFile);
    const dbHash = crypto.createHash('sha256').update(dbBuf).digest('hex');
    const manifest = {
      version: '1.0.4',
      schemaVersion: 3,
      createdAt: new Date().toISOString(),
      generationId: 'gen_test',
      database: {
        filename: 'potato.db',
        sha256: dbHash,
        byteSize: dbBuf.length,
      },
      attachments,
      ...overrides,
    };
    fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    return manifest;
  }

  function populateTestUser(db: DatabaseType, userId = 'u_test_1', username = 'testuser') {
    db.prepare(`
      INSERT INTO users (id, username, nickname, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, 'hash123', datetime('now'), datetime('now'))
    `).run(userId, username, username);

    const genId = (db.prepare("SELECT value FROM server_meta WHERE key = 'generation_id'").get() as any)?.value || 'gen_test';
    db.prepare(`
      INSERT INTO workspaces (user_id, revision, generation_id, state_json, schema_version, seed_version, updated_at)
      VALUES (?, 1, ?, ?, 3, 0, datetime('now'))
    `).run(userId, genId, JSON.stringify({
      ...BLANK_STATE,
      profile: { name: username, username, avatar: 'pose-1' },
    }));
  }

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
    const { getDb, getCurrentGenerationId, backupDatabaseOnline, closeDb } = await import('../server/db');
    const { hashPassword, createSession } = await import('../server/auth');
    const { syncUserWorkspace, getUserWorkspace } = await import('../server/workspace');
    const { saveUserMedia, getUserMediaFile } = await import('../server/media');

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

    createSession(userId);

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
      version: '1.0.4',
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
    const stalePush = syncUserWorkspace({
      userId,
      expectedRevision: 2,
      requestId: 'stale_req_after_dr',
      schemaVersion: 3,
      generationId: initialGenId,
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

    const fakeMediaId = 'media_missing_' + Date.now();
    const fakeFilename = 'non_existent_attachment.png';
    db.prepare(`
      INSERT INTO media_records (id, user_id, filename, original_name, mime_type, byte_size, sha256, created_at)
      VALUES (?, 'u_dr_test_1001', ?, 'non_existent.png', 'image/png', 1024, 'dummyhash', datetime('now'))
    `).run(fakeMediaId, fakeFilename);

    closeDb();

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

    const db2 = getDb();
    db2.prepare('DELETE FROM media_records WHERE id = ?').run(fakeMediaId);
    closeDb();
  });

  it('restore script strictly rejects backup if an attachment referenced in db is missing', async () => {
    const { execSync } = await import('node:child_process');

    const mockBackupDir = path.join(testRoot, 'mock_incomplete_backup');
    const mockAttDir = path.join(mockBackupDir, 'attachments');
    fs.mkdirSync(mockAttDir, { recursive: true });

    const mockDbFile = path.join(mockBackupDir, 'potato.db');
    const mockDb = initTestAppDb(mockDbFile);
    populateTestUser(mockDb, 'u_missing_att', 'user_missing');
    mockDb.prepare(`
      INSERT INTO media_records (id, user_id, filename, original_name, mime_type, byte_size, sha256, created_at)
      VALUES ('m_missing', 'u_missing_att', 'ghost.png', 'ghost.png', 'image/png', 100, 'somehash', datetime('now'))
    `).run();
    mockDb.close();

    writeValidManifest(mockBackupDir, mockDbFile, [
      { filename: 'ghost.png', sha256: 'somehash', byteSize: 100 },
    ]);

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

    const testDir = path.join(testRoot, 'injected_failure_test');
    const liveDir = path.join(testDir, 'live_data');
    const backupDir = path.join(testDir, 'backup_source');
    fs.mkdirSync(path.join(liveDir, 'attachments'), { recursive: true });
    fs.mkdirSync(path.join(backupDir, 'attachments'), { recursive: true });

    // 1. Prepare live database with initial user and attachment
    const origDbFile = path.join(liveDir, 'potato.db');
    const origDb = initTestAppDb(origDbFile);
    populateTestUser(origDb, 'u_orig', 'orig_user');
    const origAttFile = path.join(liveDir, 'attachments', 'original.png');
    const origAttContent = Buffer.from('original-file-bytes-1234');
    fs.writeFileSync(origAttFile, origAttContent);
    const origAttHash = crypto.createHash('sha256').update(origAttContent).digest('hex');
    origDb.prepare(`
      INSERT INTO media_records (id, user_id, filename, original_name, mime_type, byte_size, sha256, created_at)
      VALUES ('m_orig', 'u_orig', 'original.png', 'original.png', 'image/png', ?, ?, datetime('now'))
    `).run(origAttContent.length, origAttHash);
    origDb.close();
    const origDbHash = crypto.createHash('sha256').update(fs.readFileSync(origDbFile)).digest('hex');

    // 2. Prepare backup source directory where media_records references a file whose hash doesn't match
    const backupDbFile = path.join(backupDir, 'potato.db');
    const backupDb = initTestAppDb(backupDbFile);
    populateTestUser(backupDb, 'u_new', 'restored_user');
    backupDb.prepare(`
      INSERT INTO media_records (id, user_id, filename, original_name, mime_type, byte_size, sha256, created_at)
      VALUES ('m_corrupt', 'u_new', 'corrupt.png', 'corrupt.png', 'image/png', 20, 'expected_valid_hash_9999', datetime('now'))
    `).run();
    backupDb.close();

    fs.writeFileSync(path.join(backupDir, 'attachments', 'corrupt.png'), Buffer.from('injected-corrupt-data'));
    writeValidManifest(backupDir, backupDbFile, [
      { filename: 'corrupt.png', sha256: 'expected_valid_hash_9999', byteSize: 20 },
    ]);

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

    const testDir = path.join(testRoot, 'successful_restore_test');
    const liveDir = path.join(testDir, 'live_data');
    const backupDir = path.join(testDir, 'backup_source');
    fs.mkdirSync(path.join(liveDir, 'attachments'), { recursive: true });
    fs.mkdirSync(path.join(backupDir, 'attachments'), { recursive: true });

    // 1. Pre-existing healthy database in liveDir
    const preDbFile = path.join(liveDir, 'potato.db');
    const preDb = initTestAppDb(preDbFile);
    populateTestUser(preDb, 'u_old', 'old_user');
    preDb.close();

    // 2. Backup source with valid DB and attachments
    const backupDbFile = path.join(backupDir, 'potato.db');
    const backupDb = initTestAppDb(backupDbFile);
    const attData = Buffer.from('photo-bytes-for-successful-restore');
    const attHash = crypto.createHash('sha256').update(attData).digest('hex');
    fs.writeFileSync(path.join(backupDir, 'attachments', 'pic.png'), attData);

    populateTestUser(backupDb, 'u_restored', 'restored_user');
    backupDb.prepare(`
      INSERT INTO sessions (token, user_id, csrf_token, created_at, expires_at, last_seen_at)
      VALUES ('sess_token_123', 'u_restored', 'csrf_123', datetime('now'), datetime('now', '+1 day'), datetime('now'))
    `).run();
    backupDb.prepare(`
      INSERT INTO media_records (id, user_id, filename, original_name, mime_type, byte_size, sha256, created_at)
      VALUES ('m_1', 'u_restored', 'pic.png', 'pic.png', 'image/png', ?, ?, datetime('now'))
    `).run(attData.length, attHash);
    backupDb.close();

    writeValidManifest(backupDir, backupDbFile, [
      { filename: 'pic.png', sha256: attHash, byteSize: attData.length },
    ]);

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
    assert.equal(wsRow.revision, 1);
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

    const testDir = path.join(testRoot, 'conflict_attachment_test');
    const liveDir = path.join(testDir, 'live_data');
    const backupDir = path.join(testDir, 'backup_source');
    fs.mkdirSync(path.join(liveDir, 'attachments'), { recursive: true });
    fs.mkdirSync(path.join(backupDir, 'attachments'), { recursive: true });

    // 1. Live directory has photo.png with content AAA
    const liveDbFile = path.join(liveDir, 'potato.db');
    const liveDb = initTestAppDb(liveDbFile);
    populateTestUser(liveDb, 'u_original', 'orig');
    liveDb.close();
    const liveDbHash = crypto.createHash('sha256').update(fs.readFileSync(liveDbFile)).digest('hex');

    const livePhotoFile = path.join(liveDir, 'attachments', 'photo.png');
    const livePhotoBytes = Buffer.from('CONTENT_VERSION_AAA_OF_PHOTO');
    fs.writeFileSync(livePhotoFile, livePhotoBytes);

    // 2. Backup directory has photo.png with content BBB
    const backupDbFile = path.join(backupDir, 'potato.db');
    const backupDb = initTestAppDb(backupDbFile);
    const backupPhotoBytes = Buffer.from('CONTENT_VERSION_BBB_DIFFERENT_HASH');
    const backupPhotoHash = crypto.createHash('sha256').update(backupPhotoBytes).digest('hex');
    fs.writeFileSync(path.join(backupDir, 'attachments', 'photo.png'), backupPhotoBytes);

    populateTestUser(backupDb, 'u_backup', 'backup_user');
    backupDb.prepare(`
      INSERT INTO media_records (id, user_id, filename, original_name, mime_type, byte_size, sha256, created_at)
      VALUES ('m_conflict', 'u_backup', 'photo.png', 'photo.png', 'image/png', ?, ?, datetime('now'))
    `).run(backupPhotoBytes.length, backupPhotoHash);
    backupDb.close();

    writeValidManifest(backupDir, backupDbFile, [
      { filename: 'photo.png', sha256: backupPhotoHash, byteSize: backupPhotoBytes.length },
    ]);

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

  describe('Task 5 Manifest & Application Schema Validation Regressions (S07)', () => {
    function setupPreservedTarget(baseDir: string) {
      const liveDir = path.join(baseDir, 'live_data');
      const backupDir = path.join(baseDir, 'backup_source');
      fs.mkdirSync(path.join(liveDir, 'attachments'), { recursive: true });
      fs.mkdirSync(path.join(backupDir, 'attachments'), { recursive: true });

      const liveDbFile = path.join(liveDir, 'potato.db');
      const liveDb = initTestAppDb(liveDbFile);
      populateTestUser(liveDb, 'u_target_keeper', 'target_user');
      liveDb.prepare(`
        INSERT INTO sessions (token, user_id, csrf_token, created_at, expires_at, last_seen_at)
        VALUES ('sess_preserved_1', 'u_target_keeper', 'csrf_p1', datetime('now'), datetime('now', '+1 day'), datetime('now'))
      `).run();
      const liveAttBytes = Buffer.from('target-keeper-photo');
      const liveAttHash = crypto.createHash('sha256').update(liveAttBytes).digest('hex');
      const liveAttFile = path.join(liveDir, 'attachments', 'target_pic.png');
      fs.writeFileSync(liveAttFile, liveAttBytes);
      liveDb.prepare(`
        INSERT INTO media_records (id, user_id, filename, original_name, mime_type, byte_size, sha256, created_at)
        VALUES ('m_target', 'u_target_keeper', 'target_pic.png', 'target_pic.png', 'image/png', ?, ?, datetime('now'))
      `).run(liveAttBytes.length, liveAttHash);
      liveDb.close();

      const liveDbHash = crypto.createHash('sha256').update(fs.readFileSync(liveDbFile)).digest('hex');
      const liveDbGen = (() => {
        const d = new Database(liveDbFile, { readonly: true });
        const g = (d.prepare("SELECT value FROM server_meta WHERE key = 'generation_id'").get() as any)?.value;
        d.close();
        return g;
      })();

      return {
        liveDir,
        backupDir,
        liveDbFile,
        liveDbHash,
        liveDbGen,
        liveAttFile,
        liveAttBytes,
      };
    }

    function assertTargetPreserved(state: ReturnType<typeof setupPreservedTarget>) {
      assert.ok(fs.existsSync(state.liveDbFile), 'live db must still exist');
      const currentDbHash = crypto.createHash('sha256').update(fs.readFileSync(state.liveDbFile)).digest('hex');
      assert.equal(currentDbHash, state.liveDbHash, 'live db bytes must be completely unchanged');

      const d = new Database(state.liveDbFile, { readonly: true });
      const currentGen = (d.prepare("SELECT value FROM server_meta WHERE key = 'generation_id'").get() as any)?.value;
      assert.equal(currentGen, state.liveDbGen, 'live generation must not have rotated on failure');

      const sess = d.prepare('SELECT COUNT(*) as cnt FROM sessions').get() as { cnt: number };
      assert.equal(sess.cnt, 1, 'live sessions must remain intact on failure');
      d.close();

      assert.ok(fs.existsSync(state.liveAttFile), 'live attachment must still exist');
      assert.deepEqual(fs.readFileSync(state.liveAttFile), state.liveAttBytes, 'live attachment bytes must be unchanged');

      const leftovers = fs.readdirSync(state.liveDir).filter(f => f.startsWith('.restore_staging_'));
      assert.equal(leftovers.length, 0, 'staging directory must be cleaned up');
    }

    it('rejects restore when manifest.json is missing', async () => {
      const { restoreOffline } = await import('../server/disasterRecovery');
      const base = path.join(testRoot, 'reg_missing_manifest');
      const env = setupPreservedTarget(base);

      const backupDbFile = path.join(env.backupDir, 'potato.db');
      const bDb = initTestAppDb(backupDbFile);
      populateTestUser(bDb, 'u_bk', 'bk_user');
      bDb.close();
      // Do NOT create manifest.json

      await assert.rejects(
        () => restoreOffline({ sourceDir: env.backupDir, dataDir: env.liveDir, offlineConfirmed: true }),
        /MISSING_MANIFEST/
      );
      assertTargetPreserved(env);
    });

    it('rejects restore when manifest.json is corrupt (invalid JSON)', async () => {
      const { restoreOffline } = await import('../server/disasterRecovery');
      const base = path.join(testRoot, 'reg_corrupt_manifest');
      const env = setupPreservedTarget(base);

      const backupDbFile = path.join(env.backupDir, 'potato.db');
      const bDb = initTestAppDb(backupDbFile);
      populateTestUser(bDb, 'u_bk', 'bk_user');
      bDb.close();

      fs.writeFileSync(path.join(env.backupDir, 'manifest.json'), '{ NOT_VALID_JSON ...');

      await assert.rejects(
        () => restoreOffline({ sourceDir: env.backupDir, dataDir: env.liveDir, offlineConfirmed: true }),
        /INVALID_MANIFEST/
      );
      assertTargetPreserved(env);
    });

    it('rejects restore when manifest schemaVersion is unsupported (e.g. 4 or 2)', async () => {
      const { restoreOffline } = await import('../server/disasterRecovery');
      const base = path.join(testRoot, 'reg_unsupported_schema');
      const env = setupPreservedTarget(base);

      const backupDbFile = path.join(env.backupDir, 'potato.db');
      const bDb = initTestAppDb(backupDbFile);
      populateTestUser(bDb, 'u_bk', 'bk_user');
      bDb.close();

      writeValidManifest(env.backupDir, backupDbFile, [], { schemaVersion: 4 });

      await assert.rejects(
        () => restoreOffline({ sourceDir: env.backupDir, dataDir: env.liveDir, offlineConfirmed: true }),
        /UNSUPPORTED_SCHEMA_VERSION/
      );
      assertTargetPreserved(env);
    });

    it('rejects restore when manifest database sha256 does not match potato.db', async () => {
      const { restoreOffline } = await import('../server/disasterRecovery');
      const base = path.join(testRoot, 'reg_sha_mismatch');
      const env = setupPreservedTarget(base);

      const backupDbFile = path.join(env.backupDir, 'potato.db');
      const bDb = initTestAppDb(backupDbFile);
      populateTestUser(bDb, 'u_bk', 'bk_user');
      bDb.close();

      const realStat = fs.statSync(backupDbFile);
      writeValidManifest(env.backupDir, backupDbFile, [], {
        database: { filename: 'potato.db', sha256: 'deadbeef0000111122223333444455556666777788889999aaaabbbbccccdddd', byteSize: realStat.size },
      });

      await assert.rejects(
        () => restoreOffline({ sourceDir: env.backupDir, dataDir: env.liveDir, offlineConfirmed: true }),
        /SOURCE_DB_HASH_MISMATCH/
      );
      assertTargetPreserved(env);
    });

    it('rejects restore when manifest database byteSize does not match potato.db', async () => {
      const { restoreOffline } = await import('../server/disasterRecovery');
      const base = path.join(testRoot, 'reg_size_mismatch');
      const env = setupPreservedTarget(base);

      const backupDbFile = path.join(env.backupDir, 'potato.db');
      const bDb = initTestAppDb(backupDbFile);
      populateTestUser(bDb, 'u_bk', 'bk_user');
      bDb.close();

      const realBuf = fs.readFileSync(backupDbFile);
      const realHash = crypto.createHash('sha256').update(realBuf).digest('hex');
      writeValidManifest(env.backupDir, backupDbFile, [], {
        database: { filename: 'potato.db', sha256: realHash, byteSize: realBuf.length + 9999 },
      });

      await assert.rejects(
        () => restoreOffline({ sourceDir: env.backupDir, dataDir: env.liveDir, offlineConfirmed: true }),
        /SOURCE_DB_SIZE_MISMATCH/
      );
      assertTargetPreserved(env);
    });

    it('rejects restore of an empty SQLite database (non-app database)', async () => {
      const { restoreOffline } = await import('../server/disasterRecovery');
      const base = path.join(testRoot, 'reg_empty_sqlite');
      const env = setupPreservedTarget(base);

      const backupDbFile = path.join(env.backupDir, 'potato.db');
      const emptyDb = new Database(backupDbFile);
      // Initialize valid SQLite database header without application tables
      emptyDb.pragma('user_version = 0');
      emptyDb.close();

      writeValidManifest(env.backupDir, backupDbFile, []);

      await assert.rejects(
        () => restoreOffline({ sourceDir: env.backupDir, dataDir: env.liveDir, offlineConfirmed: true }),
        /MISSING_TABLE/
      );
      assertTargetPreserved(env);
    });

    it('rejects restore of a zero-byte database file', async () => {
      const { restoreOffline } = await import('../server/disasterRecovery');
      const base = path.join(testRoot, 'reg_zero_byte_sqlite');
      const env = setupPreservedTarget(base);

      const backupDbFile = path.join(env.backupDir, 'potato.db');
      fs.writeFileSync(backupDbFile, Buffer.alloc(0));

      writeValidManifest(env.backupDir, backupDbFile, [], {
        database: { filename: 'potato.db', sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', byteSize: 0 },
      });

      await assert.rejects(
        () => restoreOffline({ sourceDir: env.backupDir, dataDir: env.liveDir, offlineConfirmed: true }),
        /INVALID_MANIFEST.*byteSize/
      );
      assertTargetPreserved(env);
    });

    it('rejects restore when required application table is missing (e.g. workspace_history)', async () => {
      const { restoreOffline } = await import('../server/disasterRecovery');
      const base = path.join(testRoot, 'reg_missing_table');
      const env = setupPreservedTarget(base);

      const backupDbFile = path.join(env.backupDir, 'potato.db');
      const bDb = initTestAppDb(backupDbFile);
      populateTestUser(bDb, 'u_bk', 'bk_user');
      bDb.exec('DROP TABLE workspace_history');
      bDb.close();

      writeValidManifest(env.backupDir, backupDbFile, []);

      await assert.rejects(
        () => restoreOffline({ sourceDir: env.backupDir, dataDir: env.liveDir, offlineConfirmed: true }),
        /MISSING_TABLE.*workspace_history/
      );
      assertTargetPreserved(env);
    });

    it('rejects restore when required column is missing in a table (e.g. workspaces.generation_id)', async () => {
      const { restoreOffline } = await import('../server/disasterRecovery');
      const base = path.join(testRoot, 'reg_missing_col');
      const env = setupPreservedTarget(base);

      const backupDbFile = path.join(env.backupDir, 'potato.db');
      const bDb = initTestAppDb(backupDbFile);
      populateTestUser(bDb, 'u_bk', 'bk_user');
      bDb.exec(`
        CREATE TABLE workspaces_bad (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          revision INTEGER NOT NULL DEFAULT 0,
          state_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO workspaces_bad SELECT user_id, revision, state_json, updated_at FROM workspaces;
        DROP TABLE workspaces;
        ALTER TABLE workspaces_bad RENAME TO workspaces;
      `);
      bDb.close();

      writeValidManifest(env.backupDir, backupDbFile, []);

      await assert.rejects(
        () => restoreOffline({ sourceDir: env.backupDir, dataDir: env.liveDir, offlineConfirmed: true }),
        /MISSING_COLUMN.*workspaces.*generation_id/
      );
      assertTargetPreserved(env);
    });

    it('rejects restore when foreign_key_check detects violations (orphaned workspace / media record)', async () => {
      const { restoreOffline } = await import('../server/disasterRecovery');
      const base = path.join(testRoot, 'reg_foreign_key_violation');
      const env = setupPreservedTarget(base);

      const backupDbFile = path.join(env.backupDir, 'potato.db');
      const bDb = initTestAppDb(backupDbFile);
      populateTestUser(bDb, 'u_bk', 'bk_user');
      bDb.pragma('foreign_keys = OFF');
      bDb.prepare(`
        INSERT INTO workspaces (user_id, revision, generation_id, state_json, updated_at)
        VALUES ('u_nonexistent_foreign_orphan', 1, 'gen_orphan', ?, datetime('now'))
      `).run(JSON.stringify(BLANK_STATE));
      bDb.close();

      writeValidManifest(env.backupDir, backupDbFile, []);

      await assert.rejects(
        () => restoreOffline({ sourceDir: env.backupDir, dataDir: env.liveDir, offlineConfirmed: true }),
        /FOREIGN_KEY_VIOLATION|ORPHAN_WORKSPACE/
      );
      assertTargetPreserved(env);
    });

    it('rejects restore when workspace state_json is corrupted (not valid JSON)', async () => {
      const { restoreOffline } = await import('../server/disasterRecovery');
      const base = path.join(testRoot, 'reg_corrupt_ws_json');
      const env = setupPreservedTarget(base);

      const backupDbFile = path.join(env.backupDir, 'potato.db');
      const bDb = initTestAppDb(backupDbFile);
      populateTestUser(bDb, 'u_bk', 'bk_user');
      bDb.prepare("UPDATE workspaces SET state_json = 'INVALID_JSON_CORRUPT{[' WHERE user_id = 'u_bk'").run();
      bDb.close();

      writeValidManifest(env.backupDir, backupDbFile, []);

      await assert.rejects(
        () => restoreOffline({ sourceDir: env.backupDir, dataDir: env.liveDir, offlineConfirmed: true }),
        /INVALID_WORKSPACE_STATE_JSON/
      );
      assertTargetPreserved(env);
    });

    it('rejects restore when workspace state_json schema is invalid (e.g. future version 5 or missing profile)', async () => {
      const { restoreOffline } = await import('../server/disasterRecovery');
      const base = path.join(testRoot, 'reg_bad_ws_schema');
      const env = setupPreservedTarget(base);

      const backupDbFile = path.join(env.backupDir, 'potato.db');
      const bDb = initTestAppDb(backupDbFile);
      populateTestUser(bDb, 'u_bk', 'bk_user');
      bDb.prepare("UPDATE workspaces SET state_json = ? WHERE user_id = 'u_bk'").run(
        JSON.stringify({ ...BLANK_STATE, version: 5 })
      );
      bDb.close();

      writeValidManifest(env.backupDir, backupDbFile, []);

      await assert.rejects(
        () => restoreOffline({ sourceDir: env.backupDir, dataDir: env.liveDir, offlineConfirmed: true }),
        /INVALID_WORKSPACE_PAYLOAD/
      );
      assertTargetPreserved(env);
    });

    it('rejects restore when workspace_history state_json is corrupted', async () => {
      const { restoreOffline } = await import('../server/disasterRecovery');
      const base = path.join(testRoot, 'reg_corrupt_history_json');
      const env = setupPreservedTarget(base);

      const backupDbFile = path.join(env.backupDir, 'potato.db');
      const bDb = initTestAppDb(backupDbFile);
      populateTestUser(bDb, 'u_bk', 'bk_user');
      bDb.prepare(`
        INSERT INTO workspace_history (id, user_id, revision, reason, state_json, created_at)
        VALUES ('hist_bad_1', 'u_bk', 1, 'test', 'NOT_VALID_JSON{', datetime('now'))
      `).run();
      bDb.close();

      writeValidManifest(env.backupDir, backupDbFile, []);

      await assert.rejects(
        () => restoreOffline({ sourceDir: env.backupDir, dataDir: env.liveDir, offlineConfirmed: true }),
        /INVALID_HISTORY_STATE_JSON/
      );
      assertTargetPreserved(env);
    });

    it('rejects restore when workspace references media belonging to a different user (cross-user violation)', async () => {
      const { restoreOffline } = await import('../server/disasterRecovery');
      const base = path.join(testRoot, 'reg_cross_user_media');
      const env = setupPreservedTarget(base);

      const backupDbFile = path.join(env.backupDir, 'potato.db');
      const bDb = initTestAppDb(backupDbFile);
      populateTestUser(bDb, 'u_user_a', 'user_a');
      populateTestUser(bDb, 'u_user_b', 'user_b');

      const photoData = Buffer.from('photo-belonging-to-user-b');
      const photoHash = crypto.createHash('sha256').update(photoData).digest('hex');
      fs.writeFileSync(path.join(env.backupDir, 'attachments', 'pic_b.png'), photoData);

      // Media record belongs to user_b
      bDb.prepare(`
        INSERT INTO media_records (id, user_id, filename, original_name, mime_type, byte_size, sha256, created_at)
        VALUES ('media_b_1', 'u_user_b', 'pic_b.png', 'pic_b.png', 'image/png', ?, ?, datetime('now'))
      `).run(photoData.length, photoHash);

      // But user_a workspace references media_b_1!
      const userAState = {
        ...BLANK_STATE,
        profile: { name: 'user_a', username: 'user_a', avatar: 'pose-1' },
        wrong: [{ id: 'w1', date: '2026-10-27', image: '/api/media/media_b_1' }],
      };
      bDb.prepare("UPDATE workspaces SET state_json = ? WHERE user_id = 'u_user_a'").run(JSON.stringify(userAState));
      bDb.close();

      writeValidManifest(env.backupDir, backupDbFile, [
        { filename: 'pic_b.png', sha256: photoHash, byteSize: photoData.length },
      ]);

      await assert.rejects(
        () => restoreOffline({ sourceDir: env.backupDir, dataDir: env.liveDir, offlineConfirmed: true }),
        /CROSS_USER_MEDIA_REFERENCE/
      );
      assertTargetPreserved(env);
    });

    it('rejects restore when workspace references a media record that does not exist in media_records', async () => {
      const { restoreOffline } = await import('../server/disasterRecovery');
      const base = path.join(testRoot, 'reg_missing_media_rec');
      const env = setupPreservedTarget(base);

      const backupDbFile = path.join(env.backupDir, 'potato.db');
      const bDb = initTestAppDb(backupDbFile);
      populateTestUser(bDb, 'u_user_a', 'user_a');

      // User A references a media ID that was never saved to media_records
      const userAState = {
        ...BLANK_STATE,
        profile: { name: 'user_a', username: 'user_a', avatar: 'pose-1' },
        wrong: [{ id: 'w1', date: '2026-10-27', image: '/api/media/media_phantom_99' }],
      };
      bDb.prepare("UPDATE workspaces SET state_json = ? WHERE user_id = 'u_user_a'").run(JSON.stringify(userAState));
      bDb.close();

      writeValidManifest(env.backupDir, backupDbFile, []);

      await assert.rejects(
        () => restoreOffline({ sourceDir: env.backupDir, dataDir: env.liveDir, offlineConfirmed: true }),
        /MISSING_MEDIA_RECORD/
      );
      assertTargetPreserved(env);
    });

    it('rejects restore when workspace_history references media belonging to another user', async () => {
      const { restoreOffline } = await import('../server/disasterRecovery');
      const base = path.join(testRoot, 'reg_history_cross_user_media');
      const env = setupPreservedTarget(base);

      const backupDbFile = path.join(env.backupDir, 'potato.db');
      const bDb = initTestAppDb(backupDbFile);
      populateTestUser(bDb, 'u_user_a', 'user_a');
      populateTestUser(bDb, 'u_user_b', 'user_b');

      const photoData = Buffer.from('photo-belonging-to-user-b');
      const photoHash = crypto.createHash('sha256').update(photoData).digest('hex');
      fs.writeFileSync(path.join(env.backupDir, 'attachments', 'pic_b.png'), photoData);

      bDb.prepare(`
        INSERT INTO media_records (id, user_id, filename, original_name, mime_type, byte_size, sha256, created_at)
        VALUES ('media_b_1', 'u_user_b', 'pic_b.png', 'pic_b.png', 'image/png', ?, ?, datetime('now'))
      `).run(photoData.length, photoHash);

      // History of user_a references media of user_b
      const histState = {
        ...BLANK_STATE,
        profile: { name: 'user_a', username: 'user_a', avatar: 'pose-1' },
        wrong: [{ id: 'w1', date: '2026-10-27', image: '/api/media/media_b_1' }],
      };
      bDb.prepare(`
        INSERT INTO workspace_history (id, user_id, revision, reason, state_json, created_at)
        VALUES ('hist_cross_1', 'u_user_a', 1, 'test', ?, datetime('now'))
      `).run(JSON.stringify(histState));
      bDb.close();

      writeValidManifest(env.backupDir, backupDbFile, [
        { filename: 'pic_b.png', sha256: photoHash, byteSize: photoData.length },
      ]);

      await assert.rejects(
        () => restoreOffline({ sourceDir: env.backupDir, dataDir: env.liveDir, offlineConfirmed: true }),
        /CROSS_USER_MEDIA_REFERENCE/
      );
      assertTargetPreserved(env);
    });

    it('rejects restore when media_records filename contains path traversal', async () => {
      const { restoreOffline } = await import('../server/disasterRecovery');
      const base = path.join(testRoot, 'reg_path_traversal');
      const env = setupPreservedTarget(base);

      const backupDbFile = path.join(env.backupDir, 'potato.db');
      const bDb = initTestAppDb(backupDbFile);
      populateTestUser(bDb, 'u_user_a', 'user_a');
      bDb.prepare(`
        INSERT INTO media_records (id, user_id, filename, original_name, mime_type, byte_size, sha256, created_at)
        VALUES ('media_hack_1', 'u_user_a', '../secret.png', 'secret.png', 'image/png', 10, 'dummyhash', datetime('now'))
      `).run();
      bDb.close();

      writeValidManifest(env.backupDir, backupDbFile, []);

      await assert.rejects(
        () => restoreOffline({ sourceDir: env.backupDir, dataDir: env.liveDir, offlineConfirmed: true }),
        /SECURITY_PATH_TRAVERSAL_DETECTED/
      );
      assertTargetPreserved(env);
    });

    it('staging migration safely adds missing seed_version and init_choice to older supported Schema 3 backups without touching source', async () => {
      const { restoreOffline } = await import('../server/disasterRecovery');
      const base = path.join(testRoot, 'reg_staging_migration');
      const env = setupPreservedTarget(base);

      // Create an older Schema 3 backup that lacks seed_version and init_choice on workspaces
      const backupDbFile = path.join(env.backupDir, 'potato.db');
      const bDb = new Database(backupDbFile);
      bDb.exec(`
        CREATE TABLE server_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, nickname TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE invites (code TEXT PRIMARY KEY, created_by TEXT NOT NULL, used_by TEXT, used_at TEXT, created_at TEXT NOT NULL);
        CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, csrf_token TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen_at TEXT NOT NULL);
        CREATE TABLE reset_codes (code TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_by TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT);
        CREATE TABLE workspaces (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, revision INTEGER NOT NULL DEFAULT 0, generation_id TEXT NOT NULL, state_json TEXT NOT NULL, schema_version INTEGER NOT NULL DEFAULT 3, updated_at TEXT NOT NULL);
        CREATE TABLE sync_idempotency (user_id TEXT NOT NULL, request_id TEXT NOT NULL, expected_revision INTEGER NOT NULL, result_revision INTEGER NOT NULL, payload_sha256 TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (user_id, request_id));
        CREATE TABLE media_records (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, filename TEXT NOT NULL, original_name TEXT NOT NULL, mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE workspace_history (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, revision INTEGER NOT NULL, reason TEXT NOT NULL, state_json TEXT NOT NULL, created_at TEXT NOT NULL);
      `);

      const genId = 'gen_old_schema3';
      bDb.prepare("INSERT INTO server_meta (key, value) VALUES ('generation_id', ?)").run(genId);
      bDb.prepare("INSERT INTO users VALUES ('u_old_schema', 'old_s3_user', 'old_s3', 'hash', 'user', 1, datetime('now'), datetime('now'))").run();
      bDb.prepare("INSERT INTO workspaces VALUES ('u_old_schema', 1, ?, ?, 3, datetime('now'))").run(
        genId,
        JSON.stringify({ ...BLANK_STATE, profile: { name: 'old_s3', username: 'old_s3_user', avatar: 'pose-1' } })
      );
      bDb.close();

      // Verify that source database DOES NOT have seed_version or init_choice
      const verifySrcDb = new Database(backupDbFile, { readonly: true });
      const srcWsCols = (verifySrcDb.pragma('table_info(workspaces)') as Array<{ name: string }>).map(c => c.name);
      assert.equal(srcWsCols.includes('seed_version'), false, 'source must NOT have seed_version before restore');
      assert.equal(srcWsCols.includes('init_choice'), false, 'source must NOT have init_choice before restore');
      verifySrcDb.close();

      writeValidManifest(env.backupDir, backupDbFile, []);

      // Execute restore: staging migration must apply without failing
      const res = await restoreOffline({
        sourceDir: env.backupDir,
        dataDir: env.liveDir,
        offlineConfirmed: true,
      });

      assert.equal(res.ok, true);
      assert.ok(res.generationId.startsWith('gen_'));

      // Verify restored target database HAS seed_version and init_choice
      const restoredDb = new Database(env.liveDbFile, { readonly: true });
      const restoredWsCols = (restoredDb.pragma('table_info(workspaces)') as Array<{ name: string }>).map(c => c.name);
      assert.equal(restoredWsCols.includes('seed_version'), true, 'restored database must have seed_version');
      assert.equal(restoredWsCols.includes('init_choice'), true, 'restored database must have init_choice');

      const restoredWs = restoredDb.prepare("SELECT user_id, revision, generation_id, seed_version FROM workspaces WHERE user_id = 'u_old_schema'").get() as any;
      assert.equal(restoredWs.revision, 1);
      assert.equal(restoredWs.generation_id, res.generationId);
      assert.equal(restoredWs.seed_version, 0);
      restoredDb.close();

      // Verify source database was NOT modified
      const recheckSrcDb = new Database(backupDbFile, { readonly: true });
      const recheckSrcCols = (recheckSrcDb.pragma('table_info(workspaces)') as Array<{ name: string }>).map(c => c.name);
      assert.equal(recheckSrcCols.includes('seed_version'), false, 'source DB must remain completely unmodified');
      recheckSrcDb.close();
    });
  });
});
