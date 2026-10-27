import {
  AppState,
  MutationResult,
  MediaRecord,
  SnapshotRecord,
  DamagedCacheRecord,
  OutboxRecord,
  SyncBaseline,
  SyncConflictRecord,
  LockScope,
  OperationScope,
  OperationContext,
  WorkspacePushPayload,
  PreparedOutboxCompaction,
  WrongRecord,
} from '../types';

export type { LockScope, OperationScope, OperationContext, WorkspacePushPayload, PreparedOutboxCompaction };
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
// Storage Availability & Fail-Fast Guard
// ----------------------------------------------------------------------
export function checkStorageAvailable(): void {
  if (typeof window !== 'undefined') {
    if (typeof indexedDB === 'undefined' || indexedDB === null) {
      const err: any = new Error('IndexedDB is unavailable in this browser environment');
      err.code = 'STORAGE_UNAVAILABLE';
      throw err;
    }
  }
}

// ----------------------------------------------------------------------
// Lock & Lease Coordination (Web Locks + IDB sync_state lease fallback)
// ----------------------------------------------------------------------
interface LockRecord {
  userId: string; // keyPath is 'userId', stored as 'lock:<userId>'
  ownerId: string;
  fence: number;
  expiresAt: number;
}

function notifyLockRelease(userId: string): void {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel(`kaogong_lock_${userId}`);
      bc.postMessage({ type: 'released', userId });
      bc.close();
    }
  } catch {}
}

async function tryAcquireLeaseRecord(normalizedUserId: string, ownerId: string): Promise<{ fence: number; expiresAt: number } | null> {
  const lockKey = `lock:${normalizedUserId}`;
  if (!hasNativeIdb()) {
    const current = memoryStore.syncState.get(lockKey) as unknown as LockRecord | undefined;
    const now = Date.now();
    if (current && current.expiresAt > now && current.ownerId !== ownerId) {
      return null;
    }
    const fence = (current?.fence ?? 0) + 1;
    const expiresAt = now + 30000;
    const record: LockRecord = { userId: lockKey, ownerId, fence, expiresAt };
    memoryStore.syncState.set(lockKey, record as any);
    return { fence, expiresAt };
  }

  const db = await initDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_STATE_STORE, 'readwrite');
    const store = tx.objectStore(SYNC_STATE_STORE);
    const req = store.get(lockKey);
    let result: { fence: number; expiresAt: number } | null = null;

    req.onsuccess = () => {
      const current = req.result as LockRecord | undefined;
      const now = Date.now();
      if (current && current.expiresAt > now && current.ownerId !== ownerId) {
        result = null;
        return;
      }
      const fence = (current?.fence ?? 0) + 1;
      const expiresAt = now + 30000;
      const record: LockRecord = { userId: lockKey, ownerId, fence, expiresAt };
      store.put(record);
      result = { fence, expiresAt };
    };

    req.onerror = () => reject(req.error);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function renewLeaseRecord(normalizedUserId: string, ownerId: string, fence: number): Promise<{ expiresAt: number } | null> {
  const lockKey = `lock:${normalizedUserId}`;
  if (!hasNativeIdb()) {
    const current = memoryStore.syncState.get(lockKey) as unknown as LockRecord | undefined;
    if (!current || current.ownerId !== ownerId || current.fence !== fence) {
      return null;
    }
    const expiresAt = Date.now() + 30000;
    current.expiresAt = expiresAt;
    memoryStore.syncState.set(lockKey, current as any);
    return { expiresAt };
  }

  const db = await initDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_STATE_STORE, 'readwrite');
    const store = tx.objectStore(SYNC_STATE_STORE);
    const req = store.get(lockKey);
    let result: { expiresAt: number } | null = null;

    req.onsuccess = () => {
      const current = req.result as LockRecord | undefined;
      if (!current || current.ownerId !== ownerId || current.fence !== fence) {
        result = null;
        return;
      }
      const expiresAt = Date.now() + 30000;
      current.expiresAt = expiresAt;
      store.put(current);
      result = { expiresAt };
    };

    req.onerror = () => reject(req.error);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function releaseLeaseRecord(normalizedUserId: string, ownerId: string, fence: number): Promise<void> {
  const lockKey = `lock:${normalizedUserId}`;
  if (!hasNativeIdb()) {
    const current = memoryStore.syncState.get(lockKey) as unknown as LockRecord | undefined;
    if (current && current.ownerId === ownerId && current.fence === fence) {
      current.expiresAt = 0; // PRESERVE fence! Never reset to 0
      memoryStore.syncState.set(lockKey, current as any);
    }
    notifyLockRelease(normalizedUserId);
    return;
  }

  const db = await initDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SYNC_STATE_STORE, 'readwrite');
    const store = tx.objectStore(SYNC_STATE_STORE);
    const req = store.get(lockKey);

    req.onsuccess = () => {
      const current = req.result as LockRecord | undefined;
      if (current && current.ownerId === ownerId && current.fence === fence) {
        current.expiresAt = 0; // PRESERVE fence! Never reset to 0
        store.put(current);
      }
    };

    req.onerror = () => reject(req.error);
    tx.oncomplete = () => {
      notifyLockRelease(normalizedUserId);
      resolve();
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function withUserLock<T>(
  userId: string | null | undefined,
  task: (scope: LockScope) => Promise<T>,
  existingScope?: LockScope
): Promise<T> {
  checkStorageAvailable();

  const normalizedUserId = userId ?? 'guest';

  // If existingScope is passed, verify and reuse without re-acquiring:
  if (existingScope) {
    if (existingScope.userId === normalizedUserId && !existingScope.isExpired()) {
      return await task(existingScope);
    }
  }

  const hasLocks = typeof navigator !== 'undefined' && (navigator as any).locks && typeof (navigator as any).locks.request === 'function';
  const ownerId = `owner_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  if (hasLocks) {
    const lockName = `kaogong_sync_lock_${normalizedUserId}`;
    return await (navigator as any).locks.request(lockName, { mode: 'exclusive' }, async () => {
      let isRevoked = false;
      const lease = await tryAcquireLeaseRecord(normalizedUserId, ownerId);
      const fence = lease?.fence ?? 1;
      let currentExpiresAt = lease?.expiresAt ?? (Date.now() + 30000);

      const scope: LockScope = {
        ownerId,
        userId: normalizedUserId,
        fence,
        get expiresAt() {
          return currentExpiresAt;
        },
        isExpired: () => isRevoked || Date.now() > currentExpiresAt,
      };

      const renewTimer = setInterval(async () => {
        try {
          const res = await renewLeaseRecord(normalizedUserId, ownerId, fence);
          if (res) {
            currentExpiresAt = res.expiresAt;
          } else {
            isRevoked = true;
            clearInterval(renewTimer);
          }
        } catch {
          isRevoked = true;
          clearInterval(renewTimer);
        }
      }, 5000);

      try {
        return await task(scope);
      } finally {
        clearInterval(renewTimer);
        await releaseLeaseRecord(normalizedUserId, ownerId, fence).catch(() => {});
      }
    });
  }

  // Fallback without Web Locks: coordinate via sync_state lease
  const maxWaitMs = 35000;
  const startWait = Date.now();
  let lease: { fence: number; expiresAt: number } | null = null;

  while (Date.now() - startWait < maxWaitMs) {
    lease = await tryAcquireLeaseRecord(normalizedUserId, ownerId);
    if (lease) break;

    await new Promise<void>(resolve => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let bc: BroadcastChannel | null = null;

      const done = () => {
        if (timer) clearTimeout(timer);
        if (bc) {
          try { bc.close(); } catch {}
        }
        resolve();
      };

      timer = setTimeout(done, 25);

      try {
        if (typeof BroadcastChannel !== 'undefined') {
          bc = new BroadcastChannel(`kaogong_lock_${normalizedUserId}`);
          bc.onmessage = (e) => {
            if (e.data?.type === 'released') {
              done();
            }
          };
        }
      } catch {}
    });
  }

  if (!lease) {
    throw new Error(`Failed to acquire user lock for ${normalizedUserId} (lease wait timeout)`);
  }

  const fence = lease.fence;
  let currentExpiresAt = lease.expiresAt;
  let isRevoked = false;

  const scope: LockScope = {
    ownerId,
    userId: normalizedUserId,
    fence,
    get expiresAt() {
      return currentExpiresAt;
    },
    isExpired: () => isRevoked || Date.now() > currentExpiresAt,
  };

  const renewTimer = setInterval(async () => {
    try {
      const res = await renewLeaseRecord(normalizedUserId, ownerId, fence);
      if (res) {
        currentExpiresAt = res.expiresAt;
      } else {
        isRevoked = true;
        clearInterval(renewTimer);
      }
    } catch {
      isRevoked = true;
      clearInterval(renewTimer);
    }
  }, 5000);

  try {
    return await task(scope);
  } finally {
    clearInterval(renewTimer);
    await releaseLeaseRecord(normalizedUserId, ownerId, fence).catch(() => {});
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
}

const hasNativeIdb = (): boolean => typeof indexedDB !== 'undefined' && indexedDB !== null;

/**
 * Initializes and opens the IndexedDB database 'kaogong_potato_v3'.
 * Creates/upgrades 'snapshots', 'media', 'damaged_cache', 'outbox', 'sync_state'.
 * Incremental upgrade only: existing stores and records are preserved.
 */
export async function initDatabase(): Promise<IDBDatabase> {
  const isBrowser = typeof window !== 'undefined';
  const hasIdb = typeof indexedDB !== 'undefined' && indexedDB !== null;
  if (isBrowser && !hasIdb) {
    const err: any = new Error('IndexedDB is unavailable in this browser environment');
    err.code = 'STORAGE_UNAVAILABLE';
    throw err;
  }
  if (!hasIdb) {
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
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e: any) {
      dbInitPromise = null;
      if (isBrowser) e.code = 'STORAGE_UNAVAILABLE';
      return reject(e);
    }

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
      const err: any = request.error || new Error('打开 IndexedDB 数据库失败');
      if (isBrowser) {
        err.code = 'STORAGE_UNAVAILABLE';
      }
      reject(err);
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
  checkStorageAvailable();
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

export async function commitMutationTransaction(
  snapshot: SnapshotRecord,
  newMedia?: MediaRecord[],
  deletedMediaIds?: string[],
  expectedRevision: number = (snapshot.revision ?? 0) - 1,
  outboxItem?: OutboxRecord,
  guard?: () => boolean,
  options?: {
    recoveryBeforeWrite?: boolean;
    userId?: string | null;
    context?: OperationContext;
  }
): Promise<void> {
  checkStorageAvailable();
  if (guard && !guard()) {
    const err = new Error('账号状态已变化，已取消写入');
    (err as any).code = 'AUTH_EPOCH_CHANGED';
    throw err;
  }
  const key = snapshot.key;
  const targetUserId =
    options?.userId !== undefined
      ? options.userId
      : options?.context?.scope?.userId !== undefined
      ? options.context.scope.userId
      : key.startsWith('snapshot_')
      ? key.slice('snapshot_'.length) === 'guest'
        ? null
        : key.slice('snapshot_'.length)
      : activeUserId;

  if (!hasNativeIdb()) {
    const currentSnap = memoryStore.snapshots.get(key);
    if ((currentSnap?.revision ?? 0) !== expectedRevision) {
      throw new RevisionConflictError();
    }
    if (guard && !guard()) {
      const err = new Error('账号状态已变化，已取消写入');
      (err as any).code = 'AUTH_EPOCH_CHANGED';
      throw err;
    }
    if (options?.recoveryBeforeWrite && currentSnap?.state) {
      const recKey = getRecoveryKey(targetUserId);
      const recoveryRecord: SnapshotRecord = {
        key: recKey,
        state: structuredClone(currentSnap.state),
        version: currentSnap.state.version,
        revision: currentSnap.revision ?? 0,
        migratedFromV2: true,
        updatedAt: new Date().toISOString(),
      };
      const historyKey = `recovery_${targetUserId ?? 'guest'}_${Date.now()}`;
      const historyRecord: SnapshotRecord = {
        key: historyKey,
        state: structuredClone(currentSnap.state),
        version: currentSnap.state.version,
        revision: currentSnap.revision ?? 0,
        migratedFromV2: true,
        updatedAt: new Date().toISOString(),
      };
      memoryStore.snapshots.set(recKey, recoveryRecord);
      memoryStore.snapshots.set(historyKey, historyRecord);
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
      if (guard && !guard()) {
        failure = Object.assign(new Error('账号状态已变化，已取消写入'), { code: 'AUTH_EPOCH_CHANGED' });
        tx.abort();
        return;
      }
      const current = request.result as SnapshotRecord | undefined;
      // Compare and write under the same IndexedDB lock, shared by all tabs.
      if ((current?.revision ?? 0) !== expectedRevision) {
        failure = new RevisionConflictError();
        tx.abort();
        return;
      }
      try {
        if (options?.recoveryBeforeWrite && current?.state) {
          const recKey = getRecoveryKey(targetUserId);
          const recoveryRecord: SnapshotRecord = {
            key: recKey,
            state: structuredClone(current.state),
            version: current.state.version,
            revision: current.revision ?? 0,
            migratedFromV2: true,
            updatedAt: new Date().toISOString(),
          };
          const historyKey = `recovery_${targetUserId ?? 'guest'}_${Date.now()}`;
          const historyRecord: SnapshotRecord = {
            key: historyKey,
            state: structuredClone(current.state),
            version: current.state.version,
            revision: current.revision ?? 0,
            migratedFromV2: true,
            updatedAt: new Date().toISOString(),
          };
          snapshotsStore.put(recoveryRecord);
          snapshotsStore.put(historyRecord);
        }
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

const writeMutationToDB = commitMutationTransaction;

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
          version: validated.migratedState.version,
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
  guard?: () => boolean;
  scope?: OperationScope;
  context?: OperationContext;
  signal?: AbortSignal;
  recoveryBeforeWrite?: boolean;
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
      const checkGuard = (): boolean => {
        if (options?.guard && !options.guard()) return false;
        if (options?.context && !options.context.isCurrent()) return false;
        if (options?.scope && typeof (options.scope as any).isExpired === 'function' && (options.scope as any).isExpired()) return false;
        if (options?.scope?.signal?.aborted) return false;
        if (options?.signal?.aborted) return false;
        return true;
      };

      if (!checkGuard()) {
        return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消写入' };
      }

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

      if (!checkGuard()) {
        return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消写入' };
      }

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
          version: mutationResult.nextState.version,
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
          outboxItem,
          checkGuard,
          {
            recoveryBeforeWrite: options?.recoveryBeforeWrite,
            userId: targetUserId,
            context: options?.context,
          }
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
      if (err && ((err as any).code === 'AUTH_EPOCH_CHANGED' || (err as any).message?.includes('账号状态已变化'))) {
        return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消写入' };
      }
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

export async function getAllOutbox(userId: string): Promise<OutboxRecord[]> {
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
  waitingBackoff: OutboxRecord[];
  waitingLease: OutboxRecord[];
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

  const pending: OutboxRecord[] = [];
  const failed: OutboxRecord[] = [];
  const inFlight: OutboxRecord[] = [];
  const flushable: OutboxRecord[] = [];
  const waitingBackoff: OutboxRecord[] = [];
  const waitingLease: OutboxRecord[] = [];
  const quarantined: OutboxRecord[] = [];

  for (const item of all) {
    if (item.status === 'quarantined' || item.status === 'conflict') {
      quarantined.push(item);
      continue;
    }

    if (item.status === 'pending') {
      pending.push(item);
      if (item.nextAttemptAt && Date.parse(item.nextAttemptAt) > now) {
        waitingBackoff.push(item);
      } else {
        flushable.push(item);
      }
      continue;
    }

    if (item.status === 'failed') {
      failed.push(item);
      if (item.nextAttemptAt && Date.parse(item.nextAttemptAt) > now) {
        waitingBackoff.push(item);
      } else {
        flushable.push(item);
      }
      continue;
    }

    if (item.status === 'in_flight') {
      inFlight.push(item);
      const isLeaseActive = Boolean(item.leaseExpiresAt) && !isNaN(Date.parse(item.leaseExpiresAt!)) && Date.parse(item.leaseExpiresAt!) >= now;
      if (isLeaseActive) {
        waitingLease.push(item);
      } else {
        // Expired in_flight lease: recoverable / flushable!
        flushable.push(item);
      }
      continue;
    }

    // Default fallback to flushable
    flushable.push(item);
  }

  return {
    userId,
    total: all.length,
    pending,
    flushable,
    failed,
    inFlight,
    waitingBackoff,
    waitingLease,
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

  const isLeaseActive = (item: OutboxRecord): boolean => {
    return Boolean(item.leaseExpiresAt) && !isNaN(Date.parse(item.leaseExpiresAt!)) && Date.parse(item.leaseExpiresAt!) >= now.getTime();
  };

  const isClaimable = (item: OutboxRecord): boolean => {
    return item.status === 'pending' || item.status === 'failed' || (item.status === 'in_flight' && !isLeaseActive(item));
  };

  if (!hasNativeIdb()) {
    const item = memoryStore.outbox.get(id);
    if (!item || !isClaimable(item)) return null;
    const payloadHash = item.payloadHash || (await hashState(item.state));
    const frozenPayload: WorkspacePushPayload = {
      requestId: item.requestId,
      expectedRevision: item.expectedRevision,
      expectedContentHash: item.expectedContentHash,
      schemaVersion: item.state.version,
      generationId: item.generationId,
      state: item.state,
      reason: item.reason || 'sync',
    };
    const frozenRequest = item.frozenRequest || JSON.stringify(frozenPayload);
    const fence = (item.attemptFence ?? 0) + 1;
    const claimed: OutboxRecord = {
      ...item,
      status: 'in_flight',
      leaseOwner: owner,
      leaseExpiresAt,
      attemptFence: fence,
      sentAt: nowIso,
      payloadHash,
      frozenRequest,
    };
    memoryStore.outbox.set(id, structuredClone(claimed));
    return claimed;
  }

  const db = await initDatabase();
  const currentItem = await new Promise<OutboxRecord | undefined>((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readonly');
    const store = tx.objectStore(OUTBOX_STORE);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result as OutboxRecord | undefined);
    req.onerror = () => reject(req.error);
  });

  if (!currentItem || !isClaimable(currentItem)) return null;

  const payloadHash = currentItem.payloadHash || (await hashState(currentItem.state));
  const frozenPayload: WorkspacePushPayload = {
    requestId: currentItem.requestId,
    expectedRevision: currentItem.expectedRevision,
    expectedContentHash: currentItem.expectedContentHash,
    schemaVersion: currentItem.state.version,
    generationId: currentItem.generationId,
    state: currentItem.state,
    reason: currentItem.reason || 'sync',
  };
  const frozenRequest = currentItem.frozenRequest || JSON.stringify(frozenPayload);

  return new Promise<OutboxRecord | null>((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readwrite');
    const store = tx.objectStore(OUTBOX_STORE);
    let claimed: OutboxRecord | null = null;
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const item = getReq.result as OutboxRecord | undefined;
      if (!item || !isClaimable(item)) return;
      if (item.requestId !== currentItem.requestId ||
          item.expectedRevision !== currentItem.expectedRevision ||
          item.generationId !== currentItem.generationId) {
        return;
      }
      if (item.payloadHash && item.payloadHash !== payloadHash) {
        return;
      }
      const fence = (item.attemptFence ?? 0) + 1;
      claimed = {
        ...item,
        status: 'in_flight',
        leaseOwner: owner,
        leaseExpiresAt,
        attemptFence: fence,
        sentAt: nowIso,
        payloadHash: payloadHash || item.payloadHash,
        frozenRequest: item.frozenRequest || frozenRequest,
      };
      store.put(claimed);
    };
    tx.oncomplete = () => resolve(claimed);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Releases a claimed task after a retryable failure, applying bounded exponential backoff.
 * Verifies task ID and fence so stale owner results have no side effects.
 */
export async function releaseOutboxTask(
  id: string,
  failure: { message?: string; retryAfterMs?: number } = {},
  expectedFence?: number
): Promise<void> {
  const now = Date.now();
  const apply = (item: OutboxRecord): OutboxRecord | null => {
    if (expectedFence !== undefined && item.attemptFence !== expectedFence) {
      return null;
    }
    if (item.status !== 'in_flight') {
      return null;
    }
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
    if (item) {
      const updated = apply(item);
      if (updated) memoryStore.outbox.set(id, updated);
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
        const next = apply(item);
        if (next) store.put(next);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Compacts the local queue for a flush:
 * - verifies snapshotToken CAS (revision and contentHash) before touching the queue;
 * - only compacts observedTaskIds that have NEVER been dispatched (attemptFence == 0/undefined, sentAt == undefined, frozenRequest == undefined);
 * - never deletes tasks outside observedTaskIds;
 * - never overwrites already dispatched tasks.
 */
export async function compactOutboxForFlush(
  userId: string,
  prepared: PreparedOutboxCompaction,
  options?: { context?: OperationContext }
): Promise<OutboxRecord | null> {
  const checkGuard = (): boolean => {
    if (options?.context && !options.context.isCurrent()) return false;
    return true;
  };
  if (!checkGuard()) return null;

  const now = Date.now();
  const isTargetInFlightActive = (target: OutboxRecord) =>
    target.status === 'in_flight' &&
    Boolean(target.leaseExpiresAt) &&
    !isNaN(Date.parse(target.leaseExpiresAt!)) &&
    Date.parse(target.leaseExpiresAt!) >= now;

  const isDispatched = (t: OutboxRecord) =>
    Boolean(t.frozenRequest || t.sentAt || (t.attemptFence ?? 0) > 0);

  if (!hasNativeIdb()) {
    const snap = memoryStore.snapshots.get(getSnapshotKey(userId));
    if (!snap || snap.revision !== prepared.snapshotToken.revision || snap.contentHash !== prepared.snapshotToken.contentHash) {
      return null;
    }
    const items = Array.from(memoryStore.outbox.values()).filter(i => i.userId === userId);
    const target = items.find(i => i.id === prepared.targetTaskId);
    if (!target) return null;
    if (target.status === 'quarantined' || target.status === 'conflict' || isTargetInFlightActive(target)) return null;
    if (isDispatched(target)) return null;

    const updated: OutboxRecord = {
      ...target,
      state: prepared.state,
      expectedRevision: prepared.expectedRevision,
      generationId: prepared.generationId,
      status: 'pending',
      nextAttemptAt: undefined,
      attempts: target.attempts,
      payloadHash: prepared.snapshotToken.contentHash,
    };

    for (const item of items) {
      if (item.id !== prepared.targetTaskId && prepared.observedTaskIds.includes(item.id)) {
        if (!isDispatched(item) && item.status !== 'quarantined' && item.status !== 'conflict' && !isTargetInFlightActive(item)) {
          memoryStore.outbox.delete(item.id);
        }
      }
    }
    memoryStore.outbox.set(updated.id, structuredClone(updated));
    return updated;
  }

  const db = await initDatabase();
  return new Promise<OutboxRecord | null>((resolve, reject) => {
    const tx = db.transaction([SNAPSHOTS_STORE, OUTBOX_STORE], 'readwrite');
    const snapStore = tx.objectStore(SNAPSHOTS_STORE);
    const outStore = tx.objectStore(OUTBOX_STORE);
    let updated: OutboxRecord | null = null;

    const snapReq = snapStore.get(getSnapshotKey(userId));
    snapReq.onsuccess = () => {
      const snap = snapReq.result as SnapshotRecord | undefined;
      if (!snap || snap.revision !== prepared.snapshotToken.revision || snap.contentHash !== prepared.snapshotToken.contentHash) {
        tx.abort();
        return;
      }
      const outReq = outStore.getAll();
      outReq.onsuccess = () => {
        const items = ((outReq.result || []) as OutboxRecord[]).filter(i => i.userId === userId);
        const target = items.find(i => i.id === prepared.targetTaskId);
        if (!target || target.status === 'quarantined' || target.status === 'conflict' || isTargetInFlightActive(target) || isDispatched(target)) {
          tx.abort();
          return;
        }

        updated = {
          ...target,
          state: prepared.state,
          expectedRevision: prepared.expectedRevision,
          generationId: prepared.generationId,
          status: 'pending',
          nextAttemptAt: undefined,
          attempts: target.attempts,
          payloadHash: prepared.snapshotToken.contentHash,
        };

        for (const item of items) {
          if (item.id !== prepared.targetTaskId && prepared.observedTaskIds.includes(item.id)) {
            if (!isDispatched(item) && item.status !== 'quarantined' && item.status !== 'conflict' && !isTargetInFlightActive(item)) {
              outStore.delete(item.id);
            }
          }
        }
        outStore.put(updated);
      };
    };

    tx.oncomplete = () => resolve(updated);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => resolve(null);
  });
}

export interface PushConfirmation {
  revision: number;
  generationId: string;
  contentHash: string;
}

/**
 * Atomically confirms a successful push:
 * - verifies task ID and fence (stale owner results have no side effects)
 * - updates the sync baseline without regressing in the same generation
 * - updates snapshot confirmed metadata when the snapshot still holds the pushed content
 * - deletes the outbox task and clears any persisted conflict record
 */
export async function confirmOutboxPush(
  userId: string,
  requestId: string,
  confirmation: PushConfirmation,
  pushedContentHash: string,
  expectedFence?: number,
  taskId?: string
): Promise<void> {
  const nowIso = new Date().toISOString();

  if (!hasNativeIdb()) {
    if (expectedFence !== undefined || taskId) {
      const target = Array.from(memoryStore.outbox.values()).find(
        i => i.userId === userId && (taskId ? i.id === taskId : i.requestId === requestId)
      );
      if (target && expectedFence !== undefined && target.attemptFence !== expectedFence) {
        return; // Stale fence: ignore
      }
    }

    const currentBaseline = memoryStore.syncState.get(userId) as SyncBaseline | undefined;
    const canUpdateBaseline = !currentBaseline ||
      currentBaseline.generationId !== confirmation.generationId ||
      confirmation.revision >= currentBaseline.confirmedRevision;

    if (canUpdateBaseline) {
      const baseline: SyncBaseline = {
        userId,
        confirmedRevision: confirmation.revision,
        generationId: confirmation.generationId || (confirmation.contentHash ? confirmation.generationId : ''),
        contentHash: pushedContentHash,
        updatedAt: nowIso,
      };
      memoryStore.syncState.set(userId, baseline);
    }

    for (const [id, item] of memoryStore.outbox.entries()) {
      if (item.userId === userId && (taskId ? item.id === taskId : item.requestId === requestId)) {
        memoryStore.outbox.delete(id);
      }
    }

    const snapshot = memoryStore.snapshots.get(getSnapshotKey(userId));
    if (snapshot && snapshot.contentHash === pushedContentHash) {
      const canUpdateSnapshot = !snapshot.confirmedRevision ||
        snapshot.generationId !== confirmation.generationId ||
        confirmation.revision >= snapshot.confirmedRevision;
      if (canUpdateSnapshot) {
        memoryStore.snapshots.set(snapshot.key, {
          ...snapshot,
          confirmedRevision: confirmation.revision,
          generationId: confirmation.generationId,
          confirmedContentHash: pushedContentHash,
        });
      }
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

    const outReq = outStore.getAll();
    outReq.onsuccess = () => {
      const items = (outReq.result || []) as OutboxRecord[];
      if (expectedFence !== undefined || taskId) {
        const target = items.find(
          i => i.userId === userId && (taskId ? i.id === taskId : i.requestId === requestId)
        );
        if (target && expectedFence !== undefined && target.attemptFence !== expectedFence) {
          return; // Stale fence: abort without modifying baseline or deleting
        }
      }

      const baseReq = syncStore.get(userId);
      baseReq.onsuccess = () => {
        const currentBaseline = baseReq.result as SyncBaseline | undefined;
        const canUpdateBaseline = !currentBaseline ||
          currentBaseline.generationId !== confirmation.generationId ||
          confirmation.revision >= currentBaseline.confirmedRevision;

        if (canUpdateBaseline) {
          const baseline: SyncBaseline = {
            userId,
            confirmedRevision: confirmation.revision,
            generationId: confirmation.generationId || (confirmation.contentHash ? confirmation.generationId : ''),
            contentHash: pushedContentHash,
            updatedAt: nowIso,
          };
          syncStore.put(baseline);
        }

        const snapKey = getSnapshotKey(userId);
        const snapReq = snapStore.get(snapKey);
        snapReq.onsuccess = () => {
          const snapshot = snapReq.result as SnapshotRecord | undefined;
          if (snapshot && snapshot.contentHash === pushedContentHash) {
            const canUpdateSnapshot = !snapshot.confirmedRevision ||
              snapshot.generationId !== confirmation.generationId ||
              confirmation.revision >= snapshot.confirmedRevision;
            if (canUpdateSnapshot) {
              snapStore.put({
                ...snapshot,
                confirmedRevision: confirmation.revision,
                generationId: confirmation.generationId,
                confirmedContentHash: pushedContentHash,
              });
            }
          }
        };

        for (const item of items) {
          if (item.userId === userId && (taskId ? item.id === taskId : item.requestId === requestId)) {
            outStore.delete(item.id);
          }
        }
      };
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('同步确认事务失败'));
    tx.onabort = () => reject(tx.error || new Error('同步确认事务中止'));
  });
}

export const confirmOutboxTask = confirmOutboxPush;

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
export async function clearOutbox(
  userId: string,
  options?: { guard?: () => boolean; scope?: OperationScope; context?: OperationContext; signal?: AbortSignal }
): Promise<void> {
  const checkGuard = (): boolean => {
    if (options?.guard && !options.guard()) return false;
    if (options?.context && !options.context.isCurrent()) return false;
    if (options?.scope && typeof (options.scope as any).isExpired === 'function' && (options.scope as any).isExpired()) return false;
    if (options?.scope?.signal?.aborted) return false;
    if (options?.signal?.aborted) return false;
    return true;
  };
  if (!checkGuard()) return;

  if (!hasNativeIdb()) {
    for (const [id, item] of memoryStore.outbox.entries()) {
      if (item.userId === userId) memoryStore.outbox.delete(id);
    }
    return;
  }
  const db = await initDatabase();
  return new Promise<void>((resolve, reject) => {
    if (!checkGuard()) {
      resolve();
      return;
    }
    const tx = db.transaction(OUTBOX_STORE, 'readwrite');
    const store = tx.objectStore(OUTBOX_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      if (!checkGuard()) {
        tx.abort();
        return;
      }
      const all = (req.result || []) as OutboxRecord[];
      for (const item of all) {
        if (item.userId === userId) store.delete(item.id);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => resolve();
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

export function parseServerMediaRef(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  let id: string | null = null;
  if (value.startsWith('/api/media/')) {
    id = value.slice('/api/media/'.length);
  } else if (value.startsWith('media:')) {
    id = value.slice('media:'.length);
  } else if (value.startsWith('media_')) {
    id = value;
  }
  if (!id) return null;
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(id)) return null;
  return id;
}

/**
 * Helper: counts total unique attachment photos across all wrong records.
 * For each wrong record, de-duplicates 'image' and 'images' entries.
 */
export function countWrongAttachments(wrong: WrongRecord[]): number {
  if (!Array.isArray(wrong)) return 0;
  let total = 0;
  for (const item of wrong) {
    if (!item || typeof item !== 'object') continue;
    const set = new Set<string>();
    if (typeof item.image === 'string' && item.image.trim()) {
      set.add(item.image.trim());
    }
    if (Array.isArray(item.images)) {
      for (const img of item.images) {
        if (typeof img === 'string' && img.trim()) {
          set.add(img.trim());
        }
      }
    }
    total += set.size;
  }
  return total;
}

/** Resolve local attachment references before generating a portable JSON backup. */
export async function createPortableBackupState(
  state: AppState,
  options?: { isPreview?: boolean; isScopeValid?: () => boolean }
): Promise<AppState> {
  const portable = structuredClone(state);
  const asDataURL = async (blob: Blob): Promise<string> => {
    if (typeof FileReader !== 'undefined') {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error || new Error('读取备份图片失败'));
        reader.readAsDataURL(blob);
      });
    }
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const mime = blob.type || 'image/jpeg';
    if (typeof Buffer !== 'undefined') {
      return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
    }
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return `data:${mime};base64,${btoa(binary)}`;
  };

  const POSE_RE = /^pose-[0-7]$/;
  const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

  const resolveExternalLink = async (url: string, recordContext?: string): Promise<string> => {
    if (options?.isScopeValid && !options.isScopeValid()) {
      throw new Error('AUTH_SCOPE_INVALID');
    }
    const contextPrefix = recordContext ? `${recordContext} ` : '';
    try {
      const response = await fetch(url, { mode: 'cors' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const blob = await response.blob();
      if (blob.size > MAX_IMAGE_BYTES) {
        throw new Error('单张图片大小不能超过 10MB');
      }
      return await asDataURL(blob);
    } catch (err: any) {
      throw new Error(
        `无法内联${contextPrefix}外链图片 (${url})，CORS 读取失败: ${err?.message || '网络请求错误'}。无法生成完整离线备份。`
      );
    }
  };

  const resolveImage = async (
    image: string,
    storagePath?: string,
    recordContext?: string
  ): Promise<string> => {
    if (options?.isScopeValid && !options.isScopeValid()) {
      throw new Error('AUTH_SCOPE_INVALID');
    }

    if (!image) return '';

    // Built-in potato avatars (pose-0 to pose-7) and static assets are self-contained.
    if (POSE_RE.test(image) || image.startsWith('/branding/')) {
      return image;
    }

    // In isolated preview mode, never query the real persistent IndexedDB media store.
    if (options?.isPreview) {
      return image;
    }

    // Existing data URL
    if (image.startsWith('data:image/')) {
      const comma = image.indexOf(',');
      if (comma !== -1) {
        const b64 = image.slice(comma + 1);
        const approxBytes = Math.ceil((b64.length * 3) / 4);
        if (approxBytes > MAX_IMAGE_BYTES) {
          throw new Error('单张图片大小不能超过 10MB');
        }
      }
      return image;
    }

    // Blob URL
    if (image.startsWith('blob:')) {
      const response = await fetch(image);
      if (!response.ok) {
        const prefix = recordContext ? `${recordContext}: ` : '';
        throw new Error(`${prefix}无法读取本地错题图片`);
      }
      const blob = await response.blob();
      if (blob.size > MAX_IMAGE_BYTES) throw new Error('单张图片大小不能超过 10MB');
      return asDataURL(blob);
    }

    // 优先读取本地副本 (getMedia)
    const mediaKey = (storagePath && storagePath.trim()) || parseServerMediaRef(image) || image;
    let media = await getMedia(mediaKey);
    if (!media && storagePath && image) {
      media = await getMedia(image);
    }

    if (media) {
      if (media.blob instanceof Blob) {
        if (media.blob.size > MAX_IMAGE_BYTES) throw new Error('单张图片大小不能超过 10MB');
        return asDataURL(media.blob);
      }
      if (typeof media.blob === 'string') {
        if (media.blob.startsWith('data:image/')) {
          const comma = media.blob.indexOf(',');
          if (comma !== -1) {
            const b64 = media.blob.slice(comma + 1);
            if (Math.ceil((b64.length * 3) / 4) > MAX_IMAGE_BYTES) throw new Error('单张图片大小不能超过 10MB');
          }
          return media.blob;
        }
        if (media.blob.startsWith('https://') || media.blob.startsWith('http://')) {
          return await resolveExternalLink(media.blob, recordContext);
        }
      }
    }

    // 没有本地副本时，通过当前账号同源媒体接口 (fetch('/api/media/<id>')) 读取并转为 data:image/...
    const cloudId = parseServerMediaRef(image);
    if (cloudId) {
      if (options?.isScopeValid && !options.isScopeValid()) {
        throw new Error('AUTH_SCOPE_INVALID');
      }
      const response = await fetch(`/api/media/${cloudId}`, { credentials: 'same-origin' });
      if (!response.ok) {
        const prefix = recordContext ? `${recordContext}: ` : '';
        throw new Error(`${prefix}无法从云端获取媒体附件 (${cloudId})，HTTP ${response.status}`);
      }
      if (options?.isScopeValid && !options.isScopeValid()) {
        throw new Error('AUTH_SCOPE_INVALID');
      }
      const blob = await response.blob();
      if (blob.size > MAX_IMAGE_BYTES) {
        throw new Error('单张图片大小不能超过 10MB');
      }
      return asDataURL(blob);
    }

    // Legacy external https / http URL: Attempt CORS fetch and inline into base64
    if (image.startsWith('https://') || image.startsWith('http://')) {
      return await resolveExternalLink(image, recordContext);
    }

    const prefix = recordContext ? `${recordContext}: ` : '';
    throw new Error(`${prefix}备份图片附件缺失，已停止导出: ${image.slice(0, 30)}`);
  };

  for (let i = 0; i < portable.wrong.length; i++) {
    const wrong = portable.wrong[i];
    const recordLabel = `错题记录 [${wrong.id || i + 1}] (${wrong.date || '未知日期'})`;
    wrong.image = await resolveImage(wrong.image, wrong.storagePath, recordLabel);
    delete wrong.storagePath;
    const legacyImages = (wrong as unknown as { images?: unknown }).images;
    if (Array.isArray(legacyImages)) {
      const limit = Math.min(legacyImages.length, 9);
      const resolvedList: string[] = [];
      for (let j = 0; j < limit; j++) {
        const img = legacyImages[j];
        if (typeof img === 'string') {
          resolvedList.push(await resolveImage(img, undefined, `${recordLabel} 附图 ${j + 1}`));
        }
      }
      wrong.images = resolvedList;
    }
  }
  portable.profile.avatar = await resolveImage(portable.profile.avatar, undefined, '个人头像');
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

export async function saveSyncBaseline(
  baseline: SyncBaseline,
  options?: { guard?: () => boolean; scope?: OperationScope; context?: OperationContext; signal?: AbortSignal }
): Promise<void> {
  const checkGuard = (): boolean => {
    if (options?.guard && !options.guard()) return false;
    if (options?.context && !options.context.isCurrent()) return false;
    if (options?.scope && typeof (options.scope as any).isExpired === 'function' && (options.scope as any).isExpired()) return false;
    if (options?.scope?.signal?.aborted) return false;
    if (options?.signal?.aborted) return false;
    return true;
  };

  if (!checkGuard()) {
    const err = new Error('账号状态已变化，已取消更新同步基线');
    (err as any).code = 'AUTH_EPOCH_CHANGED';
    throw err;
  }

  if (!hasNativeIdb()) {
    memoryStore.syncState.set(baseline.userId, structuredClone(baseline));
    return;
  }
  const db = await initDatabase();
  return new Promise<void>((resolve, reject) => {
    if (!checkGuard()) {
      reject(Object.assign(new Error('账号状态已变化，已取消更新同步基线'), { code: 'AUTH_EPOCH_CHANGED' }));
      return;
    }
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

export async function clearConflictRecord(
  userId: string,
  options?: { guard?: () => boolean; scope?: OperationScope; context?: OperationContext; signal?: AbortSignal }
): Promise<void> {
  const checkGuard = (): boolean => {
    if (options?.guard && !options.guard()) return false;
    if (options?.context && !options.context.isCurrent()) return false;
    if (options?.scope && typeof (options.scope as any).isExpired === 'function' && (options.scope as any).isExpired()) return false;
    if (options?.scope?.signal?.aborted) return false;
    if (options?.signal?.aborted) return false;
    return true;
  };
  if (!checkGuard()) return;

  if (!hasNativeIdb()) {
    memoryStore.conflicts.delete(userId);
    return;
  }
  const db = await initDatabase();
  return new Promise<void>((resolve, reject) => {
    if (!checkGuard()) {
      resolve();
      return;
    }
    const tx = db.transaction(SYNC_STATE_STORE, 'readwrite');
    tx.objectStore(SYNC_STATE_STORE).delete(`conflict_${userId}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * S03: Protects dirty local snapshots left by older versions where local hash
 * differs from confirmed baseline and the queue is empty.
 * Returns 'clean' if local matches baseline or account is blank/fresh;
 * 'queued' if an outbox task already exists or a new outbox task was queued to push local edits;
 * 'conflict' if baseline is missing/unknown and local dirty edits must be protected as a conflict.
 */
export async function ensureSnapshotHasOutbox(
  userId: string,
  options?: { context?: OperationContext }
): Promise<'clean' | 'queued' | 'conflict'> {
  const checkGuard = (): boolean => {
    if (options?.context && !options.context.isCurrent()) return false;
    return true;
  };
  if (!checkGuard()) {
    const err = new Error('账号状态已变化');
    (err as any).code = 'AUTH_EPOCH_CHANGED';
    throw err;
  }

  const isBlankState = (s: AppState): boolean =>
    (!s.books || s.books.length === 0) &&
    (!s.courses || s.courses.length === 0) &&
    (!s.records || s.records.length === 0) &&
    (!s.plans || s.plans.length === 0) &&
    (!s.wrong || s.wrong.length === 0);

  if (!hasNativeIdb()) {
    const snapshot = memoryStore.snapshots.get(getSnapshotKey(userId));
    if (!snapshot || !snapshot.state || isBlankState(snapshot.state)) {
      return 'clean';
    }
    const conflict = memoryStore.conflicts.get(userId);
    if (conflict) {
      return 'conflict';
    }
    const currentHash = snapshot.contentHash || (await hashState(snapshot.state));
    const baseline = memoryStore.syncState.get(userId) as SyncBaseline | undefined;
    const tasks = Array.from(memoryStore.outbox.values()).filter(
      i => i.userId === userId && (i.status === 'pending' || i.status === 'in_flight' || i.status === 'failed')
    );
    if (tasks.length > 0) {
      return 'queued';
    }

    const isBaselineTrusted = Boolean(baseline && baseline.confirmedRevision > 0 && baseline.generationId && baseline.contentHash);
    if (isBaselineTrusted) {
      if (currentHash === baseline!.contentHash) {
        return 'clean';
      }
      const newTask: OutboxRecord = {
        id: `outbox_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        userId,
        requestId: `req_dirty_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        state: snapshot.state,
        expectedRevision: baseline!.confirmedRevision,
        generationId: baseline!.generationId,
        createdAt: new Date().toISOString(),
        status: 'pending',
        reason: 'dirty_snapshot_recovery',
        attempts: 0,
        payloadHash: currentHash,
        expectedContentHash: baseline!.contentHash,
      };
      memoryStore.outbox.set(newTask.id, newTask);
      return 'queued';
    }

    if (snapshot.confirmedContentHash && snapshot.confirmedContentHash === currentHash) {
      return 'clean';
    }

    const conflictRecord: SyncConflictRecord = {
      userId,
      code: 'DIRTY_SNAPSHOT_BASELINE_UNKNOWN',
      message: '检测到本机存在未同步修改且缺少可信云端基线，为保护数据已暂停自动覆盖，请确认处理方式。',
      serverRevision: baseline?.confirmedRevision ?? snapshot.confirmedRevision ?? 0,
      serverGenerationId: baseline?.generationId ?? snapshot.generationId ?? '',
      serverContentHash: baseline?.contentHash ?? snapshot.confirmedContentHash ?? '',
      serverState: null,
      localRevision: snapshot.revision,
      detectedAt: new Date().toISOString(),
    };
    memoryStore.conflicts.set(userId, conflictRecord);
    return 'conflict';
  }

  const snapOutside = await getSnapshotFromDB(userId);
  if (!snapOutside || !snapOutside.state || isBlankState(snapOutside.state)) {
    return 'clean';
  }
  const currentHash = snapOutside.contentHash || (await hashState(snapOutside.state));

  const db = await initDatabase();
  return new Promise<'clean' | 'queued' | 'conflict'>((resolve, reject) => {
    const tx = db.transaction([SNAPSHOTS_STORE, OUTBOX_STORE, SYNC_STATE_STORE], 'readwrite');
    const snapStore = tx.objectStore(SNAPSHOTS_STORE);
    const outStore = tx.objectStore(OUTBOX_STORE);
    const syncStore = tx.objectStore(SYNC_STATE_STORE);

    let result: 'clean' | 'queued' | 'conflict' = 'clean';

    const snapReq = snapStore.get(getSnapshotKey(userId));
    snapReq.onsuccess = () => {
      if (!checkGuard()) {
        tx.abort();
        reject(Object.assign(new Error('账号状态已变化'), { code: 'AUTH_EPOCH_CHANGED' }));
        return;
      }
      const snapshot = snapReq.result as SnapshotRecord | undefined;
      if (!snapshot || !snapshot.state || isBlankState(snapshot.state)) {
        result = 'clean';
        return;
      }

      const conflictReq = syncStore.get(`conflict_${userId}`);
      conflictReq.onsuccess = () => {
        if (conflictReq.result) {
          result = 'conflict';
          return;
        }

        const outReq = outStore.getAll();
        outReq.onsuccess = () => {
          const tasks = ((outReq.result || []) as OutboxRecord[]).filter(
            i => i.userId === userId && (i.status === 'pending' || i.status === 'in_flight' || i.status === 'failed')
          );
          if (tasks.length > 0) {
            result = 'queued';
            return;
          }

          const baseReq = syncStore.get(userId);
          baseReq.onsuccess = () => {
            const baseline = baseReq.result as SyncBaseline | undefined;
            const isBaselineTrusted = Boolean(baseline && baseline.confirmedRevision > 0 && baseline.generationId && baseline.contentHash);

            if (isBaselineTrusted) {
              if (currentHash === baseline!.contentHash) {
                result = 'clean';
                return;
              }
              const newTask: OutboxRecord = {
                id: `outbox_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                userId,
                requestId: `req_dirty_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                state: snapshot.state,
                expectedRevision: baseline!.confirmedRevision,
                generationId: baseline!.generationId,
                createdAt: new Date().toISOString(),
                status: 'pending',
                reason: 'dirty_snapshot_recovery',
                attempts: 0,
                payloadHash: currentHash,
                expectedContentHash: baseline!.contentHash,
              };
              outStore.put(newTask);
              result = 'queued';
              return;
            }

            if (snapshot.confirmedContentHash && snapshot.confirmedContentHash === currentHash) {
              result = 'clean';
              return;
            }

            const conflictRecord: SyncConflictRecord = {
              userId,
              code: 'DIRTY_SNAPSHOT_BASELINE_UNKNOWN',
              message: '检测到本机存在未同步修改且缺少可信云端基线，为保护数据已暂停自动覆盖，请确认处理方式。',
              serverRevision: baseline?.confirmedRevision ?? snapshot.confirmedRevision ?? 0,
              serverGenerationId: baseline?.generationId ?? snapshot.generationId ?? '',
              serverContentHash: baseline?.contentHash ?? snapshot.confirmedContentHash ?? '',
              serverState: null,
              localRevision: snapshot.revision,
              detectedAt: new Date().toISOString(),
            };
            syncStore.put({ userId: `conflict_${userId}`, conflict: conflictRecord });
            result = 'conflict';
          };
        };
      };
    };

    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => resolve(result);
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
  options: {
    force?: boolean;
    saveRecovery?: boolean;
    localMutationVersion?: number;
    guard?: () => boolean;
    scope?: OperationScope;
    context?: OperationContext;
    signal?: AbortSignal;
    expectedSnapshotToken?: { revision: number; contentHash?: string };
  } = {}
): Promise<{ ok: boolean; code?: string; message?: string }> {
  return enqueue(async () => {
    const checkGuard = (): boolean => {
      if (options.guard && !options.guard()) return false;
      if (options.context && !options.context.isCurrent()) return false;
      if (options.scope && typeof (options.scope as any).isExpired === 'function' && (options.scope as any).isExpired()) return false;
      if (options.scope?.signal?.aborted) return false;
      if (options.signal?.aborted) return false;
      return true;
    };

    if (!checkGuard()) {
      return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消写入' };
    }

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
      if (!options.force && options.expectedSnapshotToken && current) {
        if (current.revision !== options.expectedSnapshotToken.revision ||
            (options.expectedSnapshotToken.contentHash && current.contentHash !== options.expectedSnapshotToken.contentHash)) {
          return { ok: false, code: 'LOCAL_MUTATED', message: '本地快照已在拉取期间被更新' };
        }
      }
      if (options.saveRecovery !== false && current?.state) {
        memoryStore.snapshots.set(getRecoveryKey(userId), {
          key: getRecoveryKey(userId),
          state: structuredClone(current.state),
          version: current.state.version,
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
        version: serverState.version,
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
        if (!checkGuard()) {
          result = { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消写入' };
          tx.abort();
          return;
        }
        const items = ((outReq.result || []) as OutboxRecord[]).filter(i => i.userId === userId);
        if (!options.force && items.length > 0) {
          result = { ok: false, code: 'LOCAL_UNRESOLVED', message: '本机存在未同步修改，不能直接覆盖' };
          tx.abort();
          return;
        }
        const snapReq = snapStore.get(snapKey);
        snapReq.onsuccess = () => {
          if (!checkGuard()) {
            result = { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消写入' };
            tx.abort();
            return;
          }
          const current = snapReq.result as SnapshotRecord | undefined;
          if (!options.force && options.expectedSnapshotToken && current) {
            if (current.revision !== options.expectedSnapshotToken.revision ||
                (options.expectedSnapshotToken.contentHash && current.contentHash !== options.expectedSnapshotToken.contentHash)) {
              result = { ok: false, code: 'LOCAL_MUTATED', message: '本地快照已在拉取期间被更新' };
              tx.abort();
              return;
            }
          }
          if (options.saveRecovery !== false && current?.state) {
            snapStore.put({
              key: getRecoveryKey(userId),
              state: current.state,
              version: current.state.version,
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
            version: serverState.version,
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
  newOutboxItem?: OutboxRecord,
  options?: {
    guard?: () => boolean;
    scope?: OperationScope;
    context?: OperationContext;
    signal?: AbortSignal;
  }
): Promise<void> {
  return enqueue(async () => {
    const checkGuard = (): boolean => {
      if (options?.guard && !options.guard()) return false;
      if (options?.context && !options.context.isCurrent()) return false;
      if (options?.scope && typeof (options.scope as any).isExpired === 'function' && (options.scope as any).isExpired()) return false;
      if (options?.scope?.signal?.aborted) return false;
      if (options?.signal?.aborted) return false;
      return true;
    };

    if (!checkGuard()) {
      const err = new Error('账号状态已变化，已取消写入');
      (err as any).code = 'AUTH_EPOCH_CHANGED';
      throw err;
    }

    const contentHash = newSnapshot.contentHash || await hashState(newSnapshot.state);
    if (!hasNativeIdb()) {
      if (!checkGuard()) {
        const err = new Error('账号状态已变化，已取消写入');
        (err as any).code = 'AUTH_EPOCH_CHANGED';
        throw err;
      }
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
          version: current.state.version,
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
        if (!checkGuard()) {
          tx.abort();
          reject(Object.assign(new Error('账号状态已变化，已取消写入'), { code: 'AUTH_EPOCH_CHANGED' }));
          return;
        }
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
            version: curSnap.state.version,
            revision: curRev,
            migratedFromV2: curSnap.migratedFromV2,
            updatedAt: new Date().toISOString(),
          };
          snapStore.put(recoverySnap);

          const historySnap: SnapshotRecord = {
            key: `recovery_${userId}_${Date.now()}`,
            state: curSnap.state,
            version: curSnap.state.version,
            revision: curRev,
            migratedFromV2: curSnap.migratedFromV2,
            updatedAt: new Date().toISOString(),
          };
          snapStore.put(historySnap);
        }

        // 2. Delete all existing outbox items for this user
        const outReq = outStore.getAll();
        outReq.onsuccess = () => {
          if (!checkGuard()) {
            tx.abort();
            reject(Object.assign(new Error('账号状态已变化，已取消写入'), { code: 'AUTH_EPOCH_CHANGED' }));
            return;
          }
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
    version: state.version,
    revision,
    migratedFromV2: true,
    updatedAt: new Date().toISOString(),
  };
  const historyRecord: SnapshotRecord = {
    key: `recovery_${targetUserId}_${Date.now()}`,
    state: structuredClone(state),
    version: state.version,
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
  mediaRecords: MediaRecord[],
  options?: {
    guard?: () => boolean;
    scope?: OperationScope;
    context?: OperationContext;
    signal?: AbortSignal;
  }
): Promise<{ changed: boolean; revision: number; pendingRequestId?: string }> {
  const checkGuard = (): boolean => {
    if (options?.guard && !options.guard()) return false;
    if (options?.context && !options.context.isCurrent()) return false;
    if (options?.scope && typeof (options.scope as any).isExpired === 'function' && (options.scope as any).isExpired()) return false;
    if (options?.scope?.signal?.aborted) return false;
    if (options?.signal?.aborted) return false;
    return true;
  };

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
    if (!checkGuard()) {
      const err = new Error('账号状态已变化，已取消写入');
      (err as any).code = 'AUTH_EPOCH_CHANGED';
      throw err;
    }

    if (!hasNativeIdb()) {
      const key = getSnapshotKey(userId);
      const snapshot = memoryStore.snapshots.get(key);
      if (!snapshot) return { changed: false, revision: 0 };
      const nextState = applyState(snapshot.state);
      const contentHash = await hashState(nextState);
      if (!checkGuard()) {
        const err = new Error('账号状态已变化，已取消写入');
        (err as any).code = 'AUTH_EPOCH_CHANGED';
        throw err;
      }
      const nextSnapshot: SnapshotRecord = {
        ...snapshot,
        state: nextState,
        revision: snapshot.revision,
        contentHash,
        updatedAt: new Date().toISOString(),
      };
      memoryStore.snapshots.set(key, nextSnapshot);
      memoryStore.snapshots.set(`media_backup_${userId}_latest`, { ...snapshot, key: `media_backup_${userId}_latest` });
      for (const record of mediaRecords) memoryStore.media.set(record.id, structuredClone(record));
      let hasUnfrozenPending = false;
      let pendingRequestId: string | undefined;
      for (const item of memoryStore.outbox.values()) {
        if (item.userId !== userId) continue;
        const isFrozen = Boolean(item.frozenRequest || item.sentAt || (item.attemptFence ?? 0) > 0);
        if (isFrozen) {
          continue;
        }
        item.state = applyState(item.state);
        item.payloadHash = undefined;
        memoryStore.outbox.set(item.id, item);
        hasUnfrozenPending = true;
        pendingRequestId = item.requestId;
      }
      if (!hasUnfrozenPending) {
        const newTask: OutboxRecord = {
          id: `outbox_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          userId,
          requestId: `req_media_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          state: nextState,
          expectedRevision: snapshot.confirmedRevision ?? 0,
          generationId: snapshot.generationId ?? '',
          createdAt: new Date().toISOString(),
          status: 'pending',
          reason: 'media_mapping',
          attempts: 0,
          payloadHash: contentHash,
        };
        memoryStore.outbox.set(newTask.id, newTask);
        pendingRequestId = newTask.requestId;
      }
      return { changed: true, revision: nextSnapshot.revision, pendingRequestId };
    }

    const maxRetries = 5;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (!checkGuard()) {
        const err = new Error('账号状态已变化，已取消写入');
        (err as any).code = 'AUTH_EPOCH_CHANGED';
        throw err;
      }
      // 1. Read-only preparation phase:
      const snapshot = await getSnapshotFromDB(userId);
      if (!snapshot) return { changed: false, revision: 0 };

      const nextState = applyState(snapshot.state);
      const contentHash = await hashState(nextState);

      if (!checkGuard()) {
        const err = new Error('账号状态已变化，已取消写入');
        (err as any).code = 'AUTH_EPOCH_CHANGED';
        throw err;
      }

      // 2. Short readwrite IDB transaction (no async Promise/hash inside):
      const db = await initDatabase();
      let pendingRequestId: string | undefined;
      const outcome = await new Promise<{
        drifted: boolean;
        result?: { changed: boolean; revision: number; pendingRequestId?: string };
      }>((resolve, reject) => {
        let settled = false;
        let drifted = false;

        const safeResolve = (val: { drifted: boolean; result?: { changed: boolean; revision: number; pendingRequestId?: string } }) => {
          if (!settled) {
            settled = true;
            resolve(val);
          }
        };

        const safeReject = (err: any) => {
          if (!settled) {
            settled = true;
            reject(err);
          }
        };

        const tx = db.transaction([SNAPSHOTS_STORE, OUTBOX_STORE, MEDIA_STORE], 'readwrite');
        const snapStore = tx.objectStore(SNAPSHOTS_STORE);
        const outStore = tx.objectStore(OUTBOX_STORE);
        const mediaStore = tx.objectStore(MEDIA_STORE);
        const key = getSnapshotKey(userId);

        const snapReq = snapStore.get(key);
        snapReq.onsuccess = () => {
          if (!checkGuard()) {
            drifted = true;
            tx.abort();
            safeReject(Object.assign(new Error('账号状态已变化，已取消写入'), { code: 'AUTH_EPOCH_CHANGED' }));
            return;
          }
          const currentSnap = snapReq.result as SnapshotRecord | undefined;
          if (!currentSnap || currentSnap.revision !== snapshot.revision) {
            drifted = true;
            tx.abort();
            return;
          }

          // Pre-migration recovery copy
          snapStore.put({ ...currentSnap, key: `media_backup_${userId}_latest` });

          // Put new media records
          for (const record of mediaRecords) {
            mediaStore.put(record);
          }

          const outReq = outStore.getAll();
          outReq.onsuccess = () => {
            const currentTasks = ((outReq.result || []) as OutboxRecord[]).filter(i => i.userId === userId);
            let hasUnfrozenPending = false;
            for (const task of currentTasks) {
              const isFrozen = Boolean(task.frozenRequest || task.sentAt || (task.attemptFence ?? 0) > 0);
              if (isFrozen) {
                continue;
              }
              task.state = applyState(task.state);
              task.payloadHash = undefined;
              outStore.put(task);
              hasUnfrozenPending = true;
              pendingRequestId = task.requestId;
            }

            if (!hasUnfrozenPending) {
              const newTask: OutboxRecord = {
                id: `outbox_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                userId,
                requestId: `req_media_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                state: nextState,
                expectedRevision: currentSnap.confirmedRevision ?? 0,
                generationId: currentSnap.generationId ?? '',
                createdAt: new Date().toISOString(),
                status: 'pending',
                reason: 'media_mapping',
                attempts: 0,
                payloadHash: contentHash,
              };
              outStore.put(newTask);
              pendingRequestId = newTask.requestId;
            }
          };

          // Put updated snapshot with precomputed contentHash
          snapStore.put({
            ...currentSnap,
            state: nextState,
            revision: currentSnap.revision,
            contentHash,
            updatedAt: new Date().toISOString(),
          });
        };

        snapReq.onerror = () => {
          safeReject(snapReq.error || new Error('读取快照失败'));
        };

        tx.oncomplete = () => {
          safeResolve({
            drifted: false,
            result: { changed: true, revision: snapshot.revision, pendingRequestId },
          });
        };

        tx.onabort = () => {
          if (drifted) {
            safeResolve({ drifted: true });
          } else {
            safeReject(tx.error || new Error('附件引用迁移事务中止，原数据未改变'));
          }
        };

        tx.onerror = () => {
          if (!drifted) {
            safeReject(tx.error || new Error('附件引用迁移事务失败'));
          }
        };
      });

      if (!outcome.drifted && outcome.result) {
        return outcome.result;
      }
    }

    throw new Error('附件引用迁移多次检测到快照并发修改，请重试');
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
    version: state.version,
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

/** One-time guest-migration credential namespace in sync_state (R10 / Issue A01). */
export const GUEST_MIGRATION_NAMESPACE = 'guest_migration:';
const GUEST_MIGRATED_PREFIX = 'kaogong_guest_migrated_';

export interface GuestMigrationRecord {
  userId: string;
  targetUserId: string;
  completedAt: string;
  localRevision: number;
}

export function isGuestMigrationDone(userId: string): boolean {
  try {
    const credKey = `${GUEST_MIGRATION_NAMESPACE}${userId}`;
    const legacyKey = `${GUEST_MIGRATED_PREFIX}${userId}`;
    if (memoryStore.syncState.has(credKey)) return true;
    if (memoryStore.meta.has(legacyKey)) return true;
    if (typeof localStorage !== 'undefined' && Boolean(localStorage.getItem(legacyKey))) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function checkGuestMigrationCredential(userId: string): Promise<boolean> {
  if (isGuestMigrationDone(userId)) return true;
  if (!hasNativeIdb()) return false;
  try {
    const db = await initDatabase();
    return new Promise<boolean>((resolve) => {
      const credKey = `${GUEST_MIGRATION_NAMESPACE}${userId}`;
      const tx = db.transaction(SYNC_STATE_STORE, 'readonly');
      const store = tx.objectStore(SYNC_STATE_STORE);
      const req = store.get(credKey);
      req.onsuccess = () => {
        const found = Boolean(req.result);
        if (found) {
          markGuestMigrationDone(userId, req.result.localRevision ?? 0);
        }
        resolve(found);
      };
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

export function markGuestMigrationDone(userId: string, revision = 0): void {
  try {
    const credKey = `${GUEST_MIGRATION_NAMESPACE}${userId}`;
    const legacyKey = `${GUEST_MIGRATED_PREFIX}${userId}`;
    const nowIso = new Date().toISOString();
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(legacyKey, nowIso);
    }
    memoryStore.meta.set(legacyKey, nowIso);
    memoryStore.syncState.set(credKey, {
      userId: credKey,
      targetUserId: userId,
      completedAt: nowIso,
      localRevision: revision,
    } as any);
  } catch {}
}

export interface CommitGuestMigrationParams {
  userId: string;
  expectedRevision: number;
  mergedState: AppState;
  guestState: AppState;
  accountState: AppState;
  outboxBuilder?: (nextState: AppState, meta: {
    localMutationVersion: number;
    confirmedRevision: number;
    generationId: string;
    contentHash: string;
  }) => OutboxRecord;
}

/**
 * Dedicated atomic guest-migration commit transaction (Issue A01).
 * In a single IndexedDB transaction:
 * 1. Checks expectedRevision against current snapshot revision (aborts with LOCAL_CHANGED if mismatch).
 * 2. Checks migration credential in sync_state (aborts with ALREADY_MIGRATED if duplicate).
 * 3. Atomically writes pre-migration account & guest recovery points into snapshots.
 * 4. Atomically writes merged snapshot into snapshots.
 * 5. Atomically writes outbox record into outbox.
 * 6. Atomically writes migration completion credential into sync_state under guest_migration:<userId>.
 */
export async function commitGuestMigrationTransaction(
  params: CommitGuestMigrationParams
): Promise<MutationResult<void>> {
  return enqueue(async () => {
    checkStorageAvailable();
    const { userId, expectedRevision, mergedState, guestState, accountState } = params;
    const targetKey = getSnapshotKey(userId);
    const credKey = `${GUEST_MIGRATION_NAMESPACE}${userId}`;
    const legacyKey = `${GUEST_MIGRATED_PREFIX}${userId}`;
    const nowIso = new Date().toISOString();
    const accountRecoveryKey = `recovery_${userId}_pre_guest_migration_${Date.now()}`;
    const guestRecoveryKey = `recovery_${userId}_guest_pre_migration_${Date.now()}`;

    // 1. In-memory mode (Bun test / SSR)
    if (!hasNativeIdb()) {
      if (memoryStore.syncState.has(credKey) || memoryStore.meta.has(legacyKey)) {
        return { ok: false, code: 'ALREADY_MIGRATED', message: '游客数据已迁移' };
      }
      const existingSnapshot = memoryStore.snapshots.get(targetKey);
      const currentRevision = existingSnapshot?.revision ?? 0;
      if (currentRevision !== expectedRevision) {
        return {
          ok: false,
          code: 'LOCAL_CHANGED',
          message: '本地数据已被其他页面修改，请重新确认迁移预览',
        };
      }

      const baseline = existingSnapshot
        ? snapshotMeta(existingSnapshot, getActiveGenerationIdFor(userId))
        : { localMutationVersion: 0, confirmedRevision: 0, generationId: getActiveGenerationIdFor(userId), confirmedContentHash: '' };

      const nextLocalVersion = expectedRevision + 1;
      const contentHash = await hashState(mergedState);

      // Save account recovery snapshot
      memoryStore.snapshots.set(accountRecoveryKey, {
        key: accountRecoveryKey,
        state: structuredClone(existingSnapshot?.state ?? accountState),
        version: (existingSnapshot?.state ?? accountState).version,
        revision: expectedRevision,
        migratedFromV2: true,
        updatedAt: nowIso,
      });

      // Save guest recovery snapshot
      memoryStore.snapshots.set(guestRecoveryKey, {
        key: guestRecoveryKey,
        state: structuredClone(guestState),
        version: guestState.version,
        revision: 0,
        migratedFromV2: true,
        updatedAt: nowIso,
      });

      // Save outbox record
      const outboxItem: OutboxRecord = params.outboxBuilder
        ? params.outboxBuilder(mergedState, {
            localMutationVersion: nextLocalVersion,
            confirmedRevision: baseline.confirmedRevision,
            generationId: baseline.generationId,
            contentHash,
          })
        : {
            id: `outbox_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            userId,
            requestId: `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            state: mergedState,
            expectedRevision: baseline.confirmedRevision,
            generationId: baseline.generationId,
            createdAt: nowIso,
            status: 'pending',
          };
      memoryStore.outbox.set(outboxItem.id, structuredClone(outboxItem));

      // Save merged snapshot
      const newSnapshot: SnapshotRecord = {
        key: targetKey,
        state: structuredClone(mergedState),
        version: mergedState.version,
        revision: nextLocalVersion,
        confirmedRevision: baseline.confirmedRevision,
        generationId: baseline.generationId,
        confirmedContentHash: baseline.confirmedContentHash,
        contentHash,
        migratedFromV2: true,
        updatedAt: nowIso,
      };
      memoryStore.snapshots.set(targetKey, newSnapshot);

      // Save migration credential into sync_state
      memoryStore.syncState.set(credKey, {
        userId: credKey,
        targetUserId: userId,
        completedAt: nowIso,
        localRevision: nextLocalVersion,
      } as any);

      markGuestMigrationDone(userId, nextLocalVersion);
      return { ok: true, revision: nextLocalVersion, value: undefined };
    }

    // 2. Native IndexedDB mode: dedicated atomic transaction
    const db = await initDatabase();
    const contentHash = await hashState(mergedState);

    return new Promise<MutationResult<void>>((resolve) => {
      let settled = false;
      const finish = (result: MutationResult<void>) => {
        if (!settled) {
          settled = true;
          resolve(result);
        }
      };

      const tx = db.transaction([SNAPSHOTS_STORE, OUTBOX_STORE, SYNC_STATE_STORE], 'readwrite');
      const snapStore = tx.objectStore(SNAPSHOTS_STORE);
      const outStore = tx.objectStore(OUTBOX_STORE);
      const syncStore = tx.objectStore(SYNC_STATE_STORE);

      let abortCode: string | null = null;
      let abortMessage: string | null = null;
      let credChecked = false;
      let snapChecked = false;
      let hasCred = false;
      let currentSnapshot: SnapshotRecord | undefined = undefined;

      const tryCommit = () => {
        if (!credChecked || !snapChecked) return;
        if (abortCode) return;

        if (hasCred) {
          abortCode = 'ALREADY_MIGRATED';
          abortMessage = '游客数据已迁移';
          tx.abort();
          return;
        }

        const currentRevision = currentSnapshot?.revision ?? 0;
        if (currentRevision !== expectedRevision) {
          abortCode = 'LOCAL_CHANGED';
          abortMessage = '本地数据已被其他页面修改，请重新确认迁移预览';
          tx.abort();
          return;
        }

        const baseline = currentSnapshot
          ? snapshotMeta(currentSnapshot, getActiveGenerationIdFor(userId))
          : { localMutationVersion: 0, confirmedRevision: 0, generationId: getActiveGenerationIdFor(userId), confirmedContentHash: '' };

        const nextLocalVersion = expectedRevision + 1;

        try {
          // 1. Account recovery point
          snapStore.put({
            key: accountRecoveryKey,
            state: currentSnapshot?.state ?? accountState,
            version: (currentSnapshot?.state ?? accountState).version,
            revision: expectedRevision,
            migratedFromV2: true,
            updatedAt: nowIso,
          });

          // 2. Guest recovery point
          snapStore.put({
            key: guestRecoveryKey,
            state: guestState,
            version: guestState.version,
            revision: 0,
            migratedFromV2: true,
            updatedAt: nowIso,
          });

          // 3. Outbox task
          const outboxItem: OutboxRecord = params.outboxBuilder
            ? params.outboxBuilder(mergedState, {
                localMutationVersion: nextLocalVersion,
                confirmedRevision: baseline.confirmedRevision,
                generationId: baseline.generationId,
                contentHash,
              })
            : {
                id: `outbox_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
                userId,
                requestId: `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
                state: mergedState,
                expectedRevision: baseline.confirmedRevision,
                generationId: baseline.generationId,
                createdAt: nowIso,
                status: 'pending',
              };
          outStore.put(outboxItem);

          // 4. Merged snapshot
          snapStore.put({
            key: targetKey,
            state: mergedState,
            version: mergedState.version,
            revision: nextLocalVersion,
            confirmedRevision: baseline.confirmedRevision,
            generationId: baseline.generationId,
            confirmedContentHash: baseline.confirmedContentHash,
            contentHash,
            migratedFromV2: true,
            updatedAt: nowIso,
          });

          // 5. Migration completion credential in sync_state
          syncStore.put({
            userId: credKey,
            targetUserId: userId,
            completedAt: nowIso,
            localRevision: nextLocalVersion,
          });
        } catch (err) {
          abortCode = 'COMMIT_FAILED';
          abortMessage = err instanceof Error ? err.message : String(err);
          tx.abort();
        }
      };

      const credReq = syncStore.get(credKey);
      credReq.onsuccess = () => {
        hasCred = Boolean(credReq.result);
        credChecked = true;
        tryCommit();
      };
      credReq.onerror = () => {
        abortCode = 'COMMIT_FAILED';
        abortMessage = '读取迁移凭据失败';
        tx.abort();
      };

      const snapReq = snapStore.get(targetKey);
      snapReq.onsuccess = () => {
        currentSnapshot = snapReq.result as SnapshotRecord | undefined;
        snapChecked = true;
        tryCommit();
      };
      snapReq.onerror = () => {
        abortCode = 'COMMIT_FAILED';
        abortMessage = '读取账号快照失败';
        tx.abort();
      };

      tx.oncomplete = () => {
        markGuestMigrationDone(userId, expectedRevision + 1);
        finish({ ok: true, revision: expectedRevision + 1, value: undefined });
      };

      tx.onabort = () => {
        if (abortCode) {
          finish({ ok: false, code: abortCode, message: abortMessage || '迁移已终止' });
        } else {
          finish({ ok: false, code: 'COMMIT_FAILED', message: '迁移事务已中止' });
        }
      };

      tx.onerror = () => {
        if (abortCode) {
          finish({ ok: false, code: abortCode, message: abortMessage || '迁移已终止' });
        } else {
          finish({ ok: false, code: 'COMMIT_FAILED', message: tx.error?.message || '专用迁移提交事务失败' });
        }
      };
    });
  });
}
