import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { acquireDataDirectoryLock } from '../server/dataLock';
import { restoreOffline } from '../server/disasterRecovery';

describe('Data Directory Maintenance Lock & Server Lifecycle Suite', () => {
  const testSuiteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaogong-data-lock-test-'));

  after(() => {
    try {
      fs.rmSync(testSuiteDir, { recursive: true, force: true });
    } catch {}
  });

  // Helper to create a valid minimal backup
  function createValidBackup(targetDir: string) {
    fs.mkdirSync(path.join(targetDir, 'attachments'), { recursive: true });
    const db = new Database(path.join(targetDir, 'potato.db'));
    db.exec(`
      CREATE TABLE IF NOT EXISTS server_meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT, nickname TEXT, password_hash TEXT, role TEXT, is_active INTEGER, created_at TEXT, updated_at TEXT);
      CREATE TABLE IF NOT EXISTS workspaces (user_id TEXT PRIMARY KEY, revision INTEGER, generation_id TEXT, state_json TEXT, schema_version INTEGER, seed_version INTEGER, updated_at TEXT);
      CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT, csrf_token TEXT, created_at TEXT, expires_at TEXT, last_seen_at TEXT);
      INSERT INTO server_meta VALUES ('generation_id', 'gen_backup_001');
      INSERT INTO users VALUES ('u_1', 'backup_user', 'BU', 'hash', 'user', 1, '2026-10-26', '2026-10-26');
      INSERT INTO workspaces VALUES ('u_1', 1, 'gen_backup_001', '{}', 3, 0, '2026-10-26');
    `);
    db.close();
  }

  // Helper to create a valid minimal live db
  function createValidLiveDb(dataDir: string) {
    fs.mkdirSync(path.join(dataDir, 'attachments'), { recursive: true });
    const db = new Database(path.join(dataDir, 'potato.db'));
    db.exec(`
      CREATE TABLE IF NOT EXISTS server_meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT, nickname TEXT, password_hash TEXT, role TEXT, is_active INTEGER, created_at TEXT, updated_at TEXT);
      CREATE TABLE IF NOT EXISTS workspaces (user_id TEXT PRIMARY KEY, revision INTEGER, generation_id TEXT, state_json TEXT, schema_version INTEGER, seed_version INTEGER, updated_at TEXT);
      CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT, csrf_token TEXT, created_at TEXT, expires_at TEXT, last_seen_at TEXT);
      INSERT INTO server_meta VALUES ('generation_id', 'gen_live_001');
      INSERT INTO users VALUES ('u_live', 'live_user', 'LU', 'hash', 'user', 1, '2026-10-26', '2026-10-26');
      INSERT INTO workspaces VALUES ('u_live', 1, 'gen_live_001', '{}', 3, 0, '2026-10-26');
    `);
    db.close();
  }

  it('a) Running server (holding shared lock) causes restoreOffline (exclusive) to be rejected with DATA_LOCK_BUSY', async () => {
    const dataDir = path.join(testSuiteDir, 'test_a_data');
    const backupDir = path.join(testSuiteDir, 'test_a_backup');
    fs.mkdirSync(dataDir, { recursive: true });
    createValidLiveDb(dataDir);
    createValidBackup(backupDir);

    const port = 39821;
    const serverProc = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        DATA_DIR: dataDir,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    try {
      // Wait for server to be ready
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Server failed to start within 10s')), 10000);
        let out = '';
        serverProc.stdout?.on('data', (d) => {
          out += d.toString();
          if (out.includes('后端服务已启动')) {
            clearTimeout(timer);
            resolve();
          }
        });
        serverProc.stderr?.on('data', (d) => {
          out += d.toString();
        });
        serverProc.on('exit', (code) => {
          clearTimeout(timer);
          reject(new Error(`Server exited unexpectedly with code ${code}: ${out}`));
        });
      });

      // Now server is holding shared lock.
      // Attempting restoreOffline (which acquires exclusive lock) must be rejected with DATA_LOCK_BUSY
      await assert.rejects(
        async () => {
          await restoreOffline({
            sourceDir: backupDir,
            dataDir,
            offlineConfirmed: true,
          });
        },
        (err: any) => {
          assert.ok(
            err.message.includes('DATA_LOCK_BUSY') || err.code === 'DATA_LOCK_BUSY',
            `Expected DATA_LOCK_BUSY, got: ${err.message}`
          );
          return true;
        }
      );
    } finally {
      serverProc.kill('SIGTERM');
      await new Promise<void>((r) => serverProc.once('close', () => r()));
    }
  });

  it('b) Process holding exclusive lock causes server / shared lock to be rejected before touching DB', async () => {
    const dataDir = path.join(testSuiteDir, 'test_b_data');
    fs.mkdirSync(dataDir, { recursive: true });

    // Acquire exclusive lock
    const exLock = await acquireDataDirectoryLock(dataDir, 'exclusive');

    try {
      const port = 39822;
      const res = spawnSync(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PORT: String(port),
          DATA_DIR: dataDir,
        },
        encoding: 'utf-8',
        timeout: 8000,
      });

      assert.notEqual(res.status, 0, 'Server must exit with non-zero exit code');
      const combined = (res.stderr || '') + (res.stdout || '');
      assert.ok(
        combined.includes('DATA_LOCK_BUSY'),
        `Expected output to contain DATA_LOCK_BUSY, got: ${combined}`
      );

      // Verify that database was NOT created / touched
      const dbFile = path.join(dataDir, 'potato.db');
      assert.equal(fs.existsSync(dbFile), false, 'Database must not be touched or created when lock is busy');
    } finally {
      await exLock.release();
    }
  });

  it('c) Two restore processes (exclusive) compete: one succeeds, one gets BUSY', async () => {
    const dataDir = path.join(testSuiteDir, 'test_c_data');
    const backupDir = path.join(testSuiteDir, 'test_c_backup');
    fs.mkdirSync(dataDir, { recursive: true });
    createValidLiveDb(dataDir);
    createValidBackup(backupDir);

    // Holder 1 acquires exclusive lock
    const lock1 = await acquireDataDirectoryLock(dataDir, 'exclusive');

    try {
      // Competitor 2 attempts restoreOffline on same dataDir
      await assert.rejects(
        async () => {
          await restoreOffline({
            sourceDir: backupDir,
            dataDir,
            offlineConfirmed: true,
          });
        },
        (err: any) => {
          assert.ok(
            err.message.includes('DATA_LOCK_BUSY') || err.code === 'DATA_LOCK_BUSY',
            `Expected DATA_LOCK_BUSY, got: ${err.message}`
          );
          return true;
        }
      );
    } finally {
      await lock1.release();
    }

    // After lock1 is released, restoreOffline can succeed
    const res = await restoreOffline({
      sourceDir: backupDir,
      dataDir,
      offlineConfirmed: true,
    });
    assert.equal(res.ok, true);
  });

  it('d) Two shared lock holders: releasing one does not release or impact the other', async () => {
    const dataDir = path.join(testSuiteDir, 'test_d_data');
    fs.mkdirSync(dataDir, { recursive: true });

    const shared1 = await acquireDataDirectoryLock(dataDir, 'shared');
    const shared2 = await acquireDataDirectoryLock(dataDir, 'shared');

    // While both hold shared, exclusive must be rejected
    await assert.rejects(
      async () => await acquireDataDirectoryLock(dataDir, 'exclusive'),
      (err: any) => {
        assert.ok(err.message.includes('DATA_LOCK_BUSY') || err.code === 'DATA_LOCK_BUSY');
        return true;
      }
    );

    // Release shared1
    await shared1.release();

    // shared2 is still held: exclusive must STILL be rejected
    await assert.rejects(
      async () => await acquireDataDirectoryLock(dataDir, 'exclusive'),
      (err: any) => {
        assert.ok(err.message.includes('DATA_LOCK_BUSY') || err.code === 'DATA_LOCK_BUSY');
        return true;
      }
    );

    // Release shared2
    await shared2.release();

    // Now exclusive can be acquired
    const exclusive = await acquireDataDirectoryLock(dataDir, 'exclusive');
    await exclusive.release();
  });

  it('e) Process killed with SIGKILL automatically releases kernel flock so another process can acquire lock immediately', async () => {
    const dataDir = path.join(testSuiteDir, 'test_e_data');
    fs.mkdirSync(dataDir, { recursive: true });

    // Spawn a node child process that acquires exclusive lock and waits
    const childCode = `
      import { acquireDataDirectoryLock } from './server/dataLock';
      const lock = await acquireDataDirectoryLock(process.env.TARGET_DATA_DIR, 'exclusive');
      console.log('LOCKED_OK');
      await new Promise(() => {}); // hang forever until killed
    `;
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', childCode], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TARGET_DATA_DIR: dataDir,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let childErr = '';
    child.stderr?.on('data', (d) => { childErr += d.toString(); });

    await new Promise<void>((resolve, reject) => {
      child.stdout?.on('data', (d) => {
        if (d.toString().includes('LOCKED_OK')) resolve();
      });
      child.on('exit', (code) => reject(new Error(`Child exited early: ${code}: ${childErr}`)));
      setTimeout(() => reject(new Error(`Child timeout: ${childErr}`)), 5000);
    });

    // Verify it is held
    await assert.rejects(
      async () => await acquireDataDirectoryLock(dataDir, 'exclusive'),
      (err: any) => {
        assert.ok(err.message.includes('DATA_LOCK_BUSY') || err.code === 'DATA_LOCK_BUSY');
        return true;
      }
    );

    // Kill child with SIGKILL
    child.kill('SIGKILL');
    await new Promise<void>((r) => child.once('close', () => r()));

    // Kernel must have released flock immediately
    const nextLock = await acquireDataDirectoryLock(dataDir, 'exclusive');
    assert.ok(nextLock);
    await nextLock.release();
  });

  it('f) Helper process killed while server running causes server to terminate non-zero', async () => {
    const dataDir = path.join(testSuiteDir, 'test_f_data');
    fs.mkdirSync(dataDir, { recursive: true });
    createValidLiveDb(dataDir);

    const port = 39823;
    const serverProc = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        DATA_DIR: dataDir,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let serverStderr = '';
    serverProc.stderr?.on('data', (d) => {
      serverStderr += d.toString();
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Server start timeout')), 10000);
        serverProc.stdout?.on('data', (d) => {
          if (d.toString().includes('后端服务已启动')) {
            clearTimeout(timer);
            resolve();
          }
        });
        serverProc.on('exit', (code) => {
          clearTimeout(timer);
          reject(new Error(`Server exited: ${code}`));
        });
      });

      // Find the child python helper process
      // On Mac/Linux, find processes whose parent is serverProc.pid
      const pgrepRes = spawnSync('pgrep', ['-P', String(serverProc.pid)], { encoding: 'utf-8' });
      const childPids = pgrepRes.stdout.trim().split(/\s+/).map((p) => parseInt(p, 10)).filter(Boolean);

      assert.ok(childPids.length > 0, 'Must find child process for helper');
      const helperPid = childPids[0];

      // Kill the helper process
      process.kill(helperPid, 'SIGKILL');

      // The server must terminate with non-zero exit code
      const exitCode = await new Promise<number | null>((resolve) => {
        const t = setTimeout(() => {
          serverProc.kill('SIGKILL');
          resolve(-999);
        }, 5000);
        serverProc.on('exit', (code) => {
          clearTimeout(t);
          resolve(code);
        });
      });

      assert.notEqual(exitCode, 0, 'Server must terminate non-zero when helper is killed');
      assert.ok(
        serverStderr.includes('Data directory maintenance lock lost') || serverStderr.includes('DATA_LOCK_LOST'),
        `Expected stderr to indicate lost lock, got: ${serverStderr}`
      );
    } finally {
      try {
        serverProc.kill('SIGKILL');
      } catch {}
    }
  });

  it('g) Path alias (e.g. ./data vs /abs/path/to/data via realpath) lock together', async () => {
    const actualDataDir = path.join(testSuiteDir, 'test_g_actual');
    fs.mkdirSync(actualDataDir, { recursive: true });

    // Create a symlink to actualDataDir
    const symlinkDir = path.join(testSuiteDir, 'test_g_symlink');
    fs.symlinkSync(actualDataDir, symlinkDir);

    // Also compute relative path from current working directory
    const relDataDir = path.relative(process.cwd(), actualDataDir);

    // Acquire shared lock on actualDataDir
    const shared = await acquireDataDirectoryLock(actualDataDir, 'shared');

    try {
      // Trying exclusive on symlinkDir must be rejected with DATA_LOCK_BUSY
      await assert.rejects(
        async () => await acquireDataDirectoryLock(symlinkDir, 'exclusive'),
        (err: any) => {
          assert.ok(err.message.includes('DATA_LOCK_BUSY') || err.code === 'DATA_LOCK_BUSY');
          return true;
        }
      );

      // Trying exclusive on relative path must also be rejected with DATA_LOCK_BUSY
      await assert.rejects(
        async () => await acquireDataDirectoryLock(relDataDir, 'exclusive'),
        (err: any) => {
          assert.ok(err.message.includes('DATA_LOCK_BUSY') || err.code === 'DATA_LOCK_BUSY');
          return true;
        }
      );
    } finally {
      await shared.release();
    }
  });

  it('h) Missing python / permission denied returns DATA_LOCK_UNAVAILABLE', async () => {
    const normalDir = path.join(testSuiteDir, 'test_h_normal');
    fs.mkdirSync(normalDir, { recursive: true });

    // 1. Missing python
    const origPython = process.env.PYTHON_BIN;
    process.env.PYTHON_BIN = '/nonexistent/bin/python3_dummy';
    try {
      await assert.rejects(
        async () => await acquireDataDirectoryLock(normalDir, 'shared'),
        (err: any) => {
          assert.ok(
            err.message.includes('DATA_LOCK_UNAVAILABLE') || err.code === 'DATA_LOCK_UNAVAILABLE',
            `Expected DATA_LOCK_UNAVAILABLE, got: ${err.message}`
          );
          return true;
        }
      );
    } finally {
      if (origPython !== undefined) {
        process.env.PYTHON_BIN = origPython;
      } else {
        delete process.env.PYTHON_BIN;
      }
    }

    // 2. Permission denied directory
    const noPermDir = path.join(testSuiteDir, 'test_h_noperm');
    fs.mkdirSync(noPermDir, { recursive: true });
    fs.chmodSync(noPermDir, 0o000);

    try {
      await assert.rejects(
        async () => await acquireDataDirectoryLock(noPermDir, 'shared'),
        (err: any) => {
          assert.ok(
            err.message.includes('DATA_LOCK_UNAVAILABLE') || err.code === 'DATA_LOCK_UNAVAILABLE',
            `Expected DATA_LOCK_UNAVAILABLE, got: ${err.message}`
          );
          return true;
        }
      );
    } finally {
      try {
        fs.chmodSync(noPermDir, 0o700);
      } catch {}
    }

    // 3. Nonexistent directory
    const nonexistentDir = path.join(testSuiteDir, 'test_h_nonexistent_xyz');
    await assert.rejects(
      async () => await acquireDataDirectoryLock(nonexistentDir, 'shared'),
      (err: any) => {
        assert.ok(
          err.message.includes('DATA_LOCK_UNAVAILABLE') || err.code === 'DATA_LOCK_UNAVAILABLE',
          `Expected DATA_LOCK_UNAVAILABLE, got: ${err.message}`
        );
        return true;
      }
    );
  });
});
