import Database, { Database as DatabaseType } from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { migrateAccountFeatures } from './accountFeatureSchema';

export function getDataDir(): string {
  return process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
}

export function getAttachmentsDir(): string {
  const dir = path.resolve(getDataDir(), 'attachments');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

export function getDbPath(): string {
  return path.resolve(getDataDir(), 'potato.db');
}

let dbInstance: DatabaseType | null = null;

export function getDb(): DatabaseType {
  if (dbInstance) return dbInstance;

  const dataDir = getDataDir();
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  }

  const db = new Database(getDbPath());
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  // Initialize schema
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

  // Migration: ensure seed_version column exists on existing workspaces table
  try {
    db.exec('ALTER TABLE workspaces ADD COLUMN seed_version INTEGER NOT NULL DEFAULT 0');
  } catch {
    // Column already exists
  }

  // Migration: persisted one-time empty-library initialization choice (R10)
  // NULL = 尚未选择；'default' = 已载入官方默认资料库；'blank' = 用户明确保留空白
  try {
    db.exec('ALTER TABLE workspaces ADD COLUMN init_choice TEXT');
  } catch {
    // Column already exists
  }

  // 媒体秒传/幂等检索索引：按 (user_id, sha256) 去重（非唯一索引，避免历史重复数据导致启动失败）
  db.exec('CREATE INDEX IF NOT EXISTS idx_media_user_sha ON media_records(user_id, sha256)');

  // Ensure global sync generation ID exists
  const getGen = db.prepare('SELECT value FROM server_meta WHERE key = ?').get('generation_id') as { value: string } | undefined;
  if (!getGen) {
    const initialGenId = `gen_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    db.prepare('INSERT INTO server_meta (key, value) VALUES (?, ?)').run('generation_id', initialGenId);
  }

  migrateAccountFeatures(db);
  dbInstance = db;
  return db;
}

export function getCurrentGenerationId(): string {
  const db = getDb();
  const row = db.prepare('SELECT value FROM server_meta WHERE key = ?').get('generation_id') as { value: string } | undefined;
  return row?.value || 'gen_default';
}

export function rotateGenerationId(): string {
  const db = getDb();
  const nextGenId = `gen_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  db.prepare('INSERT OR REPLACE INTO server_meta (key, value) VALUES (?, ?)').run('generation_id', nextGenId);
  try {
    db.prepare('UPDATE workspaces SET generation_id = ?').run(nextGenId);
  } catch {}
  // Also revoke all existing active sessions to prevent old client replay
  db.prepare('DELETE FROM sessions').run();
  return nextGenId;
}

export { restoreOffline, validateRestoreDatabase } from './disasterRecovery';
export type { RestoreOfflineOptions, RestoreOfflineResult, MediaRecordRow } from './disasterRecovery';

/**
 * Perform safe hot backup using SQLite Online Backup API.
 * Guarantees zero-corruption checkpointing even under concurrent WAL writes.
 */
export async function backupDatabaseOnline(targetFile: string): Promise<void> {
  const db = getDb();
  const resolved = path.resolve(targetFile);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  // Remove destination if it already exists
  if (fs.existsSync(resolved)) {
    fs.unlinkSync(resolved);
  }
  await db.backup(resolved);
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
