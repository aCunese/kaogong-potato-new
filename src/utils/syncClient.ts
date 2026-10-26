import { AppState, OutboxRecord, SnapshotRecord } from '../types';
import {
  getPendingOutbox,
  deleteOutboxItem,
  commitMutation,
  getSnapshotKey,
  loadLatestState,
  atomicResolveConflict,
  saveActiveGenerationId,
  getActiveGenerationId,
} from './db';

export interface SyncResult {
  ok: boolean;
  status: 'synced' | 'conflict' | 'failed' | 'offline';
  code?: string;
  serverRevision?: number;
  serverState?: AppState | null;
  serverGenerationId?: string;
  message?: string;
}

/**
 * Normal bidirectional sync flusher:
 * - If outbox has items: pushes each sequentially with generation guard.
 *   On 409 (REVISION_CONFLICT or GENERATION_MISMATCH): pauses and returns conflict for UI resolution.
 * - If outbox is empty: checks remote workspace; if remote revision > local, fast-forwards.
 */
export async function syncOutboxWithServer(
  userId: string,
  csrfToken: string
): Promise<SyncResult> {
  if (!navigator.onLine) {
    return { ok: false, status: 'offline', message: '当前处于离线状态，修改已安全保存在本机' };
  }

  const items = await getPendingOutbox(userId);
  if (items.length === 0) {
    // No local pending outbox, pull latest from server
    return await pullLatestFromServer(userId);
  }

  // Sort outbox items by createdAt ascending
  items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // Ensure we have a valid generationId
  let activeGen = getActiveGenerationId(userId);

  for (const item of items) {
    const generationToSend = item.generationId || activeGen;
    try {
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          expectedRevision: item.expectedRevision,
          requestId: item.requestId,
          schemaVersion: 3,
          generationId: generationToSend,
          state: item.state,
          reason: item.reason || 'sync',
        }),
      });

      if (response.status === 409) {
        const errorJson = await response.json();
        if (errorJson.generationId) {
          saveActiveGenerationId(userId, errorJson.generationId);
        }
        return {
          ok: false,
          status: 'conflict',
          code: errorJson.code || 'REVISION_CONFLICT',
          serverRevision: errorJson.serverRevision,
          serverState: errorJson.serverState,
          serverGenerationId: errorJson.generationId,
          message: errorJson.message || '检测到云端有更新的版本或发生代际轮换，存在冲突',
        };
      }

      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}));
        return {
          ok: false,
          status: 'failed',
          code: errorJson.code || 'SYNC_ERROR',
          message: errorJson.message || `同步失败 (HTTP ${response.status})`,
        };
      }

      const successJson = await response.json();
      if (successJson.generationId) {
        saveActiveGenerationId(userId, successJson.generationId);
      }
      // Safely delete verified task from outbox
      await deleteOutboxItem(item.id);
    } catch (err) {
      return {
        ok: false,
        status: 'failed',
        message: err instanceof Error ? err.message : '网络通信异常，待下次联网重试',
      };
    }
  }

  return { ok: true, status: 'synced', message: '全部学情已与云端同步' };
}

/** Alias for clear semantic invocation */
export const syncNormal = syncOutboxWithServer;

/**
 * Checks server for remote updates without pushing local outbox.
 * Guarantees local edits are not overwritten if local has pending changes (Defect B).
 */
export async function pullLatestFromServer(userId: string): Promise<SyncResult> {
  if (!navigator.onLine) {
    return { ok: false, status: 'offline', message: '网络未连接' };
  }

  try {
    const res = await fetch('/api/workspace');
    if (!res.ok) {
      return { ok: false, status: 'failed', message: `获取云端数据失败 (HTTP ${res.status})` };
    }
    const data = await res.json();
    if (data.generationId) {
      saveActiveGenerationId(userId, data.generationId);
    }

    if (!data.hasCloudData || !data.state) {
      return { ok: true, status: 'synced', message: '云端暂无数据' };
    }

    const pendingOutbox = await getPendingOutbox(userId);
    const local = await loadLatestState(userId);

    // If local has pending outbox and server has different data, do NOT overwrite; enter conflict (Defect B)
    if (pendingOutbox.length > 0 && local.revision !== data.revision) {
      return {
        ok: false,
        status: 'conflict',
        code: 'REVISION_CONFLICT',
        serverRevision: data.revision,
        serverState: data.state,
        serverGenerationId: data.generationId,
        message: '本机有未同步的修改，云端版本存在差异，请选择保留本地或采用云端。',
      };
    }

    // If local has no pending outbox and local revision < server revision, fast-forward local state
    if (local.revision < data.revision) {
      const commitRes = await commitMutation<void>(
        () => ({ nextState: data.state, value: undefined }),
        { userId, targetRevision: data.revision }
      );
      if (!commitRes.ok) {
        return {
          ok: false,
          status: 'failed',
          message: commitRes.message || '更新本地数据失败',
        };
      }
    }

    return {
      ok: true,
      status: 'synced',
      serverRevision: data.revision,
      serverState: data.state,
      serverGenerationId: data.generationId,
      message: '云端最新数据已同步至本机',
    };
  } catch (err) {
    return {
      ok: false,
      status: 'failed',
      message: err instanceof Error ? err.message : '检查云端数据异常',
    };
  }
}

/**
 * Force Pull Remote:
 * User explicitly chooses "Keep Remote / 采用云端".
 * Protects against concurrent edits made while transit dialog was open (Defect B).
 * Atomically replaces local snapshot and wipes stale outbox (Defect G).
 */
export async function forcePullRemote(
  userId: string,
  targetServerState: AppState,
  targetServerRevision: number,
  expectedLocalRevision: number
): Promise<SyncResult> {
  try {
    const key = getSnapshotKey(userId);
    const newSnapshot: SnapshotRecord = {
      key,
      state: targetServerState,
      version: 3,
      revision: targetServerRevision,
      migratedFromV2: true,
      updatedAt: new Date().toISOString(),
    };

    // Atomically inside single transaction: check expectedLocalRevision, wipe outbox, put snapshot
    await atomicResolveConflict(userId, newSnapshot, expectedLocalRevision);

    return {
      ok: true,
      status: 'synced',
      serverRevision: targetServerRevision,
      serverState: targetServerState,
      message: '已成功采用云端存档覆盖本机数据',
    };
  } catch (err) {
    return {
      ok: false,
      status: 'failed',
      message: err instanceof Error ? err.message : '采用云端数据失败',
    };
  }
}

/**
 * Force Upload Local:
 * User explicitly chooses "Keep Local / 保留本地".
 * Atomically updates local snapshot to serverRevision + 1, enqueues forced sync outbox,
 * and pushes to server (Defect A, G, I).
 */
export async function forceUploadLocal(
  userId: string,
  csrfToken: string,
  targetServerRevision: number,
  expectedLocalRevision: number
): Promise<SyncResult> {
  if (!navigator.onLine) {
    return { ok: false, status: 'offline', message: '当前离线，无法上传覆盖云端' };
  }

  try {
    // 1. Fetch latest server generation ID first
    let currentGen = getActiveGenerationId(userId);
    const getRes = await fetch('/api/workspace');
    if (getRes.ok) {
      const gd = await getRes.json();
      if (gd.generationId) {
        currentGen = gd.generationId;
        saveActiveGenerationId(userId, currentGen);
      }
    }

    const local = await loadLatestState(userId);
    const nextRevision = targetServerRevision + 1;
    const key = getSnapshotKey(userId);

    const forcedSnapshot: SnapshotRecord = {
      key,
      state: local.state,
      version: 3,
      revision: nextRevision,
      migratedFromV2: true,
      updatedAt: new Date().toISOString(),
    };

    const newOutboxItem: OutboxRecord = {
      id: `outbox_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      userId,
      requestId: `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      state: local.state,
      expectedRevision: targetServerRevision,
      generationId: currentGen,
      createdAt: new Date().toISOString(),
      status: 'pending',
      reason: 'force_local_override',
    };

    // Atomically wipe outdated conflict outbox and install new forced outbox task (Defect G)
    await atomicResolveConflict(userId, forcedSnapshot, expectedLocalRevision, newOutboxItem);

    // Push the forced outbox task immediately
    return await syncOutboxWithServer(userId, csrfToken);
  } catch (err) {
    return {
      ok: false,
      status: 'failed',
      message: err instanceof Error ? err.message : '保留本地并上传云端失败',
    };
  }
}
