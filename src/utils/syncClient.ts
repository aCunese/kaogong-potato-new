import { AppState, OutboxRecord, SyncState } from '../types';
import { getPendingOutbox, deleteOutboxItem, commitMutation, getSnapshotKey, loadLatestState } from './db';

export interface SyncResult {
  ok: boolean;
  status: 'synced' | 'conflict' | 'failed' | 'offline';
  serverRevision?: number;
  serverState?: AppState | null;
  message?: string;
}

export async function syncOutboxWithServer(
  userId: string,
  csrfToken: string
): Promise<SyncResult> {
  if (!navigator.onLine) {
    return { ok: false, status: 'offline', message: '当前处于离线状态，修改已安全保存在本机' };
  }

  const items = await getPendingOutbox(userId);
  if (items.length === 0) {
    // No outbox, check if server has updates
    return await pullLatestFromServer(userId);
  }

  // Sort by createdAt ascending
  items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const item of items) {
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
          generationId: item.generationId,
          state: item.state,
          reason: item.reason || 'sync',
        }),
      });

      if (response.status === 409) {
        const errorJson = await response.json();
        return {
          ok: false,
          status: 'conflict',
          serverRevision: errorJson.serverRevision,
          serverState: errorJson.serverState,
          message: errorJson.message || '检测到云端有更新的版本，存在冲突',
        };
      }

      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}));
        return {
          ok: false,
          status: 'failed',
          message: errorJson.message || `同步失败 (HTTP ${response.status})`,
        };
      }

      const successJson = await response.json();
      // On success, safely remove this task from outbox
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
    if (!data.hasCloudData || !data.state) {
      // Server is empty
      return { ok: true, status: 'synced', message: '云端暂无数据' };
    }

    const local = await loadLatestState(userId);
    // If local has no pending outbox and local revision < server revision, fast-forward local state
    if (local.revision < data.revision) {
      await commitMutation<void>(draft => {
        return {
          nextState: data.state,
          value: undefined,
        };
      }, { userId, targetRevision: data.revision });
    }

    return {
      ok: true,
      status: 'synced',
      serverRevision: data.revision,
      serverState: data.state,
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
