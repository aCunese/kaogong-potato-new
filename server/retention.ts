/**
 * 服务端数据保留与配额策略 (R18 / 工作区历史与幂等记录有界化)
 *
 * 背景（只读审查 R18）：
 * - 原实现每次同步都把上一次的整份工作区快照永久写入 workspace_history，既无行数上限也无字节上限，
 *   受邀账号可连续提交大 payload 无界耗尽共享数据库磁盘。
 * - sync_idempotency 同一请求幂等表同理无清理策略。
 *
 * 本模块只提供"新写入时惰性裁剪"的策略函数：
 *   - 仅在发生新的历史写入 / 幂等写入时调用，不会在服务启动或后台定时任务中批量删除真实生产数据；
 *   - 本任务没有对真实 data/ 目录执行任何离线清理操作（证据见 docs/implementation/evidence/server-contracts.md）。
 *
 * 明确的保留窗口（可审计常量）：
 *   - 工作区历史：最近 7 天内的快照全部保留（灾难恢复窗口，不裁剪）；
 *     超过 7 天的旧快照才允许裁剪，裁剪目标是"整账号历史 ≤ 30 行 且 state_json 总量 ≤ 8 MiB"。
 *   - 同步幂等记录：仅保留最近 30 天、且每账号最多 200 行。
 */
import type { Database as DatabaseType } from 'better-sqlite3';
import { getDb } from './db';

/** 工作区历史最多保留的行数（含 7 天窗口内的行；超过 7 天的行才会被删除） */
export const WORKSPACE_HISTORY_KEEP_ROWS = 30;
/** 每账号工作区历史 state_json 总字节上限（8 MiB；超过 7 天的行才会被删除） */
export const WORKSPACE_HISTORY_MAX_BYTES = 8 * 1024 * 1024;
/** 灾难恢复窗口：最近 7 天的历史快照无条件保留 */
export const WORKSPACE_HISTORY_RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** 每账号同步幂等记录最多保留行数 */
export const SYNC_IDEMPOTENCY_MAX_ROWS = 200;
/** 同步幂等记录最长保留时间（30 天） */
export const SYNC_IDEMPOTENCY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface RetentionPolicy {
  workspaceHistory: {
    keepRows: number;
    maxBytes: number;
    recentWindowMs: number;
    pruneOnlyOlderThanWindow: true;
  };
  syncIdempotency: {
    maxRows: number;
    ttlMs: number;
  };
}

/** 供接口/证据文档/tests 读取的机器可读策略快照 */
export function getRetentionPolicy(): RetentionPolicy {
  return {
    workspaceHistory: {
      keepRows: WORKSPACE_HISTORY_KEEP_ROWS,
      maxBytes: WORKSPACE_HISTORY_MAX_BYTES,
      recentWindowMs: WORKSPACE_HISTORY_RECENT_WINDOW_MS,
      pruneOnlyOlderThanWindow: true,
    },
    syncIdempotency: {
      maxRows: SYNC_IDEMPOTENCY_MAX_ROWS,
      ttlMs: SYNC_IDEMPOTENCY_TTL_MS,
    },
  };
}

export interface HistoryRetentionResult {
  /** 被裁剪的历史行数 */
  deletedRows: number;
  /** 裁剪后该账号保留下来的历史行数 */
  retainedRows: number;
  /** 裁剪后该账号保留下来的历史 state_json 总字节数 */
  retainedBytes: number;
  /** 7 天恢复窗口内无条件保留的行数 */
  protectedRecentRows: number;
}

/**
 * 对单个账号的工作区历史执行有界裁剪。
 * 必须在调用方已开启的写事务内（同步 / 初始化选择 / 恢复）执行，避免裁剪与写入交错。
 * 只删除 `created_at` 早于 7 天恢复窗口的行；窗口内快照永不删除。
 */
export function pruneWorkspaceHistory(
  userId: string,
  now: Date = new Date(),
  db: DatabaseType = getDb()
): HistoryRetentionResult {
  const cutoffIso = new Date(now.getTime() - WORKSPACE_HISTORY_RECENT_WINDOW_MS).toISOString();

  const recent = db.prepare(`
    SELECT COUNT(*) as cnt, COALESCE(SUM(LENGTH(CAST(state_json AS BLOB))), 0) as bytes
    FROM workspace_history
    WHERE user_id = ? AND created_at >= ?
  `).get(userId, cutoffIso) as { cnt: number; bytes: number };

  const oldRows = db.prepare(`
    SELECT id, LENGTH(CAST(state_json AS BLOB)) as bytes
    FROM workspace_history
    WHERE user_id = ? AND created_at < ?
    ORDER BY created_at DESC, rowid DESC
  `).all(userId, cutoffIso) as Array<{ id: string; bytes: number }>;

  let keptOldRows = 0;
  let keptOldBytes = 0;
  const toDelete: string[] = [];

  for (const row of oldRows) {
    const rowsIfKept = recent.cnt + keptOldRows + 1;
    const bytesIfKept = recent.bytes + keptOldBytes + row.bytes;
    if (rowsIfKept <= WORKSPACE_HISTORY_KEEP_ROWS && bytesIfKept <= WORKSPACE_HISTORY_MAX_BYTES) {
      keptOldRows += 1;
      keptOldBytes += row.bytes;
    } else {
      toDelete.push(row.id);
    }
  }

  if (toDelete.length > 0) {
    const del = db.prepare('DELETE FROM workspace_history WHERE id = ? AND user_id = ?');
    for (const id of toDelete) {
      del.run(id, userId);
    }
  }

  return {
    deletedRows: toDelete.length,
    retainedRows: recent.cnt + keptOldRows,
    retainedBytes: recent.bytes + keptOldBytes,
    protectedRecentRows: recent.cnt,
  };
}

/**
 * 对单个账号的同步幂等记录执行有界裁剪：
 * 1. 删除超过 30 天 TTL 的记录；
 * 2. 仅保留最近 SYNC_IDEMPOTENCY_MAX_ROWS 行。
 * 必须在同步写事务内调用。
 */
export function pruneSyncIdempotency(
  userId: string,
  now: Date = new Date(),
  db: DatabaseType = getDb()
): { deletedRows: number; retainedRows: number } {
  const cutoffIso = new Date(now.getTime() - SYNC_IDEMPOTENCY_TTL_MS).toISOString();

  const ttlDeleted = db.prepare(`
    DELETE FROM sync_idempotency WHERE user_id = ? AND created_at < ?
  `).run(userId, cutoffIso);

  const overflowDeleted = db.prepare(`
    DELETE FROM sync_idempotency
    WHERE rowid IN (
      SELECT rowid FROM sync_idempotency
      WHERE user_id = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT -1 OFFSET ?
    )
  `).run(userId, SYNC_IDEMPOTENCY_MAX_ROWS);

  const retained = db.prepare(`
    SELECT COUNT(*) as cnt FROM sync_idempotency WHERE user_id = ?
  `).get(userId) as { cnt: number };

  return {
    deletedRows: ttlDeleted.changes + overflowDeleted.changes,
    retainedRows: retained.cnt,
  };
}
