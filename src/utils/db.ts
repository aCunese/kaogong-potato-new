import { AppState, MutationResult, MediaRecord, SnapshotRecord, DamagedCacheRecord, OutboxRecord } from '../types';
import { BLANK_STATE } from '../constants/initialData';
import { validateAndMigrateBackup } from './backupValidator';

export const DB_NAME = 'kaogong_potato_v3';
export const DB_VERSION = 2;
export const LEGACY_STORAGE_KEY = 'potato_study_v2';

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

// Serial transaction queue (mutex) to prevent race conditions
let mutationQueue: Promise<any> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(task, task);
  mutationQueue = result.catch(() => {});
  return result;
}

// In-memory fallback for environments without native IndexedDB (e.g. Bun test / SSR)
const memoryStore = {
  snapshots: new Map<string, SnapshotRecord>(),
  media: new Map<string, MediaRecord>(),
  damaged_cache: new Map<string, DamagedCacheRecord>(),
  outbox: new Map<string, OutboxRecord>(),
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
  memoryStore.meta.clear();
  dbInstance = null;
  dbInitPromise = null;
  activeUserId = null;
}

/**
 * Initializes and opens the IndexedDB database 'kaogong_potato_v3'.
 * Creates 'snapshots', 'media', 'damaged_cache', and 'outbox' object stores if needed.
 */
export async function initDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    // Return mock IDBDatabase for headless/test environments
    return {
      name: DB_NAME,
      version: DB_VERSION,
      objectStoreNames: ['snapshots', 'media', 'damaged_cache', 'outbox'] as any,
      close: () => {},
    } as unknown as IDBDatabase;
  }

  if (dbInstance) return dbInstance;
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('snapshots')) {
        db.createObjectStore('snapshots', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('media')) {
        db.createObjectStore('media', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('damaged_cache')) {
        db.createObjectStore('damaged_cache', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('outbox')) {
        db.createObjectStore('outbox', { keyPath: 'id' });
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
// Low-level DB helpers with in-memory fallback support
// ----------------------------------------------------------------------

async function getSnapshotFromDB(userId?: string | null): Promise<SnapshotRecord | null> {
  const key = getSnapshotKey(userId);
  if (typeof indexedDB === 'undefined') {
    const item = memoryStore.snapshots.get(key) || (key !== 'latest' ? null : memoryStore.snapshots.get('latest'));
    return item ? JSON.parse(JSON.stringify(item)) : null;
  }

  const db = await initDatabase();
  return new Promise<SnapshotRecord | null>((resolve, reject) => {
    const tx = db.transaction('snapshots', 'readonly');
    const store = tx.objectStore('snapshots');
    const request = store.get(key);

    request.onsuccess = () => {
      resolve(request.result || null);
    };
    request.onerror = () => {
      reject(request.error || new Error('读取快照失败'));
    };
  });
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
  expectedRevision: number = snapshot.revision - 1,
  outboxItem?: OutboxRecord
): Promise<void> {
  const key = snapshot.key;
  if (typeof indexedDB === 'undefined') {
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
  const storeNames = ['snapshots'];
  if (newMedia?.length || deletedMediaIds?.length) storeNames.push('media');
  if (outboxItem) storeNames.push('outbox');

  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeNames, 'readwrite');
    let failure: Error | null = null;
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(failure || tx.error || new Error('写入事务失败'));
    tx.onabort = () => reject(failure || tx.error || new Error('写入事务已中止'));

    const snapshotsStore = tx.objectStore('snapshots');
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
        if (storeNames.includes('media')) {
          const mediaStore = tx.objectStore('media');
          for (const m of newMedia ?? []) mediaStore.put(m);
          for (const id of deletedMediaIds ?? []) mediaStore.delete(id);
        }
        if (outboxItem && storeNames.includes('outbox')) {
          const outboxStore = tx.objectStore('outbox');
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
  revision: number;
  isFresh: boolean;
  corruptedRaw?: string;
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
      return {
        state: existingSnapshot.state,
        revision: existingSnapshot.revision || 1,
        isFresh: false,
      };
    }

    const key = getSnapshotKey(userId);
    // If partitioned for a specific logged-in user, start with clean BLANK_STATE
    if (key !== 'latest') {
      return {
        state: BLANK_STATE,
        revision: 0,
        isFresh: true,
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
        };
      }
    }

    // 3. No existing data -> fresh start
    return {
      state: BLANK_STATE,
      revision: 0,
      isFresh: true,
    };
  });
}

export interface CommitOptions {
  userId?: string | null;
  targetRevision?: number;
  outboxBuilder?: (nextState: AppState, nextRevision: number) => OutboxRecord | undefined;
}

/**
 * Commits a state mutation via a serial transaction queue (mutex) to prevent race conditions.
 * Updates revision and stores the new snapshot atomically with optional outbox record.
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
      const currentRevision = currentSnapshot ? currentSnapshot.revision : 0;

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
        const nextRevision = options?.targetRevision ?? (currentRevision + 1);
        const outboxItem = options?.outboxBuilder
          ? options.outboxBuilder(mutationResult.nextState, nextRevision)
          : undefined;

        const newSnapshot: SnapshotRecord = {
          key: targetKey,
          state: mutationResult.nextState,
          version: 3,
          revision: nextRevision,
          migratedFromV2: currentSnapshot ? currentSnapshot.migratedFromV2 : true,
          updatedAt: new Date().toISOString(),
        };

        await writeMutationToDB(
          newSnapshot,
          mutationResult.newMedia,
          mutationResult.deletedMediaIds,
          currentRevision,
          outboxItem
        );

        return {
          ok: true,
          value: mutationResult.value,
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
 * Retrieves all pending outbox records for a user
 */
export async function getPendingOutbox(userId: string): Promise<OutboxRecord[]> {
  if (typeof indexedDB === 'undefined') {
    return Array.from(memoryStore.outbox.values()).filter(item => item.userId === userId && item.status !== 'in_flight');
  }
  const db = await initDatabase();
  return new Promise<OutboxRecord[]>((resolve, reject) => {
    const tx = db.transaction('outbox', 'readonly');
    const store = tx.objectStore('outbox');
    const req = store.getAll();
    req.onsuccess = () => {
      const all = (req.result || []) as OutboxRecord[];
      resolve(all.filter(item => item.userId === userId));
    };
    req.onerror = () => reject(req.error || new Error('读取待同步队列失败'));
  });
}

/**
 * Deletes an outbox task after successful synchronization confirmation
 */
export async function deleteOutboxItem(id: string): Promise<void> {
  if (typeof indexedDB === 'undefined') {
    memoryStore.outbox.delete(id);
    return;
  }
  const db = await initDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('outbox', 'readwrite');
    const store = tx.objectStore('outbox');
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
  if (typeof indexedDB === 'undefined') {
    for (const [id, item] of memoryStore.outbox.entries()) {
      if (item.userId === userId) memoryStore.outbox.delete(id);
    }
    return;
  }
  const db = await initDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('outbox', 'readwrite');
    const store = tx.objectStore('outbox');
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

  if (typeof indexedDB === 'undefined') {
    memoryStore.damaged_cache.set(id, record);
    return id;
  }

  const db = await initDatabase();
  return new Promise<string>((resolve, reject) => {
    const tx = db.transaction('damaged_cache', 'readwrite');
    const store = tx.objectStore('damaged_cache');
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
  if (typeof indexedDB === 'undefined') {
    return Array.from(memoryStore.damaged_cache.values());
  }

  const db = await initDatabase();
  return new Promise<DamagedCacheRecord[]>((resolve, reject) => {
    const tx = db.transaction('damaged_cache', 'readonly');
    const store = tx.objectStore('damaged_cache');
    const req = store.getAll();

    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error || new Error('读取受损缓存失败'));
  });
}

/**
 * Retrieves a media record by id
 */
export async function getMedia(id: string): Promise<MediaRecord | null> {
  if (typeof indexedDB === 'undefined') {
    const item = memoryStore.media.get(id);
    return item ? structuredClone(item) : null;
  }

  const db = await initDatabase();
  return new Promise<MediaRecord | null>((resolve, reject) => {
    const tx = db.transaction('media', 'readonly');
    const store = tx.objectStore('media');
    const req = store.get(id);

    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error(`读取媒体记录 (${id}) 失败`));
  });
}

/**
 * Saves or updates a media record
 */
export async function saveMedia(record: MediaRecord): Promise<boolean> {
  if (typeof indexedDB === 'undefined') {
    memoryStore.media.set(record.id, structuredClone(record));
    return true;
  }

  const db = await initDatabase();
  return new Promise<boolean>((resolve, reject) => {
    const tx = db.transaction('media', 'readwrite');
    const store = tx.objectStore('media');
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
  if (typeof indexedDB === 'undefined') {
    memoryStore.media.delete(id);
    return true;
  }

  const db = await initDatabase();
  return new Promise<boolean>((resolve, reject) => {
    const tx = db.transaction('media', 'readwrite');
    const store = tx.objectStore('media');
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
    // Built-in potato avatars (pose-0 to pose-7), static assets, data URIs, and external URLs are self-contained.
    if (!storagePath && (!image || /^(data:image\/|https?:\/\/)/i.test(image) || image.startsWith('pose-') || image.startsWith('/') || image.startsWith('./'))) {
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
    if (typeof media.blob === 'string' && media.blob.startsWith('data:image/')) return media.blob;
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
  try {
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
    if (typeof indexedDB === 'undefined') {
      const current = memoryStore.snapshots.get(newSnapshot.key);
      const curRev = current ? current.revision : 0;
      if (expectedRevision > 0 && curRev !== expectedRevision) {
        throw new RevisionConflictError(expectedRevision, curRev);
      }
      // Backup for rollback
      const prevOutbox = new Map(memoryStore.outbox);
      const prevSnapshot = current ? structuredClone(current) : undefined;
      try {
        for (const [id, item] of memoryStore.outbox.entries()) {
          if (item.userId === userId) memoryStore.outbox.delete(id);
        }
        memoryStore.snapshots.set(newSnapshot.key, structuredClone(newSnapshot));
        if (newOutboxItem) {
          memoryStore.outbox.set(newOutboxItem.id, structuredClone(newOutboxItem));
        }
      } catch (e) {
        memoryStore.outbox = prevOutbox;
        if (prevSnapshot) memoryStore.snapshots.set(newSnapshot.key, prevSnapshot);
        throw e;
      }
      return;
    }

    const db = await initDatabase();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['snapshots', 'outbox'], 'readwrite');
      const snapStore = tx.objectStore('snapshots');
      const outStore = tx.objectStore('outbox');

      const getReq = snapStore.get(newSnapshot.key);
      getReq.onsuccess = () => {
        const curSnap = getReq.result as SnapshotRecord | undefined;
        const curRev = curSnap ? curSnap.revision : 0;
        if (expectedRevision > 0 && curRev !== expectedRevision) {
          tx.abort();
          reject(new RevisionConflictError(expectedRevision, curRev));
          return;
        }

        // 1. Delete all existing outbox items for this user
        const outReq = outStore.getAll();
        outReq.onsuccess = () => {
          const items = (outReq.result || []) as OutboxRecord[];
          for (const item of items) {
            if (item.userId === userId) {
              outStore.delete(item.id);
            }
          }

          // 2. Write new snapshot
          snapStore.put(newSnapshot);

          // 3. Write optional new outbox item
          if (newOutboxItem) {
            outStore.put(newOutboxItem);
          }
        };
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('冲突解决事务提交失败'));
      tx.onabort = () => reject(tx.error || new Error('冲突解决事务已被中止，原数据未改变'));
    });
  });
}

/**
 * Clears local client cache only (does not delete cloud data, does not generate outbox).
 */
export async function clearLocalCache(userId?: string | null): Promise<void> {
  return enqueue(async () => {
    const targetUserId = userId !== undefined ? userId : activeUserId;
    const targetKey = getSnapshotKey(targetUserId);

    if (typeof indexedDB === 'undefined') {
      memoryStore.snapshots.delete(targetKey);
      for (const [id, item] of memoryStore.outbox.entries()) {
        if (item.userId === targetUserId) memoryStore.outbox.delete(id);
      }
      return;
    }

    const db = await initDatabase();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['snapshots', 'outbox'], 'readwrite');
      tx.objectStore('snapshots').delete(targetKey);
      const outStore = tx.objectStore('outbox');
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
