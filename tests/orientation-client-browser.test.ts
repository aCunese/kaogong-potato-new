import { afterAll, beforeAll, expect, it } from 'bun:test';
import { chromium, type Browser, type Page } from 'playwright';
import { buildBrowserHarness, createHarnessPage } from '../scripts/lib/boundary-checks';

let browser: Browser, harness: string;
beforeAll(async () => { harness = await buildBrowserHarness(); browser = await chromium.launch({ headless: true }); });
afterAll(async () => { await browser?.close(); });
const resolved = (rotation: number) => ({ status: 'resolved', rotation, version: 1 });

async function mountQueue(page: Page, refs: string[], pending = true) {
  await page.evaluate(({ refs, pending }) => {
    const w = window as any;
    w.owner = 'a'; w.epoch = 1; w.commits = []; w.controllers = [];
    w.orientationState = structuredClone(w.BLANK_STATE);
    w.orientationState.wrong = [{ id: 'w', bookId: '资料分析', date: '2026-11-04', image: refs[0], images: refs, ...(pending ? { imageOrientations: refs.map(() => null) } : {}) }];
    const isValid = (scope: any) => scope.userId === w.owner && scope.epoch === w.epoch && !scope.signal.aborted;
    function Queue() {
      w.renderedOrientationState = w.orientationState;
      w.orientationAPI = w.useWrongImageOrientation({ state: w.orientationState, userId: w.owner, csrf: 'test-only', enabled: true,
        createScope: (userId: string) => { const controller = new AbortController(); w.controllers.push(controller); return { userId, epoch: w.epoch, signal: controller.signal, operationId: 'test' }; },
        isValid,
        mutate: async (mutator: any, reason: string, options: any) => {
          if (options && !options.context.isCurrent()) return { ok: false, code: 'AUTH_EPOCH_CHANGED' };
          const draft = structuredClone(w.orientationState), result = mutator(draft);
          if ('error' in result) return { ok: false, ...result.error };
          w.orientationState = draft; w.commits.push(reason); w.renderQueue(); return { ok: true, value: result.value };
        },
      });
      return null;
    }
    w.queueRoot = w.createRoot(document.getElementById('root'));
    w.renderQueue = () => w.queueRoot.render(w.React.createElement(Queue));
    w.renderQueue();
  }, { refs, pending });
  page.setDefaultTimeout(3000);
  await page.waitForFunction(() => !!(window as any).orientationAPI);
}

it('processes multiple photos serially after offline media mapping, preserving separate results', async () => {
  const { page, context } = await createHarnessPage(browser, harness);
  let active = 0, peak = 0, calls = 0;
  try {
    await page.route('**/api/media/*/orientation', async route => {
      active++; peak = Math.max(peak, active); calls++;
      await new Promise(resolve => setTimeout(resolve, 80));
      const mediaId = route.request().url().split('/').at(-2)!;
      active--;
      await route.fulfill({ json: { ok: true, mediaId, orientation: resolved(mediaId === 'media_one' ? 90 : 270) } });
    });
    await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { value: false, configurable: true }));
    await mountQueue(page, ['data:image/png;base64,offline1', 'data:image/png;base64,offline2']);
    expect(calls).toBe(0);
    await page.evaluate(() => { const w = window as any; Object.defineProperty(navigator, 'onLine', { value: true, configurable: true }); window.dispatchEvent(new Event('online')); w.orientationState = structuredClone(w.orientationState); w.orientationState.wrong[0].images = ['/api/media/media_one', '/api/media/media_two']; w.orientationState.wrong[0].image = '/api/media/media_one'; w.renderQueue(); });
    await page.waitForFunction(() => (window as any).orientationState.wrong[0].imageOrientations[1]?.rotation === 270);
    expect(await page.evaluate(() => (window as any).orientationState.wrong[0].imageOrientations.map((r: any) => r.rotation))).toEqual([90, 270]);
    expect(calls).toBe(2); expect(peak).toBe(1);
  } finally { await context.close(); }
}, 15000);

it('queues old offline details durably and retries unresolved results only on request', async () => {
  const { page, context } = await createHarnessPage(browser, harness); let calls = 0;
  try {
    await page.route('**/api/media/*/orientation', route => { calls++; return route.fulfill({ json: { ok: true, mediaId: 'media_old', orientation: calls === 1 ? { status: 'unresolved', rotation: 0, version: 1 } : resolved(180) } }); });
    await mountQueue(page, ['data:image/png;base64,offline'], false);
    await page.evaluate(() => (window as any).orientationAPI.requestWrongImageOrientations('w'));
    await page.waitForFunction(() => (window as any).orientationState.wrong[0].imageOrientations?.[0] === null);
    await page.evaluate(() => { const w = window as any; w.orientationState = structuredClone(w.orientationState); w.orientationState.wrong[0].images = ['/api/media/media_old']; w.renderQueue(); });
    await page.waitForFunction(() => (window as any).orientationState.wrong[0].imageOrientations[0]?.status === 'unresolved');
    await page.evaluate(() => (window as any).renderQueue());
    expect(calls).toBe(1);
    await page.evaluate(() => (window as any).orientationAPI.requestWrongImageOrientations('w', true));
    await page.waitForFunction(() => (window as any).orientationState.wrong[0].imageOrientations[0]?.rotation === 180);
    expect(calls).toBe(2);
  } finally { await context.close(); }
}, 15000);

it('drops an in-flight result after an account switch', async () => {
  const { page, context } = await createHarnessPage(browser, harness); let release: any;
  try {
    await page.route('**/api/media/*/orientation', route => new Promise<void>(resolve => { release = async () => { await route.fulfill({ json: { ok: true, mediaId: 'media_one', orientation: resolved(90) } }); resolve(); }; }));
    await mountQueue(page, ['/api/media/media_one']);
    await page.waitForFunction(() => (window as any).orientationAPI.orientationActivity?.index === 0);
    await page.evaluate(() => { const w = window as any; w.epoch++; w.owner = 'b'; w.controllers.forEach((c: AbortController) => c.abort()); w.orientationState = structuredClone(w.BLANK_STATE); w.renderQueue(); });
    await release();
    await page.waitForFunction(() => !(window as any).orientationAPI.orientationActivity);
    expect(await page.evaluate(() => (window as any).commits)).toEqual([]);
  } finally { await context.close(); }
}, 15000);

it('rejects mismatched media responses and supports failed-request retry', async () => {
  const { page, context } = await createHarnessPage(browser, harness); let calls = 0;
  try {
    await page.route('**/api/media/*/orientation', route => { calls++; return route.fulfill({ json: { ok: true, mediaId: calls === 1 ? 'media_wrong' : 'media_one', orientation: resolved(270) } }); });
    await mountQueue(page, ['/api/media/media_one']);
    await page.waitForFunction(() => !!(window as any).orientationAPI.orientationErrors['w:0']);
    expect(await page.evaluate(() => (window as any).orientationState.wrong[0].imageOrientations)).toEqual([null]);
    await page.evaluate(() => (window as any).orientationAPI.requestWrongImageOrientations('w', true));
    await page.waitForFunction(() => (window as any).orientationState.wrong[0].imageOrientations[0]?.rotation === 270);
    expect(calls).toBe(2);
  } finally { await context.close(); }
}, 15000);

it('discards recognition for a removed image even when the record ID remains the same', async () => {
  const { page, context } = await createHarnessPage(browser, harness); let release: any;
  try {
    await page.route('**/api/media/*/orientation', route => new Promise<void>(resolve => { release = async () => { await route.fulfill({ json: { ok: true, mediaId: 'media_one', orientation: resolved(90) } }); resolve(); }; }));
    await mountQueue(page, ['/api/media/media_one']);
    await page.waitForFunction(() => (window as any).orientationAPI.orientationActivity?.index === 0);
    await page.evaluate(() => { const w = window as any; w.orientationState = structuredClone(w.orientationState); w.orientationState.wrong[0].images = ['data:image/png;base64,replaced']; w.orientationState.wrong[0].image = 'data:image/png;base64,replaced'; w.orientationState.wrong[0].note = 'new note'; w.renderQueue(); });
    await release();
    await page.waitForFunction(() => !(window as any).orientationAPI.orientationActivity);
    expect(await page.evaluate(() => (window as any).commits)).toEqual([]);
    expect(await page.evaluate(() => (window as any).orientationState.wrong[0].imageOrientations)).toEqual([null]);
    expect(await page.evaluate(() => (window as any).orientationState.wrong[0].note)).toBe('new note');
  } finally { await context.close(); }
}, 15000);

it('discards a stale failure after the image at the same index has changed', async () => {
  const { page, context } = await createHarnessPage(browser, harness); let release: any;
  try {
    await page.route('**/api/media/*/orientation', route => new Promise<void>(resolve => { release = async () => { await route.fulfill({ status: 503, json: { ok: false } }); resolve(); }; }));
    await mountQueue(page, ['/api/media/media_old']);
    await page.waitForFunction(() => (window as any).orientationAPI.orientationActivity?.index === 0);
    await page.evaluate(() => { const w = window as any; w.orientationState = structuredClone(w.orientationState); w.orientationState.wrong[0].images = ['data:image/png;base64,replaced']; w.orientationState.wrong[0].image = 'data:image/png;base64,replaced'; w.renderQueue(); });
    await page.waitForFunction(() => (window as any).renderedOrientationState.wrong[0].images[0] === 'data:image/png;base64,replaced');
    await release();
    await page.waitForFunction(() => !(window as any).orientationAPI.orientationActivity);
    expect(await page.evaluate(() => (window as any).orientationAPI.orientationErrors)).toEqual({});
    expect(await page.evaluate(() => (window as any).commits)).toEqual([]);
  } finally { await context.close(); }
}, 15000);

it('hides an existing error after image replacement and retries only the current image', async () => {
  const { page, context } = await createHarnessPage(browser, harness); const requested: string[] = []; let release: any;
  try {
    await page.route('**/api/media/*/orientation', route => {
      const mediaId = route.request().url().split('/').at(-2)!;
      requested.push(mediaId);
      if (mediaId === 'media_old') return route.fulfill({ status: 503, json: { ok: false } });
      if (requested.length === 2) return new Promise<void>(resolve => { release = async () => { await route.fulfill({ status: 503, json: { ok: false } }); resolve(); }; });
      return route.fulfill({ json: { ok: true, mediaId, orientation: resolved(180) } });
    });
    await mountQueue(page, ['/api/media/media_old']);
    await page.waitForFunction(() => !!(window as any).orientationAPI.orientationErrors['w:0']);
    await page.evaluate(() => { const w = window as any; w.orientationState = structuredClone(w.orientationState); w.orientationState.wrong[0].images = ['data:image/png;base64,replaced']; w.orientationState.wrong[0].image = 'data:image/png;base64,replaced'; w.renderQueue(); });
    await page.waitForFunction(() => (window as any).renderedOrientationState.wrong[0].images[0] === 'data:image/png;base64,replaced');
    expect(await page.evaluate(() => (window as any).orientationAPI.orientationErrors)).toEqual({});
    await page.evaluate(() => { const w = window as any; w.orientationState = structuredClone(w.orientationState); w.orientationState.wrong[0].images = ['/api/media/media_new']; w.orientationState.wrong[0].image = '/api/media/media_new'; w.renderQueue(); });
    await page.waitForFunction(() => (window as any).orientationAPI.orientationActivity?.index === 0);
    expect(await page.evaluate(() => (window as any).orientationAPI.orientationErrors)).toEqual({});
    await release();
    await page.waitForFunction(() => !!(window as any).orientationAPI.orientationErrors['w:0'] && !(window as any).orientationAPI.orientationActivity);
    await page.evaluate(() => (window as any).orientationAPI.requestWrongImageOrientations('w', true));
    await page.waitForFunction(() => (window as any).orientationState.wrong[0].imageOrientations[0]?.rotation === 180);
    expect(requested).toEqual(['media_old', 'media_new', 'media_new']);
    expect(await page.evaluate(() => (window as any).orientationAPI.orientationErrors)).toEqual({});
  } finally { await context.close(); }
}, 15000);

it('swaps the image coordinate system for quarter turns while keeping zoom on the outer element', async () => {
  const { page, context } = await createHarnessPage(browser, harness);
  try {
    await page.evaluate(() => { const w = window as any, canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 40; w.imageSource = canvas.toDataURL(); w.imageRoot = w.createRoot(document.getElementById('root')); w.imageRoot.render(w.React.createElement(w.OrientedImage, { src: w.imageSource, alt: 'rotated', rotation: 90, style: { transform: 'scale(2)' } })); });
    const image = page.getByRole('img', { name: 'rotated' });
    await page.waitForFunction(() => document.querySelector('svg')?.getAttribute('viewBox') === '0 0 40 80');
    expect(await image.getAttribute('style')).toContain('scale(2)');
    expect(await image.locator('image').getAttribute('transform')).toBe('translate(40 0) rotate(90)');
  } finally { await context.close(); }
});
