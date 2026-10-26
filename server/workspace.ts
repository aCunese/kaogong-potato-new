import crypto from 'node:crypto';
import { getDb, getCurrentGenerationId } from './db';
import { AppState } from '../src/types';

export interface WorkspaceRow {
  user_id: string;
  revision: number;
  generation_id: string;
  state_json: string;
  schema_version: number;
  seed_version?: number;
  updated_at: string;
}

export interface WorkspaceGetResponse {
  ok: boolean;
  hasCloudData: boolean;
  revision: number;
  generationId: string;
  snapshotGenerationId?: string;
  schemaVersion: number;
  seedVersion?: number;
  updatedAt?: string;
  state: AppState | null;
}

export function validateWorkspacePayload(state: any, schemaVersion: any): { valid: boolean; message?: string } {
  if (schemaVersion !== 3) {
    return { valid: false, message: `不支持的工作区 schema 版本: ${schemaVersion}，仅支持版本 3` };
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return { valid: false, message: '工作区 state 必须为有效 JSON 对象，不能为字符串、数组或空值' };
  }
  const requiredArrays = ['books', 'courses', 'library', 'plans', 'records', 'wrong', 'countdowns'];
  for (const field of requiredArrays) {
    if (!Array.isArray(state[field])) {
      return { valid: false, message: `工作区数据缺少必需的数组字段: ${field}` };
    }
    if (state[field].some((item: any) => item === null || item === undefined)) {
      return { valid: false, message: `工作区字段 ${field} 包含无效的空元素 (null/undefined)` };
    }
  }
  if (!state.profile || typeof state.profile !== 'object' || Array.isArray(state.profile)) {
    return { valid: false, message: '工作区缺少有效的 profile 个人信息配置' };
  }
  return { valid: true };
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
      snapshotGenerationId: currentGen,
      schemaVersion: 3,
      seedVersion: 0,
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
    generationId: currentGen,
    snapshotGenerationId: row.generation_id,
    schemaVersion: row.schema_version,
    seedVersion: row.seed_version || 0,
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

  // 1. Strict Schema & State Payload Validation (Defect J)
  const validation = validateWorkspacePayload(input.state, input.schemaVersion);
  if (!validation.valid) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_WORKSPACE_STATE',
      message: validation.message || '工作区数据格式校验未通过',
    };
  }

  // 2. Strict Generation ID Guard: Non-empty & must match current server generation (Defect I)
  if (!input.generationId || typeof input.generationId !== 'string' || input.generationId !== currentGen) {
    const existing = db.prepare('SELECT * FROM workspaces WHERE user_id = ?').get(input.userId) as WorkspaceRow | undefined;
    let serverState: AppState | null = null;
    if (existing) {
      try { serverState = JSON.parse(existing.state_json); } catch {}
    }
    return {
      ok: false,
      status: 409,
      code: 'GENERATION_MISMATCH',
      message: '服务器代际不匹配或发生过灾备恢复。为防止覆盖灾备数据，请重新核对云端版本。',
      generationId: currentGen,
      serverRevision: existing ? existing.revision : 0,
      serverState,
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
      INSERT INTO workspaces (user_id, revision, generation_id, state_json, schema_version, seed_version, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        revision = excluded.revision,
        generation_id = excluded.generation_id,
        state_json = excluded.state_json,
        schema_version = excluded.schema_version,
        seed_version = COALESCE(workspaces.seed_version, 0),
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
