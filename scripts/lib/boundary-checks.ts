/**
 * Boundary regression checks for V01 through V12.
 * Grounded in the evidence from commit e488847 review.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import cp from 'node:child_process';
import vm from 'node:vm';
import http from 'node:http';
import crypto from 'node:crypto';
import { resolveRepoRoot } from './isolated-env';
import { buildGuestMigration } from '../../src/utils/guestMigration';
import { BLANK_STATE } from '../../src/constants/initialData';

declare const Bun: any;

export interface CheckResult {
  id: string;
  name: string;
  passed: boolean;
  durationMs: number;
  detail: any;
  error?: string;
}

const REPO_ROOT = resolveRepoRoot();

export async function buildBrowserHarness(): Promise<string> {
  const entryPath = path.join(REPO_ROOT, 'tests', 'fixtures', 'boundaries-browser-entry.tsx');
  const built = await Bun.build({
    entrypoints: [entryPath],
    target: 'browser',
    format: 'esm',
  });
  if (!built.success) {
    throw new Error(`Failed to bundle boundary browser harness:\n${built.logs.join('\n')}`);
  }
  return await built.outputs[0].text();
}

export async function createHarnessPage(browser: Browser, harnessSource: string): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext();
  await context.route('http://localhost:18764/**', route => {
    return route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>',
    });
  });
  const page = await context.newPage();
  await page.goto('http://localhost:18764');
  await page.addScriptTag({ content: harnessSource, type: 'module' });
  await page.waitForFunction(() => !!(window as any).db, { timeout: 10_000 });
  return { page, context };
}

// ---------------------------------------------------------------------------
// V01: Account lock bypass & fallback queue deadlock
// ---------------------------------------------------------------------------
export async function runV01Check(browser: Browser, harnessSource: string): Promise<CheckResult> {
  const start = Date.now();
  try {
    const { page, context } = await createHarnessPage(browser, harnessSource);
    try {
      // Subtest A: Same-tab lock bypass
      const bypassResult = await page.evaluate(async () => {
        const w = window as any;
        let release: any;
        const events: string[] = [];
        const first = w.db.withUserLock('A', async () => {
          events.push('first-enter');
          await new Promise(r => release = r);
          events.push('first-exit');
        });
        await new Promise(r => setTimeout(r, 30));
        const second = w.db.withUserLock('A', async () => {
          events.push('second-enter');
        });
        await new Promise(r => setTimeout(r, 30));
        const beforeRelease = [...events];
        if (release) release();
        await Promise.all([first, second]);
        return { hasWebLocks: !!navigator.locks, beforeRelease, after: events };
      });

      // Subtest B: Fallback queue deadlock without navigator.locks
      const deadlockResult = await page.evaluate(async () => {
        const w = window as any;
        Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
        await w.db.commitMutation((state: any) => ({ nextState: state, value: true }), {
          userId: 'A_DEADLOCK',
          outboxBuilder: (state: any) => ({
            id: 'pending_deadlock',
            userId: 'A_DEADLOCK',
            requestId: 'req_deadlock',
            state,
            expectedRevision: 1,
            generationId: 'G',
            createdAt: '2026-10-26',
            status: 'pending',
          }),
        });
        w.fetch = async () => new Response('{}');
        const outcome = await Promise.race([
          w.sync.initialHydrate('A_DEADLOCK', 'token').then(() => 'completed'),
          new Promise(r => setTimeout(() => r('hung'), 350)),
        ]);
        return { outcome };
      });

      // In fixed system:
      // - bypassResult.beforeRelease must ONLY contain 'first-enter' (second-enter waits until first finishes)
      // - deadlockResult.outcome must be 'completed' (not hung)
      const noLockBypass = bypassResult.beforeRelease.length === 1 && bypassResult.beforeRelease[0] === 'first-enter';
      const noDeadlock = deadlockResult.outcome === 'completed';
      const passed = noLockBypass && noDeadlock;

      return {
        id: 'V01',
        name: 'V01: 账号锁可被平行异步调用绕过；fallback 还存在嵌套死锁',
        passed,
        durationMs: Date.now() - start,
        detail: { bypassResult, deadlockResult, noLockBypass, noDeadlock },
      };
    } finally {
      await context.close().catch(() => {});
    }
  } catch (err) {
    return {
      id: 'V01',
      name: 'V01: 账号锁可被平行异步调用绕过；fallback 还存在嵌套死锁',
      passed: false,
      durationMs: Date.now() - start,
      detail: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// V02: Retry backoff becomes false conflict & expired in_flight lease unrecoverable
// ---------------------------------------------------------------------------
export async function runV02Check(browser: Browser, harnessSource: string): Promise<CheckResult> {
  const start = Date.now();
  try {
    const { page, context } = await createHarnessPage(browser, harnessSource);
    try {
      // Subtest A: Retry backoff becomes false conflict
      const conflictResult = await page.evaluate(async () => {
        const w = window as any;
        const remote = structuredClone(w.BLANK_STATE);
        remote.profile.name = 'CONFIRMED_REMOTE';
        const hash = await w.db.hashState(remote);
        await w.db.installConfirmedServerState('A_V02', remote, { revision: 1, generationId: 'G', contentHash: hash });
        await w.db.commitMutation((state: any) => {
          state.profile.name = 'UNSYNCED_EDIT';
          return { nextState: state, value: true };
        }, {
          userId: 'A_V02',
          outboxBuilder: (state: any) => ({
            id: 'retry_task',
            userId: 'A_V02',
            requestId: 'retry_req',
            state,
            expectedRevision: 1,
            generationId: 'G',
            createdAt: '2026-10-26',
            status: 'pending',
          }),
        });
        let posts = 0;
        w.fetch = async (url: any, o: any = {}) => {
          if (o.method === 'POST') {
            posts++;
            throw new TypeError('temporary network reset');
          }
          return Response.json({ ok: true, hasCloudData: true, state: remote, revision: 1, generationId: 'G', snapshotGenerationId: 'G', contentHash: hash });
        };
        const first = await w.sync.syncNormal('A_V02', 'token');
        const queueBefore = await w.db.getUnresolvedLocalChanges('A_V02');
        const second = await w.sync.syncNormal('A_V02', 'token');
        const conflictRecord = await w.db.getConflictRecord('A_V02');
        return {
          firstCode: first.code,
          backoffScheduled: !!queueBefore.failed[0]?.nextAttemptAt,
          secondCode: second.code,
          secondStatus: second.status,
          posts,
          conflictPersisted: !!conflictRecord,
        };
      });

      // Subtest B: Expired in_flight lease unrecoverable
      const leaseResult = await page.evaluate(async () => {
        const w = window as any;
        const s = structuredClone(w.BLANK_STATE);
        const hash = await w.db.hashState(s);
        await w.db.installConfirmedServerState('A_LEASE', s, { revision: 1, generationId: 'G', contentHash: hash });
        await w.db.commitMutation((state: any) => {
          state.profile.name = 'EDIT_LEASE';
          return { nextState: state, value: true };
        }, {
          userId: 'A_LEASE',
          outboxBuilder: (state: any) => ({
            id: 'stale_flight_task',
            userId: 'A_LEASE',
            requestId: 'stale_flight_req',
            state,
            expectedRevision: 1,
            generationId: 'G',
            createdAt: '2020-01-01',
            status: 'in_flight',
            leaseOwner: 'closed-tab',
            leaseExpiresAt: '2020-01-01',
          }),
        });
        w.fetch = async () => new Response('{}');
        const a = await w.sync.syncNormal('A_LEASE', 'token');
        const b = await w.sync.syncNormal('A_LEASE', 'token');
        const remaining = (await w.db.getUnresolvedLocalChanges('A_LEASE')).inFlight.length;
        return { aCode: a.code, bCode: b.code, remaining };
      });

      // In fixed system:
      // - conflictResult: conflictPersisted must be false, secondCode must NOT be 'CONTENT_DIVERGED'
      // - leaseResult: aCode / bCode must NOT be 'SYNC_IN_PROGRESS_OTHER_TAB'
      const noFalseConflict = !conflictResult.conflictPersisted && conflictResult.secondCode !== 'CONTENT_DIVERGED';
      const expiredLeaseRecoverable = leaseResult.aCode !== 'SYNC_IN_PROGRESS_OTHER_TAB';
      const passed = noFalseConflict && expiredLeaseRecoverable;

      return {
        id: 'V02',
        name: 'V02: 自动重试在退避期转成假冲突；已过期上传租约永远不能重领',
        passed,
        durationMs: Date.now() - start,
        detail: { conflictResult, leaseResult, noFalseConflict, expiredLeaseRecoverable },
      };
    } finally {
      await context.close().catch(() => {});
    }
  } catch (err) {
    return {
      id: 'V02',
      name: 'V02: 自动重试在退避期转成假冲突；已过期上传租约永远不能重领',
      passed: false,
      durationMs: Date.now() - start,
      detail: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// V03: Init-choice & refreshSession epoch guards, and sync guard mutation order
// ---------------------------------------------------------------------------
export async function runV03Check(browser: Browser, harnessSource: string): Promise<CheckResult> {
  const start = Date.now();
  try {
    const { page, context } = await createHarnessPage(browser, harnessSource);
    try {
      // Subtest A: init-choice late response cross-account pollution
      const initChoiceResult = await page.evaluate(async () => {
        const w = window as any;
        let session = 'A';
        let releaseInit: any;
        const makeState = (name: string) => {
          const x = structuredClone(w.BLANK_STATE);
          x.profile.name = name;
          return x;
        };
        const user = (id: string) => ({ id, username: id.toLowerCase(), nickname: id, role: 'user' });
        w.fetch = async (url: any, o: any = {}) => {
          if (url === '/api/auth/me') return Response.json({ ok: true, user: user(session), csrfToken: 'token_' + session });
          if (url === '/api/auth/login') {
            session = JSON.parse(o.body).username;
            return Response.json({ ok: true, user: user(session), csrfToken: 'token_' + session });
          }
          if (url === '/api/workspace/init-choice') {
            return new Promise(r => releaseInit = async () => {
              const x = makeState('A_INIT_LATE');
              r(Response.json({ ok: true, state: x, revision: 2, generationId: 'G', contentHash: await w.db.hashState(x) }));
            });
          }
          if (url === '/api/workspace') {
            const x = makeState('STATE_' + session);
            return Response.json({ ok: true, hasCloudData: true, state: x, revision: 1, generationId: 'G', snapshotGenerationId: 'G', contentHash: await w.db.hashState(x), needsInitChoice: session === 'A' });
          }
          return Response.json({ ok: true });
        };
        w.mount();
        await new Promise(r => setTimeout(r, 70));
        const pending = w.api.chooseEmptyLibrary('default');
        await new Promise(r => setTimeout(r, 10));
        await w.api.logout();
        await w.api.login('B', 'dummy');
        await new Promise(r => setTimeout(r, 30));
        const before = { user: w.api.currentUser?.id, name: w.api.state.profile.name, phase: w.api.authPhase };
        if (releaseInit) await releaseInit();
        await pending;
        await new Promise(r => setTimeout(r, 30));
        const after = { user: w.api.currentUser?.id, name: w.api.state.profile.name, phase: w.api.authPhase };
        return { before, after };
      });

      // Subtest B: refreshSession resurrects logout
      const refreshResult = await page.evaluate(async () => {
        const w = window as any;
        let meCalls = 0, releaseMe: any;
        const user = { id: 'A', username: 'a', nickname: 'A', role: 'user' };
        const x = structuredClone(w.BLANK_STATE);
        x.profile.name = 'A_CONTENT';
        w.fetch = async (url: any, o: any = {}) => {
          if (url === '/api/auth/me') {
            meCalls++;
            if (meCalls === 2) return new Promise(r => releaseMe = () => r(Response.json({ ok: true, user, csrfToken: 'late-token' })));
            return Response.json({ ok: true, user, csrfToken: 'token' });
          }
          if (url === '/api/workspace') return Response.json({ ok: true, hasCloudData: true, state: x, revision: 1, generationId: 'G', snapshotGenerationId: 'G', contentHash: await w.db.hashState(x) });
          return Response.json({ ok: true });
        };
        w.mount();
        await new Promise(r => setTimeout(r, 70));
        w.dispatchEvent(new Event('online'));
        await new Promise(r => setTimeout(r, 10));
        await w.api.logout();
        await new Promise(r => setTimeout(r, 10));
        const before = { user: w.api.currentUser?.id ?? null, phase: w.api.authPhase };
        if (releaseMe) releaseMe();
        await new Promise(r => setTimeout(r, 50));
        const after = { user: w.api.currentUser?.id ?? null, name: w.api.state?.profile?.name, phase: w.api.authPhase, csrfPresent: !!w.api.csrfToken };
        return { before, after };
      });

      // Subtest C: guard-false still mutates IDB
      const guardResult = await page.evaluate(async () => {
        const w = window as any;
        const s = structuredClone(w.BLANK_STATE);
        s.profile.name = 'ORIGINAL_A';
        await w.db.installConfirmedServerState('A_GUARD', s, { revision: 1, generationId: 'G', contentHash: await w.db.hashState(s) });
        let current = true;
        w.fetch = async () => {
          const other = structuredClone(s);
          other.profile.name = 'LATE_OTHER_SESSION_STATE';
          current = false;
          return Response.json({ ok: true, hasCloudData: true, revision: 2, generationId: 'G', snapshotGenerationId: 'G', state: other, contentHash: await w.db.hashState(other) });
        };
        const r = await w.sync.syncNormal('A_GUARD', 'token', { guard: () => current });
        const persisted = (await w.db.loadLatestState('A_GUARD')).state.profile.name;
        return { code: r.code, persisted };
      });

      const initChoiceSafe = initChoiceResult.after.name !== 'A_INIT_LATE';
      const refreshSafe = refreshResult.after.user === null && !refreshResult.after.csrfPresent;
      const guardSafe = guardResult.persisted === 'ORIGINAL_A';
      const passed = initChoiceSafe && refreshSafe && guardSafe;

      return {
        id: 'V03',
        name: 'V03: 初始化选择和重连会话缺少 epoch 守卫，迟到响应仍污染新账号或复活已退出身份',
        passed,
        durationMs: Date.now() - start,
        detail: { initChoiceResult, refreshResult, guardResult, initChoiceSafe, refreshSafe, guardSafe },
      };
    } finally {
      await context.close().catch(() => {});
    }
  } catch (err) {
    return {
      id: 'V03',
      name: 'V03: 初始化选择和重连会话缺少 epoch 守卫，迟到响应仍污染新账号或复活已退出身份',
      passed: false,
      durationMs: Date.now() - start,
      detail: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// V04: Force resolution second GET & expectedLocalVersion
// ---------------------------------------------------------------------------
export async function runV04Check(browser: Browser, harnessSource: string): Promise<CheckResult> {
  const start = Date.now();
  try {
    const { page, context } = await createHarnessPage(browser, harnessSource);
    try {
      // Subtest A: forceUploadLocal second GET bypasses reviewed CAS
      const forceUploadResult = await page.evaluate(async () => {
        const w = window as any;
        const local = structuredClone(w.BLANK_STATE);
        local.profile.name = 'LOCAL';
        const remote1 = structuredClone(w.BLANK_STATE);
        remote1.profile.name = 'REVIEWED';
        const remote2 = structuredClone(w.BLANK_STATE);
        remote2.profile.name = 'UNREVIEWED';
        await w.db.installConfirmedServerState('A_V04', local, { revision: 1, generationId: 'G', contentHash: await w.db.hashState(local) });
        let gets = 0, posted: any;
        w.fetch = async (url: any, o: any = {}) => {
          if (o.method === 'POST') {
            posted = JSON.parse(o.body);
            return Response.json({ ok: true, revision: 3, generationId: 'G', contentHash: await w.db.hashState(posted.state) });
          }
          gets++;
          return Response.json({ ok: true, hasCloudData: true, revision: gets === 1 ? 1 : 2, generationId: 'G', snapshotGenerationId: 'G', state: gets === 1 ? remote1 : remote2, contentHash: await w.db.hashState(gets === 1 ? remote1 : remote2) });
        };
        const r = await w.sync.forceUploadLocal('A_V04', 'token', { serverRevision: 1, serverGenerationId: 'G', serverContentHash: await w.db.hashState(remote1) });
        return { status: r.status, gets, postedExpected: posted?.expectedRevision, postedName: posted?.state.profile.name };
      });

      // Subtest B: forcePullRemote ignores expectedLocalVersion
      const forcePullResult = await page.evaluate(async () => {
        const w = window as any;
        const remote = structuredClone(w.BLANK_STATE);
        remote.profile.name = 'REMOTE';
        const hash = await w.db.hashState(remote);
        await w.db.installConfirmedServerState('A_V04_PULL', remote, { revision: 1, generationId: 'G', contentHash: hash });
        const reviewedLocal = (await w.db.loadLatestState('A_V04_PULL')).revision;
        await w.db.commitMutation((state: any) => {
          state.profile.name = 'NEW_EDIT_AFTER_DIALOG';
          return { nextState: state, value: true };
        }, { userId: 'A_V04_PULL' });
        w.fetch = async () => Response.json({ ok: true, hasCloudData: true, revision: 1, generationId: 'G', snapshotGenerationId: 'G', state: remote, contentHash: hash });
        const r = await w.sync.forcePullRemote('A_V04_PULL', remote, 1, reviewedLocal, { serverRevision: 1, serverGenerationId: 'G', serverContentHash: hash });
        return { reviewedLocal, result: r.status, name: (await w.db.loadLatestState('A_V04_PULL')).state.profile.name };
      });

      const uploadAbortsOnRemoteChange = forceUploadResult.status !== 'synced';
      const pullRespectsLocalEdit = forcePullResult.result !== 'synced' && forcePullResult.name === 'NEW_EDIT_AFTER_DIALOG';
      const passed = uploadAbortsOnRemoteChange && pullRespectsLocalEdit;

      return {
        id: 'V04',
        name: 'V04: 强制裁决第二次 GET 偷换审核基线，仍能覆盖用户未审阅的云端内容',
        passed,
        durationMs: Date.now() - start,
        detail: { forceUploadResult, forcePullResult, uploadAbortsOnRemoteChange, pullRespectsLocalEdit },
      };
    } finally {
      await context.close().catch(() => {});
    }
  } catch (err) {
    return {
      id: 'V04',
      name: 'V04: 强制裁决第二次 GET 偷换审核基线，仍能覆盖用户未审阅的云端内容',
      passed: false,
      durationMs: Date.now() - start,
      detail: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// V05: Media transaction inactive during async hash
// ---------------------------------------------------------------------------
export async function runV05Check(browser: Browser, harnessSource: string): Promise<CheckResult> {
  const start = Date.now();
  try {
    const { page, context } = await createHarnessPage(browser, harnessSource);
    try {
      const mediaResult = await page.evaluate(async () => {
        const w = window as any;
        const photo = 'data:image/png;base64,aGk=';
        const state = structuredClone(w.BLANK_STATE);
        state.wrong = [{ id: 'w_test', date: '2026-10-26', bookId: 'b_test', note: '', image: photo }];
        await w.db.commitMutation(() => ({ nextState: state, value: true }), {
          userId: 'A_V05',
          outboxBuilder: (state: any) => ({
            id: 'media_task_v05',
            userId: 'A_V05',
            requestId: 'media_req_v05',
            state,
            expectedRevision: 1,
            generationId: 'G',
            createdAt: '2026-10-26',
            status: 'pending',
          }),
        });
        const nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
        crypto.subtle.digest = async (...args: any[]) => {
          await new Promise(r => setTimeout(r, 35));
          return nativeDigest(...args);
        };
        const result = await w.db.applyMediaRefMappings(
          'A_V05',
          [{ from: photo, to: '/api/media/uploaded' }],
          [{ id: 'uploaded', type: 'photo', mime: 'image/png', blob: photo, createdAt: '2026-10-26' }]
        );
        await new Promise(r => setTimeout(r, 60));
        const snap = await w.db.loadLatestState('A_V05');
        const queue = await w.db.getPendingOutbox('A_V05');
        return {
          result,
          snapshotRef: snap.state.wrong[0].image,
          outboxRef: queue[0]?.state.wrong[0].image,
          mediaStored: !!(await w.db.getMedia('uploaded')),
        };
      });

      // In fixed system: snapshotRef must be '/api/media/uploaded' and result.changed must be true
      const passed = mediaResult.snapshotRef === '/api/media/uploaded' && mediaResult.result?.changed === true;

      return {
        id: 'V05',
        name: 'V05: 媒体映射事务中等待异步 hash，快照/outbox/媒体可能部分提交',
        passed,
        durationMs: Date.now() - start,
        detail: { mediaResult },
      };
    } finally {
      await context.close().catch(() => {});
    }
  } catch (err) {
    return {
      id: 'V05',
      name: 'V05: 媒体映射事务中等待异步 hash，快照/outbox/媒体可能部分提交',
      passed: false,
      durationMs: Date.now() - start,
      detail: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// V06: Docker image missing release.json & silent fallback in server
// ---------------------------------------------------------------------------
export async function runV06Check(): Promise<CheckResult> {
  const start = Date.now();
  try {
    // 1. Dockerfile check
    const dockerfilePath = path.join(REPO_ROOT, 'Dockerfile');
    const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');
    const hasCopyRelease = /COPY\s+(\.\/)?release\.json/i.test(dockerfile);

    // 2. Runtime fallback check: run node script with missing release.json
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-runner-resource-check-'));
    let healthStatus = 0;
    let versionStatus = 0;
    let healthData: any = null;
    let versionData: any = null;
    try {
      const runnerCode = `
import fs from 'node:fs';
import path from 'node:path';
const root = ${JSON.stringify(REPO_ROOT)};
const runtime = ${JSON.stringify(tempDir)};
process.chdir(runtime);
process.env.DATA_DIR = path.join(runtime, 'data');
process.env.RELEASE_CONFIG_PATH = path.join(runtime, 'missing-release.json');
const { default: app } = await import(root + '/server/app.ts');
const { closeDb } = await import(root + '/server/db.ts');
const server = app.listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const base = 'http://127.0.0.1:' + server.address().port;
const healthRes = await fetch(base + '/api/health');
const hStatus = healthRes.status;
const hData = await healthRes.json();
const verRes = await fetch(base + '/version.json');
const vStatus = verRes.status;
const vData = await verRes.json();
await new Promise(r => server.close(r));
closeDb();
console.log(JSON.stringify({ healthStatus: hStatus, health: hData, versionStatus: vStatus, version: vData }));
`;
      const scriptFile = path.join(tempDir, 'test.mts');
      fs.writeFileSync(scriptFile, runnerCode);
      const loaderUrl = 'file://' + path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs');
      const run = cp.spawnSync('node', ['--import', loaderUrl, scriptFile], {
        cwd: tempDir,
        encoding: 'utf8',
        timeout: 15_000,
      });
      const match = run.stdout.match(/\{"healthStatus":\d+,.*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        healthStatus = parsed.healthStatus;
        healthData = parsed.health;
        versionStatus = parsed.versionStatus;
        versionData = parsed.version;
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    // In fixed system: hasCopyRelease is true AND missing config causes HTTP 503 RELEASE_CONFIG_INVALID for both health and version
    const passed =
      hasCopyRelease &&
      healthStatus === 503 &&
      healthData?.code === 'RELEASE_CONFIG_INVALID' &&
      versionStatus === 503 &&
      versionData?.code === 'RELEASE_CONFIG_INVALID';

    return {
      id: 'V06',
      name: 'V06: Docker最终镜像漏复制 release.json，部署后版本接口退化为unknown，健康检查仍绿',
      passed,
      durationMs: Date.now() - start,
      detail: { hasCopyRelease, healthStatus, healthData, versionStatus, versionData },
    };
  } catch (err) {
    return {
      id: 'V06',
      name: 'V06: Docker最终镜像漏复制 release.json，部署后版本接口退化为unknown，健康检查仍绿',
      passed: false,
      durationMs: Date.now() - start,
      detail: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// V07: Media upload quota check after disk write (orphan files)
// ---------------------------------------------------------------------------
export async function runV07Check(): Promise<CheckResult> {
  const start = Date.now();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-quota-check-'));
  try {
    const runnerCode = `
import fs from 'node:fs';
import path from 'node:path';
const root = ${JSON.stringify(REPO_ROOT)};
const temp = ${JSON.stringify(tempDir)};
process.env.DATA_DIR = path.join(temp, 'data');
process.env.USER_MEDIA_QUOTA_BYTES = '100';
const { default: app } = await import(root + '/server/app.ts');
const { getDb, closeDb } = await import(root + '/server/db.ts');
const { createSession } = await import(root + '/server/auth.ts');
const server = app.listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const url = 'http://127.0.0.1:' + server.address().port;
const db = getDb();
db.prepare("INSERT INTO users (id,username,nickname,password_hash,created_at,updated_at) VALUES ('audit_q','audit_q','audit_q','hash',datetime('now'),datetime('now'))").run();
const s = createSession('audit_q');
async function upload(bytes) {
  const f = new FormData();
  f.append('file', new Blob([bytes], { type: 'image/png' }), 'sample.png');
  const r = await fetch(url + '/api/media/upload', {
    method: 'POST',
    headers: { 'Cookie': 'potato_session=' + s.token, 'x-csrf-token': s.csrfToken },
    body: f,
  });
  return { status: r.status, data: await r.json() };
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const first = await upload(png);
const rejects = [];
for (let i = 1; i <= 3; i++) {
  const r = await upload(Buffer.concat([png, Buffer.from([i])]));
  rejects.push(r.status);
}
const attachments = fs.readdirSync(path.join(temp, 'data', 'attachments'));
await new Promise(r => server.close(r));
closeDb();
console.log(JSON.stringify({ firstStatus: first.status, rejects, attachmentCount: attachments.length }));
`;
    const scriptFile = path.join(tempDir, 'test.mts');
    fs.writeFileSync(scriptFile, runnerCode);
    const run = cp.spawnSync('node', ['--import', 'tsx', scriptFile], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 20_000,
    });
    const match = run.stdout.match(/\{"firstStatus":.*"attachmentCount":\d+\}/);
    if (!match) {
      throw new Error(`Failed to parse quota test output: ${run.stdout} ${run.stderr}`);
    }
    const data = JSON.parse(match[0]);
    // In fixed system: attachmentCount must be 1 (0 orphan files from rejected uploads)
    const passed = data.attachmentCount === 1;

    return {
      id: 'V07',
      name: 'V07: 上传配额检查发生在落盘之后，拒绝请求仍能生成不记账的孤儿附件',
      passed,
      durationMs: Date.now() - start,
      detail: data,
    };
  } catch (err) {
    return {
      id: 'V07',
      name: 'V07: 上传配额检查发生在落盘之后，拒绝请求仍能生成不记账的孤儿附件',
      passed: false,
      durationMs: Date.now() - start,
      detail: null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// V08: Historical restore does not check deleted media references
// ---------------------------------------------------------------------------
export async function runV08Check(): Promise<CheckResult> {
  const start = Date.now();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-restore-check-'));
  try {
    const runnerCode = `
import fs from 'node:fs';
import path from 'node:path';
const root = ${JSON.stringify(REPO_ROOT)};
const temp = ${JSON.stringify(tempDir)};
process.env.DATA_DIR = path.join(temp, 'data');
const { default: app } = await import(root + '/server/app.ts');
const { getDb, getCurrentGenerationId, closeDb, getAttachmentsDir } = await import(root + '/server/db.ts');
const { createSession } = await import(root + '/server/auth.ts');
const { createSeedState } = await import(root + '/src/utils/seedFactory.ts');
const server = app.listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const url = 'http://127.0.0.1:' + server.address().port;
const db = getDb();
const gen = getCurrentGenerationId();
db.prepare("INSERT INTO users (id,username,nickname,password_hash,created_at,updated_at) VALUES ('audit_h','audit_h','audit_h','hash',datetime('now'),datetime('now'))").run();
const s = createSession('audit_h');
async function call(route, method='GET', body) {
  const h = { 'Cookie': 'potato_session=' + s.token, 'x-csrf-token': s.csrfToken };
  if (body) h['Content-Type'] = 'application/json';
  const r = await fetch(url + route, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json() };
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const f = new FormData();
f.append('file', new Blob([png], { type: 'image/png' }), 'sample.png');
const upRes = await fetch(url + '/api/media/upload', {
  method: 'POST',
  headers: { 'Cookie': 'potato_session=' + s.token, 'x-csrf-token': s.csrfToken },
  body: f,
});
const upData = await upRes.json();
const stateWithMedia = createSeedState('audit_h');
stateWithMedia.wrong = [{ id: 'w1', date: '2026-10-27', bookId: 'b1', note: 'sample', image: upData.media.url }];
await call('/api/workspace', 'POST', { expectedRevision: 0, requestId: 'r1', schemaVersion: 3, generationId: gen, state: stateWithMedia });
const cleared = createSeedState('audit_h');
await call('/api/workspace', 'POST', { expectedRevision: 1, requestId: 'r2', schemaVersion: 3, generationId: gen, state: cleared });
const history = db.prepare('SELECT id FROM workspace_history WHERE user_id=? AND revision=1').get('audit_h');

// Delete must be rejected with 409 MEDIA_IN_USE because history references it
const delRes = await call('/api/media/' + upData.media.id, 'DELETE');

// Simulate missing attachment by unlinking the attachment file from disk
const mediaRec = db.prepare('SELECT filename FROM media_records WHERE id = ?').get(upData.media.id);
const diskPath = path.join(getAttachmentsDir(), mediaRec.filename);
if (fs.existsSync(diskPath)) {
  fs.unlinkSync(diskPath);
}

// Restore must now be rejected with 409 RESTORE_MEDIA_UNAVAILABLE
const restore = await call('/api/backups/restore-history', 'POST', { historyId: history.id });

await new Promise(r => server.close(r));
closeDb();
console.log(JSON.stringify({
  deleteStatus: delRes.status,
  deleteCode: delRes.data?.code,
  restoreStatus: restore.status,
  restoreCode: restore.data?.code,
}));
`;
    const scriptFile = path.join(tempDir, 'test.mts');
    fs.writeFileSync(scriptFile, runnerCode);
    const run = cp.spawnSync('node', ['--import', 'tsx', scriptFile], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 20_000,
    });
    const match = run.stdout.match(/\{"deleteStatus":\d+,.*\}/);
    if (!match) {
      throw new Error(`Failed to parse restore test output: ${run.stdout} ${run.stderr}`);
    }
    const data = JSON.parse(match[0]);
    // In fixed system: DELETE is rejected with 409 MEDIA_IN_USE,
    // and when file is actually missing, restore is rejected with 409 RESTORE_MEDIA_UNAVAILABLE
    const passed =
      data.deleteStatus === 409 &&
      data.deleteCode === 'MEDIA_IN_USE' &&
      data.restoreStatus === 409 &&
      data.restoreCode === 'RESTORE_MEDIA_UNAVAILABLE';

    return {
      id: 'V08',
      name: 'V08: 历史恢复不检查已删除的媒体，恢复成功后同步被 INVALID_MEDIA_REF 堵塞',
      passed,
      durationMs: Date.now() - start,
      detail: data,
    };
  } catch (err) {
    return {
      id: 'V08',
      name: 'V08: 历史恢复不检查已删除的媒体，恢复成功后同步被 INVALID_MEDIA_REF 堵塞',
      passed: false,
      durationMs: Date.now() - start,
      detail: null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// V09: Guest migration StudyRecord sourceId mapping
// ---------------------------------------------------------------------------
export async function runV09Check(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const a = structuredClone(BLANK_STATE);
    const g = structuredClone(BLANK_STATE);
    g.books = [{ id: 'legacy-book', name: 'Custom legacy book', subject: '常识判断', total: 100, pages: 20, done: 5, errors: 1, minutes: 10 }];
    g.library = [{ id: 'legacy-lib', type: 'book', sourceId: 'legacy-book', name: 'Custom legacy book', subject: '常识判断', defaultMinutes: 30 }];
    g.plans = [{ id: 'legacy-plan', date: '2026-10-26', libraryId: 'legacy-lib', name: 'Custom legacy book', type: 'book', sourceId: 'legacy-book', subject: '常识判断', plannedMinutes: 30, actualMinutes: 10, accumulatedMs: 600000, done: true, timerStart: 0 }];
    g.records = [{ id: 'legacy-record', planId: 'legacy-plan', date: '2026-10-26', type: 'book', sourceId: 'legacy-book', subject: '常识判断', minutes: 10, questions: 5, errors: 1 }];

    const { mergedState: m } = buildGuestMigration(a, g);
    const recordHasExistingBook = m.books.some(b => b.id === m.records[0].sourceId);
    const passed = recordHasExistingBook;

    return {
      id: 'V09',
      name: 'V09: 游客 StudyRecord 的 sourceId 没有随自定义题本/课程重映射',
      passed,
      durationMs: Date.now() - start,
      detail: {
        mergedBookId: m.books[0]?.id,
        planSourceId: m.plans[0]?.sourceId,
        recordSourceId: m.records[0]?.sourceId,
        recordHasExistingBook,
      },
    };
  } catch (err) {
    return {
      id: 'V09',
      name: 'V09: 游客 StudyRecord 的 sourceId 没有随自定义题本/课程重映射',
      passed: false,
      durationMs: Date.now() - start,
      detail: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// V10: SW auto-claim causes applyWebUpdate 12s timeout
// ---------------------------------------------------------------------------
export async function runV10Check(browser: Browser): Promise<CheckResult> {
  const start = Date.now();
  let server: http.Server | undefined;
  let context: BrowserContext | undefined;
  try {
    const esbuildPath = path.join(REPO_ROOT, 'node_modules', 'esbuild');
    const esbuild = await import(esbuildPath);
    const bundle = await esbuild.build({
      entryPoints: [path.join(REPO_ROOT, 'src', 'utils', 'versionCheck.ts')],
      bundle: true,
      write: false,
      format: 'iife',
      globalName: 'UpdateAudit',
      platform: 'browser',
    });
    const bundleJS = bundle.outputFiles[0].text;
    const oldSW = cp.execFileSync('git', ['show', 'bc368b7:public/sw.js'], { cwd: REPO_ROOT, encoding: 'utf8' });
    const newSW = fs.readFileSync(path.join(REPO_ROOT, 'public', 'sw.js'), 'utf8') + '\nself.skipWaiting();';
    let stage = 'old';

    const html = '<!doctype html><html><body><p id="build">old-document</p><script src="/audit.js"></script><script>window.changes=0;navigator.serviceWorker.addEventListener("controllerchange",()=>window.changes++);navigator.serviceWorker.register("/sw.js");</script></body></html>';
    server = http.createServer((req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      if (req.url?.split('?')[0] === '/sw.js') {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(stage === 'old' ? oldSW : newSW);
      } else if (req.url === '/audit.js') {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(bundleJS);
      } else {
        res.setHeader('Content-Type', 'text/html');
        res.end(html);
      }
    });
    await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const url = `http://127.0.0.1:${port}`;

    context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

    stage = 'new';
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg?.update();
    });
    await page.waitForFunction(() => (window as any).changes > 1, { timeout: 8_000 });

    const applyStart = Date.now();
    // In baseline, applyWebUpdate hangs waiting for a future controllerchange for 12,000ms.
    // We cap at 3,500ms to prove it times out without making the test unnecessarily slow.
    const result = await Promise.race([
      page.evaluate(() => (window as any).UpdateAudit.applyWebUpdate({ canActivate: () => ({ ok: true }) })),
      new Promise<any>(r => setTimeout(() => r({ ok: false, timedOut: true }), 3500)),
    ]);
    const applyElapsed = Date.now() - applyStart;
    const passed = result?.ok === true && applyElapsed < 3500;

    return {
      id: 'V10',
      name: 'V10: SW先自动接管，点击更新时却只等未来controllerchange，稳定误报12秒更新失败',
      passed,
      durationMs: Date.now() - start,
      detail: { result, applyElapsedMs: applyElapsed },
    };
  } catch (err) {
    return {
      id: 'V10',
      name: 'V10: SW先自动接管，点击更新时却只等未来controllerchange，稳定误报12秒更新失败',
      passed: false,
      durationMs: Date.now() - start,
      detail: null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (context) await context.close().catch(() => {});
    if (server) await new Promise(r => server!.close(r)).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// V11: Version check cache not bound to local build identity
// ---------------------------------------------------------------------------
export async function runV11Check(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const esbuildPath = path.join(REPO_ROOT, 'node_modules', 'esbuild');
    const esbuild = await import(esbuildPath);
    const storage = new Map<string, string>();
    let fetches = 0;

    const compile = async (old: boolean) => {
      const plugins = old
        ? [
            {
              name: 'historical-release',
              setup(b: any) {
                b.onLoad({ filter: /release\.json$/ }, (args: any) => {
                  const r = JSON.parse(fs.readFileSync(args.path, 'utf8'));
                  r.webVersion = '1.0.2';
                  r.webBuild = '20261026.03';
                  return { contents: JSON.stringify(r), loader: 'json' };
                });
              },
            },
          ]
        : [];
      const b = await esbuild.build({
        entryPoints: [path.join(REPO_ROOT, 'src', 'utils', 'versionCheck.ts')],
        bundle: true,
        write: false,
        format: 'iife',
        globalName: 'audit',
        platform: 'browser',
        plugins,
      });
      const context: any = {
        console,
        Date,
        Math,
        Promise,
        JSON,
        URL,
        AbortController,
        Response,
        setTimeout,
        clearTimeout,
        Uint8Array,
        crypto: (crypto as any).webcrypto,
        localStorage: {
          getItem: (k: string) => storage.get(k) || null,
          setItem: (k: string, v: string) => storage.set(k, v),
          removeItem: (k: string) => storage.delete(k),
        },
        navigator: { onLine: true, userAgent: 'Desktop Chrome' },
        window: { location: { origin: 'https://work.ruyne.space' } },
        fetch: async (url: string) => {
          fetches++;
          const u = new URL(url, 'https://work.ruyne.space');
          return new Response(
            JSON.stringify({
              version: '1.0.3',
              build: '20261027.01',
              schemaVersion: 3,
              nonce: u.searchParams.get('nonce'),
              apkVersion: '1.0.3',
              apkVersionCode: 4,
              apkReleased: false,
              apkSha256: '',
              apkPackageName: 'com.ruyne.kaogong',
            }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        },
      };
      vm.createContext(context);
      vm.runInContext(b.outputFiles[0].text, context);
      return context;
    };

    const oldContext = await compile(true);
    await oldContext.audit.checkAppUpdate({ manual: true });
    const freshContext = await compile(false);
    const currentPassive = await freshContext.audit.checkAppUpdate();

    // In fixed system: because freshContext has currentBuild matching remote build,
    // it must invalidate or bypass the old cache from build 1.0.2, so webUpdateAvailable is false.
    // In baseline: webUpdateAvailable is true and fromCache is true!
    const passed = currentPassive.webUpdateAvailable === false;

    return {
      id: 'V11',
      name: 'V11: 版本节流缓存未绑定本地build/安装身份，升级后仍提示同一个更新',
      passed,
      durationMs: Date.now() - start,
      detail: {
        currentBuild: freshContext.audit.CURRENT_WEB_BUILD,
        status: currentPassive.status,
        installed: currentPassive.installedVersionName,
        webUpdateAvailable: currentPassive.webUpdateAvailable,
        fromCache: currentPassive.fromCache,
        fetches,
      },
    };
  } catch (err) {
    return {
      id: 'V11',
      name: 'V11: 版本节流缓存未绑定本地build/安装身份，升级后仍提示同一个更新',
      passed: false,
      durationMs: Date.now() - start,
      detail: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// V12: Android install permission payload loss & state machine lockup
// ---------------------------------------------------------------------------
export async function runV12Check(): Promise<CheckResult> {
  const start = Date.now();
  try {
    // Check 1: startNativeApkInstall permission denied drops payload
    const esbuildPath = path.join(REPO_ROOT, 'node_modules', 'esbuild');
    const esbuild = await import(esbuildPath);
    let permissions = 0;
    let installCalls = 0;
    const b = await esbuild.build({
      entryPoints: [path.join(REPO_ROOT, 'src', 'utils', 'versionCheck.ts')],
      bundle: true,
      write: false,
      format: 'iife',
      globalName: 'audit',
      platform: 'browser',
    });
    const context: any = {
      console,
      Date,
      Math,
      Promise,
      JSON,
      URL,
      AbortController,
      Response,
      setTimeout,
      clearTimeout,
      Uint8Array,
      crypto: (crypto as any).webcrypto,
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      navigator: { onLine: true, userAgent: 'Android' },
      window: {
        location: { origin: 'https://work.ruyne.space' },
        AndroidBridge: {
          getAppInfo: () =>
            JSON.stringify({
              bridgeProtocol: 2,
              available: true,
              trusted: true,
              packageName: 'com.ruyne.kaogong',
              versionCode: 3,
              versionName: '1.0.2',
              certFingerprint: 'AA'.repeat(32),
              installPermission: 'denied',
            }),
          requestInstallPermission: () => {
            permissions++;
          },
          installApkVerified: () => {
            installCalls++;
          },
        },
      },
    };
    vm.createContext(context);
    vm.runInContext(b.outputFiles[0].text, context);
    const install = await context.audit.startNativeApkInstall({
      version: '1.0.3',
      build: '20261027.01',
      apkVersionCode: 4,
      apkDownloadUrl: '/api/download/apk',
      apkSha256: 'a'.repeat(64),
      apkPackageName: 'com.ruyne.kaogong',
      apkCertFingerprint: 'AA'.repeat(32),
    });

    // Check 2: Android state machine execution via Java harness (verifying RESULT_FIRST_USER, RESULT_CANCELED, RESULT_OK with lower version, etc.)
    const mainActivityPath = path.join(REPO_ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'ruyne', 'kaogong', 'MainActivity.java');
    const templatePath = path.join(REPO_ROOT, 'output', 'audits', '2026-10-27-independent-review', 'repro', 'Harness.template.java');
    const existingHarnessPath = path.join(REPO_ROOT, 'output', 'audits', '2026-10-27-independent-review', 'repro', 'Harness.java');

    let javaHarnessPassed = false;
    let javaHarnessOutput = '';
    const javaTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-v12-harness-'));

    try {
      let harnessCode = '';
      if (fs.existsSync(mainActivityPath) && fs.existsSync(templatePath)) {
        const mainSource = fs.readFileSync(mainActivityPath, 'utf8');
        const methodStart = mainSource.indexOf('    private void handleInstallActivityResult(');
        const methodEnd = mainSource.indexOf('\n    private void handleInstallPermissionResult()', methodStart);
        if (methodStart !== -1 && methodEnd !== -1) {
          const actualMethod = mainSource.substring(methodStart, methodEnd);
          const templateSource = fs.readFileSync(templatePath, 'utf8');
          harnessCode = templateSource.replace('__ACTUAL_JAVA_METHOD__', actualMethod);
        }
      }
      if (!harnessCode && fs.existsSync(existingHarnessPath)) {
        harnessCode = fs.readFileSync(existingHarnessPath, 'utf8');
      }
      if (!harnessCode) {
        throw new Error('Unable to construct or find Java state machine harness');
      }

      const tempHarnessJava = path.join(javaTempDir, 'Harness.java');
      fs.writeFileSync(tempHarnessJava, harnessCode);

      const javacRes = cp.spawnSync('javac', ['-d', javaTempDir, tempHarnessJava], {
        encoding: 'utf8',
        timeout: 10_000,
      });
      if (javacRes.status !== 0) {
        throw new Error(`javac compilation failed: ${javacRes.stderr || javacRes.stdout}`);
      }

      const javaRes = cp.spawnSync('java', ['-cp', javaTempDir, 'Harness'], {
        encoding: 'utf8',
        timeout: 10_000,
      });
      javaHarnessOutput = (javaRes.stdout || '') + (javaRes.stderr || '');
      if (
        javaRes.status === 0 &&
        javaHarnessOutput.includes('All A08 Harness assertions passed successfully.') &&
        javaHarnessOutput.includes('resultCode=RESULT_FIRST_USER(1)')
      ) {
        javaHarnessPassed = true;
      } else {
        throw new Error(`Java harness execution failed with status ${javaRes.status}: ${javaHarnessOutput}`);
      }
    } finally {
      fs.rmSync(javaTempDir, { recursive: true, force: true });
    }

    const payloadSubmitted = installCalls > 0;
    const passed = payloadSubmitted && javaHarnessPassed;

    return {
      id: 'V12',
      name: 'V12: Android安装流程有两个可达状态机缺口：首次授权不续跑、取消安装后一直busy',
      passed,
      durationMs: Date.now() - start,
      detail: {
        firstInstallDenied: install,
        permissionCalls: permissions,
        installRequestPayloadSubmitted: installCalls,
        javaHarnessPassed,
        javaHarnessOutput: javaHarnessOutput.trim(),
      },
    };
  } catch (err) {
    return {
      id: 'V12',
      name: 'V12: Android安装流程有两个可达状态机缺口：首次授权不续跑、取消安装后一直busy',
      passed: false,
      durationMs: Date.now() - start,
      detail: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Run all boundary checks
// ---------------------------------------------------------------------------
export async function runAllBoundaryChecks(onProgress?: (result: CheckResult) => void): Promise<CheckResult[]> {
  const harnessSource = await buildBrowserHarness();
  const browser = await chromium.launch({ headless: true });
  const results: CheckResult[] = [];

  const execute = async (fn: () => Promise<CheckResult>) => {
    const res = await fn();
    results.push(res);
    if (onProgress) onProgress(res);
    return res;
  };

  try {
    await execute(() => runV01Check(browser, harnessSource));
    await execute(() => runV02Check(browser, harnessSource));
    await execute(() => runV03Check(browser, harnessSource));
    await execute(() => runV04Check(browser, harnessSource));
    await execute(() => runV05Check(browser, harnessSource));
    await execute(() => runV06Check());
    await execute(() => runV07Check());
    await execute(() => runV08Check());
    await execute(() => runV09Check());
    await execute(() => runV10Check(browser));
    await execute(() => runV11Check());
    await execute(() => runV12Check());
  } finally {
    await browser.close().catch(() => {});
  }

  return results;
}
