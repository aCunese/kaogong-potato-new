import { afterAll, beforeAll, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium, type Browser, type Locator, type Page } from 'playwright';
import { buildBrowserHarness, createHarnessPage } from '../scripts/lib/boundary-checks';

let browser: Browser, harness: string, css: string;
beforeAll(async () => {
  const result = spawnSync('node', ['node_modules/tailwindcss/lib/cli.js', '-i', 'src/index.css', '--minify'], { encoding: 'utf8' });
  expect(result.status).toBe(0);
  css = result.stdout;
  harness = await buildBrowserHarness();
  browser = await chromium.launch({ headless: true });
  mkdirSync('output/wrong-history', { recursive: true });
});
afterAll(async () => { await browser?.close(); });

async function mount(page: Page, scene: 'detail' | 'cards' | 'analysis' | 'import' = 'analysis', dayCount = 9) {
  await page.addStyleTag({ content: css });
  await page.evaluate(({ scene, dayCount }) => {
    const w = window as any;
    const state = structuredClone(w.BLANK_STATE);
    state.books = [{ id: 'b', name: '数量练习', subject: '数量关系', total: 100, done: 0, errors: 0, minutes: 0, pages: 1 }];
    state.courses = [{ id: 'c', name: '数量网课', subject: '数量关系', totalLessons: 30, completedLessons: 9, minutes: 180, url: '' }];
    const canvas = document.createElement('canvas');
    canvas.width = 400; canvas.height = 600;
    const drawing = canvas.getContext('2d')!;
    drawing.fillStyle = '#F4F3EB'; drawing.fillRect(0, 0, 400, 600);
    drawing.fillStyle = '#343C2F'; drawing.font = '22px sans-serif';
    drawing.fillText('Wrong question sample', 32, 60);
    drawing.fillText('12 x 8 = ?', 32, 120);
    const image = canvas.toDataURL();
    state.wrong = [{ id: 'w', bookId: 'b', subject: '数量关系', date: '2026-11-04', createdAt: 1793782800000, note: '原笔记', image, images: [image, image], imageOrientations: [null, null] }];
    state.records = [];
    for (let index = 0; index < dayCount; index++) {
      const date = new Date(Date.UTC(2026, 10, 4 - index)).toISOString().slice(0, 10);
      state.records.push(
        { id: `b-${index}`, date, type: 'book', sourceId: 'b', subject: '数量关系', questions: 10, errors: 2, minutes: 20 },
        { id: `c-${index}`, date, type: 'course', sourceId: 'c', subject: '数量关系', questions: 0, errors: 0, minutes: 40, lessons: 2 },
      );
    }
    if (dayCount) state.records.push({ id: 'b-extra', date: '2026-11-04', type: 'book', sourceId: 'b', subject: '数量关系', questions: 5, errors: 1, minutes: 10 });
    w.mut.writePersistedWrongSubject('数量关系');
    w.mutationCalls = [];
    w.fixture = {
      state, activeDate: '2026-11-04', currentUser: { id: 'history-test' },
      registerUpdateBlocker: () => () => {},
      updateWrongRecord: async (id: string, updates: any) => {
        w.mutationCalls.push(structuredClone(updates));
        if (w.failMutation) return { ok: false, code: 'STORAGE_WRITE_FAILED', message: '保存暂未完成' };
        const draft = structuredClone(w.fixture.state);
        const result = w.mut.applyUpdateWrongRecord(draft, id, updates);
        if ('error' in result) return { ok: false, ...result.error };
        w.fixture.state = draft;
        w.renderFixture();
        return { ok: true, value: result.value };
      },
      addWrongRecords: async (target: string, note: string, images: string[], date?: string) => {
        const draft = structuredClone(w.fixture.state);
        const result = w.mut.applyAddWrongRecords(draft, target, date || w.fixture.activeDate, note, images);
        if ('error' in result) return { ok: false, ...result.error };
        w.fixture.state = draft;
        w.renderFixture();
        return { ok: true, value: result.value };
      },
    };
    w.importTarget = scene === 'import' ? { subject: '数量关系', lockSubject: true } : undefined;
    w.importOpen = scene === 'import';
    w.detailOpen = scene === 'detail';
    w.root = w.createRoot(document.getElementById('root'));
    const toast = (message: string) => { w.lastToast = message; };
    w.renderFixture = () => w.root.render(w.React.createElement(w.AppContext.Provider, { value: { ...w.fixture } },
      w.React.createElement(w.React.Fragment, null,
        scene === 'analysis' ? w.React.createElement(w.AnalysisView, { onOpenMonthPicker: () => {}, onOpenLegendDetail: () => {} }) : null,
        scene === 'cards' ? w.React.createElement(w.WrongView, {
          onOpenImportModal: (subject?: string, lockSubject = false) => {
            w.importTarget = subject ? { subject, lockSubject } : undefined;
            w.importOpen = true; w.renderFixture();
          },
          onOpenDetailModal: () => { w.detailOpen = true; w.renderFixture(); },
          onOpenDeleteConfirm: () => {}, onToast: toast,
        }) : null,
        w.React.createElement(w.WrongDetailModal, { record: w.fixture.state.wrong[0], isOpen: w.detailOpen, onClose: () => { w.detailOpen = false; w.renderFixture(); }, onToast: toast }),
        w.React.createElement(w.PhotoImportModal, { isOpen: w.importOpen, initialTarget: w.importTarget, onClose: () => { w.importOpen = false; w.renderFixture(); }, onToast: toast }),
      ),
    ));
    w.renderFixture();
  }, { scene, dayCount });
}

async function swipe(list: Locator, dx: number, dy = 0) {
  await list.dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: 220, clientY: 200 }] });
  await list.dispatchEvent('touchmove', { touches: [{ identifier: 1, clientX: 220 + dx, clientY: 200 + dy }] });
  await list.dispatchEvent('touchend', { touches: [], changedTouches: [{ identifier: 1, clientX: 220 + dx, clientY: 200 + dy }] });
}

it('edits only the note while preserving category and book ownership, including failed saves and cancellation', async () => {
  const { page, context } = await createHarnessPage(browser, harness);
  page.setDefaultTimeout(2000);
  try {
    await mount(page, 'detail');
    const before = await page.evaluate(() => (window as any).fixture.state.wrong[0]);
    const detail = page.getByRole('dialog', { name: '错题复盘大图详情', exact: true });
    await detail.getByRole('button', { name: '编辑', exact: true }).click();
    expect(await detail.getByText('转移到分类', { exact: true }).count()).toBe(0);
    await detail.getByRole('textbox').fill('新笔记');
    await page.evaluate(() => { (window as any).failMutation = true; });
    await detail.getByRole('button', { name: '保存修改', exact: true }).click();
    await detail.getByRole('alert').waitFor();
    expect(await detail.getByRole('textbox').inputValue()).toBe('新笔记');
    await page.evaluate(() => { (window as any).failMutation = false; });
    await detail.getByRole('button', { name: '保存修改', exact: true }).click();
    await detail.getByRole('button', { name: '编辑', exact: true }).waitFor();
    expect(await page.evaluate(() => (window as any).mutationCalls)).toEqual([{ note: '新笔记' }, { note: '新笔记' }]);
    expect(await page.evaluate(() => (window as any).fixture.state.wrong[0])).toEqual({ ...before, note: '新笔记' });
    await detail.getByRole('button', { name: '编辑', exact: true }).click();
    await detail.getByRole('textbox').fill('取消的内容');
    await detail.getByRole('button', { name: '取消', exact: true }).click();
    await detail.getByRole('button', { name: '编辑', exact: true }).click();
    expect(await detail.getByRole('textbox').inputValue()).toBe('新笔记');
  } finally { await context.close(); }
}, 12000);

it('transfers from detail and card actions without editing notes and closes only the top dialog on back', async () => {
  const { page, context } = await createHarnessPage(browser, harness);
  page.setDefaultTimeout(2000);
  try {
    await mount(page, 'cards');
    const before = await page.evaluate(() => (window as any).fixture.state.wrong[0]);
    await page.getByRole('button', { name: '查看错题大图', exact: true }).first().click();
    const detail = page.getByRole('dialog', { name: '错题复盘大图详情', exact: true });
    await detail.getByRole('button', { name: '转移', exact: true }).click();
    const move = page.getByRole('dialog', { name: '转移错题分类', exact: true });
    await move.waitFor();
    expect(await move.getByRole('textbox').count()).toBe(0);
    await page.evaluate(() => (window as any).closeTopModal());
    await move.waitFor({ state: 'hidden' });
    expect(await detail.isVisible()).toBe(true);
    await detail.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await page.getByRole('button', { name: '转移错题分类', exact: true }).first().click();
    await move.getByRole('button', { name: '申论', exact: true }).click();
    await page.evaluate(() => { (window as any).failMutation = true; });
    await move.getByRole('button', { name: '确认转移', exact: true }).click();
    await move.getByRole('alert').waitFor();
    expect(await move.getByRole('button', { name: '申论', exact: true }).getAttribute('aria-pressed')).toBe('true');
    await page.evaluate(() => { (window as any).failMutation = false; });
    await move.getByRole('button', { name: '确认转移', exact: true }).click();
    await move.waitFor({ state: 'hidden' });
    expect(await page.evaluate(() => (window as any).mutationCalls)).toEqual([{ subject: '申论' }, { subject: '申论' }]);
    expect(await page.evaluate(() => (window as any).fixture.state.wrong[0])).toEqual({ ...before, subject: '申论', bookId: '申论' });
    expect(await page.getByRole('button', { name: '查看错题大图', exact: true }).count()).toBe(0);
    expect(await page.getByText('已定位：', { exact: false }).textContent()).toContain('数量关系');
  } finally { await context.close(); }
}, 12000);

it('locks both category upload entries, archives into that category, and keeps general upload selectable', async () => {
  const { page, context } = await createHarnessPage(browser, harness);
  page.setDefaultTimeout(2000);
  try {
    await mount(page, 'cards');
    await page.getByRole('button', { name: '添加照片', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: '添加【数量关系】错题照片', exact: true });
    await dialog.waitFor();
    expect(await dialog.getByRole('group', { name: '错题所属分类', exact: true }).count()).toBe(0);
    await dialog.getByRole('button', { name: '加入示例错题', exact: true }).click();
    await dialog.getByRole('button', { name: /保存并归档到/ }).click();
    await dialog.waitFor({ state: 'hidden' });
    expect(await page.evaluate(() => (window as any).fixture.state.wrong[0].subject)).toBe('数量关系');
    await page.getByRole('button', { name: '筛选错题分类', exact: true }).click();
    await page.getByRole('option', { name: /申论/ }).click();
    await page.getByRole('button', { name: /快速添加【申论】/ }).click();
    dialog = page.getByRole('dialog', { name: '添加【申论】错题照片', exact: true });
    await dialog.waitFor();
    expect(await dialog.getByRole('group', { name: '错题所属分类', exact: true }).count()).toBe(0);
    await dialog.getByRole('button', { name: '加入示例错题', exact: true }).click();
    await dialog.getByRole('button', { name: /保存并归档到/ }).click();
    await dialog.waitFor({ state: 'hidden' });
    expect(await page.evaluate(() => (window as any).fixture.state.wrong[0].subject)).toBe('申论');
    await page.getByRole('button', { name: '从相册上传错题', exact: true }).click();
    const general = page.getByRole('dialog', { name: '从相册上传错题照片', exact: true });
    await general.waitFor();
    await general.getByRole('button', { name: '资料分析', exact: true }).click();
    expect(await general.getByRole('button', { name: /保存并归档到/ }).textContent()).toContain('资料分析');
  } finally { await context.close(); }
}, 12000);

for (const category of ['book', 'course'] as const) {
  const title = category === 'book' ? '每日刷题记录' : '每日听课记录';
  it(`${category} previews three dates and pages all history with gestures, range resets and refreshed totals`, async () => {
    const { page, context } = await createHarnessPage(browser, harness);
    page.setDefaultTimeout(2000);
    try {
      await mount(page);
      if (category === 'book') await page.getByRole('button', { name: '题本学习', exact: true }).click();
      const card = page.getByRole('region', { name: title, exact: true });
      await card.waitFor();
      expect(await card.textContent()).toContain('2026-11-04');
      expect(await card.textContent()).not.toContain('2026-11-01');
      if (category === 'book') {
        expect(await card.getByTestId('practice-2026-11-04-b').count()).toBe(0);
        await card.getByRole('button', { name: /2026-11-04/ }).click();
        expect(await card.getByTestId('practice-2026-11-04-b').getByTestId('questions').textContent()).toBe('15');
        expect(await card.getByTestId('practice-2026-11-04-b').getByTestId('correct').textContent()).toBe('12');
        await card.getByRole('button', { name: /2026-11-03/ }).click();
        expect(await card.getByTestId('practice-2026-11-04-b').count()).toBe(0);
      } else {
        expect(await card.textContent()).toContain('40 分钟');
        expect(await card.textContent()).toContain('2 节');
      }
      await card.getByRole('button', { name: /查看全部/ }).click();
      const history = page.getByRole('dialog', { name: `${title}历史`, exact: true });
      const list = history.getByRole('region', { name: '历史日期列表', exact: true });
      await history.waitFor();
      expect(await list.textContent()).toContain('2026-10-31');
      expect(await list.textContent()).not.toContain('2026-10-30');
      expect(await history.getByRole('button', { name: '上一页', exact: true }).isDisabled()).toBe(true);
      await swipe(list, -100);
      await history.getByText('第 2/2 页', { exact: true }).waitFor();
      expect(await list.textContent()).toContain('2026-10-30');
      expect(await list.textContent()).not.toContain('2026-11-04');
      expect(await history.getByRole('button', { name: '下一页', exact: true }).isDisabled()).toBe(true);
      await swipe(list, -100);
      expect(await history.getByText('第 2/2 页', { exact: true }).count()).toBe(1);
      await swipe(list, 20, 120);
      expect(await history.getByText('第 2/2 页', { exact: true }).count()).toBe(1);
      await swipe(list, 100);
      await history.getByText('第 1/2 页', { exact: true }).waitFor();
      await history.getByRole('button', { name: '下一页', exact: true }).click();
      await history.getByRole('button', { name: '关闭弹窗', exact: true }).click();
      await card.getByRole('button', { name: /查看全部/ }).click();
      await history.getByText('第 1/2 页', { exact: true }).waitFor();
      await history.getByRole('button', { name: '下一页', exact: true }).click();
      await page.evaluate(() => {
        const w = window as any, draft = structuredClone(w.fixture.state);
        draft.records.push({ id: 'new-day', date: '2026-10-01', type: 'book', sourceId: 'b', subject: '数量关系', questions: 3, errors: 1, minutes: 5 });
        w.fixture.state = draft; w.renderFixture();
      });
      await page.getByRole('button', { name: '全部记录', exact: true }).evaluate((element: HTMLButtonElement) => element.click());
      await history.getByText('第 1/2 页', { exact: true }).waitFor();
      await history.getByRole('button', { name: '下一页', exact: true }).click();
      await page.evaluate(category => {
        const w = window as any, draft = structuredClone(w.fixture.state);
        draft.records.push({ id: 'latest', date: '2026-11-05', type: category, sourceId: category === 'book' ? 'b' : 'c', subject: '数量关系', questions: category === 'book' ? 7 : 0, errors: 1, minutes: 12, lessons: 1 });
        w.fixture.activeDate = '2026-11-05'; w.fixture.state = draft; w.renderFixture();
      }, category);
      await history.getByText(category === 'book' ? '第 1/3 页' : '第 1/2 页', { exact: true }).waitFor();
      expect(await list.textContent()).toContain('2026-11-05');
    } finally { await context.close(); }
  }, 18000);
}

it('handles zero, one, three, four, five and six recorded dates without blank pages', async () => {
  for (const count of [0, 1, 3, 4, 5, 6]) {
    const { page, context } = await createHarnessPage(browser, harness);
    page.setDefaultTimeout(2000);
    try {
      await mount(page, 'analysis', count);
      for (const category of ['网课学习', '题本学习']) {
        await page.getByRole('button', { name: category, exact: true }).click();
        const card = page.getByRole('region', { name: category === '网课学习' ? '每日听课记录' : '每日刷题记录', exact: true });
        await card.waitFor();
        expect(await card.getByRole('button', { name: /查看全部/ }).count()).toBe(count > 3 ? 1 : 0);
        if (count > 3) {
          await card.getByRole('button', { name: /查看全部/ }).click();
          const history = page.getByRole('dialog');
          expect(await history.getByRole('button', { name: '下一页', exact: true }).isDisabled()).toBe(count <= 5);
          if (count === 6) {
            await history.getByRole('button', { name: '下一页', exact: true }).click();
            expect(await history.getByRole('region', { name: '历史日期列表' }).textContent()).toContain('2026-10-30');
          }
          await history.getByRole('button', { name: '关闭弹窗', exact: true }).click();
        }
      }
    } finally { await context.close(); }
  }
}, 20000);

it('keeps previews, history navigation and separate wrong actions usable at mobile widths', async () => {
  for (const width of [360, 393, 412]) {
    const { page, context } = await createHarnessPage(browser, harness);
    page.setDefaultTimeout(2000);
    try {
      await page.setViewportSize({ width, height: 800 });
      await mount(page);
      for (const category of ['网课学习', '题本学习']) {
        await page.getByRole('button', { name: category, exact: true }).click();
        const card = page.getByRole('region', { name: category === '网课学习' ? '每日听课记录' : '每日刷题记录', exact: true });
        expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        const previewBox = await card.boundingBox();
        expect(previewBox!.height).toBeLessThan(300);
        await card.screenshot({ path: `output/wrong-history/${category === '网课学习' ? 'course' : 'book'}-preview-${width}.png` });
        await card.getByRole('button', { name: /查看全部/ }).click();
        const history = page.getByRole('dialog');
        expect(await history.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        const nextBox = await history.getByRole('button', { name: '下一页', exact: true }).boundingBox();
        expect(nextBox!.y + nextBox!.height).toBeLessThanOrEqual(800);
        await history.screenshot({ path: `output/wrong-history/${category === '网课学习' ? 'course' : 'book'}-${width}.png` });
        const list = history.getByRole('region', { name: '历史日期列表', exact: true });
        const bounds = (await list.boundingBox())!;
        const session = await context.newCDPSession(page);
        const startX = bounds.x + bounds.width * 0.8, y = bounds.y + 22;
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y }] });
        for (const fraction of [0.6, 0.4, 0.2]) {
          await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: bounds.x + bounds.width * fraction, y }] });
        }
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await history.getByText('第 2/2 页', { exact: true }).waitFor();
        await session.detach();
        await page.evaluate(() => (window as any).closeTopModal());
      }
      await page.evaluate(() => (window as any).root.unmount());
      await mount(page, 'cards');
      await page.getByRole('button', { name: '查看错题大图', exact: true }).first().click();
      const detail = page.getByRole('dialog', { name: '错题复盘大图详情', exact: true });
      await detail.getByRole('button', { name: '编辑', exact: true }).click();
      expect(await detail.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await detail.getByRole('button', { name: '保存修改', exact: true }).scrollIntoViewIfNeeded();
      await detail.screenshot({ path: `output/wrong-history/edit-${width}.png` });
      await detail.getByRole('button', { name: '取消', exact: true }).click();
      await detail.getByRole('button', { name: '转移', exact: true }).click();
      const move = page.getByRole('dialog', { name: '转移错题分类', exact: true });
      expect(await move.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await move.screenshot({ path: `output/wrong-history/move-${width}.png` });
      await page.evaluate(() => (window as any).closeTopModal());
      await page.evaluate(() => (window as any).closeTopModal());
      await page.getByRole('button', { name: /快速添加【数量关系】/ }).click();
      const upload = page.getByRole('dialog', { name: '添加【数量关系】错题照片', exact: true });
      expect(await upload.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await upload.screenshot({ path: `output/wrong-history/upload-${width}.png` });
    } finally { await context.close(); }
  }
}, 20000);
