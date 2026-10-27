import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { acquireDataDirectoryLock } from './dataLock';
import { validateWorkspacePayload } from './workspace';
import { extractMediaIdsFromState } from './media';

export interface RestoreOfflineOptions {
  sourceDir: string;
  dataDir: string;
  offlineConfirmed: boolean;
  skipPreBackup?: boolean;
}

export interface RestoreOfflineResult {
  ok: boolean;
  generationId: string;
  databasePath: string;
  attachmentsRestored: number;
  safetyBackupDir?: string;
  corruptBackupDir?: string;
}

export interface MediaRecordRow {
  id: string;
  user_id: string;
  filename: string;
  original_name: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
}

interface TableRequirement {
  tableName: string;
  requiredColumns: string[];
  primaryKeys: string[];
}

const REQUIRED_TABLES: TableRequirement[] = [
  {
    tableName: 'server_meta',
    requiredColumns: ['key', 'value'],
    primaryKeys: ['key'],
  },
  {
    tableName: 'users',
    requiredColumns: ['id', 'username', 'password_hash', 'role', 'created_at'],
    primaryKeys: ['id'],
  },
  {
    tableName: 'invites',
    requiredColumns: ['code', 'created_by', 'created_at'],
    primaryKeys: ['code'],
  },
  {
    tableName: 'sessions',
    requiredColumns: ['token', 'user_id', 'created_at', 'expires_at'],
    primaryKeys: ['token'],
  },
  {
    tableName: 'reset_codes',
    requiredColumns: ['code', 'user_id', 'created_at', 'expires_at'],
    primaryKeys: ['code'],
  },
  {
    tableName: 'workspaces',
    requiredColumns: ['user_id', 'revision', 'generation_id', 'state_json', 'updated_at'],
    primaryKeys: ['user_id'],
  },
  {
    tableName: 'sync_idempotency',
    requiredColumns: ['user_id', 'request_id', 'created_at'],
    primaryKeys: ['user_id', 'request_id'],
  },
  {
    tableName: 'media_records',
    requiredColumns: ['id', 'user_id', 'filename', 'original_name', 'mime_type', 'byte_size', 'sha256', 'created_at'],
    primaryKeys: ['id'],
  },
  {
    tableName: 'workspace_history',
    requiredColumns: ['id', 'user_id', 'revision', 'reason', 'state_json', 'created_at'],
    primaryKeys: ['id'],
  },
];

const REQUIRED_FOREIGN_KEYS: Array<{ table: string; from: string; toTable: string; toCol: string }> = [
  { table: 'sessions', from: 'user_id', toTable: 'users', toCol: 'id' },
  { table: 'reset_codes', from: 'user_id', toTable: 'users', toCol: 'id' },
  { table: 'workspaces', from: 'user_id', toTable: 'users', toCol: 'id' },
  { table: 'media_records', from: 'user_id', toTable: 'users', toCol: 'id' },
  { table: 'workspace_history', from: 'user_id', toTable: 'users', toCol: 'id' },
];

function computeFileSha256(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * 校验待恢复或暂存数据库的应用 Schema、外键、工作区与媒体引用：
 * - 绝不调用 getDb() 或在源/暂存库中建表
 * - 验证 SQLite PRAGMA integrity_check 为 ok
 * - 验证 SQLite PRAGMA foreign_key_check 无违反记录
 * - 验证全部 9 张核心应用表的存在性、必要列与主键/外键约束
 * - 校验 workspaces 及 workspace_history 中 state_json 结构（复用 validateWorkspacePayload）
 * - 提取媒体引用，确保引用的媒体在 media_records 中存在且属于同一用户
 * - 校验媒体记录文件名（防止路径穿越）
 * - 在 staging/final 阶段验证会话已撤销、generation_id 一致
 * - 返回已校验的媒体记录清单
 */
export function validateRestoreDatabase(
  db: DatabaseType,
  phase: 'source' | 'staging' | 'final'
): MediaRecordRow[] {
  // 1. SQLite PRAGMA integrity_check
  const integrity = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
  if (!integrity || integrity.length === 0 || integrity[0]?.integrity_check !== 'ok') {
    throw new Error(`SOURCE_INTEGRITY_CHECK_FAILED: 数据库 PRAGMA integrity_check 失败 (${phase}): ${JSON.stringify(integrity)}`);
  }

  // 2. SQLite PRAGMA foreign_key_check
  const fkRows = db.pragma('foreign_key_check') as Array<{ table: string; rowid: number; parent: string; fkid: number }>;
  if (fkRows && fkRows.length > 0) {
    throw new Error(`FOREIGN_KEY_VIOLATION: 数据库 PRAGMA foreign_key_check 失败 (${phase}): 检测到外键约束破坏: ${JSON.stringify(fkRows)}`);
  }

  // 3. 检查 9 张核心表结构、必要列与主键约束
  for (const req of REQUIRED_TABLES) {
    const tableRow = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(req.tableName);
    if (!tableRow) {
      throw new Error(`MISSING_TABLE: 数据库缺少必要应用表: ${req.tableName} (${phase})`);
    }

    const columns = db.pragma(`table_info(${req.tableName})`) as Array<{ name: string; pk: number }>;
    const colNames = new Set(columns.map(c => c.name));

    for (const col of req.requiredColumns) {
      if (!colNames.has(col)) {
        throw new Error(`MISSING_COLUMN: 数据库表 ${req.tableName} 缺少必要列: ${col} (${phase})`);
      }
    }

    if (req.tableName === 'sync_idempotency') {
      if (!colNames.has('payload_sha256') && !colNames.has('payload_sha')) {
        throw new Error(`MISSING_COLUMN: 数据库表 sync_idempotency 缺少 payload_sha256 列 (${phase})`);
      }
      if (!colNames.has('result_revision') && !colNames.has('expected_revision') && !colNames.has('revision')) {
        throw new Error(`MISSING_COLUMN: 数据库表 sync_idempotency 缺少 revision 列 (${phase})`);
      }
    }

    const pkCols = columns.filter(c => c.pk > 0).map(c => c.name);
    for (const pk of req.primaryKeys) {
      if (!pkCols.includes(pk)) {
        throw new Error(`MISSING_PRIMARY_KEY: 数据库表 ${req.tableName} 缺少主键约束: ${pk} (${phase})`);
      }
    }
  }

  // 4. 检查外键定义
  for (const fk of REQUIRED_FOREIGN_KEYS) {
    const fks = db.pragma(`foreign_key_list(${fk.table})`) as Array<{ table: string; from: string; to: string }>;
    const hasFk = fks.some(f => f.table === fk.toTable && f.from === fk.from && f.to === fk.toCol);
    if (!hasFk) {
      throw new Error(`MISSING_FOREIGN_KEY: 数据库表 ${fk.table} 缺少外键约束: ${fk.from} -> ${fk.toTable}(${fk.toCol}) (${phase})`);
    }
  }

  // 5. staging 与 final 阶段特定断言
  if (phase === 'staging' || phase === 'final') {
    const wsCols = (db.pragma('table_info(workspaces)') as Array<{ name: string }>).map(c => c.name);
    if (!wsCols.includes('seed_version')) {
      throw new Error(`MISSING_COLUMN: 数据库表 workspaces 缺少 seed_version 列 (${phase})`);
    }

    const sessCount = db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
    if (sessCount.count !== 0) {
      throw new Error(`ACTIVE_SESSIONS_NOT_REVOKED: ${phase} 阶段检测到活跃会话未被清空 (剩余: ${sessCount.count})`);
    }

    const metaGen = db.prepare("SELECT value FROM server_meta WHERE key = 'generation_id'").get() as { value: string } | undefined;
    if (!metaGen || !metaGen.value || !metaGen.value.startsWith('gen_')) {
      throw new Error(`MISSING_OR_INVALID_GENERATION_ID: ${phase} 阶段缺少合法的 generation_id`);
    }

    const mismatchWs = db.prepare("SELECT user_id, generation_id FROM workspaces WHERE generation_id != ?").all(metaGen.value) as any[];
    if (mismatchWs.length > 0) {
      throw new Error(`WORKSPACE_GENERATION_MISMATCH: ${phase} 阶段工作区 generation_id 与 server_meta 不匹配: ${mismatchWs[0]?.user_id}`);
    }
  }

  // 6. 验证用户、媒体记录与路径安全
  const userRows = db.prepare('SELECT id, username FROM users').all() as Array<{ id: string; username: string }>;
  const userIds = new Set(userRows.map(u => u.id));

  const rawMedia = db.prepare('SELECT id, user_id, filename, original_name, mime_type, byte_size, sha256 FROM media_records').all() as any[];
  const requiredMedia: MediaRecordRow[] = [];
  const mediaMap = new Map<string, MediaRecordRow>();

  for (const r of rawMedia) {
    const row: MediaRecordRow = {
      id: String(r.id || ''),
      user_id: String(r.user_id || ''),
      filename: String(r.filename || ''),
      original_name: String(r.original_name || r.filename || ''),
      mime_type: String(r.mime_type || 'application/octet-stream'),
      byte_size: Number(r.byte_size || 0),
      sha256: String(r.sha256 || ''),
    };

    if (!userIds.has(row.user_id)) {
      throw new Error(`ORPHAN_MEDIA_RECORD: 媒体记录缺少所属有效用户: ${row.id} (user_id: ${row.user_id}) (${phase})`);
    }

    const safeName = path.basename(row.filename);
    if (safeName !== row.filename || row.filename.includes('..') || path.isAbsolute(row.filename)) {
      throw new Error(`SECURITY_PATH_TRAVERSAL_DETECTED: 媒体记录文件名非法: ${row.filename} (${phase})`);
    }

    requiredMedia.push(row);
    mediaMap.set(row.id, row);
  }

  // 7. 验证工作区 state_json 与媒体归属
  const wsRows = db.prepare('SELECT user_id, revision, generation_id, state_json FROM workspaces').all() as any[];
  for (const ws of wsRows) {
    if (!userIds.has(ws.user_id)) {
      throw new Error(`ORPHAN_WORKSPACE: 工作区缺少所属有效用户: ${ws.user_id} (${phase})`);
    }
    let parsedState: any;
    try {
      parsedState = JSON.parse(ws.state_json);
    } catch (err: any) {
      throw new Error(`INVALID_WORKSPACE_STATE_JSON: 用户 ${ws.user_id} 工作区 state_json 不是合法 JSON (${phase}): ${err.message}`);
    }
    const validation = validateWorkspacePayload(parsedState, parsedState?.version || 3);
    if (!validation.valid) {
      throw new Error(`INVALID_WORKSPACE_PAYLOAD: 用户 ${ws.user_id} 工作区 state 结构校验失败 (${phase}): ${validation.message}`);
    }
    const mediaIds = extractMediaIdsFromState(parsedState);
    for (const mId of mediaIds) {
      const rec = mediaMap.get(mId);
      if (!rec) {
        throw new Error(`MISSING_MEDIA_RECORD: 用户 ${ws.user_id} 工作区引用的媒体记录在 media_records 中不存在: ${mId} (${phase})`);
      }
      if (rec.user_id !== ws.user_id) {
        throw new Error(`CROSS_USER_MEDIA_REFERENCE: 用户 ${ws.user_id} 工作区引用了其他用户的媒体: ${mId} (归属用户: ${rec.user_id}) (${phase})`);
      }
    }
  }

  // 8. 验证历史记录 state_json 与媒体归属
  const histRows = db.prepare('SELECT id, user_id, revision, reason, state_json FROM workspace_history').all() as any[];
  for (const hist of histRows) {
    if (!userIds.has(hist.user_id)) {
      throw new Error(`ORPHAN_HISTORY: 历史记录缺少所属有效用户: ${hist.id} (user_id: ${hist.user_id}) (${phase})`);
    }
    let parsedState: any;
    try {
      parsedState = JSON.parse(hist.state_json);
    } catch (err: any) {
      throw new Error(`INVALID_HISTORY_STATE_JSON: 历史记录 ${hist.id} (user_id: ${hist.user_id}) state_json 不是合法 JSON (${phase}): ${err.message}`);
    }
    const validation = validateWorkspacePayload(parsedState, parsedState?.version || 3);
    if (!validation.valid) {
      throw new Error(`INVALID_HISTORY_PAYLOAD: 历史记录 ${hist.id} (user_id: ${hist.user_id}) state 结构校验失败 (${phase}): ${validation.message}`);
    }
    const mediaIds = extractMediaIdsFromState(parsedState);
    for (const mId of mediaIds) {
      const rec = mediaMap.get(mId);
      if (!rec) {
        throw new Error(`MISSING_MEDIA_RECORD: 历史记录 ${hist.id} 引用的媒体记录在 media_records 中不存在: ${mId} (${phase})`);
      }
      if (rec.user_id !== hist.user_id) {
        throw new Error(`CROSS_USER_MEDIA_REFERENCE: 历史记录 ${hist.id} 引用了其他用户的媒体: ${mId} (归属用户: ${rec.user_id}) (${phase})`);
      }
    }
  }

  return requiredMedia;
}

/**
 * 核心停服灾难恢复接口：
 * 1. 显式路径入参，脱离全局 DB 单例
 * 2. 仅支持停服恢复（确认 offlineConfirmed、独占维护锁、检查目标服务占用）
 * 3. 严格核验 manifest.json（schemaVersion === 3，database.filename/sha256/byteSize）
 * 4. 恢复前调用 validateRestoreDatabase 对源库进行应用 Schema、外键、工作区与媒体引用全量校验
 * 5. 校验源库引用的所有附件文件（路径、大小、SHA-256）
 * 6. 在同一文件系统内建立隔离暂存区 (.restore_staging_...) 并复制数据
 * 7. 在暂存区执行安全补列迁移（如 seed_version/init_choice）、代际轮换与会话撤销
 * 8. 校验暂存数据库 (staging 阶段) 与暂存附件
 * 9. 保存旧库安全快照（可验证时保存完整副本，损坏时保存现场副本）
 * 10. 将附件安全就位（同名不同内容直接拒绝 ATTACHMENT_CONFLICT）
 * 11. 原子替换主数据库文件 (fs.renameSync) 并清理旧 wal/shm
 * 12. 最终数据库验证 (final 阶段)，任一步骤失败全回滚并清理暂存
 */
export async function restoreOffline(options: RestoreOfflineOptions): Promise<RestoreOfflineResult> {
  if (options.offlineConfirmed !== true) {
    throw new Error('OFFLINE_NOT_CONFIRMED: restoreOffline 仅支持停服恢复。必须显式确认 offlineConfirmed: true。');
  }

  if (!options.sourceDir || typeof options.sourceDir !== 'string') {
    throw new Error('INVALID_SOURCE_DIR: 必须指定备份来源目录 sourceDir');
  }
  if (!options.dataDir || typeof options.dataDir !== 'string') {
    throw new Error('INVALID_DATA_DIR: 必须指定数据目标目录 dataDir');
  }

  const resolvedSource = path.resolve(options.sourceDir);
  const resolvedDataDir = path.resolve(options.dataDir);

  if (!fs.existsSync(resolvedSource) || !fs.statSync(resolvedSource).isDirectory()) {
    throw new Error(`INVALID_SOURCE_DIR: 备份来源目录不存在或非目录: ${resolvedSource}`);
  }

  const sourceDbFile = path.join(resolvedSource, 'potato.db');
  if (!fs.existsSync(sourceDbFile)) {
    throw new Error(`MISSING_SOURCE_DB: 备份来源缺少 potato.db: ${resolvedSource}`);
  }

  // 确保目标数据目录存在（Docker 挂载目录保持不变）
  if (!fs.existsSync(resolvedDataDir)) {
    fs.mkdirSync(resolvedDataDir, { recursive: true, mode: 0o700 });
  }

  // 1. 取得数据目录独占维护锁 (POSIX fcntl.flock)
  const lock = await acquireDataDirectoryLock(resolvedDataDir, 'exclusive');
  let stagingDirToClean: string | null = null;

  try {
    const targetDbFile = path.join(resolvedDataDir, 'potato.db');
    if (fs.existsSync(targetDbFile)) {
      try {
        const probeDb = new Database(targetDbFile, { timeout: 100 });
        try {
          probeDb.pragma('busy_timeout = 100');
          probeDb.exec('BEGIN EXCLUSIVE; ROLLBACK;');
        } finally {
          probeDb.close();
        }
      } catch (err: any) {
        if (err?.code === 'SQLITE_BUSY' || (err?.message && (err.message.includes('locked') || err.message.includes('busy')))) {
          throw new Error(`DATABASE_LOCKED: 目标数据库 ${targetDbFile} 正在被其他服务进程独占或活跃占用。必须停止所有服务后方可恢复。`);
        }
      }
    }

    // 2. 严格核验 manifest.json
    const manifestPath = path.join(resolvedSource, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`MISSING_MANIFEST: 备份来源缺少 manifest.json: ${resolvedSource}`);
    }

    let manifest: any;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (err: any) {
      throw new Error(`INVALID_MANIFEST: 备份清单 manifest.json 格式损坏不是有效 JSON: ${err.message}`);
    }

    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      throw new Error('INVALID_MANIFEST: 备份清单 manifest.json 必须为 JSON 对象');
    }

    if (manifest.schemaVersion !== 3) {
      throw new Error(`UNSUPPORTED_SCHEMA_VERSION: 不支持的备份 schemaVersion: ${manifest.schemaVersion}，仅支持版本 3`);
    }

    if (!manifest.database || typeof manifest.database !== 'object') {
      throw new Error('INVALID_MANIFEST: manifest.json 缺少 database 配置对象');
    }

    if (!manifest.database.filename || typeof manifest.database.filename !== 'string') {
      throw new Error('INVALID_MANIFEST: manifest.json 缺少 database.filename');
    }

    if (!manifest.database.sha256 || typeof manifest.database.sha256 !== 'string') {
      throw new Error('INVALID_MANIFEST: manifest.json 缺少 database.sha256');
    }

    if (typeof manifest.database.byteSize !== 'number' || !Number.isFinite(manifest.database.byteSize) || manifest.database.byteSize <= 0) {
      throw new Error('INVALID_MANIFEST: manifest.json 缺少合法的 database.byteSize');
    }

    if (manifest.attachments !== undefined && !Array.isArray(manifest.attachments)) {
      throw new Error('INVALID_MANIFEST: manifest.attachments 必须为数组');
    }

    const srcDbStat = fs.statSync(sourceDbFile);
    if (srcDbStat.size !== manifest.database.byteSize) {
      throw new Error(`SOURCE_DB_SIZE_MISMATCH: 备份数据库文件大小不匹配! 期望: ${manifest.database.byteSize}, 实际: ${srcDbStat.size}`);
    }

    const srcDbBuf = fs.readFileSync(sourceDbFile);
    const computedHash = crypto.createHash('sha256').update(srcDbBuf).digest('hex');
    if (computedHash !== manifest.database.sha256) {
      throw new Error(`SOURCE_DB_HASH_MISMATCH: 备份数据库校验和不匹配! 期望: ${manifest.database.sha256}, 计算: ${computedHash}`);
    }

    // 3. 源数据库 Schema、外键、工作区与媒体引用全量校验 (source 阶段)
    const sourceDb = new Database(sourceDbFile, { readonly: true });
    let requiredMedia: MediaRecordRow[] = [];
    try {
      requiredMedia = validateRestoreDatabase(sourceDb, 'source');
    } finally {
      sourceDb.close();
    }

    // 4. 源备份附件完整性核验
    const srcAttDir = path.join(resolvedSource, 'attachments');
    for (const item of requiredMedia) {
      const attFile = path.join(srcAttDir, item.filename);
      if (!fs.existsSync(attFile)) {
        throw new Error(`恢复校验失败: 数据库引用的媒体文件在备份中缺失: ${item.filename} (ID: ${item.id})`);
      }

      const stat = fs.statSync(attFile);
      if (item.byte_size > 0 && stat.size !== item.byte_size) {
        throw new Error(`恢复校验失败: 附件大小不匹配: ${item.filename} (期望: ${item.byte_size}, 实际: ${stat.size})`);
      }

      if (item.sha256) {
        const hash = computeFileSha256(attFile);
        if (hash !== item.sha256) {
          throw new Error(`恢复校验失败: 附件校验和不匹配: ${item.filename} (期望: ${item.sha256}, 实际: ${hash})`);
        }
      }
    }

    if (Array.isArray(manifest.attachments)) {
      for (const att of manifest.attachments) {
        if (att && typeof att.filename === 'string') {
          const safeName = path.basename(att.filename);
          if (safeName !== att.filename || att.filename.includes('..') || path.isAbsolute(att.filename)) {
            throw new Error(`SECURITY_PATH_TRAVERSAL_DETECTED: 清单附件文件名非法: ${att.filename}`);
          }
          const mFile = path.join(srcAttDir, att.filename);
          if (!fs.existsSync(mFile)) {
            throw new Error(`MISSING_MANIFEST_ATTACHMENT: 清单声明的附件在备份中缺失: ${att.filename}`);
          }
          if (typeof att.byteSize === 'number' && att.byteSize > 0) {
            const stat = fs.statSync(mFile);
            if (stat.size !== att.byteSize) {
              throw new Error(`MANIFEST_ATTACHMENT_SIZE_MISMATCH: 清单附件大小不匹配: ${att.filename} (期望: ${att.byteSize}, 实际: ${stat.size})`);
            }
          }
          if (typeof att.sha256 === 'string' && att.sha256) {
            const hash = computeFileSha256(mFile);
            if (hash !== att.sha256) {
              throw new Error(`MANIFEST_ATTACHMENT_HASH_MISMATCH: 清单附件校验和不匹配: ${att.filename} (期望: ${att.sha256}, 实际: ${hash})`);
            }
          }
        }
      }
    }

    // 5. 在同一文件系统内建立隔离暂存区（dataDir 下 .restore_staging_...）
    const stagingDir = path.join(resolvedDataDir, `.restore_staging_${Date.now()}_${process.pid}_${crypto.randomBytes(4).toString('hex')}`);
    stagingDirToClean = stagingDir;
    fs.mkdirSync(stagingDir, { recursive: true, mode: 0o700 });
    const stagingDbFile = path.join(stagingDir, 'potato.db');
    fs.copyFileSync(sourceDbFile, stagingDbFile);

    const stagingAttDir = path.join(stagingDir, 'attachments');
    fs.mkdirSync(stagingAttDir, { recursive: true, mode: 0o700 });
    for (const item of requiredMedia) {
      const srcFile = path.join(resolvedSource, 'attachments', item.filename);
      const destFile = path.join(stagingAttDir, item.filename);
      fs.copyFileSync(srcFile, destFile);
    }

    // 6. 在暂存区执行安全补列迁移、代际轮换与会话撤销，再对暂存数据库校验 (staging 阶段)
    const stagingDb = new Database(stagingDbFile);
    let nextGenId: string;
    try {
      // 显式补列迁移（仅在 staging 针对旧受支持 Schema 3 执行，不改动 source/live）
      const wsCols = (stagingDb.pragma('table_info(workspaces)') as Array<{ name: string }>).map(c => c.name);
      if (!wsCols.includes('seed_version')) {
        stagingDb.exec('ALTER TABLE workspaces ADD COLUMN seed_version INTEGER NOT NULL DEFAULT 0');
      }
      if (!wsCols.includes('init_choice')) {
        stagingDb.exec('ALTER TABLE workspaces ADD COLUMN init_choice TEXT');
      }

      nextGenId = `gen_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
      stagingDb.prepare("INSERT OR REPLACE INTO server_meta (key, value) VALUES ('generation_id', ?)").run(nextGenId);
      stagingDb.prepare("UPDATE workspaces SET generation_id = ?").run(nextGenId);
      stagingDb.prepare("DELETE FROM sessions").run();
      stagingDb.pragma('wal_checkpoint(TRUNCATE)');

      // 暂存库应用 Schema 全量校验
      validateRestoreDatabase(stagingDb, 'staging');
    } finally {
      stagingDb.close();
    }

    // 清理暂存区残留空 wal/shm
    try { fs.unlinkSync(stagingDbFile + '-wal'); } catch {}
    try { fs.unlinkSync(stagingDbFile + '-shm'); } catch {}

    // 暂存区附件逐项核验
    for (const item of requiredMedia) {
      const stagingFile = path.join(stagingAttDir, item.filename);
      if (!fs.existsSync(stagingFile)) {
        throw new Error(`恢复校验失败: 数据库引用的媒体文件在暂存区缺失: ${item.filename}`);
      }
      const stat = fs.statSync(stagingFile);
      if (item.byte_size > 0 && stat.size !== item.byte_size) {
        throw new Error(`恢复校验失败: 暂存区附件大小不匹配: ${item.filename}`);
      }
      if (item.sha256) {
        const hash = computeFileSha256(stagingFile);
        if (hash !== item.sha256) {
          throw new Error(`恢复校验失败: 暂存区附件校验和不匹配: ${item.filename}`);
        }
      }
    }

    // 7. 切换前必须保存可验证旧库安全副本；损坏现场只能标记为现场副本
    let safetyBackupDir: string | undefined;
    let corruptBackupDir: string | undefined;

    if (!options.skipPreBackup && fs.existsSync(targetDbFile)) {
      let isTargetHealthy = false;
      let targetSize = 0;
      let targetHash = '';
      try {
        const buf = fs.readFileSync(targetDbFile);
        targetSize = buf.length;
        targetHash = crypto.createHash('sha256').update(buf).digest('hex');
        const testDb = new Database(targetDbFile, { readonly: true, timeout: 500 });
        const check = testDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
        if (check && check[0]?.integrity_check === 'ok') {
          isTargetHealthy = true;
        }
        testDb.close();
      } catch {
        isTargetHealthy = false;
      }

      const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 15);
      const backupsBase = path.join(resolvedDataDir, 'backups');
      fs.mkdirSync(backupsBase, { recursive: true, mode: 0o700 });

      if (isTargetHealthy) {
        safetyBackupDir = path.join(backupsBase, `pre_restore_safety_${timestamp}`);
        fs.mkdirSync(safetyBackupDir, { recursive: true, mode: 0o700 });
        const safetyDbFile = path.join(safetyBackupDir, 'potato.db');
        fs.copyFileSync(targetDbFile, safetyDbFile);

        if (fs.existsSync(targetDbFile + '-wal')) {
          fs.copyFileSync(targetDbFile + '-wal', path.join(safetyBackupDir, 'potato.db-wal'));
        }
        if (fs.existsSync(targetDbFile + '-shm')) {
          fs.copyFileSync(targetDbFile + '-shm', path.join(safetyBackupDir, 'potato.db-shm'));
        }

        const targetAttDir = path.join(resolvedDataDir, 'attachments');
        if (fs.existsSync(targetAttDir)) {
          const safetyAttDir = path.join(safetyBackupDir, 'attachments');
          fs.mkdirSync(safetyAttDir, { recursive: true, mode: 0o700 });
          for (const file of fs.readdirSync(targetAttDir)) {
            const src = path.join(targetAttDir, file);
            if (fs.statSync(src).isFile()) {
              fs.copyFileSync(src, path.join(safetyAttDir, file));
            }
          }
        }

        // 校验安全快照的完整性与哈希一致性
        const copiedBuf = fs.readFileSync(safetyDbFile);
        const copiedHash = crypto.createHash('sha256').update(copiedBuf).digest('hex');
        if (copiedHash !== targetHash || copiedBuf.length !== targetSize) {
          throw new Error('SAFETY_BACKUP_VERIFICATION_FAILED: 安全快照复制校验和不一致');
        }
        const verifySafetyDb = new Database(safetyDbFile, { readonly: true });
        const safetyCheck = verifySafetyDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
        verifySafetyDb.close();
        if (!safetyCheck || safetyCheck[0]?.integrity_check !== 'ok') {
          throw new Error('SAFETY_BACKUP_INTEGRITY_FAILED: 安全快照数据库完整性校验失败');
        }
      } else {
        corruptBackupDir = path.join(backupsBase, `pre_restore_corrupt_${timestamp}`);
        fs.mkdirSync(corruptBackupDir, { recursive: true, mode: 0o700 });
        fs.copyFileSync(targetDbFile, path.join(corruptBackupDir, 'potato.db'));
        if (fs.existsSync(targetDbFile + '-wal')) {
          fs.copyFileSync(targetDbFile + '-wal', path.join(corruptBackupDir, 'potato.db-wal'));
        }
        if (fs.existsSync(targetDbFile + '-shm')) {
          fs.copyFileSync(targetDbFile + '-shm', path.join(corruptBackupDir, 'potato.db-shm'));
        }
        fs.writeFileSync(path.join(corruptBackupDir, 'manifest.json'), JSON.stringify({
          recordedAt: new Date().toISOString(),
          type: 'corrupt_scene_preservation',
          note: '旧数据库在恢复前已处于损坏状态，仅作为现场副本标记留存，不视为可验证安全快照',
        }, null, 2));
      }
    }

    // 8. 先将已校验附件安全就位，再次确认暂存库引用均可读取；同名不同内容直接拒绝；旧无关附件不清理
    const targetAttDir = path.join(resolvedDataDir, 'attachments');
    if (!fs.existsSync(targetAttDir)) {
      fs.mkdirSync(targetAttDir, { recursive: true, mode: 0o700 });
    }

    for (const item of requiredMedia) {
      const targetFile = path.join(targetAttDir, item.filename);
      if (fs.existsSync(targetFile)) {
        const existingHash = computeFileSha256(targetFile);
        if (existingHash !== item.sha256) {
          throw new Error(`ATTACHMENT_CONFLICT: 目标附件已存在但内容不符: ${item.filename} (已有哈希: ${existingHash}, 预期: ${item.sha256})。直接拒绝恢复。`);
        }
      } else {
        const stagingFile = path.join(stagingAttDir, item.filename);
        const tmpTarget = path.join(targetAttDir, `.${item.filename}.tmp_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`);
        fs.copyFileSync(stagingFile, tmpTarget);
        fs.renameSync(tmpTarget, targetFile);
      }
    }

    // 再次确认暂存库所有引用在目标附件目录中均可安全读取且哈希一致
    for (const item of requiredMedia) {
      const targetFile = path.join(targetAttDir, item.filename);
      if (!fs.existsSync(targetFile)) {
        throw new Error(`ATTACHMENT_MISSING_AFTER_PLACEMENT: 附件就位后无法读取: ${item.filename}`);
      }
      const stat = fs.statSync(targetFile);
      if (stat.size !== item.byte_size) {
        throw new Error(`ATTACHMENT_SIZE_MISMATCH: 目标附件大小不匹配: ${item.filename}`);
      }
      const hash = computeFileSha256(targetFile);
      if (hash !== item.sha256) {
        throw new Error(`ATTACHMENT_HASH_MISMATCH: 目标附件哈希不匹配: ${item.filename}`);
      }
    }

    // 9. 恢复提交点：最后原子替换主数据库 (fs.renameSync) 并安全清理旧 wal/shm
    fs.renameSync(stagingDbFile, targetDbFile);

    // 清理旧目标 WAL/SHM，确保新主库不受旧 WAL 干扰
    try { fs.unlinkSync(targetDbFile + '-wal'); } catch {}
    try { fs.unlinkSync(targetDbFile + '-shm'); } catch {}

    // 清理暂存目录
    try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch {}
    stagingDirToClean = null;

    // 10. 最终数据库验证 (final 阶段)
    const finalDb = new Database(targetDbFile, { readonly: true });
    try {
      validateRestoreDatabase(finalDb, 'final');
    } finally {
      finalDb.close();
    }

    return {
      ok: true,
      generationId: nextGenId,
      databasePath: targetDbFile,
      attachmentsRestored: requiredMedia.length,
      safetyBackupDir,
      corruptBackupDir,
    };
  } finally {
    if (stagingDirToClean && fs.existsSync(stagingDirToClean)) {
      try { fs.rmSync(stagingDirToClean, { recursive: true, force: true }); } catch {}
    }
    await lock.release();
  }
}
