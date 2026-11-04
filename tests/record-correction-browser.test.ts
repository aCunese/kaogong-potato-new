import { afterAll, beforeAll, expect, it } from 'bun:test';
import { chromium, type Browser, type Page } from 'playwright';
import { buildBrowserHarness, createHarnessPage } from '../scripts/lib/boundary-checks';

let browser: Browser;
let harness: string;
beforeAll(async () => { harness = await buildBrowserHarness(); browser = await chromium.launch({ headless: true }); });
afterAll(async () => { await browser?.close(); });

async function mountOverlayFixture(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    localStorage.setItem('kaogong_potato_study_video_v1_done', '1');
    localStorage.setItem('kaogong_daily_countdown_shown_overlay', '2026-11-04');
    const state = structuredClone(w.BLANK_STATE);
    state.books = [{ id: 'b', name: 'Book', subject: '资料分析', total: 100, done: 0, errors: 0, minutes: 0, pages: 1 }];
    state.wrong = [{ id: 'w', bookId: '资料分析', subject: '资料分析', date: '2026-11-04', image: '', note: 'a'.repeat(201) }];
    state.countdowns = [{ id: 'cd', name: '目标', date: '2026-11-29' }];
    w.overlayValue = { state, activeDate: '2026-11-04', authPhase: 'authenticated', currentUser: { id: 'overlay', nickname: 'Tester' }, registerUpdateBlocker: () => () => {}, isAnyTimerRunning: () => false,
      updateWrongRecord: async (id: string, updates: any) => {
        const result = w.mut.applyUpdateWrongRecord(state, id, updates); w.renderOverlayFixture();
        return 'error' in result ? { ok: false, message: result.error.message } : { ok: true };
      } };
    w.testRoot = w.createRoot(document.getElementById('root'));
    w.renderOverlayFixture = (patch: any = {}) => {
      Object.assign(w.overlayValue, patch);
      w.testRoot.render(w.React.createElement(w.AppContext.Provider, { value: { ...w.overlayValue } }, w.React.createElement('div', { 'data-fixture-day': w.overlayValue.activeDate }, w.React.createElement(w.App))));
    };
    w.renderOverlayFixture();
  });
  await page.locator('[data-fixture-day="2026-11-04"]').waitFor();
}

for (const kind of ['category rename', 'book transfer', 'wrong record edit', 'wrong category rename', 'standalone timer']) {
  it(`defers next-day countdown until the child overlay closes: ${kind}`, async () => {
    const { page, context } = await createHarnessPage(browser, harness);
    page.setDefaultTimeout(2000);
    try {
      await mountOverlayFixture(page);
      let dialogName: string;
      if (kind === 'category rename' || kind === 'book transfer') {
        await page.getByRole('button', { name: '学习', exact: true }).click();
        if (kind === 'category rename') {
          await page.getByRole('button', { name: '编辑分类名称：资料分析', exact: true }).click();
          dialogName = '编辑分类名称';
        } else {
          await page.getByRole('button', { name: '资料分析 · 1本题本', exact: true }).click();
          await page.getByRole('button', { name: '转移题本分类：Book', exact: true }).click();
          dialogName = '转移所属分类';
        }
      } else if (kind === 'wrong record edit' || kind === 'wrong category rename') {
        await page.getByRole('button', { name: '错题', exact: true }).click();
        if (kind === 'wrong record edit') {
          await page.getByRole('button', { name: /^资料分析\s*1道/ }).click();
          await page.getByRole('button', { name: '转移错题分类或编辑笔记', exact: true }).click();
          dialogName = '转移错题分类 / 编辑笔记';
        } else {
          await page.getByRole('button', { name: '编辑分类名称：资料分析', exact: true }).click();
          dialogName = '编辑分类名称';
        }
      } else {
        await page.getByRole('button', { name: '番茄钟', exact: true }).click();
        dialogName = '番茄钟';
      }
      const child = page.getByRole('dialog', { name: dialogName, exact: true });
      await child.waitFor();
      await page.evaluate(() => (window as any).renderOverlayFixture({ activeDate: '2026-11-05' }));
      await page.locator('[data-fixture-day="2026-11-05"]').waitFor();
      const reminder = page.getByRole('dialog', { name: '今日备考倒数日提醒', exact: true });
      expect(await reminder.count()).toBe(0);
      expect(await page.evaluate(() => localStorage.getItem('kaogong_daily_countdown_shown_overlay'))).toBe('2026-11-04');
      await child.getByRole('button', { name: '关闭弹窗', exact: true }).click();
      await reminder.waitFor();
      expect(await page.evaluate(() => localStorage.getItem('kaogong_daily_countdown_shown_overlay'))).toBe('2026-11-05');
      // The reminder must not count itself as a blocker and vanish after its own registration.
      await page.evaluate(() => (window as any).renderOverlayFixture());
      await reminder.waitFor();
      await reminder.getByRole('button', { name: '知道了，开启今日备考！', exact: true }).click();
      await page.evaluate(() => (window as any).renderOverlayFixture());
      await reminder.waitFor({ state: 'hidden' });
    } finally { await context.close(); }
  }, 10000);
}

it('continues editing a valid existing wrong-detail note longer than 200 characters', async () => {
  const { page, context } = await createHarnessPage(browser, harness);
  page.setDefaultTimeout(2000);
  try {
    await mountOverlayFixture(page);
    await page.getByRole('button', { name: '错题', exact: true }).click();
    await page.getByRole('button', { name: /^资料分析\s*1道/ }).click();
    await page.getByRole('button', { name: '查看错题大图', exact: true }).click();
    const detail = page.getByRole('dialog', { name: '错题复盘大图详情', exact: true });
    await detail.getByRole('button', { name: '编辑', exact: true }).click();
    const note = detail.getByRole('textbox');
    expect(await note.getAttribute('maxlength')).toBe('2000');
    await note.evaluate((element: HTMLTextAreaElement) => { element.focus(); element.setSelectionRange(element.value.length, element.value.length); });
    await note.pressSequentially('more');
    expect(await note.inputValue()).toBe(`${'a'.repeat(201)}more`);
    await detail.getByRole('button', { name: '保存修改', exact: true }).click();
    await page.waitForFunction(() => (window as any).overlayValue.state.wrong[0].note.length === 205);
  } finally { await context.close(); }
}, 10000);

it('shows countdown once per user/day, waits for overlays, and hides it across auth/account changes', async () => {
  const { page, context } = await createHarnessPage(browser, harness);
  page.setDefaultTimeout(2000);
  try {
    await page.evaluate(() => {
      const w = window as any;
      localStorage.setItem('kaogong_potato_study_video_v1_done', '1');
      const state = structuredClone(w.BLANK_STATE);
      state.countdowns = [{ id: 'cd', name: '目标', date: '2026-11-29' }];
      w.countdownContext = { state, activeDate: '2026-11-04', authPhase: 'authenticated', currentUser: { id: 'a', nickname: 'Tester' }, registerUpdateBlocker: () => () => {}, isAnyTimerRunning: () => false };
      w.testRoot = w.createRoot(document.getElementById('root'));
      w.renderCountdownApp = (patch: any = {}) => {
        Object.assign(w.countdownContext, patch);
        w.testRoot.render(w.React.createElement(w.AppContext.Provider, { value: { ...w.countdownContext } }, w.React.createElement(w.App)));
      };
      w.renderCountdownApp();
    });
    const reminder = page.getByRole('dialog', { name: '今日备考倒数日提醒', exact: true });
    await reminder.waitFor({ timeout: 1500 });
    expect(await page.evaluate(() => localStorage.getItem('kaogong_daily_countdown_shown_a'))).toBe('2026-11-04');
    // A previously seen account must not inherit the open state of another account.
    await page.evaluate(() => { localStorage.setItem('kaogong_daily_countdown_shown_b', '2026-11-04'); (window as any).renderCountdownApp({ currentUser: { id: 'b', nickname: 'B' } }); });
    await reminder.waitFor({ state: 'hidden' });
    await page.evaluate(() => (window as any).renderCountdownApp({ authPhase: 'unauthenticated', currentUser: null }));
    await reminder.waitFor({ state: 'hidden' });
    await page.evaluate(() => (window as any).renderCountdownApp({ authPhase: 'authenticated', currentUser: { id: 'c', nickname: 'C' }, needsInitChoice: true }));
    await page.getByRole('dialog', { name: '备考空间资料库初始化' }).waitFor({ timeout: 1500 });
    expect(await reminder.count()).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem('kaogong_daily_countdown_shown_c'))).toBeNull();
    await page.evaluate(() => (window as any).renderCountdownApp({ needsInitChoice: false }));
    await reminder.waitFor();
    await reminder.getByRole('button', { name: '知道了，开启今日备考！' }).click();
    await page.evaluate(() => (window as any).renderCountdownApp());
    await reminder.waitFor({ state: 'hidden' });
    await page.evaluate(() => (window as any).renderCountdownApp({ activeDate: '2026-11-05' }));
    await reminder.waitFor();
    expect(await page.evaluate(() => localStorage.getItem('kaogong_daily_countdown_shown_c'))).toBe('2026-11-05');
  } finally { await context.close(); }
}, 15000);

it('allows clearing a category name to reset it from learning and wrong-question editors', async () => {
  const { page, context } = await createHarnessPage(browser, harness);
  page.setDefaultTimeout(2000);
  try {
    await page.evaluate(() => {
      const w = window as any;
      localStorage.setItem('kaogong_potato_study_video_v1_done', '1');
      const state = structuredClone(w.BLANK_STATE);
      state.subjectLabels = { 资料分析: '自定义分类' };
      state.wrong = [{ id: 'wrong', bookId: '资料分析', subject: '资料分析', date: '2026-11-04', image: '', note: '' }];
      w.testRoot = w.createRoot(document.getElementById('root'));
      const value = { state, activeDate: '2026-11-04', authPhase: 'authenticated', currentUser: { id: 'a', nickname: 'Tester' }, registerUpdateBlocker: () => () => {}, isAnyTimerRunning: () => false,
        updateSubjectLabel: async (subject: any, label: string) => {
          const result = w.mut.applyUpdateSubjectLabel(state, subject, label); render();
          return 'error' in result ? { ok: false, message: result.error.message } : { ok: true };
        } };
      function render() { w.testRoot.render(w.React.createElement(w.AppContext.Provider, { value: { ...value } }, w.React.createElement(w.App))); }
      render();
    });
    for (const tab of ['学习', '错题']) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      await page.getByRole('button', { name: '编辑分类名称：自定义分类', exact: true }).click();
      const editor = page.getByRole('dialog', { name: '编辑分类名称', exact: true });
      await editor.getByLabel('自定义分类名称', { exact: true }).fill('');
      expect(await editor.getByRole('button', { name: '保存分类名称', exact: true }).isEnabled()).toBe(true);
      await editor.getByRole('button', { name: '保存分类名称', exact: true }).click();
      await page.getByRole('button', { name: '编辑分类名称：资料分析', exact: true }).waitFor();
      await page.getByRole('button', { name: '编辑分类名称：资料分析', exact: true }).click();
      await page.getByLabel('自定义分类名称', { exact: true }).fill('自定义分类');
      await page.getByRole('button', { name: '保存分类名称', exact: true }).click();
    }
  } finally { await context.close(); }
}, 15000);
