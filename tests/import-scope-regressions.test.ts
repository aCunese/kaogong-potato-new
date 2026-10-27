/**
 * S04 Import auth scope binding and atomic recovery point regressions.
 *
 * Verifies:
 * 1. The auth scope / OperationContext created at the beginning of importBackup
 *    is bound throughout: network probes, recovery point generation, database writes,
 *    outbox queuing, and UI state updates.
 * 2. If account switching (A -> B), logout (A -> guest), or re-login (A -> logout -> A)
 *    occurs during import preparation, the import terminates with AUTH_EPOCH_CHANGED.
 *    The new account / guest never receives the imported snapshot, outbox, recovery points, or network sync.
 * 3. Concurrent edit during import preparation: While import is preparing, edit X is committed.
 *    The atomic recovery point saved by recoveryBeforeWrite contains X (the actual overwritten state).
 *    Injected failure in recovery or outbox put rolls back everything completely (snapshot remains X).
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { buildBrowserHarness, createHarnessPage } from '../scripts/lib/boundary-checks';
import { BLANK_STATE } from '../src/constants/initialData';

describe('S04: Import scope binding & atomic recovery regressions', () => {
  let browser: Browser;
  let harnessSource: string;

  beforeAll(async () => {
    harnessSource = await buildBrowserHarness();
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    if (browser) await browser.close().catch(() => {});
  });

  it('1a: A starts import, media probe delayed, user switches A -> B; delayed probe returns 200 -> must return AUTH_EPOCH_CHANGED, B must not receive imported data', async () => {
    const { page, context } = await createHarnessPage(browser, harnessSource);
    try {
      const result = await page.evaluate(async () => {
        const w = window as any;
        let activeSessionUser: any = { id: 'user_a', username: 'alice', nickname: 'Alice', role: 'user' };
        let activeEpoch = 1;
        let resolveProbe: ((res: Response) => void) | null = null;
        const probeReceived = new Promise<void>(r => {
          (w as any)._onProbe = r;
        });

        w.fetch = async (url: any, init: any = {}) => {
          const urlStr = String(url);
          if (urlStr === '/api/auth/me') {
            return Response.json({
              ok: true,
              user: activeSessionUser,
              csrfToken: 'token_' + (activeSessionUser?.id || 'guest'),
            });
          }
          if (urlStr === '/api/auth/login') {
            const body = JSON.parse(init.body || '{}');
            activeSessionUser = { id: 'user_' + body.username, username: body.username, nickname: body.username, role: 'user' };
            activeEpoch++;
            return Response.json({ ok: true, user: activeSessionUser, csrfToken: 'token_' + activeSessionUser.id });
          }
          if (urlStr === '/api/auth/logout') {
            activeSessionUser = null;
            activeEpoch++;
            return Response.json({ ok: true });
          }
          if (urlStr === '/api/workspace') {
            const snap = structuredClone(w.BLANK_STATE);
            snap.profile.name = activeSessionUser ? activeSessionUser.username + '_workspace' : 'guest_workspace';
            return Response.json({
              ok: true,
              hasCloudData: true,
              state: snap,
              revision: 1,
              generationId: 'G1',
              contentHash: await w.db.hashState(snap),
              needsInitChoice: false,
            });
          }
          if (urlStr === '/api/media/probe_delayed_a_to_b') {
            if ((w as any)._onProbe) (w as any)._onProbe();
            return new Promise<Response>(resolve => {
              resolveProbe = resolve;
            });
          }
          return Response.json({ ok: true });
        };

        w.mount();
        await new Promise(r => setTimeout(r, 60));

        // Initial state for user A
        await w.api.updateProfile('Alice Original', '');

        const backupJson = JSON.stringify({
          version: 3,
          app: '考公工作台·土豆新版',
          state: {
            ...structuredClone(w.BLANK_STATE),
            profile: { name: 'Imported Backup Alice Payload', username: 'alice_backup', avatar: '' },
            wrong: [
              {
                id: 'w_probe_a_b',
                date: '2026-10-27',
                bookId: 'b_probe',
                note: 'probe note',
                image: '/api/media/probe_delayed_a_to_b',
              },
            ],
          },
        });

        // 1. User A starts importBackup
        const importPromise = w.api.importBackup(backupJson);

        // Wait until probe is in flight
        await probeReceived;

        // 2. User switches account to B
        await w.api.logout();
        await w.api.login('bob', 'password');
        await new Promise(r => setTimeout(r, 50));
        await w.api.updateProfile('Bob Original', '');

        // 3. Delayed probe finishes with 200 (even if mock ignores abortSignal)
        if (resolveProbe) {
          (resolveProbe as any)(new Response(JSON.stringify({ ok: true, id: 'probe_delayed_a_to_b' }), { status: 200 }));
        }

        const importResult = await importPromise;

        // Verify Bob's state
        const currentUiProfile = w.api.state.profile.name;
        const currentUserId = w.api.currentUser?.id;
        const bobLatestInDb = await w.db.loadLatestState('user_bob');
        const bobOutbox = await w.db.getAllOutbox('user_bob');
        const bobRecovery = await w.db.getLatestRecoverySnapshot('user_bob');

        return {
          importResult,
          currentUserId,
          currentUiProfile,
          bobLatestName: bobLatestInDb.state.profile.name,
          bobOutboxCount: bobOutbox.length,
          bobHasImportedWrong: bobOutbox.some((o: any) => o.state?.wrong?.some((w: any) => w.id === 'w_probe_a_b')),
          bobRecoveryName: bobRecovery?.state?.profile?.name ?? null,
        };
      });

      expect(result.importResult.ok).toBe(false);
      expect(result.importResult.code).toBe('AUTH_EPOCH_CHANGED');
      expect(result.currentUserId).toBe('user_bob');
      expect(result.currentUiProfile).toBe('Bob Original');
      expect(result.bobLatestName).toBe('Bob Original');
      expect(result.bobHasImportedWrong).toBe(false);
      expect(result.bobRecoveryName).not.toBe('Imported Backup Alice Payload');
    } finally {
      await context.close().catch(() => {});
    }
  });

  it('1b: A starts import, media probe delayed, user switches A -> guest; delayed probe returns 200 -> must return AUTH_EPOCH_CHANGED, guest must not receive imported data', async () => {
    const { page, context } = await createHarnessPage(browser, harnessSource);
    try {
      const result = await page.evaluate(async () => {
        const w = window as any;
        let activeSessionUser: any = { id: 'user_a', username: 'alice', nickname: 'Alice', role: 'user' };
        let activeEpoch = 1;
        let resolveProbe: ((res: Response) => void) | null = null;
        const probeReceived = new Promise<void>(r => {
          (w as any)._onProbe = r;
        });

        w.fetch = async (url: any) => {
          const urlStr = String(url);
          if (urlStr === '/api/auth/me') {
            return Response.json({
              ok: true,
              user: activeSessionUser,
              csrfToken: 'token_' + (activeSessionUser?.id || 'guest'),
            });
          }
          if (urlStr === '/api/auth/logout') {
            activeSessionUser = null;
            activeEpoch++;
            return Response.json({ ok: true });
          }
          if (urlStr === '/api/workspace') {
            const snap = structuredClone(w.BLANK_STATE);
            snap.profile.name = 'workspace_data';
            return Response.json({
              ok: true,
              hasCloudData: true,
              state: snap,
              revision: 1,
              generationId: 'G1',
              contentHash: await w.db.hashState(snap),
            });
          }
          if (urlStr === '/api/media/probe_delayed_a_to_guest') {
            if ((w as any)._onProbe) (w as any)._onProbe();
            return new Promise<Response>(resolve => {
              resolveProbe = resolve;
            });
          }
          return Response.json({ ok: true });
        };

        w.mount();
        await new Promise(r => setTimeout(r, 60));

        await w.api.updateProfile('Alice Pre-Import', '');

        const backupJson = JSON.stringify({
          version: 3,
          app: '考公工作台·土豆新版',
          state: {
            ...structuredClone(w.BLANK_STATE),
            profile: { name: 'Imported For Guest Check', username: 'guest_leak_test', avatar: '' },
            wrong: [
              {
                id: 'w_probe_guest',
                date: '2026-10-27',
                bookId: 'b_probe',
                note: 'probe note guest',
                image: '/api/media/probe_delayed_a_to_guest',
              },
            ],
          },
        });

        const importPromise = w.api.importBackup(backupJson);
        await probeReceived;

        // Logout -> switches to guest
        await w.api.logout();
        await new Promise(r => setTimeout(r, 50));

        if (resolveProbe) {
          (resolveProbe as any)(new Response(JSON.stringify({ ok: true, id: 'probe_delayed_a_to_guest' }), { status: 200 }));
        }

        const importResult = await importPromise;

        const currentUiProfile = w.api.state.profile.name;
        const currentUserId = w.api.currentUser?.id ?? null;
        const guestLatestInDb = await w.db.loadLatestState(null);
        const guestOutbox = await w.db.getAllOutbox('guest');
        const guestRecovery = await w.db.getLatestRecoverySnapshot(null);

        return {
          importResult,
          currentUserId,
          currentUiProfile,
          guestLatestName: guestLatestInDb.state.profile.name,
          guestHasImportedWrong: guestOutbox.some((o: any) => o.state?.wrong?.some((w: any) => w.id === 'w_probe_guest')),
          guestRecoveryName: guestRecovery?.state?.profile?.name ?? null,
        };
      });

      expect(result.importResult.ok).toBe(false);
      expect(result.importResult.code).toBe('AUTH_EPOCH_CHANGED');
      expect(result.currentUserId).toBeNull();
      expect(result.currentUiProfile).not.toBe('Imported For Guest Check');
      expect(result.guestLatestName).not.toBe('Imported For Guest Check');
      expect(result.guestHasImportedWrong).toBe(false);
      expect(result.guestRecoveryName).not.toBe('Imported For Guest Check');
    } finally {
      await context.close().catch(() => {});
    }
  });

  it('1c: A starts import, media probe delayed, user logs out & re-logins A; delayed probe returns 200 -> must return AUTH_EPOCH_CHANGED', async () => {
    const { page, context } = await createHarnessPage(browser, harnessSource);
    try {
      const result = await page.evaluate(async () => {
        const w = window as any;
        let activeSessionUser: any = { id: 'user_a', username: 'alice', nickname: 'Alice', role: 'user' };
        let activeEpoch = 1;
        let resolveProbe: ((res: Response) => void) | null = null;
        const probeReceived = new Promise<void>(r => {
          (w as any)._onProbe = r;
        });

        w.fetch = async (url: any) => {
          const urlStr = String(url);
          if (urlStr === '/api/auth/me') {
            return Response.json({
              ok: true,
              user: activeSessionUser,
              csrfToken: 'token_' + (activeSessionUser?.id || 'guest'),
            });
          }
          if (urlStr === '/api/auth/login') {
            activeSessionUser = { id: 'user_a', username: 'alice', nickname: 'Alice', role: 'user' };
            activeEpoch++;
            return Response.json({ ok: true, user: activeSessionUser, csrfToken: 'token_user_a' });
          }
          if (urlStr === '/api/auth/logout') {
            activeSessionUser = null;
            activeEpoch++;
            return Response.json({ ok: true });
          }
          if (urlStr === '/api/workspace') {
            const snap = structuredClone(w.BLANK_STATE);
            snap.profile.name = 'Alice Re-login Workspace';
            return Response.json({
              ok: true,
              hasCloudData: true,
              state: snap,
              revision: 1,
              generationId: 'G1',
              contentHash: await w.db.hashState(snap),
            });
          }
          if (urlStr === '/api/media/probe_delayed_relogin') {
            if ((w as any)._onProbe) (w as any)._onProbe();
            return new Promise<Response>(resolve => {
              resolveProbe = resolve;
            });
          }
          return Response.json({ ok: true });
        };

        w.mount();
        await new Promise(r => setTimeout(r, 60));

        await w.api.updateProfile('Alice Session 1', '');

        const backupJson = JSON.stringify({
          version: 3,
          app: '考公工作台·土豆新版',
          state: {
            ...structuredClone(w.BLANK_STATE),
            profile: { name: 'Interrupted Import Payload', username: 'alice', avatar: '' },
            wrong: [
              {
                id: 'w_probe_relogin',
                date: '2026-10-27',
                bookId: 'b_probe',
                note: 'probe note relogin',
                image: '/api/media/probe_delayed_relogin',
              },
            ],
          },
        });

        const importPromise = w.api.importBackup(backupJson);
        await probeReceived;

        // Logout and re-login Alice in new epoch
        await w.api.logout();
        await w.api.login('alice', 'pwd');
        await new Promise(r => setTimeout(r, 50));

        if (resolveProbe) {
          (resolveProbe as any)(new Response(JSON.stringify({ ok: true, id: 'probe_delayed_relogin' }), { status: 200 }));
        }

        const importResult = await importPromise;
        const uiProfileName = w.api.state.profile.name;

        return {
          importResult,
          uiProfileName,
        };
      });

      expect(result.importResult.ok).toBe(false);
      expect(result.importResult.code).toBe('AUTH_EPOCH_CHANGED');
      expect(result.uiProfileName).not.toBe('Interrupted Import Payload');
    } finally {
      await context.close().catch(() => {});
    }
  });

  it('2a: Concurrent edit X during import preparation: atomic recovery point contains actual overwritten state X', async () => {
    const { page, context } = await createHarnessPage(browser, harnessSource);
    try {
      const result = await page.evaluate(async () => {
        const w = window as any;
        const activeSessionUser: any = { id: 'user_concurrent', username: 'concurrent_user', nickname: 'Concurrent', role: 'user' };
        let resolveProbe: ((res: Response) => void) | null = null;
        const probeReceived = new Promise<void>(r => {
          (w as any)._onProbe = r;
        });

        w.fetch = async (url: any) => {
          const urlStr = String(url);
          if (urlStr === '/api/auth/me') {
            return Response.json({
              ok: true,
              user: activeSessionUser,
              csrfToken: 'token_concurrent',
            });
          }
          if (urlStr === '/api/workspace') {
            const snap = structuredClone(w.BLANK_STATE);
            snap.profile.name = 'Baseline Before Edit';
            return Response.json({
              ok: true,
              hasCloudData: true,
              state: snap,
              revision: 1,
              generationId: 'G1',
              contentHash: await w.db.hashState(snap),
            });
          }
          if (urlStr === '/api/media/probe_delayed_concurrent') {
            if ((w as any)._onProbe) (w as any)._onProbe();
            return new Promise<Response>(resolve => {
              resolveProbe = resolve;
            });
          }
          return Response.json({ ok: true });
        };

        w.mount();
        await new Promise(r => setTimeout(r, 60));

        await w.api.updateProfile('Baseline Profile', '');

        const backupJson = JSON.stringify({
          version: 3,
          app: '考公工作台·土豆新版',
          state: {
            ...structuredClone(w.BLANK_STATE),
            profile: { name: 'Imported Backup Content', username: 'concurrent_user', avatar: '' },
            wrong: [
              {
                id: 'w_probe_conc',
                date: '2026-10-27',
                bookId: 'b_conc',
                note: 'probe note conc',
                image: '/api/media/probe_delayed_concurrent',
              },
            ],
          },
        });

        // 1. Start import (probe will be delayed)
        const importPromise = w.api.importBackup(backupJson);
        await probeReceived;

        // 2. While import is preparing, commit concurrent Edit X
        await w.api.updateProfile('State X Committed During Import Prep', '');

        // 3. Resolve the probe to allow import to proceed to write
        if (resolveProbe) {
          (resolveProbe as any)(new Response(JSON.stringify({ ok: true, id: 'probe_delayed_concurrent' }), { status: 200 }));
        }

        const importResult = await importPromise;

        // 4. Inspect latest recovery snapshot
        const recoverySnap = await w.db.getLatestRecoverySnapshot('user_concurrent');
        const latestDbState = await w.db.loadLatestState('user_concurrent');

        return {
          importResult,
          recoveryProfileName: recoverySnap?.state?.profile?.name ?? null,
          latestDbProfileName: latestDbState.state.profile.name,
        };
      });

      expect(result.importResult.ok).toBe(true);
      expect(result.latestDbProfileName).toBe('Imported Backup Content');
      // The recovery snapshot MUST contain 'State X Committed During Import Prep', NOT 'Baseline Profile'
      expect(result.recoveryProfileName).toBe('State X Committed During Import Prep');
    } finally {
      await context.close().catch(() => {});
    }
  });

  it('2b: Injected failure in recovery or outbox put rolls back everything completely (snapshot remains X)', async () => {
    const { page, context } = await createHarnessPage(browser, harnessSource);
    try {
      const result = await page.evaluate(async () => {
        const w = window as any;
        const userId = 'user_fail_test';
        await w.db.resetDatabase();

        // 1. Commit initial state X
        await w.db.commitMutation((state: any) => {
          state.profile.name = 'State X Keep Intact';
          return { nextState: state, value: true };
        }, { userId });

        const beforeSnap = await w.db.loadLatestState(userId);

        // 2. Hook IDBObjectStore.prototype.put to inject a failure when writing to outbox
        const originalPut = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function(value: any, ...rest: any[]) {
          if (this.name === 'outbox') {
            // Trigger failure inside transaction
            this.transaction.abort();
            throw new Error('Simulated outbox write failure for rollback test');
          }
          return originalPut.call(this, value, ...rest);
        };

        let commitResult: any = null;
        try {
          commitResult = await w.db.commitMutation((state: any) => {
            state.profile.name = 'Corrupted Partial Import';
            return { nextState: state, value: true };
          }, {
            userId,
            recoveryBeforeWrite: true,
            outboxBuilder: (nextState: any) => ({
              id: 'outbox_must_fail',
              userId,
              requestId: 'req_fail_1',
              state: nextState,
              expectedRevision: 1,
              generationId: 'G1',
              createdAt: new Date().toISOString(),
              status: 'pending',
            }),
          });
        } catch (err: any) {
          commitResult = { ok: false, error: err?.message };
        } finally {
          IDBObjectStore.prototype.put = originalPut;
        }

        // 3. Inspect database after failed commit
        const afterSnap = await w.db.loadLatestState(userId);
        const outboxItems = await w.db.getAllOutbox(userId);
        const recoverySnap = await w.db.getLatestRecoverySnapshot(userId);

        return {
          commitResult,
          beforeName: beforeSnap.state.profile.name,
          afterName: afterSnap.state.profile.name,
          outboxCount: outboxItems.length,
          recoverySnapFound: Boolean(recoverySnap),
        };
      });

      expect(result.commitResult.ok).toBe(false);
      // State MUST remain State X Keep Intact, not Corrupted Partial Import
      expect(result.afterName).toBe('State X Keep Intact');
      expect(result.outboxCount).toBe(0);
    } finally {
      await context.close().catch(() => {});
    }
  });

  it('2c: If import mutation fails during write, recovery point rolls back atomically and does not leak without the import succeeding', async () => {
    const { page, context } = await createHarnessPage(browser, harnessSource);
    try {
      const result = await page.evaluate(async () => {
        const w = window as any;
        const activeSessionUser: any = { id: 'user_rollback_import', username: 'rollback_user', nickname: 'Rollback', role: 'user' };

        w.fetch = async (url: any) => {
          const urlStr = String(url);
          if (urlStr === '/api/auth/me') {
            return Response.json({
              ok: true,
              user: activeSessionUser,
              csrfToken: 'token_rollback',
            });
          }
          if (urlStr === '/api/workspace') {
            const snap = structuredClone(w.BLANK_STATE);
            snap.profile.name = 'Initial Rollback Baseline';
            return Response.json({
              ok: true,
              hasCloudData: true,
              state: snap,
              revision: 1,
              generationId: 'G1',
              contentHash: await w.db.hashState(snap),
            });
          }
          return Response.json({ ok: true });
        };

        w.mount();
        await new Promise(r => setTimeout(r, 60));

        await w.api.updateProfile('Stable Baseline Before Import', '');

        // Make sure no recovery snapshot exists yet
        const initialRecovery = await w.db.getLatestRecoverySnapshot('user_rollback_import');

        const backupJson = JSON.stringify({
          version: 3,
          app: '考公工作台·土豆新版',
          state: {
            ...structuredClone(w.BLANK_STATE),
            profile: { name: 'Payload Should Roll Back', username: 'rollback_user', avatar: '' },
          },
        });

        // Inject failure on outbox write during import write transaction
        const originalPut = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function(value: any, ...rest: any[]) {
          if (this.name === 'outbox') {
            this.transaction.abort();
            throw new Error('Injected outbox failure during import write');
          }
          return originalPut.call(this, value, ...rest);
        };

        let importResult: any = null;
        try {
          importResult = await w.api.importBackup(backupJson);
        } finally {
          IDBObjectStore.prototype.put = originalPut;
        }

        const stateAfter = await w.db.loadLatestState('user_rollback_import');
        const recoveryAfter = await w.db.getLatestRecoverySnapshot('user_rollback_import');

        return {
          importResult,
          initialRecoveryFound: Boolean(initialRecovery),
          stateAfterName: stateAfter.state.profile.name,
          recoveryAfterFound: Boolean(recoveryAfter),
        };
      });

      expect(result.importResult.ok).toBe(false);
      expect(result.stateAfterName).toBe('Stable Baseline Before Import');
      // In atomic implementation, if import write fails, the recovery point also rolls back!
      expect(result.recoveryAfterFound).toBe(false);
    } finally {
      await context.close().catch(() => {});
    }
  });

  it('3: Selection & confirmation captures user/epoch; switching accounts clears pending backup so A chosen file cannot be confirmed by B', async () => {
    const { page, context } = await createHarnessPage(browser, harnessSource);
    try {
      const result = await page.evaluate(async () => {
        const w = window as any;
        let activeSessionUser: any = { id: 'user_a', username: 'alice', nickname: 'Alice', role: 'user' };

        w.fetch = async (url: any, init: any = {}) => {
          const urlStr = String(url);
          if (urlStr === '/api/auth/me') {
            return Response.json({
              ok: true,
              user: activeSessionUser,
              csrfToken: 'token_' + (activeSessionUser?.id || 'guest'),
            });
          }
          if (urlStr === '/api/auth/login') {
            const body = JSON.parse(init.body || '{}');
            activeSessionUser = { id: 'user_' + body.username, username: body.username, nickname: body.username, role: 'user' };
            return Response.json({ ok: true, user: activeSessionUser, csrfToken: 'token_' + activeSessionUser.id });
          }
          if (urlStr === '/api/auth/logout') {
            activeSessionUser = null;
            return Response.json({ ok: true });
          }
          if (urlStr === '/api/workspace') {
            const snap = structuredClone(w.BLANK_STATE);
            snap.profile.name = activeSessionUser ? activeSessionUser.username + '_workspace' : 'guest_workspace';
            return Response.json({
              ok: true,
              hasCloudData: true,
              state: snap,
              revision: 1,
              generationId: 'G1',
              contentHash: await w.db.hashState(snap),
            });
          }
          return Response.json({ ok: true });
        };

        const waitFor = async (predicate: () => boolean) => {
          const deadline = Date.now() + 3000;
          while (!predicate()) {
            if (Date.now() >= deadline) throw new Error('Expected import UI state did not settle');
            await new Promise(r => setTimeout(r, 10));
          }
        };
        const hasConfirmation = () => document.body.innerText.includes('确认导入') || document.body.innerText.includes('Alice Chosen Backup');
        w.backupModalOpen = true;
        w.mount();
        await waitFor(() => w.api?.authPhase === 'authenticated' && w.api?.currentUser?.id === 'user_a');

        const backupJson = JSON.stringify({
          version: 3,
          app: '考公工作台·土豆新版',
          state: {
            ...structuredClone(w.BLANK_STATE),
            profile: { name: 'Alice Chosen Backup', username: 'alice', avatar: '' },
          },
        });

        // 1. Simulate file selection by user A
        const inputEl = document.querySelector('input[type="file"]') as HTMLInputElement;
        if (!inputEl) throw new Error('File input element not found');

        const file = new File([backupJson], 'backup.json', { type: 'application/json' });
        const dt = new DataTransfer();
        dt.items.add(file);
        Object.defineProperty(inputEl, 'files', { value: dt.files, configurable: true });
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));

        // Wait for FileReader + React state, rather than assuming they finish within 50ms.
        await waitFor(hasConfirmation);

        const confirmationBeforeSwitch = document.body.innerText.includes('确认导入') ||
          document.body.innerText.includes('Alice Chosen Backup');

        // 2. User switches account to B
        await w.api.logout();
        await w.api.login('bob', 'pwd');
        await waitFor(() => w.api?.currentUser?.id === 'user_bob' && !hasConfirmation());

        const confirmationAfterSwitch = document.body.innerText.includes('确认导入') ||
          document.body.innerText.includes('Alice Chosen Backup');

        return {
          confirmationBeforeSwitch,
          confirmationAfterSwitch,
          currentUserId: w.api.currentUser?.id,
        };
      });

      expect(result.confirmationBeforeSwitch).toBe(true);
      // Once account is switched to B, pending confirmation MUST be cleared
      expect(result.confirmationAfterSwitch).toBe(false);
      expect(result.currentUserId).toBe('user_bob');
    } finally {
      await context.close().catch(() => {});
    }
  });
});
