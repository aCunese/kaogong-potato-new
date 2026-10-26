import crypto from 'node:crypto';
import { getDb, getCurrentGenerationId } from './db';
import { AppState } from '../src/types';

export interface WorkspaceRow {
  user_id: string;
  revision: number;
  generation_id: string;
  state_json: string;
  schema_version: number;
  updated_at: string;
}

export interface WorkspaceGetResponse {
  ok: boolean;
  hasCloudData: boolean;
  revision: number;
  generationId: string;
  schemaVersion: number;
  updatedAt?: string;
  state: AppState | null;
}

export function getUserWorkspace(userId: string): WorkspaceGetResponse {
  const db = getDb();
  const currentGen = getCurrentGenerationId();
  const row = db.prepare('SELECT * FROM workspaces WHERE user_id = ?').get(userId) as WorkspaceRow | undefined;

  if (!row) {
    return {
      ok: true,
      hasCloudData: false,
      revision: 0,
      generationId: currentGen,
      schemaVersion: 3,
      state: null,
    };
  }

  let parsedState: AppState | null = null;
  try {
    parsedState = JSON.parse(row.state_json);
  } catch (err) {
    console.error(`解析用户 ${userId} 云端工作区失败:`, err);
  }

  return {
    ok: true,
    hasCloudData: true,
    revision: row.revision,
    generationId: row.generation_id,
    schemaVersion: row.schema_version,
    updatedAt: row.updated_at,
    state: parsedState,
  };
}

export interface SyncPushInput {
  userId: string;
  expectedRevision: number;
  requestId: string;
  schemaVersion: number;
  generationId: string;
  state: AppState;
  reason?: string;
}

export interface SyncPushResult {
  ok: boolean;
  status: 200 | 400 | 409 | 500;
  code?: string;
  message?: string;
  revision?: number;
  updatedAt?: string;
  generationId?: string;
  serverRevision?: number;
  serverState?: AppState | null;
  idempotent?: boolean;
}

export function syncUserWorkspace(input: SyncPushInput): SyncPushResult {
  const db = getDb();
  const currentGen = getCurrentGenerationId();

  // 1. Check generation ID: if server underwent full disaster recovery and generation rotated, reject old client outbox
  if (input.generationId && input.generationId !== currentGen) {
    return {
      ok: false,
      status: 409,
      code: 'GENERATION_MISMATCH',
      message: '服务器已执行整机灾备恢复，代际已轮换。为防止覆盖灾备数据，请重新核对云端版本。',
      generationId: currentGen,
    };
  }

  const payloadString = JSON.stringify(input.state);
  const payloadSha = crypto.createHash('sha256').update(payloadString).digest('hex');

  // 2. Check Idempotency Table: (user_id, request_id)
  const existingIdempotency = db.prepare(`
    SELECT * FROM sync_idempotency WHERE user_id = ? AND request_id = ?
  `).get(input.userId, input.requestId) as {
    user_id: string;
    request_id: string;
    expected_revision: number;
    result_revision: number;
    payload_sha256: string;
    created_at: string;
  } | undefined;

  if (existingIdempotency) {
    if (existingIdempotency.payload_sha256 !== payloadSha) {
      return {
        ok: false,
        status: 400,
        code: 'DUPLICATE_REQUEST_ID_DIFFERENT_PAYLOAD',
        message: '相同的请求 ID 提交了不同的数据内容，已拒绝处理。',
      };
    }
    // Idempotent retry: return previously recorded revision
    return {
      ok: true,
      status: 200,
      revision: existingIdempotency.result_revision,
      updatedAt: existingIdempotency.created_at,
      idempotent: true,
    };
  }

  // 3. Execute revision check and workspace update inside a single SQLite transaction
  const executeTransaction = db.transaction(() => {
    const existing = db.prepare('SELECT * FROM workspaces WHERE user_id = ?').get(input.userId) as WorkspaceRow | undefined;
    const currentRevision = existing ? existing.revision : 0;

    // Check revision
    if (currentRevision !== input.expectedRevision) {
      let serverState: AppState | null = null;
      if (existing) {
        try { serverState = JSON.parse(existing.state_json); } catch {}
      }
      return {
        conflict: true,
        currentRevision,
        serverState,
      };
    }

    const nextRevision = currentRevision + 1;
    const nowIso = new Date().toISOString();

    // Preserve old version into history if there was an existing workspace
    if (existing) {
      const historyId = `hist_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
      db.prepare(`
        INSERT INTO workspace_history (id, user_id, revision, reason, state_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(historyId, input.userId, existing.revision, input.reason || 'sync', existing.state_json, nowIso);
    }

    // Write new workspace
    db.prepare(`
      INSERT INTO workspaces (user_id, revision, generation_id, state_json, schema_version, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        revision = excluded.revision,
        generation_id = excluded.generation_id,
        state_json = excluded.state_json,
        schema_version = excluded.schema_version,
        updated_at = excluded.updated_at
    `).run(input.userId, nextRevision, currentGen, payloadString, input.schemaVersion || 3, nowIso);

    // Record idempotency
    db.prepare(`
      INSERT INTO sync_idempotency (user_id, request_id, expected_revision, result_revision, payload_sha256, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(input.userId, input.requestId, input.expectedRevision, nextRevision, payloadSha, nowIso);

    return {
      conflict: false,
      nextRevision,
      updatedAt: nowIso,
    };
  });

  const txResult = executeTransaction();
  if (txResult.conflict) {
    return {
      ok: false,
      status: 409,
      code: 'REVISION_CONFLICT',
      message: `云端存在更新版本（云端修订号: ${txResult.currentRevision}，本地提交期待: ${input.expectedRevision}），请拉取或合并。`,
      serverRevision: txResult.currentRevision,
      serverState: txResult.serverState,
    };
  }

  return {
    ok: true,
    status: 200,
    revision: txResult.nextRevision,
    updatedAt: txResult.updatedAt,
    generationId: currentGen,
  };
}

export interface WorkspaceHistoryItem {
  id: string;
  revision: number;
  reason: string;
  created_at: string;
}

export function getUserWorkspaceHistory(userId: string): WorkspaceHistoryItem[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, revision, reason, created_at
    FROM workspace_history
    WHERE user_id = ?
    ORDER BY revision DESC
    LIMIT 30
  `).all(userId) as WorkspaceHistoryItem[];

  return rows;
}

export function getUserBackupExport(userId: string) {
  const current = getUserWorkspace(userId);
  if (!current) return null;

  return {
    version: 3,
    exportedAt: new Date().toISOString(),
    userId,
    revision: current.revision,
    generationId: current.generationId,
    state: current.state,
  };
}

export function restoreUserFromHistory(userId: string, historyId: string) {
  const db = getDb();
  const currentGen = getCurrentGenerationId();

  const historyRow = db.prepare(`
    SELECT * FROM workspace_history WHERE id = ? AND user_id = ?
  `).get(historyId, userId) as {
    id: string;
    user_id: string;
    revision: number;
    reason: string;
    state_json: string;
    created_at: string;
  } | undefined;

  if (!historyRow) {
    return { ok: false, status: 404, message: '历史快照不存在或无权访问' };
  }

  const tx = db.transaction(() => {
    const existing = db.prepare('SELECT * FROM workspaces WHERE user_id = ?').get(userId) as WorkspaceRow | undefined;
    const currentRevision = existing ? existing.revision : 0;
    const nextRevision = currentRevision + 1;
    const nowIso = new Date().toISOString();

    // Preserve the current state before replacing
    if (existing) {
      const currentHistoryId = `hist_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
      db.prepare(`
        INSERT INTO workspace_history (id, user_id, revision, reason, state_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(currentHistoryId, userId, existing.revision, `pre_restore_from_${historyRow.revision}`, existing.state_json, nowIso);
    }

    db.prepare(`
      INSERT INTO workspaces (user_id, revision, generation_id, state_json, schema_version, updated_at)
      VALUES (?, ?, ?, ?, 3, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        revision = excluded.revision,
        generation_id = excluded.generation_id,
        state_json = excluded.state_json,
        schema_version = excluded.schema_version,
        updated_at = excluded.updated_at
    `).run(userId, nextRevision, currentGen, historyRow.state_json, nowIso);

    return nextRevision;
  });

  const newRevision = tx();
  let parsedState: AppState | null = null;
  try {
    parsedState = JSON.parse(historyRow.state_json);
  } catch {}

  return {
    ok: true,
    status: 200,
    message: `已成功将个人工作区恢复至历史版本（原修订号: ${historyRow.revision}，新修订号: ${newRevision}）`,
    revision: newRevision,
    state: parsedState,
  };
}
