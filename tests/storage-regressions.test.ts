import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { resolve } from 'node:path';
import { BLANK_STATE } from '../src/constants/initialData';
import { validateAndMigrateBackup } from '../src/utils/backupValidator';

const blank = () => structuredClone(BLANK_STATE);

describe('Backup validation regressions', () => {
  it('rejects malformed library entries instead of throwing or preserving render-breaking objects', () => {
    expect(validateAndMigrateBackup(JSON.stringify({ ...blank(), library: [null] })).valid).toBe(false);
    expect(validateAndMigrateBackup(JSON.stringify({ ...blank(), library: [{ id: 'x', type: 'custom', sourceId: '', name: {}, subject: '常识判断', defaultMinutes: -5 }] })).valid).toBe(false);
  });

  it('rejects declared versions outside the supported integer versions', () => {
    for (const version of ['99', 2.5, null]) {
      expect(validateAndMigrateBackup(JSON.stringify({ ...blank(), version })).valid).toBe(false);
    }
  });

  it('rejects numeric overflow in JSON before it can become null in a state clone', () => {
    const json = JSON.stringify({ ...blank(), books: [{ id: 'b', name: 'Book', subject: '常识判断', total: 10, pages: 1, done: 0, errors: 0, minutes: 1 }] }).replace('"minutes":1', '"minutes":1e400');
    expect(validateAndMigrateBackup(json).valid).toBe(false);
  });
});

describe('Native IndexedDB persistence regressions', () => {
  let browser: Browser;
  let context: BrowserContext;
  let a: Page;
  let b: Page;

  beforeAll(async () => {
    const built = await Bun.build({ entrypoints: [resolve('src/utils/db.ts')], target: 'browser', format: 'esm' });
    if (!built.success) throw new Error(built.logs.join('\n'));
    const moduleSource = await built.outputs[0].text();
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    await context.route('http://storage-audit.test/**', route => route.fulfill({ contentType: route.request().url().endsWith('db.js') ? 'application/javascript' : 'text/html', body: route.request().url().endsWith('db.js') ? moduleSource : '<!doctype html><html></html>' }));
    a = await context.newPage();
    b = await context.newPage();
    for (const page of [a, b]) {
      await page.goto('http://storage-audit.test/');
      await page.evaluate(async () => { (window as any).db = await import(/* @vite-ignore */ 'http://storage-audit.test/db.js'); });
    }
  });

  afterAll(async () => { await browser?.close(); });

  it('rejects a stale cross-tab write inside the write transaction without overwriting the winner', async () => {
    await a.evaluate(() => (window as any).db.resetDatabase());
    const pending = a.evaluate(async () => {
      const w = window as any;
      w.started = false;
      w.release = false;
      return w.db.commitMutation(async (state: any) => {
        w.started = true;
        while (!w.release) await new Promise(r => setTimeout(r, 5));
        state.profile.name = 'Stale Tab A';
        return { nextState: state, value: true };
      });
    });
    await a.waitForFunction(() => (window as any).started);
    const winner = await b.evaluate(() => (window as any).db.commitMutation(async (state: any) => {
      state.profile.name = 'Committed Tab B';
      return { nextState: state, value: true };
    }));
    await a.evaluate(() => { (window as any).release = true; });
    const loser = await pending;
    const loaded = await a.evaluate(() => (window as any).db.loadLatestState());
    expect(winner.ok).toBe(true);
    expect(loser.ok).toBe(false);
    expect(loser.code).toBe('REVISION_CONFLICT');
    expect(loaded.state.profile.name).toBe('Committed Tab B');
  });

  it('waits for transaction completion for reset, media, and damaged-cache writes', async () => {
    await a.evaluate(() => (window as any).db.commitMutation(async (state: any) => { state.profile.name = 'Keep Me'; return { nextState: state, value: true }; }));
    const result = await a.evaluate(async () => {
      const w = window as any;
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(...args: Parameters<IDBObjectStore['put']>) {
        const req = original.apply(this, args);
        req.addEventListener('success', () => this.transaction.abort(), { once: true });
        return req;
      };
      const attempt = async (action: () => Promise<unknown>) => { try { await action(); return 'resolved'; } catch { return 'rejected'; } };
      try {
        return {
          reset: await attempt(() => w.db.resetDatabase()),
          media: await attempt(() => w.db.saveMedia({ id: 'abort-media', type: 'photo', mime: 'image/png', blob: 'data:image/png;base64,eA==', createdAt: new Date().toISOString() })),
          cache: await attempt(() => w.db.saveDamagedCache('bad', 'audit')),
          loaded: await w.db.loadLatestState(),
          persistedMedia: await w.db.getMedia('abort-media'),
          caches: await w.db.getDamagedCaches(),
        };
      } finally { IDBObjectStore.prototype.put = original; }
    });
    expect(result.reset).toBe('rejected');
    expect(result.media).toBe('rejected');
    expect(result.cache).toBe('rejected');
    expect(result.loaded.state.profile.name).toBe('Keep Me');
    expect(result.persistedMedia).toBeNull();
    expect(result.caches).toEqual([]);
  });

  it('exports a referenced native Blob as portable image data and rejects a missing attachment', async () => {
    const result = await a.evaluate(async () => {
      const w = window as any;
      await w.db.saveMedia({ id: 'photo', type: 'photo', mime: 'image/png', blob: new Blob(['image'], { type: 'image/png' }), createdAt: new Date().toISOString() });
      const state = (await w.db.loadLatestState()).state;
      state.wrong = [{ id: 'w', date: '2026-10-26', bookId: '', note: 'photo', image: 'photo', storagePath: 'photo' }];
      const portable = await w.db.createPortableBackupState(state);
      state.wrong[0].storagePath = 'missing-photo';
      state.wrong[0].image = 'missing-photo';
      let rejectedMissing = false;
      try { await w.db.createPortableBackupState(state); } catch { rejectedMissing = true; }
      return { portable, rejectedMissing };
    });
    expect(result.portable.wrong[0].image).toBe('data:image/png;base64,aW1hZ2U=');
    expect(result.portable.wrong[0].storagePath).toBeUndefined();
    expect(validateAndMigrateBackup(JSON.stringify({ version: 3, state: result.portable })).valid).toBe(true);
    expect(result.rejectedMissing).toBe(true);
  });

  it('exports state with built-in potato avatars (pose-0 to pose-7) without looking for media attachments', async () => {
    const result = await a.evaluate(async () => {
      const w = window as any;
      const state = (await w.db.loadLatestState()).state;
      state.profile.avatar = 'pose-3';
      const portable = await w.db.createPortableBackupState(state);
      return { portableAvatar: portable.profile.avatar };
    });
    expect(result.portableAvatar).toBe('pose-3');
  });

  it('isolates preview export and does not touch persistent IndexedDB media', async () => {
    const result = await a.evaluate(async () => {
      const w = window as any;
      const previewState = (await w.db.loadLatestState()).state;
      previewState.wrong = [{ id: 'pw', date: '2026-10-26', bookId: '', note: 'p', image: 'preview-image-id', storagePath: 'preview-image-id' }];
      const portable = await w.db.createPortableBackupState(previewState, { isPreview: true });
      return { portableWrong: portable.wrong[0] };
    });
    expect(result.portableWrong.image).toBe('preview-image-id');
  });
});
