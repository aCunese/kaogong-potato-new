import {
  AppState,
  MutationResult,
  MediaRecord,
  SnapshotRecord,
  DamagedCacheRecord,
  OutboxRecord,
  SyncBaseline,
  SyncConflictRecord,
} from '../types';
import { BLANK_STATE } from '../constants/initialData';
import { validateAndMigrateBackup } from './backupValidator';

export const DB_NAME = 'kaogong_potato_v3';
export const DB_VERSION = 3;
export const LEGACY_STORAGE_KEY = 'potato_study_v2';

const SNAPSHOTS_STORE = 'snapshots';
const MEDIA_STORE = 'media';
const DAMAGED_STORE = 'damaged_cache';
const OUTBOX_STORE = 'outbox';
const SYNC_STATE_STORE = 'sync_state';

let dbInstance: IDBDatabase | null = null;
let dbInitPromise: Promise<IDBDatabase> | null = null;

// User Partitioning: activeUserId isolates IndexedDB snapshots and outbox queues
let activeUserId: string | null = null;

export function setActiveUserPartition(userId: string | null): void {
  activeUserId = userId;
}

export function getActiveUserPartition(): string | null {
  return activeUserId;
}

export function getSnapshotKey(userId?: string | null): string {
  const targetId = userId !== undefined ? userId : activeUserId;
  return targetId ? `snapshot_${targetId}` : 'latest';
}

export function getRecoveryKey(userId: string | null | undefined): string {
  return `recovery_${userId ?? 'guest'}_latest`;
}

// Serial transaction queue (intra-tab mutex) to prevent race conditions between
// snapshots, outbox and sync metadata writes inside a single tab.
let mutationQueue: Promise<any> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(task, task);
  mutationQueue = result.catch(() => {});
  return result;
}

// ----------------------------------------------------------------------
// Cross-tab lock (Web Locks API). Falls back to the intra-tab queue when the
// environment has no Web Locks support (unit tests / non-browser runtimes).
// All sync flush / conflict resolution / cache / recovery operations must run
// inside this lock so two tabs of the same account cannot interleave.
// ----------------------------------------------------------------------
const heldLocks = new Set<string>();
// Separate queue for the lock fallback: MUST NOT share `mutationQueue`, otherwise
// a lock holding a task that calls enqueue()-protected db helpers would deadlock.
let lockQueue: Promise<any> = Promise.resolve();

function enqueueLock<T>(task: () => Promise<T>): Promise<T> {
  const result = lockQueue.then(task, task);
  lockQueue = result.catch(() => {});
  return result;
}

export async function withUserLock<T>(userId: string | null | undefined, task: () => Promise<T>): Promise<T> {
  const key = `kaogong_sync_lock_${userId ?? 'guest'}`;
  const hasIndexedDb = typeof indexedDB !== 'undefined';
  const locks = typeof navigator !== 'undefined' ? (navigator as any).locks : undefined;
  if (!hasIndexedDb || !locks || typeof locks.request !== 'function') {
    return enqueueLock(task);
  }
  if (heldLocks.has(key)) {
    return task();
  }
  heldLocks.add(key);
  try {
    return await locks.request(key, { mode: 'exclusive' }, async () => task());
  } finally {
    heldLocks.delete(key);
  }
}

// In-memory fallback for environments without native IndexedDB (e.g. Bun test / SSR)
const memoryStore = {
  snapshots: new Map<string, SnapshotRecord>(),
  media: new Map<string, MediaRecord>(),
  damaged_cache: new Map<string, DamagedCacheRecord>(),
  outbox: new Map<string, OutboxRecord>(),
  syncState: new Map<string, SyncBaseline>(),
  conflicts: new Map<string, SyncConflictRecord>(),
  meta: new Map<string, string>(),
};

/**
 * Resets the in-memory fallback store (useful for clean unit tests)
 */
export function _resetInMemoryStore(): void {
  memoryStore.snapshots.clear();
  memoryStore.media.clear();
  memoryStore.damaged_cache.clear();
  memoryStore.outbox.clear();
  memoryStore.syncState.clear();
  memoryStore.conflicts.clear();
  memoryStore.meta.clear();
  dbInstance = null;
  dbInitPromise = null;
  activeUserId = null;
  heldLocks.clear();
}

const hasNativeIdb = (): boolean => typeof indexedDB !== 'undefined';

/**
 * Initializes and opens the IndexedDB database 'kaogong_potato_v3'.
 * Creates/upgrades 'snapshots', 'media', 'damaged_cache', 'outbox', 'sync_state'.
 * Incremental upgrade only: existing stores and records are preserved.
 */
export async function initDatabase(): Promise<IDBDatabase> {
  if (!hasNativeIdb()) {
    // Return mock IDBDatabase for headless/test environments
    return {
      name: DB_NAME,
      version: DB_VERSION,
      objectStoreNames: ['snapshots', 'media', 'damaged_cache', 'outbox', 'sync_state'] as any,
      close: () => {},
    } as unknown as IDBDatabase;
  }

  if (dbInstance) return dbInstance;
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SNAPSHOTS_STORE)) {
        db.createObjectStore(SNAPSHOTS_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(MEDIA_STORE)) {
        db.createObjectStore(MEDIA_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(DAMAGED_STORE)) {
        db.createObjectStore(DAMAGED_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        db.createObjectStore(OUTBOX_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(SYNC_STATE_STORE)) {
        db.createObjectStore(SYNC_STATE_STORE, { keyPath: 'userId' });
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      dbInstance.onversionchange = () => {
        dbInstance?.close();
        dbInstance = null;
        dbInitPromise = null;
      };
      dbInstance.onclose = () => {
        dbInstance = null;
        dbInitPromise = null;
      };
      resolve(dbInstance);
    };

    request.onerror = () => {
      dbInitPromise = null;
      reject(request.error || new Error('打开 IndexedDB 数据库失败'));
    };
  });

  return dbInitPromise;
}

// ----------------------------------------------------------------------
// Content hashing (must match server sha256(JSON.stringify(state)))
// ----------------------------------------------------------------------
export function stableStateJson(state: AppState): string {
  return JSON.stringify(state);
}

export async function hashContent(content: string): Promise<string> {
  try {
    const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined;
    if (subtle && typeof subtle.digest === 'function') {
      const data = new TextEncoder().encode(content);
      const digest = await subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    // fall through to deterministic fallback
  }
  // Deterministic fallback for environments without SubtleCrypto (unit tests only).
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < content.length; i++) {
    const c = content.charCodeAt(i);
    h1 = (h1 ^ c) * 16777619 >>> 0;
    h2 = (h2 + c * (i + 1)) >>> 0;
  }
  return `fallback_${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

export async function hashState(state: AppState): Promise<string> {
  return hashContent(stableStateJson(state));
}

// ----------------------------------------------------------------------
// Low-level DB helpers with in-memory fallback support
// ----------------------------------------------------------------------

async function getSnapshotFromDB(userId?: string | null): Promise<SnapshotRecord | null> {
  const key = getSnapshotKey(userId);
  if (!hasNativeIdb()) {
    const item = memoryStore.snapshots.get(key) || (key !== 'latest' ? null : memoryStore.snapshots.get('latest'));
    return item ? JSON.parse(JSON.stringify(item)) : null;
  }

  const db = await initDatabase();
  return new Promise<SnapshotRecord | null>((resolve, reject) => {
    const tx = db.transaction(SNAPSHOTS_STORE, 'readonly');
    const store = tx.objectStore(SNAPSHOTS_STORE);
    const request = store.get(key);

    request.onsuccess = () => {
      resolve(request.result || null);
    };
    request.onerror = () => {
      reject(request.error || new Error('读取快照失败'));
    };
  });
}

/** Public snapshot read (for sync/UI layers that need raw metadata). */
export async function loadSnapshot(userId?: string | null): Promise<SnapshotRecord | null> {
  return getSnapshotFromDB(userId);
}

class RevisionConflictError extends Error {
  constructor(expectedRevision?: number, currentRevision?: number) {
    const msg = expectedRevision !== undefined && currentRevision !== undefined
      ? `版本冲突（期待: ${expectedRevision}，当前: ${currentRevision}），请检查最新内容后重试。`
      : '其他页面已更新本地数据，请检查最新内容后重试。';
    super(msg);
  }
}

async function putSnapshotToDB(snapshot: SnapshotRecord, expectedRevision: number): Promise<void> {
  return writeMutationToDB(snapshot, undefined, undefined, expectedRevision);
}

async function writeMutationToDB(
  snapshot: SnapshotRecord,
  newMedia?: MediaRecord[],
  deletedMediaIds?: string[],
  expectedRevision: number = (snapshot.revision ?? 0) - 1,
  outboxItem?: OutboxRecord
): Promise<void> {
  const key = snapshot.key;
  if (!hasNativeIdb()) {
    if ((memoryStore.snapshots.get(key)?.revision ?? 0) !== expectedRevision) {
      throw new RevisionConflictError();
    }
    const mediaCopies = newMedia?.map(m => structuredClone(m));
    memoryStore.snapshots.set(key, structuredClone(snapshot));
    for (const m of mediaCopies ?? []) memoryStore.media.set(m.id, m);
    for (const id of deletedMediaIds ?? []) memoryStore.media.delete(id);
    if (outboxItem) memoryStore.outbox.set(outboxItem.id, structuredClone(outboxItem));
    return;
  }

  const db = await initDatabase();
  const storeNames = [SNAPSHOTS_STORE];
  if (newMedia?.length || deletedMediaIds?.length) storeNames.push(MEDIA_STORE);
  if (outboxItem) storeNames.push(OUTBOX_STORE);

  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeNames, 'readwrite');
    let failure: Error | null = null;
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(failure || tx.error || new Error('写入事务失败'));
    tx.onabort = () => reject(failure || tx.error || new Error('写入事务已中止'));

    const snapshotsStore = tx.objectStore(SNAPSHOTS_STORE);
    const request = snapshotsStore.get(key);
    request.onsuccess = () => {
      // Compare and write under the same IndexedDB lock, shared by all tabs.
      if ((request.result?.revision ?? 0) !== expectedRevision) {
        failure = new RevisionConflictError();
        tx.abort();
        return;
      }
      try {
        snapshotsStore.put(snapshot);
        if (storeNames.includes(MEDIA_STORE)) {
          const mediaStore = tx.objectStore(MEDIA_STORE);
          for (const m of newMedia ?? []) mediaStore.put(m);
          for (const id of deletedMediaIds ?? []) mediaStore.delete(id);
        }
        if (outboxItem && storeNames.includes(OUTBOX_STORE)) {
          const outboxStore = tx.objectStore(OUTBOX_STORE);
          outboxStore.put(outboxItem);
        }
      } catch (err) {
        failure = err instanceof Error ? err : new Error(String(err));
        tx.abort();
      }
    };
  });
}

// ----------------------------------------------------------------------
// Public DB API
// ----------------------------------------------------------------------

export interface LoadStateResult {
  state: AppState;
  /** local mutation version (kept as `revision` for backward compatibility) */
  revision: number;
  isFresh: boolean;
  corruptedRaw?: string;
  localMutationVersion: number;
  confirmedRevision: number;
  generationId: string;
  confirmedContentHash: string;
}

function snapshotMeta(snapshot: SnapshotRecord | null, fallbackGenerationId = ''): {
  localMutationVersion: number;
  confirmedRevision: number;
  generationId: string;
  confirmedContentHash: string;
} {
  return {
    localMutationVersion: snapshot?.revision ?? 0,
    confirmedRevision: snapshot?.confirmedRevision ?? 0,
    generationId: snapshot?.generationId ?? fallbackGenerationId,
    confirmedContentHash: snapshot?.confirmedContentHash ?? '',
  };
}

/**
 * Loads the latest state for the active or specified user partition:
 * - Checks 'snapshots' in IndexedDB using partitioned key.
 * - If user partition is guest and not found, checks localStorage for 'potato_study_v2'.
 *   - If valid v2, migrates to v3, writes to IndexedDB with migratedFromV2: true, keeps localStorage untouched.
 *   - If corrupted/invalid, saves raw string into damaged_cache, returns BLANK_STATE with corruptedRaw set.
 *     DOES NOT overwrite with demo data!
 * - If no localStorage or partition is empty, returns BLANK_STATE with isFresh: true.
 */
export async function loadLatestState(userId?: string | null): Promise<LoadStateResult> {
  return enqueue(async () => {
    // 1. Check IndexedDB snapshot for target partition
    const existingSnapshot = await getSnapshotFromDB(userId);
    if (existingSnapshot && existingSnapshot.state) {
      const meta = snapshotMeta(existingSnapshot, getActiveGenerationIdFor(userId));
      return {
        state: existingSnapshot.state,
        revision: meta.localMutationVersion,
        isFresh: false,
        ...meta,
      };
    }

    const key = getSnapshotKey(userId);
    // If partitioned for a specific logged-in user, start with clean BLANK_STATE
    if (key !== 'latest') {
      return {
        state: BLANK_STATE,
        revision: 0,
        isFresh: true,
        localMutationVersion: 0,
        confirmedRevision: 0,
        generationId: getActiveGenerationIdFor(userId),
        confirmedContentHash: '',
      };
    }

    // 2. Check legacy localStorage for guest
    let legacyRaw: string | null = null;
    try {
      if (typeof localStorage !== 'undefined') {
        legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
      }
    } catch (e) {
      console.warn('读取 localStorage 异常:', e);
    }

    if (legacyRaw && typeof legacyRaw === 'string' && legacyRaw.trim() !== '') {
      const validated = validateAndMigrateBackup(legacyRaw);

      if (validated.valid && validated.migratedState) {
        // Valid legacy data: migrate to v3 snapshot in IndexedDB
        const initialSnapshot: SnapshotRecord = {
          key: 'latest',
          state: validated.migratedState,
          version: 3,
          revision: 1,
          migratedFromV2: true,
          updatedAt: new Date().toISOString(),
        };
        await putSnapshotToDB(initialSnapshot, 0);

        return {
          state: validated.migratedState,
          revision: 1,
          isFresh: false,
          localMutationVersion: 1,
          confirmedRevision: 0,
          generationId: '',
          confirmedContentHash: '',
        };
      } else {
        // Corrupted legacy data: save to damaged_cache and notify UI via corruptedRaw
        const reason = `v2 自动迁移校验失败: ${validated.error || '非法 JSON 或缺失核心结构'}`;
        await saveDamagedCache(legacyRaw, reason);

        return {
          state: BLANK_STATE,
          revision: 0,
          isFresh: false,
          corruptedRaw: legacyRaw,
          localMutationVersion: 0,
          confirmedRevision: 0,
          generationId: '',
          confirmedContentHash: '',
        };
      }
    }

    // 3. No existing data -> fresh start
    return {
      state: BLANK_STATE,
      revision: 0,
      isFresh: true,
      localMutationVersion: 0,
      confirmedRevision: 0,
      generationId: getActiveGenerationIdFor(userId),
      confirmedContentHash: '',
    };
  });
}

export interface CommitOptions {
  userId?: string | null;
  /** local mutation version override (used when installing a pulled snapshot) */
  targetRevision?: number;
  reason?: string;
  /**
   * Builds the outbox record for this mutation. The provided meta carries the
   * SEPARATED versions: localMutationVersion (local writes), confirmedRevision
   * (cloud CAS base) and generationId (cloud generation the baseline belongs to).
   */
  outboxBuilder?: (nextState: AppState, meta: {
    localMutationVersion: number;
    confirmedRevision: number;
    generationId: string;
    contentHash: string;
  }) => OutboxRecord | undefined;
}

/**
 * Commits a state mutation via a serial transaction queue (mutex) to prevent race conditions.
 * Updates the local mutation version and stores the new snapshot atomically with optional outbox record.
 * The cloud revision (confirmedRevision) is PRESERVED and never incremented locally.
 */
export async function commitMutation<T>(
  mutator: (state: AppState) =>
    | Promise<
        | { nextState: AppState; value: T; newMedia?: MediaRecord[]; deletedMediaIds?: string[] }
        | { error: { code: string; message: string; field?: string } }
      >
    | { nextState: AppState; value: T; newMedia?: MediaRecord[]; deletedMediaIds?: string[] }
    | { error: { code: string; message: string; field?: string } },
  options?: CommitOptions
): Promise<MutationResult<T>> {
  return enqueue(async () => {
    try {
      const targetUserId = options?.userId !== undefined ? options.userId : activeUserId;
      const targetKey = getSnapshotKey(targetUserId);
      const currentSnapshot = await getSnapshotFromDB(targetUserId);
      const currentState = currentSnapshot ? currentSnapshot.state : BLANK_STATE;
      const currentLocalVersion = currentSnapshot ? currentSnapshot.revision : 0;
      const baseline = currentSnapshot
        ? snapshotMeta(currentSnapshot, getActiveGenerationIdFor(targetUserId))
        : { localMutationVersion: 0, confirmedRevision: 0, generationId: getActiveGenerationIdFor(targetUserId), confirmedContentHash: '' };

      // Deep clone currentState so mutator cannot mutate in-memory state prematurely
      const stateClone: AppState = JSON.parse(JSON.stringify(currentState));

      const mutationResult = await mutator(stateClone);

      if ('error' in mutationResult && mutationResult.error) {
        return {
          ok: false,
          code: mutationResult.error.code,
          message: mutationResult.error.message,
          field: mutationResult.error.field,
        };
      }

      if ('nextState' in mutationResult) {
        const nextLocalVersion = options?.targetRevision ?? (currentLocalVersion + 1);
        const contentHash = await hashState(mutationResult.nextState);
        const outboxItem = options?.outboxBuilder
          ? options.outboxBuilder(mutationResult.nextState, {
              localMutationVersion: nextLocalVersion,
              confirmedRevision: baseline.confirmedRevision,
              generationId: baseline.generationId,
              contentHash,
            })
          : undefined;

        const newSnapshot: SnapshotRecord = {
          key: targetKey,
          state: mutationResult.nextState,
          version: 3,
          revision: nextLocalVersion,
          confirmedRevision: baseline.confirmedRevision,
          generationId: baseline.generationId,
          confirmedContentHash: baseline.confirmedContentHash,
          contentHash,
          migratedFromV2: currentSnapshot ? currentSnapshot.migratedFromV2 : true,
          updatedAt: new Date().toISOString(),
        };

        await writeMutationToDB(
          newSnapshot,
          mutationResult.newMedia,
          mutationResult.deletedMediaIds,
          currentLocalVersion,
          outboxItem
        );

        return {
          ok: true,
          value: mutationResult.value,
          revision: nextLocalVersion,
        };
      }

      return {
        ok: false,
        code: 'INVALID_MUTATOR_RETURN',
        message: 'Mutator 返回了未知的数据结构',
      };
    } catch (err) {
      return {
        ok: false,
        code: err instanceof RevisionConflictError ? 'REVISION_CONFLICT' : 'COMMIT_FAILED',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  });
}

/**
 * Retrieves pending outbox records for a user (excludes in-flight/quarantined tasks).
 * Used for UI pending counts and legacy callers.
 */
export async function getPendingOutbox(userId: string): Promise<OutboxRecord[]> {
  const all = await getAllOutbox(userId);
  return all.filter(item => item.status === 'pending' || item.status === 'failed');
}

async function getAllOutbox(userId: string): Promise<OutboxRecord[]> {
  if (!hasNativeIdb()) {
    return Array.from(memoryStore.outbox.values())
      .filter(item => item.userId === userId)
      .map(item => structuredClone(item));
  }
  const db = await initDatabase();
  return new Promise<OutboxRecord[]>((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readonly');
    const store = tx.objectStore(OUTBOX_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const all = (req.result || []) as OutboxRecord[];
      resolve(all.filter(item => item.userId === userId));
    };
    req.onerror = () => reject(req.error || new Error('读取待同步队列失败'));
  });
}

export interface UnresolvedLocalChanges {
  userId: string;
  total: number;
  pending: OutboxRecord[];
  flushable: OutboxRecord[];
  failed: OutboxRecord[];
  inFlight: OutboxRecord[];
  quarantined: OutboxRecord[];
  conflict: SyncConflictRecord | null;
  /** True when there is ANY unresolved local modification (incl. quarantine/conflict/in-flight). */
  hasUnsynced: boolean;
}

/**
 * Full picture of unresolved local modifications.
 * Quarantined / stale in-flight / empty-generation tasks still represent unresolved
 * local edits and must never be treated as "no local changes".
 */
export async function getUnresolvedLocalChanges(userId: string): Promise<UnresolvedLocalChanges> {
  const all = await getAllOutbox(userId);
  const conflict = await getConflictRecord(userId);
  const now = Date.now();
  const flushable = all.filter(item => {
    if (item.status !== 'pending' && item.status !== 'failed') return false;
    if (!item.nextAttemptAt) return true;
    return Date.parse(item.nextAttemptAt) <= now;
  });
  const pending = all.filter(item => item.status === 'pending');
  const failed = all.filter(item => item.status === 'failed');
  const inFlight = all.filter(item => item.status === 'in_flight');
  const quarantined = all.filter(item => item.status === 'quarantined' || item.status === 'conflict');
  return {
    userId,
    total: all.length,
    pending,
    flushable,
    failed,
    inFlight,
    quarantined,
    conflict,
    hasUnsynced: all.length > 0 || Boolean(conflict),
  };
}

/**
 * Atomically claims a flushable outbox task with a cross-tab lease.
 * Returns the claimed task, or null when another tab already owns it /
 * the task was removed or blocked in the meantime.
 */
export async function claimOutboxTask(
  id: string,
  owner: string,
  leaseMs = 60000
): Promise<OutboxRecord | null> {
  const now = new Date();
  const nowIso = now.toISOString();
  const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();

  const apply = (item: OutboxRecord): OutboxRecord | null => {
    const claimable =
      item.status === 'pending' ||
      item.status === 'failed' ||
      (item.status === 'in_flight' && Boolean(item.leaseExpiresAt) && Date.parse(item.leaseExpiresAt!) < now.getTime());
    if (!claimable) return null;
    const claimed: OutboxRecord = {
      ...item,
      status: 'in_flight',
      leaseOwner: owner,
      leaseExpiresAt,
    };
    return claimed;
  };

  if (!hasNativeIdb()) {
    const item = memoryStore.outbox.get(id);
    if (!item) return null;
    const claimed = apply(item);
    if (!claimed) return null;
    memoryStore.outbox.set(id, structuredClone(claimed));
    return claimed;
  }

  const db = await initDatabase();
  return new Promise<OutboxRecord | null>((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readwrite');
    const store = tx.objectStore(OUTBOX_STORE);
    let claimed: OutboxRecord | null = null;
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const item = getReq.result as OutboxRecord | undefined;
      if (!item) return;
      const next = apply(item);
      if (!next) return;
      claimed = next;
      store.put(next);
    };
    tx.oncomplete = () => resolve(claimed);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Releases a claimed task after a retryable failure, applying bounded exponential backoff.
 * The task and its attachments stay in the queue for the next automatic retry.
 */
export async function releaseOutboxTask(
  id: string,
  failure: { message?: string; retryAfterMs?: number } = {}
): Promise<void> {
  const now = Date.now();
  const apply = (item: OutboxRecord): OutboxRecord => {
    const attempts = (item.attempts ?? 0) + 1;
    const base = failure.retryAfterMs ?? Math.min(1000 * Math.pow(2, Math.min(attempts, 6)), 60000);
    const jitter = Math.floor(Math.random() * Math.min(base * 0.3, 10000));
    return {
      ...item,
      status: 'failed',
      attempts,
      nextAttemptAt: new Date(now + base + jitter).toISOString(),
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    };
  };

  if (!hasNativeIdb()) {
    const item = memoryStore.outbox.get(id);
    if (item) memoryStore.outbox.set(id, apply(item));
    return;
  }
  const db = await initDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readwrite');
    const store = tx.objectStore(OUTBOX_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const item = getReq.result as OutboxRecord | undefined;
      if (item) store.put(apply(item));
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Compacts the local queue for a flush: takes the newest task identity, rewrites its
 * payload to the latest local snapshot and its expectedRevision to the confirmed cloud
 * baseline, and removes superseded pending tasks in the SAME transaction.
 * Stable requestId of the target task is preserved for server idempotency.
 */
export async function compactOutboxForFlush(
  userId: string,
  requestId: string,
  nextState: AppState,
  expectedRevision: number,
  generationId: string
): Promise<OutboxRecord | null> {
  const contentHash = await hashState(nextState);
  const apply = (items: OutboxRecord[]): OutboxRecord | null => {
    const target = items.find(i => i.userId === userId && i.requestId === requestId);
    if (!target) return null;
    if (target.status === 'quarantined' || target.status === 'conflict' || target.status === 'in_flight') return null;
    const updated: OutboxRecord = {
      ...target,
      state: nextState,
      expectedRevision,
      generationId,
      status: 'pending',
      nextAttemptAt: undefined,
      attempts: target.attempts,
    };
    return updated;
  };

  if (!hasNativeIdb()) {
    const items = Array.from(memoryStore.outbox.values()).filter(i => i.userId === userId);
    const updated = apply(items);
    if (!updated) return null;
    for (const item of items) {
      if (item.requestId !== requestId && (item.status === 'pending' || item.status === 'failed')) {
        memoryStore.outbox.delete(item.id);
      }
    }
    memoryStore.outbox.set(updated.id, structuredClone(updated));
    void contentHash;
    return updated;
  }

  const db = await initDatabase();
  return new Promise<OutboxRecord | null>((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readwrite');
    const store = tx.objectStore(OUTBOX_STORE);
    let updated: OutboxRecord | null = null;
    const req = store.getAll();
    req.onsuccess = () => {
      const all = ((req.result || []) as OutboxRecord[]).filter(i => i.userId === userId);
      const next = apply(all);
      if (!next) return;
      updated = next;
      for (const item of all) {
        if (item.requestId !== requestId && (item.status === 'pending' || item.status === 'failed')) {
          store.delete(item.id);
        }
      }
      store.put(next);
    };
    tx.oncomplete = () => resolve(updated);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export interface PushConfirmation {
  revision: number;
  generationId: string;
  contentHash: string;
}

/**
 * Atomically confirms a successful push:
 * - updates the sync baseline (confirmedRevision/generation/contentHash)
 * - updates snapshot confirmed metadata when the snapshot still holds the pushed content
 * - deletes the outbox task and clears any persisted conflict record
 */
export async function confirmOutboxPush(
  userId: string,
  requestId: string,
  confirmation: PushConfirmation,
  pushedContentHash: string
): Promise<void> {
  const nowIso = new Date().toISOString();
  const baseline: SyncBaseline = {
    userId,
    confirmedRevision: confirmation.revision,
    generationId: confirmation.generationId || confirmation.contentHash ? confirmation.generationId : '',
    contentHash: pushedContentHash,
    updatedAt: nowIso,
  };

  if (!hasNativeIdb()) {
    memoryStore.syncState.set(userId, baseline);
    for (const [id, item] of memoryStore.outbox.entries()) {
      if (item.userId === userId && item.requestId === requestId) memoryStore.outbox.delete(id);
    }
    const snapshot = memoryStore.snapshots.get(getSnapshotKey(userId));
    if (snapshot && snapshot.contentHash === pushedContentHash) {
      memoryStore.snapshots.set(snapshot.key, {
        ...snapshot,
        confirmedRevision: confirmation.revision,
        generationId: confirmation.generationId,
        confirmedContentHash: pushedContentHash,
      });
    }
    memoryStore.conflicts.delete(userId);
    return;
  }

  const db = await initDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction([SNAPSHOTS_STORE, OUTBOX_STORE, SYNC_STATE_STORE], 'readwrite');
    const snapStore = tx.objectStore(SNAPSHOTS_STORE);
    const outStore = tx.objectStore(OUTBOX_STORE);
    const syncStore = tx.objectStore(SYNC_STATE_STORE);
    syncStore.put(baseline);

    const snapKey = getSnapshotKey(userId);
    const snapReq = snapStore.get(snapKey);
    snapReq.onsuccess = () => {
      const snapshot = snapReq.result as SnapshotRecord | undefined;
      if (snapshot && snapshot.contentHash === pushedContentHash) {
        snapStore.put({
          ...snapshot,
          confirmedRevision: confirmation.revision,
          generationId: confirmation.generationId,
          confirmedContentHash: pushedContentHash,
        });
      }
    };

    const outReq = outStore.getAll();
    outReq.onsuccess = () => {
      const items = (outReq.result || []) as OutboxRecord[];
      for (const item of items) {
        if (item.userId === userId && item.requestId === requestId) outStore.delete(item.id);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('同步确认事务失败'));
    tx.onabort = () => reject(tx.error || new Error('同步确认事务中止'));
  });
}

/**
 * Quarantines an outbox task (stale/empty generation after GENERATION_MISMATCH).
 * Quarantined tasks remain in storage as unresolved local modifications.
 */
export async function quarantineOutboxItem(id: string, reason: string): Promise<void> {
  if (!hasNativeIdb()) {
    const item = memoryStore.outbox.get(id);
    if (item) {
      item.status = 'quarantined';
      item.quarantineReason = reason;
    }
    return;
  }
  const db = await initDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readwrite');
    const store = tx.objectStore(OUTBOX_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const item = getReq.result as OutboxRecord | undefined;
      if (item) {
        item.status = 'quarantined';
        item.quarantineReason = reason;
        store.put(item);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Deletes an outbox task after successful synchronization confirmation.
 */
export async function deleteOutboxItem(id: string): Promise<void> {
  if (!hasNativeIdb()) {
    memoryStore.outbox.delete(id);
    return;
  }
  const db = await initDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readwrite');
    const store = tx.objectStore(OUTBOX_STORE);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
    store.delete(id);
  });
}

/**
 * Clears all outbox tasks for a specific user partition
 */
export async function clearOutbox(userId: string): Promise<void> {
  if (!hasNativeIdb()) {
    for (const [id, item] of memoryStore.outbox.entries()) {
      if (item.userId === userId) memoryStore.outbox.delete(id);
    }
    return;
  }
  const db = await initDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readwrite');
    const store = tx.objectStore(OUTBOX_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const all = (req.result || []) as OutboxRecord[];
      for (const item of all) {
        if (item.userId === userId) store.delete(item.id);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Saves a damaged or unparseable state string into damaged_cache for recovery
 */
export async function saveDamagedCache(raw: string, reason: string): Promise<string> {
  const id = `damaged_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const record: DamagedCacheRecord = {
    id,
    raw,
    recordedAt: new Date().toISOString(),
    reason,
  };

  if (!hasNativeIdb()) {
    memoryStore.damaged_cache.set(id, record);
    return id;
  }

  const db = await initDatabase();
  return new Promise<string>((resolve, reject) => {
    const tx = db.transaction(DAMAGED_STORE, 'readwrite');
    const store = tx.objectStore(DAMAGED_STORE);
    tx.oncomplete = () => resolve(id);
    tx.onerror = () => reject(tx.error || new Error('保存受损缓存失败'));
    tx.onabort = () => reject(tx.error || new Error('保存受损缓存事务已中止'));
    store.put(record);
  });
}

/**
 * Retrieves all damaged cache records
 */
export async function getDamagedCaches(): Promise<DamagedCacheRecord[]> {
  if (!hasNativeIdb()) {
    return Array.from(memoryStore.damaged_cache.values());
  }

  const db = await initDatabase();
  return new Promise<DamagedCacheRecord[]>((resolve, reject) => {
    const tx = db.transaction(DAMAGED_STORE, 'readonly');
    const store = tx.objectStore(DAMAGED_STORE);
    const req = store.getAll();

    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error || new Error('读取受损缓存失败'));
  });
}

/**
 * Retrieves a media record by id
 */
export async function getMedia(id: string): Promise<MediaRecord | null> {
  if (!hasNativeIdb()) {
    const item = memoryStore.media.get(id);
    return item ? structuredClone(item) : null;
  }

  const db = await initDatabase();
  return new Promise<MediaRecord | null>((resolve, reject) => {
    const tx = db.transaction(MEDIA_STORE, 'readonly');
    const store = tx.objectStore(MEDIA_STORE);
    const req = store.get(id);

    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error(`读取媒体记录 (${id}) 失败`));
  });
}

/**
 * Saves or updates a media record
 */
export async function saveMedia(record: MediaRecord): Promise<boolean> {
  if (!hasNativeIdb()) {
    memoryStore.media.set(record.id, structuredClone(record));
    return true;
  }

  const db = await initDatabase();
  return new Promise<boolean>((resolve, reject) => {
    const tx = db.transaction(MEDIA_STORE, 'readwrite');
    const store = tx.objectStore(MEDIA_STORE);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('保存媒体记录失败'));
    tx.onabort = () => reject(tx.error || new Error('保存媒体事务已中止'));
    store.put(record);
  });
}

/**
 * Deletes a media record by id
 */
export async function deleteMedia(id: string): Promise<boolean> {
  if (!hasNativeIdb()) {
    memoryStore.media.delete(id);
    return true;
  }

  const db = await initDatabase();
  return new Promise<boolean>((resolve, reject) => {
    const tx = db.transaction(MEDIA_STORE, 'readwrite');
    const store = tx.objectStore(MEDIA_STORE);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error(`删除媒体记录 (${id}) 失败`));
    tx.onabort = () => reject(tx.error || new Error('删除媒体事务已中止'));
    store.delete(id);
  });
}

/**
 * Resets the database: writes BLANK_STATE with migratedFromV2: true
 * so old localStorage data is never re-migrated.
 */
export async function resetDatabase(userId?: string | null): Promise<boolean> {
  return enqueue(async () => {
    const targetUserId = userId !== undefined ? userId : activeUserId;
    const targetKey = getSnapshotKey(targetUserId);
    const current = await getSnapshotFromDB(targetUserId);
    const nextRevision = (current?.revision ?? 0) + 1;
    const resetSnapshot: SnapshotRecord = {
      key: targetKey,
      state: BLANK_STATE,
      version: 3,
      revision: nextRevision,
      confirmedRevision: current?.confirmedRevision ?? 0,
      generationId: current?.generationId ?? '',
      confirmedContentHash: current?.confirmedContentHash ?? '',
      contentHash: await hashState(BLANK_STATE),
      migratedFromV2: true, // Mark migratedFromV2 so localStorage is never re-migrated
      updatedAt: new Date().toISOString(),
    };
    await putSnapshotToDB(resetSnapshot, current?.revision ?? 0);
    return true;
  });
}

/** Resolve local attachment references before generating a portable JSON backup. */
export async function createPortableBackupState(
  state: AppState,
  options?: { isPreview?: boolean }
): Promise<AppState> {
  const portable = structuredClone(state);
  const asDataURL = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('读取备份图片失败'));
    reader.readAsDataURL(blob);
  });
  const resolveImage = async (image: string, storagePath?: string): Promise<string> => {
    // Built-in potato avatars (pose-0 to pose-7), static assets, data URIs, media refs and external URLs are self-contained.
    if (!storagePath && (!image || /^(data:image\/|https?:\/\/)/i.test(image) || image.startsWith('pose-') || image.startsWith('/') || image.startsWith('./') || image.startsWith('media:'))) {
      return image;
    }
    // In isolated preview mode, never query the real persistent IndexedDB media store.
    if (options?.isPreview) {
      return image;
    }
    if (!storagePath && image.startsWith('blob:')) {
      const response = await fetch(image);
      if (!response.ok) throw new Error('无法读取本地错题图片');
      return asDataURL(await response.blob());
    }
    const media = await getMedia(storagePath || image);
    if (!media) throw new Error('备份图片附件缺失，已停止导出，请检查错题照片。');
    if (media.blob instanceof Blob) return asDataURL(media.blob);
    if (typeof media.blob === 'string' && (media.blob.startsWith('data:image/') || media.blob.startsWith('https://'))) return media.blob;
    throw new Error('备份图片附件格式无效，已停止导出。');
  };
  for (const wrong of portable.wrong) {
    wrong.image = await resolveImage(wrong.image, wrong.storagePath);
    delete wrong.storagePath;
  }
  portable.profile.avatar = await resolveImage(portable.profile.avatar);
  return portable;
}

/**
 * Non-sensitive last active user profile metadata for offline cold start (Defect E).
 * Strictly contains NO session tokens, passwords or secrets.
 */
export interface StoredUserMeta {
  id: string;
  username: string;
  nickname: string;
  role: string;
  lastActiveAt: string;
}

const LAST_ACTIVE_USER_STORAGE_KEY = 'kaogong_last_active_user';

export function saveLastActiveUser(user: { id: string; username: string; nickname: string; role: string } | null): void {
  try {
    if (!user) {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(LAST_ACTIVE_USER_STORAGE_KEY);
      }
      memoryStore.meta.delete(LAST_ACTIVE_USER_STORAGE_KEY);
      return;
    }
    const meta: StoredUserMeta = {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      role: user.role,
      lastActiveAt: new Date().toISOString(),
    };
    const json = JSON.stringify(meta);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LAST_ACTIVE_USER_STORAGE_KEY, json);
    }
    memoryStore.meta.set(LAST_ACTIVE_USER_STORAGE_KEY, json);
  } catch (e) {
    console.warn('保存非敏感离线用户信息失败:', e);
  }
}

export function getLastActiveUser(): StoredUserMeta | null {
  try {
    let raw: string | null | undefined = null;
    if (typeof localStorage !== 'undefined') {
      raw = localStorage.getItem(LAST_ACTIVE_USER_STORAGE_KEY);
    }
    if (!raw) {
      raw = memoryStore.meta.get(LAST_ACTIVE_USER_STORAGE_KEY) || null;
    }
    if (!raw) return null;
    return JSON.parse(raw) as StoredUserMeta;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------
// Persistent explicit-logout marker (R11).
// Set only on an EXPLICIT user logout. While set, a still-valid server cookie
// must NOT silently re-enter the app on reload; an explicit login is required.
// Cleared only on successful explicit login/registration. Contains no secrets.
// ----------------------------------------------------------------------
const EXPLICIT_LOGOUT_STORAGE_KEY = 'kaogong_explicit_logout';

export function setExplicitLogoutMarker(loggedOut: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') {
      if (loggedOut) localStorage.setItem(EXPLICIT_LOGOUT_STORAGE_KEY, new Date().toISOString());
      else localStorage.removeItem(EXPLICIT_LOGOUT_STORAGE_KEY);
    }
    if (loggedOut) memoryStore.meta.set(EXPLICIT_LOGOUT_STORAGE_KEY, new Date().toISOString());
    else memoryStore.meta.delete(EXPLICIT_LOGOUT_STORAGE_KEY);
  } catch {}
}

export function hasExplicitLogoutMarker(): boolean {
  try {
    if (typeof localStorage !== 'undefined') return Boolean(localStorage.getItem(EXPLICIT_LOGOUT_STORAGE_KEY));
    return memoryStore.meta.has(EXPLICIT_LOGOUT_STORAGE_KEY);
  } catch {
    return false;
  }
}

const ACTIVE_GEN_STORAGE_PREFIX = 'kaogong_active_gen_';

export function saveActiveGenerationId(userId: string, generationId: string): void {
  try {
    const key = `${ACTIVE_GEN_STORAGE_PREFIX}${userId}`;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, generationId);
    }
    memoryStore.meta.set(key, generationId);
  } catch {}
}

export function getActiveGenerationId(userId: string): string {
  return getActiveGenerationIdFor(userId);
}

function getActiveGenerationIdFor(userId: string | null | undefined): string {
  try {
    if (!userId) return '';
    const key = `${ACTIVE_GEN_STORAGE_PREFIX}${userId}`;
    if (typeof localStorage !== 'undefined') {
      const val = localStorage.getItem(key);
      if (val) return val;
    }
    return memoryStore.meta.get(key) || '';
  } catch {
    return '';
  }
}

// ----------------------------------------------------------------------
// Sync baseline & persisted conflict state
// ----------------------------------------------------------------------

export async function getSyncBaseline(userId: string): Promise<SyncBaseline | null> {
  if (!hasNativeIdb()) {
    const item = memoryStore.syncState.get(userId);
    return item ? structuredClone(item) : null;
  }
  const db = await initDatabase();
  return new Promise<SyncBaseline | null>((resolve, reject) => {
    const tx = db.transaction(SYNC_STATE_STORE, 'readonly');
    const req = tx.objectStore(SYNC_STATE_STORE).get(userId);
    req.onsuccess = () => resolve((req.result as SyncBaseline | undefined) || null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSyncBaseline(baseline: SyncBaseline): Promise<void> {
  if (!hasNativeIdb()) {
    memoryStore.syncState.set(baseline.userId, structuredClone(baseline));
    return;
  }
  const db = await initDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SYNC_STATE_STORE, 'readwrite');
    tx.objectStore(SYNC_STATE_STORE).put(baseline);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getConflictRecord(userId: string): Promise<SyncConflictRecord | null> {
  if (!hasNativeIdb()) {
    const item = memoryStore.conflicts.get(userId);
    return item ? structuredClone(item) : null;
  }
  // Conflict record is persisted in the snapshot store under a dedicated key so it
  // participates in the same transactional files as snapshots (no extra store needed).
  const db = await initDatabase();
  return new Promise<SyncConflictRecord | null>((resolve, reject) => {
    const tx = db.transaction(SYNC_STATE_STORE, 'readonly');
    const req = tx.objectStore(SYNC_STATE_STORE).get(`conflict_${userId}`);
    req.onsuccess = () => {
      const row = req.result as any;
      resolve(row?.conflict || null);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveConflictRecord(record: SyncConflictRecord): Promise<void> {
  if (!hasNativeIdb()) {
    memoryStore.conflicts.set(record.userId, structuredClone(record));
    return;
  }
  const db = await initDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SYNC_STATE_STORE, 'readwrite');
    tx.objectStore(SYNC_STATE_STORE).put({ userId: `conflict_${record.userId}`, conflict: record });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function clearConflictRecord(userId: string): Promise<void> {
  if (!hasNativeIdb()) {
    memoryStore.conflicts.delete(userId);
    return;
  }
  const db = await initDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SYNC_STATE_STORE, 'readwrite');
    tx.objectStore(SYNC_STATE_STORE).delete(`conflict_${userId}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// ----------------------------------------------------------------------
// Server-state installation / recovery
// ----------------------------------------------------------------------

/**
 * Atomically installs a confirmed server snapshot into the local partition and
 * records the matching sync baseline. By default refuses to overwrite when ANY
 * unresolved local modification exists (including quarantined/in-flight tasks);
 * callers resolving a user-confirmed conflict pass force=true after saving a
 * recovery point.
 */
export async function installConfirmedServerState(
  userId: string,
  serverState: AppState,
  meta: { revision: number; generationId: string; contentHash: string; snapshotGenerationId?: string },
  options: { force?: boolean; saveRecovery?: boolean; localMutationVersion?: number } = {}
): Promise<{ ok: boolean; code?: string; message?: string }> {
  return enqueue(async () => {
    const contentHash = meta.contentHash || await hashState(serverState);
    const baseline: SyncBaseline = {
      userId,
      confirmedRevision: meta.revision,
      generationId: meta.generationId,
      contentHash,
      updatedAt: new Date().toISOString(),
    };

    if (!hasNativeIdb()) {
      const unresolved = await getUnresolvedLocalChanges(userId);
      if (!options.force && unresolved.hasUnsynced) {
        return { ok: false, code: 'LOCAL_UNRESOLVED', message: '本机存在未同步修改，不能直接覆盖' };
      }
      const current = memoryStore.snapshots.get(getSnapshotKey(userId));
      if (options.saveRecovery !== false && current?.state) {
        memoryStore.snapshots.set(getRecoveryKey(userId), {
          key: getRecoveryKey(userId),
          state: structuredClone(current.state),
          version: 3,
          revision: current.revision ?? 0,
          migratedFromV2: true,
          updatedAt: new Date().toISOString(),
        });
      }
      for (const [id, item] of memoryStore.outbox.entries()) {
        if (item.userId === userId && options.force) memoryStore.outbox.delete(id);
      }
      memoryStore.syncState.set(userId, structuredClone(baseline));
      memoryStore.conflicts.delete(userId);
      memoryStore.snapshots.set(getSnapshotKey(userId), {
        key: getSnapshotKey(userId),
        state: serverState,
        version: 3,
        revision: Math.max((current?.revision ?? 0) + 1, 1),
        confirmedRevision: meta.revision,
        generationId: meta.generationId,
        confirmedContentHash: contentHash,
        contentHash,
        migratedFromV2: true,
        updatedAt: new Date().toISOString(),
      });
      return { ok: true };
    }

    const db = await initDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([SNAPSHOTS_STORE, OUTBOX_STORE, SYNC_STATE_STORE], 'readwrite');
      const snapStore = tx.objectStore(SNAPSHOTS_STORE);
      const outStore = tx.objectStore(OUTBOX_STORE);
      const syncStore = tx.objectStore(SYNC_STATE_STORE);
      const snapKey = getSnapshotKey(userId);
      let result: { ok: boolean; code?: string; message?: string } = { ok: true };

      const outReq = outStore.getAll();
      outReq.onsuccess = () => {
        const items = ((outReq.result || []) as OutboxRecord[]).filter(i => i.userId === userId);
        if (!options.force && items.length > 0) {
          result = { ok: false, code: 'LOCAL_UNRESOLVED', message: '本机存在未同步修改，不能直接覆盖' };
          tx.abort();
          return;
        }
        const snapReq = snapStore.get(snapKey);
        snapReq.onsuccess = () => {
          const current = snapReq.result as SnapshotRecord | undefined;
          if (options.saveRecovery !== false && current?.state) {
            snapStore.put({
              key: getRecoveryKey(userId),
              state: current.state,
              version: 3,
              revision: current.revision ?? 0,
              migratedFromV2: true,
              updatedAt: new Date().toISOString(),
            } as SnapshotRecord);
          }
          if (options.force) {
            for (const item of items) outStore.delete(item.id);
          }
          syncStore.put(baseline);
          syncStore.delete(`conflict_${userId}`);
          snapStore.put({
            key: snapKey,
            state: serverState,
            version: 3,
            revision: Math.max((current?.revision ?? 0) + 1, options.localMutationVersion ?? 1),
            confirmedRevision: meta.revision,
            generationId: meta.generationId,
            confirmedContentHash: contentHash,
            contentHash,
            migratedFromV2: true,
            updatedAt: new Date().toISOString(),
          } as SnapshotRecord);
        };
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('安装云端快照事务失败'));
      tx.onabort = () => {
        if (result.ok) reject(new Error('安装云端快照事务中止，原数据未改变'));
        else resolve(result);
      };
    });
  });
}

/**
 * Atomically replaces user snapshot, removes stale outbox items, and optionally records
 * a new forced outbox mutation inside a single IndexedDB transaction (Defect G).
 * Guarantees zero outbox loss if transaction aborts.
 */
export async function atomicResolveConflict(
  userId: string,
  newSnapshot: SnapshotRecord,
  expectedRevision: number,
  newOutboxItem?: OutboxRecord
): Promise<void> {
  return enqueue(async () => {
    const contentHash = newSnapshot.contentHash || await hashState(newSnapshot.state);
    if (!hasNativeIdb()) {
      const current = memoryStore.snapshots.get(newSnapshot.key);
      const curRev = current ? current.revision : 0;
      if (expectedRevision > 0 && curRev !== expectedRevision) {
        throw new RevisionConflictError(expectedRevision, curRev);
      }
      // Backup for rollback and save emergency recovery point (Defect F06)
      const prevOutbox = new Map(memoryStore.outbox);
      const prevSnapshot = current ? structuredClone(current) : undefined;
      if (current && current.state) {
        const recoveryPoint: SnapshotRecord = {
          key: getRecoveryKey(userId),
          state: structuredClone(current.state),
          version: 3,
          revision: curRev,
          migratedFromV2: current.migratedFromV2,
          updatedAt: new Date().toISOString(),
        };
        memoryStore.snapshots.set(getRecoveryKey(userId), recoveryPoint);
        memoryStore.snapshots.set(`recovery_${userId}_${Date.now()}`, recoveryPoint);
      }
      try {
        for (const [id, item] of memoryStore.outbox.entries()) {
          if (item.userId === userId) memoryStore.outbox.delete(id);
        }
        memoryStore.snapshots.set(newSnapshot.key, structuredClone({
          ...newSnapshot,
          contentHash,
          confirmedRevision: newSnapshot.confirmedRevision ?? 0,
          generationId: newSnapshot.generationId ?? '',
          confirmedContentHash: newSnapshot.confirmedContentHash ?? contentHash,
        }));
        if (newOutboxItem) {
          memoryStore.outbox.set(newOutboxItem.id, structuredClone(newOutboxItem));
        }
        memoryStore.syncState.set(userId, {
          userId,
          confirmedRevision: newSnapshot.confirmedRevision ?? 0,
          generationId: newSnapshot.generationId ?? '',
          contentHash: newSnapshot.confirmedContentHash ?? contentHash,
          updatedAt: new Date().toISOString(),
        });
        memoryStore.conflicts.delete(userId);
      } catch (e) {
        memoryStore.outbox = prevOutbox;
        if (prevSnapshot) memoryStore.snapshots.set(newSnapshot.key, prevSnapshot);
        throw e;
      }
      return;
    }

    const db = await initDatabase();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction([SNAPSHOTS_STORE, OUTBOX_STORE, SYNC_STATE_STORE], 'readwrite');
      const snapStore = tx.objectStore(SNAPSHOTS_STORE);
      const outStore = tx.objectStore(OUTBOX_STORE);
      const syncStore = tx.objectStore(SYNC_STATE_STORE);

      const getReq = snapStore.get(newSnapshot.key);
      getReq.onsuccess = () => {
        const curSnap = getReq.result as SnapshotRecord | undefined;
        const curRev = curSnap ? curSnap.revision : 0;
        if (expectedRevision > 0 && curRev !== expectedRevision) {
          tx.abort();
          reject(new RevisionConflictError(expectedRevision, curRev));
          return;
        }

        // 1. 关键修复 (Defect F06)：覆盖前在同一原子事务中先持久化本机恢复快照
        if (curSnap && curSnap.state) {
          const recoverySnap: SnapshotRecord = {
            key: getRecoveryKey(userId),
            state: curSnap.state,
            version: 3,
            revision: curRev,
            migratedFromV2: curSnap.migratedFromV2,
            updatedAt: new Date().toISOString(),
          };
          snapStore.put(recoverySnap);

          const historySnap: SnapshotRecord = {
            key: `recovery_${userId}_${Date.now()}`,
            state: curSnap.state,
            version: 3,
            revision: curRev,
            migratedFromV2: curSnap.migratedFromV2,
            updatedAt: new Date().toISOString(),
          };
          snapStore.put(historySnap);
        }

        // 2. Delete all existing outbox items for this user
        const outReq = outStore.getAll();
        outReq.onsuccess = () => {
          const items = (outReq.result || []) as OutboxRecord[];
          for (const item of items) {
            if (item.userId === userId) {
              outStore.delete(item.id);
            }
          }

          // 3. Write new snapshot with separated versions
          snapStore.put({
            ...newSnapshot,
            contentHash,
            confirmedRevision: newSnapshot.confirmedRevision ?? 0,
            generationId: newSnapshot.generationId ?? '',
            confirmedContentHash: newSnapshot.confirmedContentHash ?? contentHash,
          });

          // 4. Write optional new outbox item
          if (newOutboxItem) {
            outStore.put(newOutboxItem);
          }

          // 5. Sync baseline + clear persisted conflict
          syncStore.put({
            userId,
            confirmedRevision: newSnapshot.confirmedRevision ?? 0,
            generationId: newSnapshot.generationId ?? '',
            contentHash: newSnapshot.confirmedContentHash ?? contentHash,
            updatedAt: new Date().toISOString(),
          } as SyncBaseline);
          syncStore.delete(`conflict_${userId}`);
        };
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('冲突解决事务提交失败'));
      tx.onabort = () => reject(tx.error || new Error('冲突解决事务已被中止，原数据未改变'));
    });
  });
}

/**
 * @deprecated Unsafe for UI use (deletes snapshots + outbox). Kept only for legacy
 * callers/tests; user-facing cache clearing must use clearSafeCaches().
 */
export async function clearLocalCache(userId?: string | null): Promise<void> {
  return enqueue(async () => {
    const targetUserId = userId !== undefined ? userId : activeUserId;
    const targetKey = getSnapshotKey(targetUserId);

    if (!hasNativeIdb()) {
      memoryStore.snapshots.delete(targetKey);
      for (const [id, item] of memoryStore.outbox.entries()) {
        if (item.userId === targetUserId) memoryStore.outbox.delete(id);
      }
      return;
    }

    const db = await initDatabase();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction([SNAPSHOTS_STORE, OUTBOX_STORE], 'readwrite');
      tx.objectStore(SNAPSHOTS_STORE).delete(targetKey);
      const outStore = tx.objectStore(OUTBOX_STORE);
      const req = outStore.getAll();
      req.onsuccess = () => {
        const items = (req.result || []) as OutboxRecord[];
        for (const item of items) {
          if (item.userId === targetUserId) {
            outStore.delete(item.id);
          }
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  });
}

export interface ClearSafeCacheResult {
  ok: boolean;
  code?: string;
  message: string;
  clearedRecords: number;
  freedBytes: number;
}

/**
 * "清理缓存"安全语义：只释放可安全重建的缓存（受损数据缓存、超期媒体迁移副本），
 * 绝不在存在未同步修改时删除账号快照 / outbox / 被引用附件 / 恢复点。
 */
export async function clearSafeCaches(userId: string | null): Promise<ClearSafeCacheResult> {
  return withUserLock(userId, async () => {
    const targetUserId = userId ?? null;
    if (targetUserId) {
      const unresolved = await getUnresolvedLocalChanges(targetUserId);
      if (unresolved.hasUnsynced) {
        return {
          ok: false,
          code: 'UNSYNCED_DATA_PRESERVED',
          message: `检测到 ${unresolved.total} 项未同步修改或待处理冲突，已保留本机账号快照、同步队列与照片，未执行清理。请先完成同步。`,
          clearedRecords: 0,
          freedBytes: 0,
        };
      }
    }

    const damaged = await getDamagedCaches();
    let freedBytes = 0;
    let clearedRecords = 0;
    const safeToClear = damaged.filter(record => {
      // 只清理可安全重建的受损旧缓存；保留最近 24 小时内的受损记录用于恢复排查。
      const age = Date.now() - Date.parse(record.recordedAt);
      return Number.isFinite(age) ? age > 24 * 60 * 60 * 1000 : true;
    });
    for (const record of safeToClear) {
      freedBytes += (record.raw || '').length;
      clearedRecords += 1;
    }

    if (safeToClear.length > 0) {
      if (!hasNativeIdb()) {
        for (const record of safeToClear) memoryStore.damaged_cache.delete(record.id);
      } else {
        const db = await initDatabase();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(DAMAGED_STORE, 'readwrite');
          const store = tx.objectStore(DAMAGED_STORE);
          for (const record of safeToClear) store.delete(record.id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      }
    }

    return {
      ok: true,
      message: clearedRecords > 0
        ? `已清理 ${clearedRecords} 条可安全重建的旧缓存，账号快照、未同步记录与照片均已保留。`
        : '没有可安全清理的缓存，已保留全部账号数据。',
      clearedRecords,
      freedBytes,
    };
  });
}

/**
 * Retrieves the latest auto-saved emergency recovery snapshot (Defect F06).
 */
export async function getLatestRecoverySnapshot(userId?: string | null): Promise<SnapshotRecord | null> {
  const targetUserId = userId !== undefined ? userId : activeUserId;
  const key = getRecoveryKey(targetUserId);
  if (!hasNativeIdb()) {
    const item = memoryStore.snapshots.get(key);
    return item ? JSON.parse(JSON.stringify(item)) : null;
  }
  const db = await initDatabase();
  return new Promise<SnapshotRecord | null>((resolve, reject) => {
    const tx = db.transaction(SNAPSHOTS_STORE, 'readonly');
    const req = tx.objectStore(SNAPSHOTS_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Explicitly saves a recovery snapshot before destructive operations like reset (Defect F06).
 */
export async function saveRecoverySnapshot(
  userId: string | null,
  state: AppState,
  revision: number
): Promise<void> {
  const targetUserId = userId !== undefined ? userId : activeUserId;
  const record: SnapshotRecord = {
    key: getRecoveryKey(targetUserId),
    state: structuredClone(state),
    version: 3,
    revision,
    migratedFromV2: true,
    updatedAt: new Date().toISOString(),
  };
  const historyRecord: SnapshotRecord = {
    key: `recovery_${targetUserId}_${Date.now()}`,
    state: structuredClone(state),
    version: 3,
    revision,
    migratedFromV2: true,
    updatedAt: new Date().toISOString(),
  };

  if (!hasNativeIdb()) {
    memoryStore.snapshots.set(record.key, record);
    memoryStore.snapshots.set(historyRecord.key, historyRecord);
    return;
  }
  const db = await initDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SNAPSHOTS_STORE, 'readwrite');
    const store = tx.objectStore(SNAPSHOTS_STORE);
    store.put(record);
    store.put(historyRecord);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// ----------------------------------------------------------------------
// Media migration (legacy data URLs -> server media refs)
// ----------------------------------------------------------------------

const DATA_URL_PATTERN = /^data:image\/(jpeg|jpg|png|webp);base64,/i;

export function isLegacyDataUrl(value: string | undefined | null): boolean {
  return Boolean(value && DATA_URL_PATTERN.test(value));
}

export function isLocalOnlyImageRef(value: string | undefined | null): boolean {
  if (!value) return false;
  return value.startsWith('blob:') || DATA_URL_PATTERN.test(value) || /^file:\/\//i.test(value);
}

export interface MediaRefReplacement {
  from: string;
  to: string;
}

/**
 * Atomically replaces legacy local image references (data URLs / blob refs) with
 * confirmed server media references across the account snapshot AND every queued
 * outbox payload. Writes the uploaded media records and keeps a pre-migration copy
 * in the recovery store until sync confirms successfully.
 */
export async function applyMediaRefMappings(
  userId: string,
  replacements: MediaRefReplacement[],
  mediaRecords: MediaRecord[]
): Promise<{ changed: boolean; revision: number; pendingRequestId?: string }> {
  const effective = replacements.filter(r => r.from && r.to && r.from !== r.to);
  if (effective.length === 0) {
    const snapshot = await getSnapshotFromDB(userId);
    return { changed: false, revision: snapshot?.revision ?? 0 };
  }

  const replaceInJson = (json: string): string => {
    let next = json;
    for (const r of effective) next = next.split(r.from).join(r.to);
    return next;
  };

  const applyState = (state: AppState): AppState => {
    const json = replaceInJson(JSON.stringify(state));
    return JSON.parse(json) as AppState;
  };

  return enqueue(async () => {
    if (!hasNativeIdb()) {
      const key = getSnapshotKey(userId);
      const snapshot = memoryStore.snapshots.get(key);
      if (!snapshot) return { changed: false, revision: 0 };
      const nextState = applyState(snapshot.state);
      const contentHash = await hashState(nextState);
      const nextSnapshot: SnapshotRecord = {
        ...snapshot,
        state: nextState,
        revision: snapshot.revision,
        contentHash,
        updatedAt: new Date().toISOString(),
      };
      memoryStore.snapshots.set(key, nextSnapshot);
      memoryStore.snapshots.set(`media_backup_${userId}_latest`, { ...snapshot });
      for (const record of mediaRecords) memoryStore.media.set(record.id, structuredClone(record));
      let pendingRequestId: string | undefined;
      for (const item of memoryStore.outbox.values()) {
        if (item.userId !== userId) continue;
        item.state = applyState(item.state);
        memoryStore.outbox.set(item.id, item);
        pendingRequestId = item.requestId;
      }
      return { changed: true, revision: nextSnapshot.revision, pendingRequestId };
    }

    const db = await initDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([SNAPSHOTS_STORE, OUTBOX_STORE, MEDIA_STORE], 'readwrite');
      const snapStore = tx.objectStore(SNAPSHOTS_STORE);
      const outStore = tx.objectStore(OUTBOX_STORE);
      const mediaStore = tx.objectStore(MEDIA_STORE);
      const key = getSnapshotKey(userId);
      let outcome: { changed: boolean; revision: number; pendingRequestId?: string } = { changed: false, revision: 0 };
      const snapReq = snapStore.get(key);
      snapReq.onsuccess = () => {
        const snapshot = snapReq.result as SnapshotRecord | undefined;
        if (!snapshot) return;
        const nextState = applyState(snapshot.state);
        // Keep a pre-migration recovery copy (never deleted automatically).
        snapStore.put({ ...snapshot, key: `media_backup_${userId}_latest` });
        const outReq = outStore.getAll();
        outReq.onsuccess = () => {
          const items = ((outReq.result || []) as OutboxRecord[]).filter(i => i.userId === userId);
          let pendingRequestId: string | undefined;
          for (const item of items) {
            outStore.put({ ...item, state: applyState(item.state) });
            pendingRequestId = item.requestId;
          }
          for (const record of mediaRecords) mediaStore.put(record);
          hashState(nextState).then(contentHash => {
            snapStore.put({
              ...snapshot,
              state: nextState,
              revision: snapshot.revision,
              contentHash,
              updatedAt: new Date().toISOString(),
            });
            outcome = { changed: true, revision: snapshot.revision, pendingRequestId };
          }).catch(err => {
            tx.abort();
            reject(err);
          });
        };
      };
      tx.oncomplete = () => resolve(outcome);
      tx.onerror = () => reject(tx.error || new Error('附件引用迁移事务失败'));
      tx.onabort = () => reject(tx.error || new Error('附件引用迁移事务中止，原数据未改变'));
    });
  });
}

/**
 * Creates a pending outbox task for a media migration when the snapshot holds
 * legacy local-only image references but no queued workspace task exists yet.
 */
export async function createMediaMigrationOutbox(userId: string): Promise<OutboxRecord | null> {
  const snapshot = await getSnapshotFromDB(userId);
  if (!snapshot) return null;
  const baseline = await getSyncBaseline(userId);
  const contentHash = await hashState(snapshot.state);
  const item: OutboxRecord = {
    id: `outbox_media_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    userId,
    requestId: `req_media_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    state: snapshot.state,
    expectedRevision: baseline?.confirmedRevision ?? snapshot.confirmedRevision ?? 0,
    generationId: baseline?.generationId ?? snapshot.generationId ?? '',
    createdAt: new Date().toISOString(),
    status: 'pending',
    reason: 'media_migration',
    confirmedContentHash: contentHash,
  };
  if (!hasNativeIdb()) {
    memoryStore.outbox.set(item.id, item);
    return item;
  }
  const db = await initDatabase();
  return new Promise<OutboxRecord | null>((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readwrite');
    tx.objectStore(OUTBOX_STORE).put(item);
    tx.oncomplete = () => resolve(item);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** List locally cached media records (used to preserve references before cleanup). */
export async function listMedia(): Promise<MediaRecord[]> {
  if (!hasNativeIdb()) return Array.from(memoryStore.media.values()).map(m => structuredClone(m));
  const db = await initDatabase();
  return new Promise<MediaRecord[]>((resolve, reject) => {
    const tx = db.transaction(MEDIA_STORE, 'readonly');
    const req = tx.objectStore(MEDIA_STORE).getAll();
    req.onsuccess = () => resolve((req.result || []) as MediaRecord[]);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Saves a recovery snapshot under an explicit key/label (e.g. guest-migration
 * pre-checks) so multiple recovery points of different origins can coexist
 * without overwriting `recovery_<user>_latest`.
 */
export async function saveNamedRecoverySnapshot(
  userId: string | null,
  state: AppState,
  revision: number,
  label: string
): Promise<string> {
  const targetUserId = userId ?? 'guest';
  const key = `recovery_${targetUserId}_${label}_${Date.now()}`;
  const record: SnapshotRecord = {
    key,
    state: structuredClone(state),
    version: 3,
    revision,
    migratedFromV2: true,
    updatedAt: new Date().toISOString(),
  };
  if (!hasNativeIdb()) {
    memoryStore.snapshots.set(key, record);
    return key;
  }
  const db = await initDatabase();
  return new Promise<string>((resolve, reject) => {
    const tx = db.transaction(SNAPSHOTS_STORE, 'readwrite');
    tx.objectStore(SNAPSHOTS_STORE).put(record);
    tx.oncomplete = () => resolve(key);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Reads the raw legacy v2 guest payload from localStorage (if any). */
export function readLegacyGuestRaw(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    return raw && raw.trim() ? raw : null;
  } catch {
    return null;
  }
}

/** One-time guest-migration marker (kept per account; does not delete legacy data). */
const GUEST_MIGRATED_PREFIX = 'kaogong_guest_migrated_';

export function isGuestMigrationDone(userId: string): boolean {
  try {
    if (typeof localStorage === 'undefined') return memoryStore.meta.has(`${GUEST_MIGRATED_PREFIX}${userId}`);
    return Boolean(localStorage.getItem(`${GUEST_MIGRATED_PREFIX}${userId}`));
  } catch {
    return false;
  }
}

export function markGuestMigrationDone(userId: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`${GUEST_MIGRATED_PREFIX}${userId}`, new Date().toISOString());
    }
    memoryStore.meta.set(`${GUEST_MIGRATED_PREFIX}${userId}`, new Date().toISOString());
  } catch {}
}
