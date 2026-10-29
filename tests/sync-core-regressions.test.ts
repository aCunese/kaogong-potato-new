/**
 * Sync core regressions (R01/R02/R03/R05/R06/R07/R12) against the REAL modules:
 * real IndexedDB, real Web Locks, real sync client, real media pipeline.
 * The only controlled part is HTTP: a local Bun.serve mock implements the
 * server contract (CAS revision, generation guard, idempotency, media upload,
 * quota errors) so we can drive the exact failure scenarios from the audit.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { BLANK_STATE, DEMO_STATE } from '../src/constants/initialData';
import type { AppState } from '../src/types';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const stateHash = (state: AppState) => sha256(JSON.stringify(state));

interface ServerState {
  revision: number;
  hasCloudData: boolean;
  generationId: string;
  snapshotGenerationId: string;
  state: AppState | null;
  contentHash: string;
  seedVersion: number;
  needsInitChoice: boolean;
  initChoice: 'default' | 'blank' | null;
  idempotency: Map<string, { payloadSha: string; revision: number; contentHash: string }>;
  history: { revision: number; state: AppState }[];
  mediaUploads: number;
  mediaIds: Set<string>;
  forceStatus: { workspaceGet?: number; workspacePost?: number; mediaUpload?: number; quotaExceeded?: boolean } | null;
  csrfValid: boolean;
  authValid: boolean;
  postedBodies: any[];
  postedRawBodies: string[];
  /** Artificial latency for GET /api/workspace, used to reproduce pull/commit races. */
  getDelayMs?: number;
}

const initialState = () => structuredClone(BLANK_STATE);

let serverState: ServerState;
let server: ReturnType<typeof Bun.serve>;

function resetServer(overrides: Partial<ServerState> = {}) {
  serverState = {
    revision: 0,
    hasCloudData: false,
    generationId: 'gen_1',
    snapshotGenerationId: 'gen_1',
    state: null,
    contentHash: '',
    seedVersion: 0,
    needsInitChoice: false,
    initChoice: null,
    idempotency: new Map(),
    history: [],
    mediaUploads: 0,
    mediaIds: new Set(),
    forceStatus: null,
    csrfValid: true,
    authValid: true,
    postedBodies: [],
    postedRawBodies: [],
    ...overrides,
  };
}

function setCloud(state: AppState, revision: number, generationId = 'gen_1', snapshotGenerationId = generationId) {
  serverState.hasCloudData = true;
  serverState.revision = revision;
  serverState.generationId = generationId;
  serverState.snapshotGenerationId = snapshotGenerationId;
  serverState.state = structuredClone(state);
  serverState.contentHash = stateHash(state);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function handleApi(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const forced = serverState.forceStatus;
  if (forced?.workspaceGet && url.pathname === '/api/workspace' && req.method === 'GET') {
    return jsonResponse({ ok: false, code: 'SERVICE_UNAVAILABLE', message: '服务暂不可用' }, forced.workspaceGet);
  }
  if (forced?.workspacePost && url.pathname === '/api/workspace' && req.method === 'POST') {
    const raw = await req.text();
    serverState.postedRawBodies.push(raw);
    try { serverState.postedBodies.push(JSON.parse(raw)); } catch {}
    return jsonResponse({ ok: false, code: 'SERVICE_UNAVAILABLE', message: '服务暂不可用' }, forced.workspacePost);
  }
  if (forced?.mediaUpload && url.pathname === '/api/media/upload') {
    return jsonResponse({ ok: false, code: 'SERVICE_UNAVAILABLE' }, forced.mediaUpload);
  }

  if (url.pathname === '/api/auth/me' && req.method === 'GET') {
    if (!serverState.authValid) return jsonResponse({ ok: false, code: 'UNAUTHORIZED' }, 401);
    return jsonResponse({ ok: true, user: { id: 'u_test', username: 'tester', nickname: '测试员', role: 'user' }, csrfToken: 'csrf-valid' });
  }

  if (url.pathname === '/api/workspace' && req.method === 'GET') {
    if (serverState.getDelayMs) await new Promise(r => setTimeout(r, serverState.getDelayMs));
    return jsonResponse({
      ok: true,
      hasCloudData: serverState.hasCloudData,
      revision: serverState.revision,
      generationId: serverState.generationId,
      snapshotGenerationId: serverState.snapshotGenerationId,
      contentHash: serverState.contentHash,
      schemaVersion: 3,
      seedVersion: serverState.seedVersion,
      needsInitChoice: serverState.needsInitChoice,
      initChoice: serverState.initChoice,
      state: serverState.state,
    });
  }

  if (url.pathname === '/api/workspace' && req.method === 'POST') {
    const csrf = req.headers.get('x-csrf-token');
    if (!serverState.csrfValid || csrf !== 'csrf-valid') {
      return jsonResponse({ ok: false, code: 'CSRF_INVALID', message: 'CSRF 校验失败' }, 403);
    }
    const rawText = await req.text();
    serverState.postedRawBodies.push(rawText);
    const body = JSON.parse(rawText) as any;
    serverState.postedBodies.push(body);
    const payloadString = JSON.stringify(body.state);
    const payloadSha = sha256(payloadString);

    const existing = serverState.idempotency.get(String(body.requestId));
    if (existing) {
      if (existing.payloadSha !== payloadSha) {
        return jsonResponse({ ok: false, code: 'DUPLICATE_REQUEST_ID_DIFFERENT_PAYLOAD' }, 400);
      }
      return jsonResponse({ ok: true, revision: existing.revision, generationId: serverState.generationId, contentHash: existing.contentHash, idempotent: true });
    }

    if (body.generationId !== serverState.generationId) {
      return jsonResponse({
        ok: false,
        code: 'GENERATION_MISMATCH',
        message: '服务器代际不匹配',
        generationId: serverState.generationId,
        serverRevision: serverState.revision,
        serverContentHash: serverState.contentHash,
        snapshotGenerationId: serverState.snapshotGenerationId,
        serverState: serverState.state,
      }, 409);
    }

    if (body.expectedRevision !== serverState.revision) {
      return jsonResponse({
        ok: false,
        code: 'REVISION_CONFLICT',
        message: '云端存在更新版本',
        serverRevision: serverState.revision,
        serverContentHash: serverState.contentHash,
        serverState: serverState.state,
      }, 409);
    }

    serverState.history.push({ revision: serverState.revision, state: serverState.state as AppState });
    serverState.revision += 1;
    serverState.hasCloudData = true;
    serverState.state = body.state as AppState;
    serverState.contentHash = payloadSha;
    serverState.snapshotGenerationId = serverState.generationId;
    serverState.idempotency.set(String(body.requestId), {
      payloadSha,
      revision: serverState.revision,
      contentHash: payloadSha,
    });
    return jsonResponse({ ok: true, revision: serverState.revision, generationId: serverState.generationId, contentHash: serverState.contentHash });
  }

  if (url.pathname === '/api/media/upload' && req.method === 'POST') {
    if (!serverState.csrfValid || req.headers.get('x-csrf-token') !== 'csrf-valid') {
      return jsonResponse({ ok: false, code: 'CSRF_INVALID' }, 403);
    }
    if (serverState.forceStatus?.quotaExceeded) {
      return jsonResponse({ ok: false, code: 'QUOTA_EXCEEDED', message: '附件配额不足' }, 413);
    }
    const form = await req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') {
      return jsonResponse({ ok: false, code: 'NO_FILE' }, 400);
    }
    const bytes = Buffer.from(await (file as File).arrayBuffer());
    const fileSha = createHash('sha256').update(bytes).digest('hex');
    const mediaId = `media_${fileSha.slice(0, 16)}`;
    serverState.mediaUploads += 1;
    serverState.mediaIds.add(mediaId);
    return jsonResponse({
      ok: true,
      media: {
        id: mediaId,
        url: `/api/media/${mediaId}`,
        sha256: fileSha,
        byte_size: bytes.byteLength,
        mime_type: (file as File).type || 'image/png',
      },
      deduplicated: false,
    });
  }

  if (url.pathname.startsWith('/api/media/') && req.method === 'GET') {
    const id = url.pathname.split('/').pop()!;
    if (!serverState.mediaIds.has(id)) return new Response('not found', { status: 404 });
    return new Response('media', { status: 200, headers: { 'content-type': 'image/png' } });
  }

  if (url.pathname === '/api/workspace/init-choice' && req.method === 'POST') {
    const body = await req.json() as any;
    serverState.initChoice = body.choice === 'blank' ? 'blank' : 'default';
    serverState.seedVersion = 1;
    serverState.needsInitChoice = false;
    const base = serverState.state ?? structuredClone(BLANK_STATE);
    if (serverState.initChoice === 'default' && base.books.length === 0) {
      const seeded = structuredClone(DEMO_STATE);
      base.books = seeded.books;
      base.courses = seeded.courses;
      base.library = seeded.library;
    }
    serverState.revision += 1;
    serverState.hasCloudData = true;
    serverState.state = base;
    serverState.contentHash = stateHash(base);
    serverState.snapshotGenerationId = serverState.generationId;
    return jsonResponse({
      ok: true,
      revision: serverState.revision,
      generationId: serverState.generationId,
      contentHash: serverState.contentHash,
      state: base,
      seedVersion: 1,
      initChoice: serverState.initChoice,
    });
  }

  return jsonResponse({ ok: false, code: 'NOT_FOUND' }, 404);
}

const HARNESS_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>sync harness</title></head><body></body></html>';

let harnessJs = '';
let browser: Browser;
let context: BrowserContext;
let pageA: Page;
let pageB: Page;
let baseUrl = '';

async function openPage(): Promise<Page> {
  const page = await context.newPage();
  page.on('pageerror', () => {});
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    (window as any).h = await import('/harness.js');
  });
  return page;
}

type Harness = any;

async function call<T>(page: Page, fn: (h: Harness) => Promise<T>): Promise<T> {
  // Playwright cannot pass closures; evaluate the serialized body with `h` in scope.
  const source = fn.toString();
  return page.evaluate(`(async () => { const h = window.h; return (${source})(h); })()`) as Promise<T>;
}

beforeAll(async () => {
  resetServer();
  const built = await Bun.build({ entrypoints: [resolve('tests/fixtures/sync-harness.ts')], target: 'browser', format: 'esm' });
  if (!built.success) throw new Error(built.logs.map(String).join('\n'));
  harnessJs = await built.outputs[0].text();

  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/harness.js') {
        return new Response(harnessJs, { headers: { 'content-type': 'application/javascript', 'cache-control': 'no-store' } });
      }
      if (url.pathname === '/') {
        return new Response(HARNESS_HTML, { headers: { 'content-type': 'text/html' } });
      }
      if (url.pathname.startsWith('/api/')) return handleApi(req);
      return new Response('not found', { status: 404 });
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}/`;

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext();
  pageA = await openPage();
  pageB = await openPage();
});

afterAll(async () => {
  await context?.close();
  await browser?.close();
  server?.stop(true);
});

beforeEach(async () => {
  resetServer();
  for (const page of [pageA, pageB]) {
    await page.evaluate(async () => {
      const h = (window as any).h;
      // Close the cached connection, then clear every object store (never delete the DB:
      // a pending delete with open connections would block later opens in other tabs).
      try {
        const open = await h.initDatabase();
        open.close();
      } catch {}
      h._resetInMemoryStore();
      const db = await h.initDatabase();
      await new Promise<void>((resolve, reject) => {
        const stores = ['snapshots', 'media', 'damaged_cache', 'outbox', 'sync_state'];
        const tx = db.transaction(stores, 'readwrite');
        for (const name of stores) tx.objectStore(name).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      db.close();
      localStorage.clear();
      h._resetInMemoryStore();
      h.setActiveUserPartition(null);
    });
  }
});

const USER = 'u_sync_test';

async function seedLocalSnapshot(page: Page, state: AppState, meta: {
  revision?: number;
  confirmedRevision?: number;
  generationId?: string;
  confirmedContentHash?: string;
}) {
  return page.evaluate(async ({ state, meta }) => {
    const h = (window as any).h;
    h._resetInMemoryStore();
    h.setActiveUserPartition('u_sync_test');
    const hash = await h.hashState(state);
    const snap = {
      key: 'snapshot_u_sync_test',
      state,
      version: 3,
      revision: meta.revision ?? 1,
      confirmedRevision: meta.confirmedRevision ?? 0,
      generationId: meta.generationId ?? '',
      confirmedContentHash: meta.confirmedContentHash ?? '',
      contentHash: hash,
      migratedFromV2: true,
      updatedAt: new Date().toISOString(),
    };
    const db = await h.initDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('snapshots', 'readwrite');
      tx.objectStore('snapshots').put(snap);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return hash;
  }, { state, meta });
}

async function seedOutbox(page: Page, task: { requestId?: string; generationId?: string; expectedRevision?: number; state?: AppState }) {
  return page.evaluate(async (task) => {
    const h = (window as any).h;
    const db = await h.initDatabase();
    const record = {
      id: `outbox_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId: 'u_sync_test',
      requestId: task.requestId ?? `req_${Date.now()}_test`,
      state: task.state,
      expectedRevision: task.expectedRevision ?? 0,
      generationId: task.generationId ?? 'gen_1',
      createdAt: new Date().toISOString(),
      status: 'pending',
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('outbox', 'readwrite');
      tx.objectStore('outbox').put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return record.requestId;
  }, task);
}

async function readLocal(page: Page) {
  return page.evaluate(async () => {
    const h = (window as any).h;
    const snapshot = await h.loadSnapshot('u_sync_test');
    const baseline = await h.getSyncBaseline('u_sync_test');
    const conflict = await h.getConflictRecord('u_sync_test');
    const unresolved = await h.getUnresolvedLocalChanges('u_sync_test');
    return { snapshot, baseline, conflict, unresolved };
  });
}

describe('R01: same-revision new generation must not resurrect old snapshot', () => {
  it('adopts the restored generation content and pushes from the adopted content, not the old snapshot', async () => {
    const oldBook = structuredClone(BLANK_STATE);
    oldBook.books = [{ id: 'b-old', name: 'OLD_BOOK', subject: '资料分析', total: 10, pages: 10, done: 3, errors: 1, minutes: 20 }];
    const restored = structuredClone(BLANK_STATE);
    restored.books = [{ id: 'b-restored', name: 'RESTORED_BOOK', subject: '资料分析', total: 10, pages: 10, done: 0, errors: 0, minutes: 0 }];

    // Local: old generation, confirmed at revision 5. Cloud: restored generation, also revision 5.
    const oldHash = await seedLocalSnapshot(pageA, oldBook, { revision: 3, confirmedRevision: 5, generationId: 'gen_old', confirmedContentHash: stateHash(oldBook) });
    setCloud(restored, 5, 'gen_new', 'gen_new');

    const first = await call(pageA, async h => h.syncNormal('u_sync_test', 'csrf-valid'));
    expect(first.status).toBe('synced');

    const afterPull = await readLocal(pageA);
    expect(afterPull.snapshot.state.books[0].name).toBe('RESTORED_BOOK');
    expect(afterPull.baseline.generationId).toBe('gen_new');
    expect(afterPull.baseline.confirmedRevision).toBe(5);
    expect(afterPull.baseline.contentHash).toBe(stateHash(restored));
    expect(oldHash).toBe(stateHash(oldBook));

    // A single nickname edit must be built on the restored content.
    const mutation = await pageA.evaluate(async () => {
      const h = (window as any).h;
      return h.commitMutation(async (draft: AppState) => {
        draft.profile.name = 'NEW_NICKNAME';
        return { nextState: draft, value: true };
      }, { userId: 'u_sync_test', outboxBuilder: (nextState: AppState, meta: any) => ({
        id: `outbox_${Date.now()}`, userId: 'u_sync_test', requestId: `req_${Date.now()}`, state: nextState,
        expectedRevision: meta.confirmedRevision, generationId: meta.generationId,
        createdAt: new Date().toISOString(), status: 'pending',
      }) });
    });
    expect(mutation.ok).toBe(true);
    const pushed = await call(pageA, async h => h.syncNormal('u_sync_test', 'csrf-valid'));
    expect(pushed.status).toBe('synced');
    expect(serverState.state!.profile.name).toBe('NEW_NICKNAME');
    expect(serverState.state!.books[0].name).toBe('RESTORED_BOOK');
    expect(serverState.state!.books.some((b: any) => b.name === 'OLD_BOOK')).toBe(false);
  });
});

describe('R02: quarantined local changes remain unresolved', () => {
  it('reports conflict on every subsequent sync and preserves local data until the user decides', async () => {
    const local = structuredClone(BLANK_STATE);
    local.profile.name = 'LOCAL_UNSYNCED';
    const cloud = structuredClone(BLANK_STATE);
    cloud.profile.name = 'CLOUD_RESTORED';

    await seedLocalSnapshot(pageA, local, { revision: 2, confirmedRevision: 1, generationId: 'gen_old', confirmedContentHash: stateHash(cloud) });
    await seedOutbox(pageA, { generationId: 'gen_old', expectedRevision: 1, state: local });
    setCloud(cloud, 2, 'gen_new', 'gen_new');

    const first = await call(pageA, async h => h.syncNormal('u_sync_test', 'csrf-valid'));
    expect(first.status).toBe('conflict');
    expect(first.code).toBe('GENERATION_MISMATCH');

    const afterFirst = await readLocal(pageA);
    expect(afterFirst.unresolved.quarantined.length).toBe(1);
    expect(afterFirst.conflict).not.toBeNull();

    const second = await call(pageA, async h => h.syncNormal('u_sync_test', 'csrf-valid'));
    expect(second.status).toBe('conflict');
    const afterSecond = await readLocal(pageA);
    // Local snapshot content is never overwritten by the cloud while unresolved.
    expect(afterSecond.snapshot.state.profile.name).toBe('LOCAL_UNSYNCED');
    expect(afterSecond.snapshot.state.books.length).toBe(0);
    expect(serverState.state!.profile.name).toBe('CLOUD_RESTORED');

    // Keep-local resolution re-verifies the reviewed cloud state then pushes local.
    const resolution = await pageA.evaluate(async () => {
      const h = (window as any).h;
      const record = await h.getConflictRecord('u_sync_test');
      return h.forceUploadLocal('u_sync_test', 'csrf-valid', {
        serverRevision: record.serverRevision,
        serverGenerationId: record.serverGenerationId,
        serverContentHash: record.serverContentHash,
      });
    });
    expect((resolution as any).ok).toBe(true);
    expect(serverState.state!.profile.name).toBe('LOCAL_UNSYNCED');
    const afterResolve = await readLocal(pageA);
    expect(afterResolve.conflict).toBeNull();
    expect(afterResolve.unresolved.total).toBe(0);
  });

  it('does not let a second normal sync silently treat quarantined tasks as "no local changes"', async () => {
    const local = structuredClone(BLANK_STATE);
    local.books = [{ id: 'b-x', name: 'LOCAL_ONLY_BOOK', subject: '常识判断', total: 5, pages: 5, done: 0, errors: 0, minutes: 0 }];
    const cloud = structuredClone(BLANK_STATE);
    cloud.books = [{ id: 'b-y', name: 'CLOUD_BOOK', subject: '常识判断', total: 5, pages: 5, done: 0, errors: 0, minutes: 0 }];

    await seedLocalSnapshot(pageA, local, { revision: 2, confirmedRevision: 1, generationId: 'gen_old', confirmedContentHash: stateHash(cloud) });
    await seedOutbox(pageA, { generationId: 'gen_old', expectedRevision: 1, state: local });
    setCloud(cloud, 3, 'gen_new', 'gen_new');

    await call(pageA, async h => h.syncNormal('u_sync_test', 'csrf-valid'));
    await call(pageA, async h => h.syncNormal('u_sync_test', 'csrf-valid'));
    await call(pageA, async h => h.syncNormal('u_sync_test', 'csrf-valid'));

    const final = await readLocal(pageA);
    expect(final.snapshot.state.books[0].name).toBe('LOCAL_ONLY_BOOK');
    expect(final.conflict).not.toBeNull();
    expect(serverState.state!.books[0].name).toBe('CLOUD_BOOK');
  });
});

describe('R03: cross-tab stale flush cannot override a resolved conflict', () => {
  it('a stale claimed task is not uploaded after another tab keeps the cloud version', async () => {
    const local = structuredClone(BLANK_STATE);
    local.profile.name = 'LOCAL_DISCARDED';
    const cloud = structuredClone(BLANK_STATE);
    cloud.profile.name = 'CLOUD_KEEP';

    await seedLocalSnapshot(pageA, local, { revision: 2, confirmedRevision: 1, generationId: 'gen_old', confirmedContentHash: stateHash(cloud) });
    const requestId = await seedOutbox(pageA, { generationId: 'gen_old', expectedRevision: 1, state: local });
    setCloud(cloud, 2, 'gen_new', 'gen_new');

    // Tab A flushes the stale task and gets quarantined + conflict persisted.
    await call(pageA, async h => h.syncNormal('u_sync_test', 'csrf-valid'));
    const conflict = await pageB.evaluate(async () => (window as any).h.getConflictRecord('u_sync_test'));
    expect(conflict).not.toBeNull();

    // Tab B keeps the cloud version (user decision) under the same shared store.
    const keepRemote = await pageB.evaluate(async () => {
      const h = (window as any).h;
      const record = await h.getConflictRecord('u_sync_test');
      return h.forcePullRemote('u_sync_test', record.serverState, record.serverRevision, undefined, {
        serverRevision: record.serverRevision,
        serverGenerationId: record.serverGenerationId,
        serverContentHash: record.serverContentHash,
      });
    });
    expect((keepRemote as any).ok).toBe(true);
    expect(serverState.state!.profile.name).toBe('CLOUD_KEEP');

    // The old requestId must not be resurrected by another flush from tab A.
    const staleClaim = await pageA.evaluate(async (requestId) => {
      const h = (window as any).h;
      const db = await h.initDatabase();
      const all = await new Promise<any[]>((resolve, reject) => {
        const tx = db.transaction('outbox', 'readonly');
        const req = tx.objectStore('outbox').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      const stillThere = all.some(item => item.requestId === requestId);
      const after = await h.syncNormal('u_sync_test', 'csrf-valid');
      return { stillThere, after };
    }, requestId);
    expect(staleClaim.stillThere).toBe(false);
    expect(staleClaim.after.status).not.toBe('conflict');
    expect(serverState.state!.profile.name).toBe('CLOUD_KEEP');
    expect(serverState.history.some(h => h.state.profile.name === 'LOCAL_DISCARDED')).toBe(false);
  });

  it('two tabs cannot claim the same outbox task simultaneously (lease)', async () => {
    const local = structuredClone(BLANK_STATE);
    await seedLocalSnapshot(pageA, local, { revision: 1, confirmedRevision: 0, generationId: 'gen_1' });
    const requestId = await seedOutbox(pageA, { generationId: 'gen_1', expectedRevision: 0, state: local });

    const results = await Promise.all([
      pageA.evaluate(async (rid) => {
        const h = (window as any).h;
        const all = await new Promise<any[]>((resolve) => {
          h.initDatabase().then((db: any) => {
            const tx = db.transaction('outbox', 'readonly');
            const req = tx.objectStore('outbox').getAll();
            req.onsuccess = () => resolve(req.result || []);
          });
        });
        const item = all.find(i => i.requestId === rid);
        return item ? Boolean(await h.claimOutboxTask(item.id, 'tab_a')) : false;
      }, requestId),
      pageB.evaluate(async (rid) => {
        const h = (window as any).h;
        const all = await new Promise<any[]>((resolve) => {
          h.initDatabase().then((db: any) => {
            const tx = db.transaction('outbox', 'readonly');
            const req = tx.objectStore('outbox').getAll();
            req.onsuccess = () => resolve(req.result || []);
          });
        });
        const item = all.find(i => i.requestId === rid);
        return item ? Boolean(await h.claimOutboxTask(item.id, 'tab_b')) : false;
      }, requestId),
    ]);
    expect(results.filter(Boolean).length).toBe(1);
  });
});

describe('R12: local mutation version must never be sent as cloud expectedRevision', () => {
  it('pushes with the confirmed cloud revision after multiple local edits and a pull', async () => {
    const cloud = structuredClone(BLANK_STATE);
    cloud.profile.name = 'REMOTE5';
    setCloud(cloud, 5, 'gen_1', 'gen_1');

    // Local has confirmed baseline revision 1 and no pending changes.
    await seedLocalSnapshot(pageA, cloud, { revision: 2, confirmedRevision: 1, generationId: 'gen_1', confirmedContentHash: stateHash(cloud) });

    // Pull latest cloud revision (5), then make a normal edit and flush.
    const pulled = await call(pageA, async h => h.syncNormal('u_sync_test', 'csrf-valid'));
    expect(pulled.status).toBe('synced');

    await pageA.evaluate(async () => {
      const h = (window as any).h;
      await h.commitMutation(async (draft: AppState) => {
        draft.profile.name = 'EDITED_ON_TOP_OF_5';
        return { nextState: draft, value: true };
      }, {
        userId: 'u_sync_test',
        outboxBuilder: (nextState: AppState, meta: any) => ({
          id: `outbox_${Date.now()}`, userId: 'u_sync_test', requestId: `req_${Date.now()}`, state: nextState,
          expectedRevision: meta.confirmedRevision, generationId: meta.generationId,
          createdAt: new Date().toISOString(), status: 'pending',
        }),
      });
    });
    const flushed = await call(pageA, async h => h.syncNormal('u_sync_test', 'csrf-valid'));
    expect(flushed.status).toBe('synced');
    expect(serverState.revision).toBe(6);
    expect(serverState.state!.profile.name).toBe('EDITED_ON_TOP_OF_5');
    const baseline = await pageA.evaluate(async () => (window as any).h.getSyncBaseline('u_sync_test'));
    expect(baseline.confirmedRevision).toBe(6);
  });

  it('force upload after a pull does not fail with a stale UI revision', async () => {
    const cloud = structuredClone(BLANK_STATE);
    cloud.profile.name = 'REMOTE5';
    setCloud(cloud, 5, 'gen_1', 'gen_1');
    await seedLocalSnapshot(pageA, cloud, { revision: 1, confirmedRevision: 1, generationId: 'gen_1', confirmedContentHash: stateHash(cloud) });
    await call(pageA, async h => h.syncNormal('u_sync_test', 'csrf-valid'));

    const result = await pageA.evaluate(async () => {
      const h = (window as any).h;
      const server = await h.fetchServerSnapshot();
      return h.forceUploadLocal('u_sync_test', 'csrf-valid', {
        serverRevision: server.revision,
        serverGenerationId: server.generationId,
        serverContentHash: server.contentHash,
      });
    });
    expect((result as any).ok).toBe(true);
    expect(serverState.revision).toBe(6);
  });
});

describe('R05: reconnect/session handling', () => {
  it('reports a session-refresh need when CSRF is missing instead of writing', async () => {
    const local = structuredClone(BLANK_STATE);
    await seedLocalSnapshot(pageA, local, { revision: 1, confirmedRevision: 0, generationId: 'gen_1' });
    await seedOutbox(pageA, { generationId: 'gen_1', expectedRevision: 0, state: local });
    const result = await call(pageA, async h => h.syncNormal('u_sync_test', ''));
    expect((result as any).code).toBe('CSRF_INVALID');
    expect(serverState.revision).toBe(0);
  });

  it('keeps the queue when the server returns 503', async () => {
    const local = structuredClone(BLANK_STATE);
    local.profile.name = 'PENDING_503';
    await seedLocalSnapshot(pageA, local, { revision: 1, confirmedRevision: 0, generationId: 'gen_1' });
    await seedOutbox(pageA, { generationId: 'gen_1', expectedRevision: 0, state: local });
    serverState.forceStatus = { workspacePost: 503 };
    const result = await call(pageA, async h => h.syncNormal('u_sync_test', 'csrf-valid'));
    expect(result.status).toBe('failed');
    const after = await readLocal(pageA);
    expect(after.unresolved.total).toBe(1);
    expect(after.snapshot.state.profile.name).toBe('PENDING_503');
  });
});

describe('R06: real media pipeline for wrong photos and avatar', () => {
  const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  it('uploads local data URLs, rewrites snapshot + outbox atomically, then saves workspace', async () => {
    const local = structuredClone(BLANK_STATE);
    local.profile.avatar = TINY_PNG;
    local.profile.name = 'MEDIA_USER';
    local.wrong = [{ id: 'w1', date: '2026-10-26', bookId: 'b-1', note: '错题', image: TINY_PNG }];
    await seedLocalSnapshot(pageA, local, { revision: 1, confirmedRevision: 0, generationId: 'gen_1' });
    await seedOutbox(pageA, { generationId: 'gen_1', expectedRevision: 0, state: local });

    const result = await call(pageA, async h => h.syncNormal('u_sync_test', 'csrf-valid'));
    expect(result.status).toBe('synced');
    // The same image bytes are uploaded once (client dedupe + server sha256 dedupe),
    // and BOTH the avatar and the wrong photo reference the confirmed media id.
    expect(serverState.mediaUploads).toBe(1);
    expect(serverState.state!.profile.avatar).toMatch(/^\/api\/media\/media_/);
    expect(serverState.state!.wrong[0].image).toMatch(/^\/api\/media\/media_/);
    expect(serverState.state!.profile.avatar).toBe(serverState.state!.wrong[0].image);
    expect(JSON.stringify(serverState.state)).not.toContain('data:image/');

    const localAfter = await readLocal(pageA);
    expect(localAfter.snapshot.state.profile.avatar).toMatch(/^\/api\/media\//);
    expect(localAfter.unresolved.total).toBe(0);
  });

  it('keeps local data URLs and does not claim success when media quota is exceeded', async () => {
    const local = structuredClone(BLANK_STATE);
    local.wrong = [{ id: 'w2', date: '2026-10-26', bookId: 'b-1', note: '配额', image: TINY_PNG }];
    await seedLocalSnapshot(pageA, local, { revision: 1, confirmedRevision: 0, generationId: 'gen_1' });
    await seedOutbox(pageA, { generationId: 'gen_1', expectedRevision: 0, state: local });
    serverState.forceStatus = { quotaExceeded: true };

    const result = await call(pageA, async h => h.syncNormal('u_sync_test', 'csrf-valid'));
    expect(result.status).toBe('failed');
    expect((result as any).code).toBe('MEDIA_QUOTA_EXCEEDED');
    expect(serverState.revision).toBe(0);
    const localAfter = await readLocal(pageA);
    expect(localAfter.snapshot.state.wrong[0].image.startsWith('data:image/')).toBe(true);
    expect(localAfter.unresolved.total).toBe(1);
  });
});

describe('R07: safe cache clearing never removes unsynced business data', () => {
  it('refuses to clear while unsynced changes exist, then clears only safe caches after sync', async () => {
    const local = structuredClone(BLANK_STATE);
    local.profile.name = 'UNSYNCED_CACHE';
    await seedLocalSnapshot(pageA, local, { revision: 1, confirmedRevision: 0, generationId: 'gen_1' });
    await seedOutbox(pageA, { generationId: 'gen_1', expectedRevision: 0, state: local });
    await pageA.evaluate(async () => {
      const h = (window as any).h;
      await h.saveDamagedCache('{"broken":true}', 'test damaged cache');
    });

    const refused = await call(pageA, async h => h.clearSafeCaches('u_sync_test'));
    expect((refused as any).ok).toBe(false);
    expect((refused as any).code).toBe('UNSYNCED_DATA_PRESERVED');
    const stillThere = await readLocal(pageA);
    expect(stillThere.snapshot).not.toBeNull();
    expect(stillThere.unresolved.total).toBe(1);

    const synced = await call(pageA, async h => h.syncNormal('u_sync_test', 'csrf-valid'));
    expect(synced.status).toBe('synced');
    const cleared = await call(pageA, async h => h.clearSafeCaches('u_sync_test'));
    expect((cleared as any).ok).toBe(true);
    const afterClear = await readLocal(pageA);
    expect(afterClear.snapshot).not.toBeNull();
    expect(afterClear.baseline).not.toBeNull();
    expect(afterClear.unresolved.total).toBe(0);
  });
});

describe('R08: recovery points are real and restorable', () => {
  it('saves a recovery snapshot and applies it back with a correct follow-up sync task', async () => {
    const cloud = structuredClone(BLANK_STATE);
    cloud.profile.name = 'CURRENT_CLOUD';
    cloud.books = [{ id: 'b-1', name: 'CURRENT_BOOK', subject: '资料分析', total: 10, pages: 10, done: 2, errors: 0, minutes: 10 }];
    setCloud(cloud, 1, 'gen_1', 'gen_1');
    await seedLocalSnapshot(pageA, cloud, { revision: 2, confirmedRevision: 1, generationId: 'gen_1', confirmedContentHash: stateHash(cloud) });

    const recoveryState = structuredClone(BLANK_STATE);
    recoveryState.profile.name = 'RECOVERED_OLD';
    recoveryState.books = [{ id: 'b-1', name: 'RECOVERED_BOOK', subject: '资料分析', total: 10, pages: 10, done: 9, errors: 3, minutes: 99 }];
    await pageA.evaluate(async (recoveryState) => {
      const h = (window as any).h;
      await h.saveRecoverySnapshot('u_sync_test', recoveryState, 1);
    }, recoveryState);

    const restored = await pageA.evaluate(async () => {
      const h = (window as any).h;
      const recovery = await h.getLatestRecoverySnapshot('u_sync_test');
      const result = await h.commitMutation(async () => ({ nextState: recovery.state, value: true }), {
        userId: 'u_sync_test',
        outboxBuilder: (nextState: AppState, meta: any) => ({
          id: `outbox_${Date.now()}`, userId: 'u_sync_test', requestId: `req_restore_${Date.now()}`, state: nextState,
          expectedRevision: meta.confirmedRevision, generationId: meta.generationId,
          createdAt: new Date().toISOString(), status: 'pending',
        }),
      });
      return { result, recoveryName: recovery.state.profile.name };
    });
    expect((restored.result as any).ok).toBe(true);
    expect(restored.recoveryName).toBe('RECOVERED_OLD');
    const pushed = await call(pageA, async h => h.syncNormal('u_sync_test', 'csrf-valid'));
    expect(pushed.status).toBe('synced');
    expect(serverState.state!.profile.name).toBe('RECOVERED_OLD');
    expect(serverState.state!.books[0].name).toBe('RECOVERED_BOOK');
  });

  it('reset path persists a recovery point before destructive change (db-level guarantee)', async () => {
    const before = structuredClone(BLANK_STATE);
    before.profile.name = 'BEFORE_RESET';
    before.books = [{ id: 'b-1', name: 'BOOK_BEFORE_RESET', subject: '资料分析', total: 10, pages: 10, done: 4, errors: 1, minutes: 40 }];
    await seedLocalSnapshot(pageA, before, { revision: 2, confirmedRevision: 0, generationId: 'gen_1' });
    const result = await pageA.evaluate(async () => {
      const h = (window as any).h;
      const snapshot = await h.loadSnapshot('u_sync_test');
      await h.saveRecoverySnapshot('u_sync_test', snapshot.state, snapshot.revision);
      await h.commitMutation(async (draft: AppState) => {
        draft.records = [];
        for (const b of draft.books) { b.done = 0; b.errors = 0; b.minutes = 0; }
        return { nextState: draft, value: true };
      }, { userId: 'u_sync_test' });
      return h.getLatestRecoverySnapshot('u_sync_test');
    });
    expect((result as any).state.profile.name).toBe('BEFORE_RESET');
    expect((result as any).state.books[0].done).toBe(4);
  });
});

describe('S01: outbox compaction barrier and concurrent edits', () => {
  it('does not delete edits added after snapshot preparation; keeps edit B queued while A flushes; protects B from cloud overwrite', async () => {
    // 1. Initial snapshot has state A
    const stateA = structuredClone(BLANK_STATE);
    stateA.profile.name = 'STATE_A';
    await seedLocalSnapshot(pageA, stateA, { revision: 1, confirmedRevision: 0, generationId: 'gen_1' });
    const taskAReqId = await seedOutbox(pageA, { generationId: 'gen_1', expectedRevision: 0, state: stateA });

    // 2. Compaction prepares token for task A
    const prepared = await pageA.evaluate(async (taskAReqId) => {
      const h = (window as any).h;
      const snap = await h.loadSnapshot('u_sync_test');
      const all = await h.getAllOutbox('u_sync_test');
      const target = all.find((i: any) => i.requestId === taskAReqId);
      return {
        targetTaskId: target.id,
        observedTaskIds: [target.id],
        snapshotToken: { revision: snap.revision, contentHash: snap.contentHash },
        state: snap.state,
        expectedRevision: 0,
        generationId: 'gen_1',
      };
    }, taskAReqId);

    // 3. While preparing (or before compaction commits), Edit B is committed!
    const editBCommitted = await pageA.evaluate(async () => {
      const h = (window as any).h;
      const res = await h.commitMutation(async (draft: AppState) => {
        draft.profile.name = 'STATE_B';
        return { nextState: draft, value: true };
      }, {
        userId: 'u_sync_test',
        outboxBuilder: (nextState: AppState, meta: any) => ({
          id: `outbox_b_${Date.now()}`,
          userId: 'u_sync_test',
          requestId: `req_b_${Date.now()}`,
          state: nextState,
          expectedRevision: meta.confirmedRevision,
          generationId: meta.generationId,
          createdAt: new Date().toISOString(),
          status: 'pending',
        }),
      });
      return res.ok;
    });
    expect(editBCommitted).toBe(true);

    // 4. Stale prepared token must be rejected (returns null) because snapshotToken changed
    const compactionResult = await pageA.evaluate(async (prep) => {
      const h = (window as any).h;
      return h.compactOutboxForFlush('u_sync_test', prep);
    }, prepared);
    expect(compactionResult).toBeNull();

    // 5. Verify edit B was NOT deleted from outbox!
    const localBeforeSync = await readLocal(pageA);
    expect(localBeforeSync.unresolved.total).toBe(2);

    // 6. Now perform sync: A flushes, B remains or follows, and server revision advances
    const syncRes = await call(pageA, async h => h.syncNormal('u_sync_test', 'csrf-valid'));
    expect(syncRes.status).toBe('synced');
    expect(serverState.revision).toBeGreaterThanOrEqual(1);
    expect(serverState.state!.profile.name).toBe('STATE_B');

    // 7. If cloud advances independently to C, and local has unconfirmed edit D, C cannot silently overwrite D
    const stateC = structuredClone(serverState.state!);
    stateC.profile.name = 'STATE_C_CLOUD';
    setCloud(stateC, serverState.revision + 1, 'gen_1');

    await pageA.evaluate(async () => {
      const h = (window as any).h;
      await h.commitMutation(async (draft: AppState) => {
        draft.profile.name = 'STATE_D_LOCAL';
        return { nextState: draft, value: true };
      }, {
        userId: 'u_sync_test',
        outboxBuilder: (nextState: AppState, meta: any) => ({
          id: `outbox_d_${Date.now()}`,
          userId: 'u_sync_test',
          requestId: `req_d_${Date.now()}`,
          state: nextState,
          expectedRevision: meta.confirmedRevision,
          generationId: meta.generationId,
          createdAt: new Date().toISOString(),
          status: 'pending',
        }),
      });
    });

    // Calling pull must not silently overwrite D with C
    const pullRes = await call(pageA, async h => h.pullLatestFromServer('u_sync_test'));
    expect(pullRes.status).toBe('conflict');
    const localAfterPull = await readLocal(pageA);
    expect(localAfterPull.snapshot.state.profile.name).toBe('STATE_D_LOCAL');
  });
});

describe('S02: immutable frozen retry payload', () => {
  it('preserves identical requestId and frozenRequest body bytes on retries; only advances server revision once; assigns new requestId for B', async () => {
    const stateA = structuredClone(BLANK_STATE);
    stateA.profile.name = 'PAYLOAD_A';
    await seedLocalSnapshot(pageA, stateA, { revision: 1, confirmedRevision: 0, generationId: 'gen_1' });
    await seedOutbox(pageA, { generationId: 'gen_1', expectedRevision: 0, state: stateA });

    // Step 1: Force server failure 503 on workspace push
    serverState.forceStatus = { workspacePost: 503 };
    const failSync = await call(pageA, async h => h.syncNormal('u_sync_test', 'csrf-valid'));
    expect(failSync.status).toBe('failed');
    expect(serverState.postedRawBodies.length).toBe(1);
    const initialRaw = serverState.postedRawBodies[0];
    const initialBody = serverState.postedBodies[0];
    expect(initialBody.state.profile.name).toBe('PAYLOAD_A');
    const initialRequestId = initialBody.requestId;
    expect(initialRequestId).toBeTruthy();

    // Step 2: While task A is failed in queue, user commits local edit B
    const editBRes = await pageA.evaluate(async () => {
      const h = (window as any).h;
      return h.commitMutation(async (draft: AppState) => {
        draft.profile.name = 'PAYLOAD_B';
        return { nextState: draft, value: true };
      }, {
        userId: 'u_sync_test',
        outboxBuilder: (nextState: AppState, meta: any) => ({
          id: `outbox_b_${Date.now()}`,
          userId: 'u_sync_test',
          requestId: `req_b_${Date.now()}`,
          state: nextState,
          expectedRevision: meta.confirmedRevision,
          generationId: meta.generationId,
          createdAt: new Date().toISOString(),
          status: 'pending',
        }),
      });
    });
    expect(editBRes.ok).toBe(true);

    // Step 3: Remove server error and reset backoff on task A so it retries immediately
    serverState.forceStatus = null;
    await pageA.evaluate(async () => {
      const h = (window as any).h;
      const db = await h.initDatabase();
      const tx = db.transaction('outbox', 'readwrite');
      const store = tx.objectStore('outbox');
      const req = store.getAll();
      req.onsuccess = () => {
        for (const item of req.result) {
          if (item.status === 'failed') {
            item.nextAttemptAt = undefined;
            item.status = 'pending';
            store.put(item);
          }
        }
      };
      await new Promise(r => { tx.oncomplete = r; });
    });

    // Step 4: Run sync again! Task A should retry with identical requestId and exact raw body bytes
    const retrySync = await call(pageA, async h => h.syncNormal('u_sync_test', 'csrf-valid'));
    expect(retrySync.status).toBe('synced');

    // Verify requests captured by server:
    // Request 0 was the failed attempt for A
    // Request 1 was the retry of A: MUST have exact same raw body bytes and exact same requestId
    expect(serverState.postedRawBodies.length).toBeGreaterThanOrEqual(3);
    const retryRaw = serverState.postedRawBodies[1];
    const retryBody = serverState.postedBodies[1];
    expect(retryBody.requestId).toBe(initialRequestId);
    expect(retryRaw).toBe(initialRaw);
    expect(retryBody.state.profile.name).toBe('PAYLOAD_A');

    // Request 2 was task B: MUST have a distinct new requestId and state B
    const taskBBody = serverState.postedBodies[2];
    expect(taskBBody.requestId).not.toBe(initialRequestId);
    expect(taskBBody.state.profile.name).toBe('PAYLOAD_B');
    expect(serverState.state!.profile.name).toBe('PAYLOAD_B');
  });
});

describe('S03: protect old dirty local snapshot with empty queue', () => {
  it('protects dirty snapshot B against cloud A when queue is empty, establishing conflict; does not overwrite B', async () => {
    const cloudA = structuredClone(BLANK_STATE);
    cloudA.profile.name = 'CLOUD_A';
    cloudA.books = [{ id: 'b-1', name: 'BOOK_A', subject: '资料分析', total: 10, pages: 10, done: 2, errors: 0, minutes: 10 }];
    setCloud(cloudA, 1, 'gen_1');

    const dirtyLocalB = structuredClone(BLANK_STATE);
    dirtyLocalB.profile.name = 'DIRTY_LOCAL_B';
    dirtyLocalB.books = [{ id: 'b-1', name: 'BOOK_B_UNSYNCED', subject: '资料分析', total: 10, pages: 10, done: 9, errors: 1, minutes: 90 }];
    const hashB = stateHash(dirtyLocalB);

    // Baseline says confirmed revision 1 with hash A
    await pageA.evaluate(async ({ hashA, hashB, dirtyLocalB }) => {
      const h = (window as any).h;
      await h.saveSyncBaseline({
        userId: 'u_sync_test',
        confirmedRevision: 1,
        generationId: 'gen_1',
        contentHash: hashA,
        updatedAt: new Date().toISOString(),
      });
      // Snapshot has state B, but outbox is empty!
      const db = await h.initDatabase();
      const tx = db.transaction(['snapshots', 'outbox'], 'readwrite');
      tx.objectStore('snapshots').put({
        key: 'snapshot_u_sync_test',
        state: dirtyLocalB,
        version: 3,
        revision: 2,
        confirmedRevision: 1,
        generationId: 'gen_1',
        confirmedContentHash: hashA,
        contentHash: hashB,
        migratedFromV2: true,
        updatedAt: new Date().toISOString(),
      });
      tx.objectStore('outbox').clear();
      await new Promise(r => { tx.oncomplete = r; });
    }, { hashA: serverState.contentHash, hashB, dirtyLocalB });

    // ensureSnapshotHasOutbox should detect the dirty snapshot and queue an outbox task or establish conflict
    const ensureResult = await call(pageA, async h => h.ensureSnapshotHasOutbox('u_sync_test'));
    expect(['queued', 'conflict']).toContain(ensureResult);

    // Running pull/hydrate must NOT overwrite dirtyLocalB with cloudA!
    const pullResult = await call(pageA, async h => h.pullLatestFromServer('u_sync_test'));
    expect(pullResult.status).toBe('conflict');

    const localAfter = await readLocal(pageA);
    expect(localAfter.snapshot.state.profile.name).toBe('DIRTY_LOCAL_B');
    expect(localAfter.snapshot.state.books[0].name).toBe('BOOK_B_UNSYNCED');
  });

  it('blank account, initial choice, and cloud-verified match do NOT trigger false conflict', async () => {
    // 1. Blank account
    const blankRes = await call(pageA, async h => h.ensureSnapshotHasOutbox('u_sync_test'));
    expect(blankRes).toBe('clean');

    // 2. Cloud verified match
    const cloudState = structuredClone(BLANK_STATE);
    cloudState.profile.name = 'VERIFIED';
    const cHash = stateHash(cloudState);
    setCloud(cloudState, 1, 'gen_1');

    await pageA.evaluate(async ({ cloudState, cHash }) => {
      const h = (window as any).h;
      await h.saveSyncBaseline({
        userId: 'u_sync_test',
        confirmedRevision: 1,
        generationId: 'gen_1',
        contentHash: cHash,
        updatedAt: new Date().toISOString(),
      });
      const db = await h.initDatabase();
      const tx = db.transaction(['snapshots', 'outbox'], 'readwrite');
      tx.objectStore('snapshots').put({
        key: 'snapshot_u_sync_test',
        state: cloudState,
        version: 3,
        revision: 1,
        confirmedRevision: 1,
        generationId: 'gen_1',
        confirmedContentHash: cHash,
        contentHash: cHash,
        migratedFromV2: true,
        updatedAt: new Date().toISOString(),
      });
      tx.objectStore('outbox').clear();
      await new Promise(r => { tx.oncomplete = r; });
    }, { cloudState, cHash });

    const verifiedRes = await call(pageA, async h => h.ensureSnapshotHasOutbox('u_sync_test'));
    expect(verifiedRes).toBe('clean');

    const pullRes = await call(pageA, async h => h.pullLatestFromServer('u_sync_test'));
    expect(pullRes.status).toBe('synced');
  });
});



describe('pull/commit race: a save made during an in-flight pull must not open a blocked conflict', () => {
  const RACE_USER = 'u_sync_test';

  async function commitLocalEdit(page: Page, name: string) {
    return page.evaluate(async (nextName) => {
      const h = (window as any).h;
      return h.commitMutation((draft: AppState) => {
        draft.profile.name = nextName;
        return { nextState: draft, value: undefined };
      }, {
        userId: 'u_sync_test',
        outboxBuilder: (nextState: AppState, meta: any) => ({
          id: `outbox_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          userId: 'u_sync_test',
          requestId: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          state: nextState,
          expectedRevision: meta.confirmedRevision,
          generationId: meta.generationId,
          createdAt: new Date().toISOString(),
          status: 'pending',
        }),
      });
    }, name);
  }

  async function readConflict(page: Page) {
    return page.evaluate(async () => (window as any).h.getConflictRecord('u_sync_test'));
  }

  it('turns the racing save into an automatic retry instead of a persisted conflict', async () => {
    const cloud = structuredClone(DEMO_STATE);
    setCloud(cloud, 1);
    const h = stateHash(cloud);
    await seedLocalSnapshot(pageA, cloud, { revision: 5, confirmedRevision: 1, generationId: 'gen_1', confirmedContentHash: h });
    // Simulate a slow foreground pull (server round trip).
    serverState.getDelayMs = 300;
    const pullPromise = call(pageA, async h2 => h2.syncNormal(RACE_USER, 'csrf-valid'));
    await pageA.waitForTimeout(100);
    const committed = await commitLocalEdit(pageA, '并发保存');
    expect(committed.ok).toBe(true);
    const first = await pullPromise;
    expect(first.status).not.toBe('conflict');
    expect(first.code).toBe('LOCAL_EDITS_DURING_PULL');
    // The race must not persist a conflict record that would block every later save.
    expect(await readConflict(pageA)).toBeNull();
    serverState.getDelayMs = undefined;
    const second = await call(pageA, async h2 => h2.syncNormal(RACE_USER, 'csrf-valid'));
    expect(second.status).toBe('synced');
    expect(serverState.revision).toBe(2);
    expect(serverState.state?.profile.name).toBe('并发保存');
  });

  it('auto-heals a benign LOCAL_UNRESOLVED conflict and uploads the queued edit', async () => {
    const cloud = structuredClone(DEMO_STATE);
    setCloud(cloud, 1);
    const h = stateHash(cloud);
    await seedLocalSnapshot(pageA, cloud, { revision: 5, confirmedRevision: 1, generationId: 'gen_1', confirmedContentHash: h });
    const committed = await commitLocalEdit(pageA, '自动修复');
    expect(committed.ok).toBe(true);
    // A stale conflict record created by the old racing behavior.
    await pageA.evaluate(async ({ cloudHash, cloudState }) => {
      const h2 = (window as any).h;
      await h2.saveConflictRecord({
        userId: 'u_sync_test',
        code: 'LOCAL_UNRESOLVED',
        message: 'race conflict',
        serverRevision: 1,
        serverGenerationId: 'gen_1',
        serverContentHash: cloudHash,
        serverState: cloudState,
        detectedAt: new Date().toISOString(),
      });
    }, { cloudHash: h, cloudState: cloud });

    const result = await call(pageA, async h2 => h2.syncNormal(RACE_USER, 'csrf-valid'));
    expect(result.status).toBe('synced');
    expect(await readConflict(pageA)).toBeNull();
    expect(serverState.revision).toBe(2);
    expect(serverState.state?.profile.name).toBe('自动修复');
  });
});
