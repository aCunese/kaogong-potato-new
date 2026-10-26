import { AppState, OutboxRecord, SnapshotRecord, SyncConflictRecord, LockScope, OperationScope } from '../types';
import {
  getUnresolvedLocalChanges,
  claimOutboxTask,
  releaseOutboxTask,
  compactOutboxForFlush,
  confirmOutboxPush,
  quarantineOutboxItem,
  getSyncBaseline,
  saveSyncBaseline,
  getConflictRecord,
  saveConflictRecord,
  clearConflictRecord,
  loadSnapshot,
  loadLatestState,
  hashState,
  installConfirmedServerState,
  saveActiveGenerationId,
  withUserLock,
  atomicResolveConflict,
  clearOutbox,
  saveDamagedCache,
  stableStateJson,
} from './db';
import { flushLegacyMedia } from './mediaSync';

export interface SyncResult {
  ok: boolean;
  status: 'synced' | 'conflict' | 'failed' | 'offline' | 'waiting';
  code?: string;
  waitingReason?: 'backoff' | 'lease';
  retryAt?: string;
  serverRevision?: number;
  serverState?: AppState | null;
  serverGenerationId?: string;
  serverContentHash?: string;
  message?: string;
  /** Requires the caller to re-validate the session/CSRF and retry once. */
  needsSessionRefresh?: boolean;
  /** Requires the caller to send the user back to the login screen. */
  needsRelogin?: boolean;
  /** Number of unresolved local modifications (queue + quarantine + conflict). */
  pendingCount?: number;
  /** Server-provided empty-library initialization state (R10). */
  needsInitChoice?: boolean;
  initChoice?: 'default' | 'blank' | null;
}

export interface ServerSnapshot {
  ok: boolean;
  status: number;
  code?: string;
  message?: string;
  hasCloudData: boolean;
  revision: number;
  generationId: string;
  snapshotGenerationId: string;
  contentHash: string;
  state: AppState | null;
  needsInitChoice: boolean;
  initChoice: 'default' | 'blank' | null;
  seedVersion: number;
}

/** Fetch the raw cloud workspace snapshot (single source of truth for CAS checks). */
export async function fetchServerSnapshot(userId?: string): Promise<ServerSnapshot> {
  try {
    const res = await fetch('/api/workspace', {
      cache: 'no-store',
      headers: userId ? { 'x-workspace-user': userId } : undefined,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        ok: false,
        status: res.status,
        code: body.code || (res.status === 401 ? 'SESSION_EXPIRED' : res.status === 403 ? 'CSRF_INVALID' : res.status === 409 ? (body.code || 'SESSION_ACCOUNT_MISMATCH') : 'PULL_FAILED'),
        message: body.message || `获取云端数据失败 (HTTP ${res.status})`,
        hasCloudData: false,
        revision: 0,
        generationId: '',
        snapshotGenerationId: '',
        contentHash: '',
        state: null,
        needsInitChoice: false,
        initChoice: null,
        seedVersion: 0,
      };
    }
    const data = await res.json();
    return {
      ok: true,
      status: 200,
      hasCloudData: Boolean(data.hasCloudData && data.state),
      revision: typeof data.revision === 'number' ? data.revision : 0,
      generationId: typeof data.generationId === 'string' ? data.generationId : '',
      snapshotGenerationId: typeof data.snapshotGenerationId === 'string' ? data.snapshotGenerationId : (typeof data.generationId === 'string' ? data.generationId : ''),
      contentHash: typeof data.contentHash === 'string' ? data.contentHash : '',
      state: (data.state as AppState) ?? null,
      needsInitChoice: Boolean(data.needsInitChoice),
      initChoice: data.initChoice === 'default' || data.initChoice === 'blank' ? data.initChoice : null,
      seedVersion: typeof data.seedVersion === 'number' ? data.seedVersion : 0,
    };
  } catch {
    return {
      ok: false,
      status: 0,
      code: 'NETWORK',
      message: '网络连接中断，已保留本机数据',
      hasCloudData: false,
      revision: 0,
      generationId: '',
      snapshotGenerationId: '',
      contentHash: '',
      state: null,
      needsInitChoice: false,
      initChoice: null,
      seedVersion: 0,
    };
  }
}

function failureFromStatus(status: number, code?: string, message?: string): SyncResult {
  if (status === 401 || code === 'SESSION_EXPIRED') {
    return { ok: false, status: 'failed', code: 'SESSION_EXPIRED', message: message || '登录状态已失效，请重新登录', needsRelogin: true };
  }
  if (status === 403 || code === 'CSRF_INVALID') {
    return { ok: false, status: 'failed', code: 'CSRF_INVALID', message: message || '安全令牌已过期，正在重新验证会话', needsSessionRefresh: true };
  }
  return { ok: false, status: 'failed', code: code || 'SYNC_ERROR', message: message || '同步暂未完成，正在自动重试' };
}

async function buildConflictResult(
  userId: string,
  server: ServerSnapshot,
  code: string,
  message: string
): Promise<SyncResult> {
  const conflict: SyncConflictRecord = {
    userId,
    code,
    message,
    serverRevision: server.revision,
    serverGenerationId: server.generationId,
    serverContentHash: server.contentHash,
    serverState: server.state,
    detectedAt: new Date().toISOString(),
  };
  await saveConflictRecord(conflict);
  if (server.generationId) saveActiveGenerationId(userId, server.generationId);
  return {
    ok: false,
    status: 'conflict',
    code,
    serverRevision: server.revision,
    serverState: server.state,
    serverGenerationId: server.generationId,
    serverContentHash: server.contentHash,
    message,
  };
}

function conflictResultFromRecord(record: SyncConflictRecord): SyncResult {
  return {
    ok: false,
    status: 'conflict',
    code: record.code,
    serverRevision: record.serverRevision,
    serverState: record.serverState,
    serverGenerationId: record.serverGenerationId,
    serverContentHash: record.serverContentHash,
    message: record.message || '需要处理版本冲突',
  };
}

const LOCAL_STATE_UNRESOLVED_MESSAGE =
  '检测到本机仍有未解决的本地修改或待确认的版本冲突，已暂停自动覆盖。请确认要保留的内容后处理冲突。';

/**
 * Pull path (no local unresolved changes): compare CONTENT + revision + generation,
 * then install the server snapshot with a matching sync baseline.
 */
async function pullPath(userId: string, options?: SyncOptions, lockScope?: LockScope): Promise<SyncResult> {
  const server = await fetchServerSnapshot(userId);
  if (!server.ok) {
    if (server.code === 'SESSION_ACCOUNT_MISMATCH') {
      return { ok: false, status: 'failed', code: 'SESSION_ACCOUNT_MISMATCH', message: server.message, needsRelogin: true };
    }
    return failureFromStatus(server.status, server.code, server.message);
  }
  if (server.generationId) saveActiveGenerationId(userId, server.generationId);

  // Epoch/Scope check before any DB mutations:
  if (lockScope && lockScope.isExpired()) {
    return { ok: false, status: 'failed', code: 'LOCK_EXPIRED', message: '操作锁已过期' };
  }
  if (options?.guard && !options.guard()) {
    return { ok: false, status: 'failed', code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消本次同步' };
  }

  const snapshot = await loadSnapshot(userId);
  const baseline = await getSyncBaseline(userId);
  const localSnapshotRev = snapshot ? (snapshot.confirmedRevision ?? baseline?.confirmedRevision ?? 0) : (baseline?.confirmedRevision ?? 0);
  const localGeneration = snapshot ? (snapshot.generationId ?? baseline?.generationId ?? '') : (baseline?.generationId ?? '');
  const localConfirmedHash = snapshot ? (snapshot.confirmedContentHash ?? baseline?.contentHash ?? '') : (baseline?.contentHash ?? '');
  const localCurrentHash = snapshot?.contentHash ?? '';
  const localHasContent = Boolean(snapshot && snapshot.state && (snapshot.state.books.length > 0 || snapshot.state.courses.length > 0 || snapshot.state.records.length > 0 || snapshot.state.plans.length > 0 || localSnapshotRev > 0));

  if (!server.hasCloudData) {
    if (localHasContent) {
      return buildConflictResult(
        userId,
        server,
        'CLOUD_EMPTY',
        '云端暂无工作区数据，但本机仍保留学习资料。已暂停自动覆盖，请确认是否将本机内容上传到云端。'
      );
    }
    return { ok: true, status: 'synced', message: '云端暂无数据', serverRevision: server.revision, serverGenerationId: server.generationId };
  }

  const serverHashMatchesConfirmed = Boolean(server.contentHash) && server.contentHash === localConfirmedHash;

  // Same revision number never proves identical content: verify hashes and generation first.
  if (server.snapshotGenerationId && localGeneration && server.snapshotGenerationId !== localGeneration) {
    // Generation changed (disaster recovery). Content differs => the user must be aware,
    // unless the local snapshot is just an older confirmed state with no local edits.
    if (lockScope && lockScope.isExpired()) {
      return { ok: false, status: 'failed', code: 'LOCK_EXPIRED', message: '操作锁已过期' };
    }
    if (options?.guard && !options.guard()) {
      return { ok: false, status: 'failed', code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消本次同步' };
    }
    const installed = await installConfirmedServerState(userId, server.state!, {
      revision: server.revision,
      generationId: server.generationId || server.snapshotGenerationId,
      contentHash: server.contentHash,
      snapshotGenerationId: server.snapshotGenerationId,
    }, { force: false, guard: options?.guard });
    if (!installed.ok) {
      if (installed.code === 'AUTH_EPOCH_CHANGED') {
        return { ok: false, status: 'failed', code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消本次同步' };
      }
      return buildConflictResult(
        userId,
        server,
        'LOCAL_UNRESOLVED',
        '云端代际已轮换，但本机仍有未解决的本地修改，已暂停覆盖，请确认冲突处理。'
      );
    }
    return {
      ok: true,
      status: 'synced',
      message: '云端代际已更新，已安全载入最新云端存档',
      serverRevision: server.revision,
      serverState: server.state,
      serverGenerationId: server.generationId,
      serverContentHash: server.contentHash,
    };
  }

  if (server.revision > localSnapshotRev) {
    if (lockScope && lockScope.isExpired()) {
      return { ok: false, status: 'failed', code: 'LOCK_EXPIRED', message: '操作锁已过期' };
    }
    if (options?.guard && !options.guard()) {
      return { ok: false, status: 'failed', code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消本次同步' };
    }
    const installed = await installConfirmedServerState(userId, server.state!, {
      revision: server.revision,
      generationId: server.generationId || server.snapshotGenerationId,
      contentHash: server.contentHash,
      snapshotGenerationId: server.snapshotGenerationId,
    }, { force: false, guard: options?.guard });
    if (!installed.ok) {
      if (installed.code === 'AUTH_EPOCH_CHANGED') {
        return { ok: false, status: 'failed', code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消本次同步' };
      }
      return buildConflictResult(userId, server, 'LOCAL_UNRESOLVED', LOCAL_STATE_UNRESOLVED_MESSAGE);
    }
    return {
      ok: true,
      status: 'synced',
      message: '已拉取云端最新数据',
      serverRevision: server.revision,
      serverState: server.state,
      serverGenerationId: server.generationId,
      serverContentHash: server.contentHash,
    };
  }

  if (server.revision < localSnapshotRev) {
    return buildConflictResult(
      userId,
      server,
      'SERVER_ROLLED_BACK',
      '云端修订号低于本机已确认的修订号（可能发生云端回滚或灾备恢复），已暂停同步，请确认保留哪一方内容。'
    );
  }

  // Same revision: only identical content counts as "already synced".
  if (serverHashMatchesConfirmed && (!localCurrentHash || localCurrentHash === localConfirmedHash)) {
    if (lockScope && lockScope.isExpired()) {
      return { ok: false, status: 'failed', code: 'LOCK_EXPIRED', message: '操作锁已过期' };
    }
    if (options?.guard && !options.guard()) {
      return { ok: false, status: 'failed', code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消本次同步' };
    }
    await saveSyncBaseline({
      userId,
      confirmedRevision: server.revision,
      generationId: server.generationId || server.snapshotGenerationId,
      contentHash: server.contentHash,
      updatedAt: new Date().toISOString(),
    });
    return {
      ok: true,
      status: 'synced',
      message: '云端与本机已一致',
      serverRevision: server.revision,
      serverState: server.state,
      serverGenerationId: server.generationId,
      serverContentHash: server.contentHash,
    };
  }

  return buildConflictResult(
    userId,
    server,
    'CONTENT_DIVERGED',
    '云端与本机的修订号相同但内容不同，已暂停自动覆盖，请确认保留哪一方内容。'
  );
}

interface PushLoopResult {
  result: SyncResult;
  remaining: number;
}

/**
 * Flush loop: media migration first, then a single compacted workspace push with
 * stable requestId, cross-tab lease, CAS revision, generation guard and idempotency.
 */
async function pushPath(
  userId: string,
  csrfToken: string,
  options?: SyncOptions,
  lockScope?: LockScope
): Promise<PushLoopResult> {
  if (!csrfToken) {
    return {
      result: { ok: false, status: 'failed', code: 'CSRF_INVALID', message: '缺少安全令牌，正在重新验证会话', needsSessionRefresh: true },
      remaining: 1,
    };
  }

  if (lockScope && lockScope.isExpired()) {
    return { result: { ok: false, status: 'failed', code: 'LOCK_EXPIRED', message: '操作锁已过期' }, remaining: 1 };
  }
  if (options?.guard && !options.guard()) {
    return { result: { ok: false, status: 'failed', code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消本次同步' }, remaining: 1 };
  }

  // 1. Upload any local-only photos/avatar BEFORE pushing the snapshot.
  const mediaResult = await flushLegacyMedia(userId, csrfToken);
  if (!mediaResult.ok) {
    if (mediaResult.code === 'SESSION_EXPIRED') {
      return { result: { ok: false, status: 'failed', code: 'SESSION_EXPIRED', message: mediaResult.message, needsRelogin: true }, remaining: 1 };
    }
    if (mediaResult.code === 'CSRF_INVALID') {
      return { result: { ok: false, status: 'failed', code: 'CSRF_INVALID', message: mediaResult.message, needsSessionRefresh: true }, remaining: 1 };
    }
    if (mediaResult.code === 'QUOTA_EXCEEDED') {
      return { result: { ok: false, status: 'failed', code: 'MEDIA_QUOTA_EXCEEDED', message: mediaResult.message }, remaining: 1 };
    }
    return { result: { ok: false, status: 'failed', code: mediaResult.code, message: mediaResult.message }, remaining: 1 };
  }

  const owner = `tab_${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;

  for (let iteration = 0; iteration < 5; iteration++) {
    if (lockScope && lockScope.isExpired()) {
      return { result: { ok: false, status: 'failed', code: 'LOCK_EXPIRED', message: '操作锁已过期' }, remaining: 1 };
    }
    if (options?.guard && !options.guard()) {
      return { result: { ok: false, status: 'failed', code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消本次同步' }, remaining: 1 };
    }

    const unresolved = await getUnresolvedLocalChanges(userId);
    if (unresolved.conflict) {
      return { result: conflictResultFromRecord(unresolved.conflict), remaining: unresolved.total };
    }
    if (unresolved.quarantined.length > 0) {
      const server = await fetchServerSnapshot(userId);
      return {
        result: await buildConflictResult(userId, server, 'QUARANTINED_LOCAL_CHANGES', LOCAL_STATE_UNRESOLVED_MESSAGE),
        remaining: unresolved.total,
      };
    }
    const baseline = await getSyncBaseline(userId);
    const snapshot = await loadSnapshot(userId);
    const flushable = unresolved.flushable.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (flushable.length === 0) {
      if (unresolved.waitingBackoff.length > 0) {
        const earliest = unresolved.waitingBackoff.map(i => i.nextAttemptAt!).filter(Boolean).sort()[0];
        return {
          result: {
            ok: false,
            status: 'waiting',
            waitingReason: 'backoff',
            retryAt: earliest,
            message: '等待重试退避时间',
            pendingCount: unresolved.total,
          },
          remaining: unresolved.total,
        };
      }
      if (unresolved.waitingLease.length > 0) {
        const earliest = unresolved.waitingLease.map(i => i.leaseExpiresAt!).filter(Boolean).sort()[0];
        return {
          result: {
            ok: false,
            status: 'waiting',
            waitingReason: 'lease',
            retryAt: earliest,
            message: '另一标签页正在同步中',
            pendingCount: unresolved.total,
          },
          remaining: unresolved.total,
        };
      }
      if (unresolved.total > 0) {
        return {
          result: {
            ok: false,
            status: 'waiting',
            message: '队列正在等待处理',
            pendingCount: unresolved.total,
          },
          remaining: unresolved.total,
        };
      }
      // Nothing to push anymore: converge via the pull path.
      const pulled = await pullPath(userId, options, lockScope);
      return { result: pulled, remaining: 0 };
    }

    if (!snapshot) {
      return { result: { ok: false, status: 'failed', code: 'LOCAL_SNAPSHOT_MISSING', message: '本机快照缺失' }, remaining: flushable.length };
    }

    const confirmedRevision = baseline?.confirmedRevision ?? snapshot.confirmedRevision ?? 0;
    const generationId = baseline?.generationId || snapshot.generationId || '';
    if (!generationId) {
      // Unknown generation: fetch the server's current generation before pushing.
      const server = await fetchServerSnapshot(userId);
      if (!server.ok) return { result: failureFromStatus(server.status, server.code, server.message), remaining: flushable.length };
      const conflict = await buildConflictResult(
        userId,
        server,
        'GENERATION_UNKNOWN',
        '本机缺少云端代际基线，已暂停自动上传，请确认云端最新内容后再同步。'
      );
      return { result: conflict, remaining: flushable.length };
    }

    // Newest task identity + latest local content = compacted push (older tasks superseded).
    const target = flushable[flushable.length - 1];
    const compacted = await compactOutboxForFlush(userId, target.requestId, snapshot.state, confirmedRevision, generationId);
    if (!compacted) {
      return { result: { ok: false, status: 'failed', code: 'QUEUE_CHANGED', message: '同步队列已被其他页面更新，正在重试' }, remaining: flushable.length };
    }

    // Cross-tab exclusive claim: a stale flush from another tab cannot resurrect a task.
    const claimed = await claimOutboxTask(compacted.id, owner);
    if (!claimed) {
      return { result: { ok: false, status: 'failed', code: 'TASK_CLAIMED_BY_OTHER_TAB', message: '另一标签页已接管本次同步' }, remaining: flushable.length };
    }

    let response: Response;
    try {
      response = await fetch('/api/workspace', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
          'x-workspace-user': userId,
        },
        body: JSON.stringify({
          expectedRevision: claimed.expectedRevision,
          expectedContentHash: claimed.expectedContentHash,
          requestId: claimed.requestId,
          schemaVersion: 3,
          generationId: claimed.generationId,
          state: claimed.state,
          reason: claimed.reason || 'sync',
        }),
      });
    } catch {
      await releaseOutboxTask(claimed.id, {}, claimed.attemptFence);
      return {
        result: { ok: false, status: 'failed', code: 'NETWORK', message: '网络通信异常，修改已安全保留在本机，恢复连接后将自动重试' },
        remaining: flushable.length,
      };
    }

    if (response.ok) {
      if (lockScope && lockScope.isExpired()) {
        await releaseOutboxTask(claimed.id, {}, claimed.attemptFence);
        return { result: { ok: false, status: 'failed', code: 'LOCK_EXPIRED', message: '操作锁已过期' }, remaining: flushable.length };
      }
      if (options?.guard && !options.guard()) {
        await releaseOutboxTask(claimed.id, {}, claimed.attemptFence);
        return { result: { ok: false, status: 'failed', code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消本次同步' }, remaining: flushable.length };
      }

      const json = await response.json().catch(() => ({}));
      const pushedHash = await hashState(claimed.state);
      const confirmedRevisionResult = typeof json.revision === 'number' ? json.revision : claimed.expectedRevision + 1;
      const confirmedGeneration = typeof json.generationId === 'string' && json.generationId ? json.generationId : claimed.generationId;
      const confirmedHash = typeof json.contentHash === 'string' && json.contentHash ? json.contentHash : pushedHash;
      await confirmOutboxPush(userId, claimed.requestId, {
        revision: confirmedRevisionResult,
        generationId: confirmedGeneration,
        contentHash: confirmedHash,
      }, pushedHash, claimed.attemptFence, claimed.id);
      saveActiveGenerationId(userId, confirmedGeneration);
      if (json.needsInitChoice !== undefined) {
        // R10: surface server-driven empty-library initialization state.
      }
      const remaining = await getUnresolvedLocalChanges(userId);
      if (remaining.total === 0 && !remaining.conflict) {
        const latest = await loadLatestState(userId);
        return {
          result: {
            ok: true,
            status: 'synced',
            message: '全部学情与照片已保存到服务器',
            serverRevision: confirmedRevisionResult,
            serverState: latest.state,
            serverGenerationId: confirmedGeneration,
            serverContentHash: confirmedHash,
            pendingCount: 0,
          },
          remaining: 0,
        };
      }
      // Loop again for remaining queued edits (e.g. edits made while pushing).
      continue;
    }

    if (response.status === 409) {
      const body = await response.json().catch(() => ({}));
      if (body.code === 'SESSION_ACCOUNT_MISMATCH') {
        await releaseOutboxTask(claimed.id, {}, claimed.attemptFence);
        return {
          result: { ok: false, status: 'failed', code: 'SESSION_ACCOUNT_MISMATCH', message: body.message || '账号会话不匹配', needsRelogin: true },
          remaining: flushable.length,
        };
      }
      const server = await fetchServerSnapshot(userId);
      const effectiveServer: ServerSnapshot = server.ok ? server : {
        ok: true,
        status: 200,
        hasCloudData: Boolean(body.serverState),
        revision: typeof body.serverRevision === 'number' ? body.serverRevision : 0,
        generationId: typeof body.generationId === 'string' ? body.generationId : '',
        snapshotGenerationId: typeof body.snapshotGenerationId === 'string' ? body.snapshotGenerationId : '',
        contentHash: typeof body.serverContentHash === 'string' ? body.serverContentHash : (typeof body.contentHash === 'string' ? body.contentHash : ''),
        state: (body.serverState as AppState) ?? null,
        needsInitChoice: false,
        initChoice: null,
        seedVersion: 0,
      };
      if (body.code === 'GENERATION_MISMATCH') {
        await quarantineOutboxItem(claimed.id, 'GENERATION_MISMATCH');
        return {
          result: await buildConflictResult(
            userId,
            effectiveServer,
            'GENERATION_MISMATCH',
            body.message || '检测到云端代际轮换（灾备恢复），已隔离旧任务并暂停自动覆盖，请确认是否保留本机内容。'
          ),
          remaining: flushable.length,
        };
      }
      return {
        result: await buildConflictResult(
          userId,
          effectiveServer,
          body.code || 'REVISION_CONFLICT',
          body.message || '云端存在更新版本，已暂停自动覆盖，请核对双方内容后选择。'
        ),
        remaining: flushable.length,
      };
    }

    if (response.status === 401) {
      await releaseOutboxTask(claimed.id, { retryAfterMs: 5000 }, claimed.attemptFence);
      return { result: { ok: false, status: 'failed', code: 'SESSION_EXPIRED', message: '登录状态已失效，请重新登录', needsRelogin: true }, remaining: flushable.length };
    }
    if (response.status === 403) {
      await releaseOutboxTask(claimed.id, { retryAfterMs: 2000 }, claimed.attemptFence);
      return { result: { ok: false, status: 'failed', code: 'CSRF_INVALID', message: '安全令牌已过期，正在重新验证会话', needsSessionRefresh: true }, remaining: flushable.length };
    }

    const body = await response.json().catch(() => ({}));
    await releaseOutboxTask(claimed.id, {}, claimed.attemptFence);
    return {
      result: {
        ok: false,
        status: 'failed',
        code: body.code || 'SYNC_ERROR',
        message: body.message || `同步暂未完成 (HTTP ${response.status})，正在自动重试`,
      },
      remaining: flushable.length,
    };
  }

  return {
    result: { ok: false, status: 'failed', code: 'SYNC_LOOP_LIMIT', message: '同步队列处理次数超出上限，正在重试' },
    remaining: 1,
  };
}

export interface SyncOptions {
  /** Called after async steps to ensure the same user/auth epoch is still current. */
  guard?: () => boolean;
}

/**
 * Normal bidirectional sync:
 * - Persisted conflict / quarantined local changes => conflict (never treated as "no local changes")
 * - Flushable outbox items => media migration + compacted CAS push
 * - No local changes => content+revision+generation aware pull
 * Runs inside a cross-tab exclusive lock for the account.
 */
export async function syncNormal(
  userId: string,
  csrfToken: string,
  options: SyncOptions = {},
  lockScope?: LockScope
): Promise<SyncResult> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { ok: false, status: 'offline', message: '当前处于离线状态，修改已安全保存在本机', pendingCount: 0 };
  }

  return withUserLock(userId, async (scope) => {
    return syncWithLockScope(userId, csrfToken, options, scope);
  }, lockScope);
}

export async function syncWithLockScope(
  userId: string,
  csrfToken: string,
  options: SyncOptions = {},
  scope: LockScope
): Promise<SyncResult> {
  if (scope.isExpired()) {
    return { ok: false, status: 'failed', code: 'LOCK_EXPIRED', message: '操作锁已过期' };
  }
  if (options.guard && !options.guard()) {
    return { ok: false, status: 'failed', code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消本次同步' };
  }

  const conflict = await getConflictRecord(userId);
  if (conflict) {
    const unresolved = await getUnresolvedLocalChanges(userId);
    return { ...conflictResultFromRecord(conflict), pendingCount: unresolved.total };
  }
  const unresolved = await getUnresolvedLocalChanges(userId);
  if (unresolved.quarantined.length > 0) {
    const server = await fetchServerSnapshot(userId);
    const result = await buildConflictResult(userId, server, 'QUARANTINED_LOCAL_CHANGES', LOCAL_STATE_UNRESOLVED_MESSAGE);
    return { ...result, pendingCount: unresolved.total };
  }
  if (options.guard && !options.guard()) {
    return { ok: false, status: 'failed', code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消本次同步' };
  }

  if (unresolved.flushable.length > 0) {
    const { result } = await pushPath(userId, csrfToken, options, scope);
    if (options.guard && !options.guard()) {
      return { ok: false, status: 'failed', code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消本次同步' };
    }
    const remaining = await getUnresolvedLocalChanges(userId);
    return { ...result, pendingCount: remaining.total };
  }

  if (unresolved.waitingBackoff.length > 0) {
    const earliest = unresolved.waitingBackoff.map(i => i.nextAttemptAt!).filter(Boolean).sort()[0];
    return {
      ok: false,
      status: 'waiting',
      waitingReason: 'backoff',
      retryAt: earliest,
      message: '等待重试退避时间',
      pendingCount: unresolved.total,
    };
  }

  if (unresolved.waitingLease.length > 0) {
    const earliest = unresolved.waitingLease.map(i => i.leaseExpiresAt!).filter(Boolean).sort()[0];
    return {
      ok: false,
      status: 'waiting',
      waitingReason: 'lease',
      retryAt: earliest,
      message: '另一标签页正在同步中',
      pendingCount: unresolved.total,
    };
  }

  if (unresolved.total > 0) {
    return {
      ok: false,
      status: 'waiting',
      message: '队列正在等待处理',
      pendingCount: unresolved.total,
    };
  }

  const result = await pullPath(userId, options, scope);
  if (options.guard && !options.guard()) {
    return { ok: false, status: 'failed', code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消本次同步' };
  }
  const remaining = await getUnresolvedLocalChanges(userId);
  return { ...result, pendingCount: remaining.total };
}

/** Alias kept for existing callers/tests. */
export const syncOutboxWithServer = syncNormal;

/**
 * Login / cold-start hydration: load the local partition first. If local has
 * unresolved edits, sync them. Otherwise fetch and install the cloud workspace.
 * Never fabricates a local seed when the cloud load fails; returns ok:false so the
 * UI can show an accurate retry state instead of an editable empty library.
 */
export async function initialHydrate(
  userId: string,
  csrfToken: string,
  options: SyncOptions = {},
  lockScope?: LockScope
): Promise<SyncResult & { localState?: AppState; localRevision?: number }> {
  return withUserLock(userId, async (scope) => {
    return initialHydrateInternal(userId, csrfToken, options, scope);
  }, lockScope);
}

export async function initialHydrateInternal(
  userId: string,
  csrfToken: string,
  options: SyncOptions = {},
  scope: LockScope
): Promise<SyncResult & { localState?: AppState; localRevision?: number }> {
  if (scope.isExpired()) {
    return { ok: false, status: 'failed', code: 'LOCK_EXPIRED', message: '操作锁已过期' };
  }
  if (options.guard && !options.guard()) {
    return { ok: false, status: 'failed', code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消初始化' };
  }

  const local = await loadLatestState(userId);
  const unresolved = await getUnresolvedLocalChanges(userId);
  if (unresolved.hasUnsynced) {
    // Pass lockScope down to syncNormal so that it does NOT re-acquire or deadlock on itself
    const result = await syncNormal(userId, csrfToken, options, scope);
    const latest = await loadLatestState(userId);
    return { ...result, localState: latest.state, localRevision: latest.revision };
  }

  const server = await fetchServerSnapshot(userId);
  if (!server.ok) {
    if (server.status === 401 || server.code === 'SESSION_EXPIRED') {
      return { ok: false, status: 'failed', code: 'SESSION_EXPIRED', message: '登录状态已失效，请重新登录', needsRelogin: true };
    }
    if (server.status === 409 && server.code === 'SESSION_ACCOUNT_MISMATCH') {
      return { ok: false, status: 'failed', code: 'SESSION_ACCOUNT_MISMATCH', message: server.message || '账号会话不匹配', needsRelogin: true };
    }
    // Offline / server unavailable: a reliable local cache may be used offline.
    const hasReliableCache = local.isFresh === false && local.state && (local.confirmedRevision > 0 || local.confirmedContentHash.length > 0);
    if (hasReliableCache) {
      return {
        ok: true,
        status: 'failed',
        code: server.code || 'SYNC_FAILED',
        message: '当前无法连接云端，已载入本机最近一次的可靠缓存，联网后将自动同步',
        localState: local.state,
        localRevision: local.revision,
        pendingCount: 0,
      };
    }
    return {
      ok: false,
      status: 'failed',
      code: server.code || 'WORKSPACE_LOAD_FAILED',
      message: server.message || '加载云端工作区失败，请重试',
      needsRelogin: server.status === 401,
    };
  }

  if (scope.isExpired()) {
    return { ok: false, status: 'failed', code: 'LOCK_EXPIRED', message: '操作锁已过期' };
  }
  if (options.guard && !options.guard()) {
    return { ok: false, status: 'failed', code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消初始化' };
  }

  if (!server.hasCloudData) {
    // Server has no workspace for this account (unexpected for registered users):
    // keep local data if it exists, otherwise return an accurate error instead of seeding.
    if (local.isFresh) {
      return { ok: false, status: 'failed', code: 'CLOUD_WORKSPACE_MISSING', message: '云端工作区尚未初始化，请重试或联系管理员' };
    }
    return {
      ok: true,
      status: 'failed',
      code: 'CLOUD_WORKSPACE_MISSING',
      message: '云端工作区暂无数据，已保留本机缓存',
      localState: local.state,
      localRevision: local.revision,
    };
  }

  const installed = await installConfirmedServerState(userId, server.state!, {
    revision: server.revision,
    generationId: server.generationId || server.snapshotGenerationId,
    contentHash: server.contentHash,
    snapshotGenerationId: server.snapshotGenerationId,
  }, { force: false, saveRecovery: true, guard: options.guard });
  if (!installed.ok) {
    if (installed.code === 'AUTH_EPOCH_CHANGED') {
      return { ok: false, status: 'failed', code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消初始化' };
    }
    return { ok: false, status: 'conflict', code: installed.code, message: installed.message || '本机存在未同步修改，无法直接载入云端数据' };
  }
  saveActiveGenerationId(userId, server.generationId || server.snapshotGenerationId);
  const latest = await loadLatestState(userId);
  return {
    ok: true,
    status: 'synced',
    message: '已载入云端工作区',
    serverRevision: server.revision,
    serverState: server.state,
    serverGenerationId: server.generationId,
    serverContentHash: server.contentHash,
    localState: latest.state,
    localRevision: latest.revision,
    needsInitChoice: server.needsInitChoice,
    initChoice: server.initChoice,
    pendingCount: 0,
  };
}

/**
 * Re-verify that the cloud snapshot the user actually reviewed is still current.
 * Returns null when it matches, otherwise the fresh server snapshot.
 */
async function verifyReviewedServerState(expected?: {
  serverRevision?: number;
  serverGenerationId?: string;
  serverContentHash?: string;
}, userId?: string): Promise<ServerSnapshot | null> {
  const server = await fetchServerSnapshot(userId);
  if (!server.ok || !server.hasCloudData) return server;
  if (!expected) return null;
  const revisionChanged = typeof expected.serverRevision === 'number' && expected.serverRevision !== server.revision;
  const generationChanged = Boolean(expected.serverGenerationId) && expected.serverGenerationId !== server.generationId;
  const contentChanged = Boolean(expected.serverContentHash) && expected.serverContentHash !== server.contentHash;
  if (!revisionChanged && !generationChanged && !contentChanged) return null;
  return server;
}

/**
 * Keep local: push the local snapshot over the cloud AFTER re-verifying that the
 * reviewed remote content/revision/generation is still current. Never overwrites
 * remote content the user has not seen.
 */
export async function forceUploadLocal(
  userId: string,
  csrfToken: string,
  reviewed?: { serverRevision?: number; serverGenerationId?: string; serverContentHash?: string },
  expectedLocalRevision?: number,
  lockScope?: LockScope
): Promise<SyncResult> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { ok: false, status: 'offline', message: '当前离线，无法上传覆盖云端' };
  }

  const run = async (scope: LockScope): Promise<SyncResult> => {
    // 1. Verify expectedLocalRevision: if local snapshot revision does not match expectedLocalRevision, abort with LOCAL_CHANGED
    const local = await loadLatestState(userId);
    const snapshot = await loadSnapshot(userId);
    const currentLocalRevision = snapshot?.revision ?? local.revision;
    if (expectedLocalRevision !== undefined && currentLocalRevision !== expectedLocalRevision) {
      return {
        ok: false,
        status: 'failed',
        code: 'LOCAL_CHANGED',
        message: '本机在确认期间产生了新的修改，请重新核对双方内容',
      };
    }

    // 2. Re-verify reviewed server state
    const refreshed = await verifyReviewedServerState(reviewed, userId);
    if (refreshed && (!refreshed.ok || refreshed.hasCloudData === false || refreshed.revision !== reviewed?.serverRevision || refreshed.generationId !== reviewed?.serverGenerationId || (reviewed?.serverContentHash && refreshed.contentHash !== reviewed.serverContentHash))) {
      return buildConflictResult(
        userId,
        refreshed,
        'REMOTE_CHANGED_DURING_REVIEW',
        '云端内容在你确认期间已发生变化，已停止覆盖，请重新核对最新云端内容后再选择。'
      );
    }

    // 3. MUST NOT perform a second GET that silently replaces server.revision with an unreviewed new revision!
    const server = await fetchServerSnapshot(userId);
    if (!server.ok) return failureFromStatus(server.status, server.code, server.message);
    if (!server.hasCloudData) {
      return { ok: false, status: 'failed', code: 'CLOUD_EMPTY', message: '云端暂无工作区，无法覆盖' };
    }
    if (reviewed) {
      const remoteChanged =
        (typeof reviewed.serverRevision === 'number' && server.revision !== reviewed.serverRevision) ||
        (Boolean(reviewed.serverGenerationId) && server.generationId !== reviewed.serverGenerationId) ||
        (Boolean(reviewed.serverContentHash) && server.contentHash !== reviewed.serverContentHash);
      if (remoteChanged) {
        return buildConflictResult(
          userId,
          server,
          'REMOTE_CHANGED_DURING_REVIEW',
          '云端内容在你确认期间已发生变化，已停止覆盖，请重新核对最新云端内容后再选择。'
        );
      }
    }

    const localVersion = expectedLocalRevision ?? snapshot?.revision ?? local.revision;
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    const confirmedRevision = reviewed?.serverRevision ?? server.revision;
    const generationId = reviewed?.serverGenerationId || server.generationId || server.snapshotGenerationId;
    const serverContentHash = reviewed?.serverContentHash ?? server.contentHash;

    const forcedSnapshot: SnapshotRecord = {
      key: snapshot?.key ?? `snapshot_${userId}`,
      state: local.state,
      version: 3,
      revision: localVersion,
      confirmedRevision,
      generationId,
      confirmedContentHash: serverContentHash,
      migratedFromV2: snapshot?.migratedFromV2 ?? true,
      updatedAt: new Date().toISOString(),
    };
    const newOutboxItem: OutboxRecord = {
      id: `outbox_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      userId,
      requestId,
      state: local.state,
      expectedRevision: confirmedRevision,
      expectedContentHash: serverContentHash,
      generationId,
      createdAt: new Date().toISOString(),
      status: 'pending',
      reason: 'force_local_override',
    };

    try {
      await atomicResolveConflict(userId, forcedSnapshot, localVersion, newOutboxItem);
    } catch (err) {
      return { ok: false, status: 'failed', code: 'LOCAL_CHANGED', message: err instanceof Error ? err.message : '本机数据已变化，请重新确认' };
    }

    // Push immediately under the same lock; the push path re-reads queue state.
    const { result } = await pushPath(userId, csrfToken, undefined, scope);
    return result;
  };

  return withUserLock(userId, run, lockScope).finally(async () => {
    void userId;
  });
}

/**
 * Keep remote: adopt the cloud snapshot AFTER re-verifying the reviewed remote
 * revision/generation/content is still current. Sends server version barrier. Saves a recovery point first.
 */
export async function forcePullRemote(
  userId: string,
  targetServerState: AppState,
  targetServerRevision: number,
  expectedLocalRevision?: number,
  reviewed?: {
    serverRevision?: number;
    serverGenerationId?: string;
    serverContentHash?: string;
    serverState?: AppState;
  },
  lockScope?: LockScope,
  csrfToken?: string
): Promise<SyncResult> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { ok: false, status: 'offline', message: '当前离线，无法拉取云端存档' };
  }

  const run = async (scope: LockScope): Promise<SyncResult> => {
    // 1. Verify reviewed cloud identity still matches server. If cloud changed, return conflict.
    const reviewedIdentity = reviewed ?? {
      serverRevision: targetServerRevision,
    };
    const refreshed = await verifyReviewedServerState(reviewedIdentity, userId);
    if (refreshed) {
      if (!refreshed.ok) return failureFromStatus(refreshed.status, refreshed.code, refreshed.message);
      return buildConflictResult(
        userId,
        refreshed,
        'REMOTE_CHANGED_DURING_REVIEW',
        '云端内容在你确认期间已发生变化，已停止覆盖，请重新核对最新云端内容后再选择。'
      );
    }
    const server = await fetchServerSnapshot(userId);
    if (!server.ok) return failureFromStatus(server.status, server.code, server.message);
    if (!server.hasCloudData || !server.state) {
      return { ok: false, status: 'failed', code: 'CLOUD_EMPTY', message: '云端暂无可用工作区数据' };
    }
    if (reviewed) {
      const remoteChanged =
        (typeof reviewed.serverRevision === 'number' && server.revision !== reviewed.serverRevision) ||
        (Boolean(reviewed.serverGenerationId) && server.generationId !== reviewed.serverGenerationId) ||
        (Boolean(reviewed.serverContentHash) && server.contentHash !== reviewed.serverContentHash);
      if (remoteChanged) {
        return buildConflictResult(
          userId,
          server,
          'REMOTE_CHANGED_DURING_REVIEW',
          '云端内容在你确认期间已发生变化，已停止覆盖，请重新核对最新云端内容后再选择。'
        );
      }
    }

    // 2. Verify local state revision matches expectedLocalRevision. If local has new edits, return LOCAL_CHANGED / re-confirm.
    const local = await loadLatestState(userId);
    const snapshot = await loadSnapshot(userId);
    const currentLocalRevision = snapshot?.revision ?? local.revision;
    if (expectedLocalRevision !== undefined && currentLocalRevision !== expectedLocalRevision) {
      return {
        ok: false,
        status: 'failed',
        code: 'LOCAL_CHANGED',
        message: '本机在确认期间产生了新的修改，请重新核对双方内容',
      };
    }

    // 3. Save local recovery point and intent.
    try {
      await saveDamagedCache(stableStateJson(local.state), 'pre_force_pull_remote_barrier');
    } catch {}

    const effectiveServerState = reviewed?.serverState ?? server.state ?? targetServerState;
    const effectiveServerRevision = reviewed?.serverRevision ?? server.revision;
    const effectiveGenerationId = reviewed?.serverGenerationId || server.generationId || server.snapshotGenerationId;
    const effectiveContentHash = reviewed?.serverContentHash || server.contentHash;
    const barrierRequestId = `barrier_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // 4. Send barrier POST to /api/workspace
    let effectiveCsrf = csrfToken || '';
    if (!effectiveCsrf && typeof fetch !== 'undefined') {
      try {
        const meRes = await fetch('/api/auth/me', { method: 'GET' });
        if (meRes.ok) {
          const meData = await meRes.json().catch(() => ({}));
          if (meData?.csrfToken) {
            effectiveCsrf = meData.csrfToken;
          }
        }
      } catch {}
    }

    let barrierResponse: Response;
    try {
      barrierResponse = await fetch('/api/workspace', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': effectiveCsrf,
          'x-workspace-user': userId,
        },
        body: JSON.stringify({
          expectedRevision: effectiveServerRevision,
          expectedContentHash: effectiveContentHash,
          state: effectiveServerState,
          generationId: effectiveGenerationId,
          requestId: barrierRequestId,
          reason: 'keep_remote_barrier',
          schemaVersion: 3,
        }),
      });
    } catch {
      return {
        ok: false,
        status: 'failed',
        code: 'NETWORK',
        message: '网络通信异常，未能确认采用云端，请稍后重试',
      };
    }

    // 5. If barrier POST fails with 409, fail safely with conflict.
    if (!barrierResponse.ok) {
      if (barrierResponse.status === 409) {
        const freshServer = await fetchServerSnapshot(userId);
        return buildConflictResult(
          userId,
          freshServer,
          'REMOTE_CHANGED_DURING_BARRIER',
          '云端内容在执行裁决期间已发生变化，请重新核对最新云端内容。'
        );
      }
      const body = await barrierResponse.json().catch(() => ({}));
      return {
        ok: false,
        status: 'failed',
        code: body.code || 'BARRIER_FAILED',
        message: body.message || `采用云端版本失败 (HTTP ${barrierResponse.status})`,
      };
    }

    const barrierJson = await barrierResponse.json().catch(() => ({}));
    const nextRevision = typeof barrierJson.revision === 'number' ? barrierJson.revision : effectiveServerRevision + 1;
    const nextGenerationId = typeof barrierJson.generationId === 'string' && barrierJson.generationId ? barrierJson.generationId : effectiveGenerationId;
    const nextContentHash = typeof barrierJson.contentHash === 'string' && barrierJson.contentHash ? barrierJson.contentHash : effectiveContentHash;

    // 6. In a single local transaction, check scope and expectedLocalRevision.
    if (scope.isExpired()) {
      return { ok: false, status: 'failed', code: 'LOCK_EXPIRED', message: '操作锁已过期' };
    }

    const recheckLocal = await loadLatestState(userId);
    const recheckSnapshot = await loadSnapshot(userId);
    const recheckLocalRevision = recheckSnapshot?.revision ?? recheckLocal.revision;
    if (expectedLocalRevision !== undefined && recheckLocalRevision !== expectedLocalRevision) {
      return {
        ok: false,
        status: 'failed',
        code: 'LOCAL_CHANGED',
        message: '本机在提交裁决期间产生了新的修改，已保留本机新修改，请重新核对双方内容',
      };
    }

    const installed = await installConfirmedServerState(userId, effectiveServerState, {
      revision: nextRevision,
      generationId: nextGenerationId,
      contentHash: nextContentHash,
      snapshotGenerationId: nextGenerationId,
    }, { force: true, saveRecovery: false });

    if (!installed.ok) {
      return { ok: false, status: 'failed', code: installed.code || 'INSTALL_FAILED', message: installed.message || '采用云端数据失败' };
    }

    await clearOutbox(userId);
    await clearConflictRecord(userId);
    saveActiveGenerationId(userId, nextGenerationId);

    const latest = await loadLatestState(userId);
    return {
      ok: true,
      status: 'synced',
      message: '已采用云端最新存档覆盖本机数据（覆盖前已保存本机恢复点）',
      serverRevision: nextRevision,
      serverState: latest.state,
      serverGenerationId: nextGenerationId,
      serverContentHash: nextContentHash,
      pendingCount: 0,
    };
  };

  return withUserLock(userId, run, lockScope);
}

/** Pull-only helper kept for callers/tests. */
export async function pullLatestFromServer(userId: string, lockScope?: LockScope): Promise<SyncResult> {
  return withUserLock(userId, (scope) => pullPath(userId, undefined, scope), lockScope);
}

/** Clear a persisted conflict after the user's explicit resolution. */
export async function discardConflictRecord(userId: string): Promise<void> {
  await clearConflictRecord(userId);
}

export { saveSyncBaseline };
