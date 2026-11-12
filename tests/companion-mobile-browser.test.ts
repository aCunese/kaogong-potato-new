import { afterAll, beforeAll, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { buildBrowserHarness, createHarnessPage } from '../scripts/lib/boundary-checks';

let browser: Browser;
let harness: string;
let css: string;

beforeAll(async () => {
  const builtCss = spawnSync('node', ['node_modules/tailwindcss/lib/cli.js', '-i', 'src/index.css', '--minify'], {
    encoding: 'utf8',
  });
  expect(builtCss.status).toBe(0);
  css = builtCss.stdout;
  harness = await buildBrowserHarness();
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
});

async function setupMobilePage(width: number, height = 812) {
  const { page, context } = await createHarnessPage(browser, harness);
  page.setDefaultTimeout(4000);
  await page.setViewportSize({ width, height });
  await page.addStyleTag({ content: css });
  await page.route('**/api/sharing/**', async route => {
    const url = route.request().url();
    if (url.includes('/api/sharing/settings')) {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ targetStudyTime: '14:00' }) });
    }
    if (url.includes('/api/sharing/notes')) {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ notes: [] }) });
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, owned: [], received: [], codes: [] }),
    });
  });
  return { page, context };
}

it('renders SharingModal detail card and list card without mobile truncation or overflow at 360px and 375px', async () => {
  const shotDir = process.env.COMPANION_SHOT_DIR;
  if (shotDir) fs.mkdirSync(shotDir, { recursive: true });

  for (const width of [360, 375]) {
    const { page, context } = await setupMobilePage(width);
    try {
      const longTitle = '超格600图推纠错与资料分析速算高阶专项训练';
      const longNick = '阿土同学（备考必胜长昵称）';

      // 1. Focusing partner detail view
      await page.evaluate(({ longTitle, longNick }) => {
        const w = window as any;
        const d = new Date();
        const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const state = structuredClone(w.BLANK_STATE);
        const ctxValue = {
          state,
          activeDate: todayStr,
          currentUser: { id: 'viewer-1', nickname: '我' },
          csrfToken: 'test-csrf',
        };
        const focusGrant = {
          id: 'g-focus',
          partnerId: 'owner-1',
          nickname: longNick,
          avatar: 'pose-1',
          createdAt: '',
          liveStatus: {
            state: 'focusing',
            focusTitle: longTitle,
            focusMinutes: 34,
            pendingMinutes: 119,
            otherPendingMinutes: 85,
            canPoke: false,
          },
        };
        const mockOverview = {
          ownerNickname: longNick,
          updatedAt: new Date().toISOString(),
          range: { from: todayStr, to: todayStr },
          selectedTotals: { minutes: 324, questions: 80, errors: 12, accuracy: 85, lessons: 1 },
          allTimeTotals: { minutes: 3620, questions: 2850, errors: 410, accuracy: 85.6, lessons: 48 },
          books: [],
          courses: [],
          records: {
            items: [
              { date: todayStr, type: 'book', subject: '判断推理', sourceName: longTitle, quantity: 80, minutes: 324, errors: 12 },
            ],
            page: 1,
            pageSize: 30,
            total: 1,
          },
          studyDates: [todayStr],
        };
        const rootEl = document.getElementById('root')!;
        w.__mobileRoot = w.createRoot(rootEl);
        w.__renderMobile = (el: any) => w.__mobileRoot.render(w.React.createElement(w.AppContext.Provider, { value: ctxValue }, el));
        w.__renderMobile(
          w.React.createElement(w.SharingModal, {
            isOpen: true,
            onClose: () => {},
            initialSelectedId: 'g-focus',
            initialOverview: mockOverview,
            initialGrants: { owned: [], received: [focusGrant], codes: [] },
          })
        );
      }, { longTitle, longNick });

      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      const focusBanner = dialog.getByTestId('partner-detail-focus-banner');
      await focusBanner.waitFor();

      const detailMetrics = await dialog.evaluate((el, longTitle) => {
        const docOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
        const dialogOverflow = el.scrollWidth > el.clientWidth + 1;
        const banner = el.querySelector('[data-testid="partner-detail-focus-banner"]') as HTMLElement;
        const bannerRect = banner.getBoundingClientRect();
        const titleEl = Array.from(banner.querySelectorAll('p')).find(p => p.textContent?.includes(longTitle)) as HTMLElement;
        const nickEl = Array.from(el.querySelectorAll('span')).find(s => s.textContent?.includes('阿土同学（备考必胜长昵称）')) as HTMLElement;
        const nickRect = nickEl.getBoundingClientRect();
        const noteBtn = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes('贴便签')) as HTMLElement;
        const focusBtn = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.trim() === '专注中') as HTMLElement;
        const allStatsBtn = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes('累计全部统计')) as HTMLElement;
        const allStatsOverflow = Array.from(allStatsBtn.querySelectorAll('span')).some(s => getComputedStyle(s).textOverflow === 'ellipsis' && s.scrollWidth > s.clientWidth + 1);
        return {
          docOverflow,
          dialogOverflow,
          bannerText: banner.textContent,
          bannerWidth: bannerRect.width,
          titleOverflow: titleEl.scrollWidth > titleEl.clientWidth + 1,
          titleText: titleEl.textContent,
          nickWidth: nickRect.width,
          nickOverflow: nickEl.scrollWidth > nickEl.clientWidth + 1,
          noteBtnTop: noteBtn.getBoundingClientRect().top,
          bannerBottom: bannerRect.bottom,
          noteBtnHeight: noteBtn.getBoundingClientRect().height,
          focusBtnHeight: focusBtn.getBoundingClientRect().height,
          allStatsOverflow,
          hasDoubleGreenDot: el.textContent?.includes('🟢'),
          hasDoubleLightning: el.textContent?.includes('⚡️'),
        };
      }, longTitle);

      expect(detailMetrics.docOverflow).toBe(false);
      expect(detailMetrics.dialogOverflow).toBe(false);
      expect(detailMetrics.nickWidth).toBeGreaterThanOrEqual(180);
      expect(detailMetrics.nickOverflow).toBe(false);
      expect(detailMetrics.bannerWidth).toBeGreaterThanOrEqual(width - 110);
      expect(detailMetrics.titleOverflow).toBe(false);
      expect(detailMetrics.titleText).toBe(`《${longTitle}》`);
      expect(detailMetrics.bannerText).toContain('正在专注');
      expect(detailMetrics.bannerText).toContain('34m');
      expect(detailMetrics.noteBtnTop).toBeGreaterThanOrEqual(detailMetrics.bannerBottom - 1);
      expect(detailMetrics.noteBtnHeight).toBeLessThanOrEqual(38);
      expect(detailMetrics.focusBtnHeight).toBeLessThanOrEqual(38);
      expect(detailMetrics.allStatsOverflow).toBe(false);
      expect(detailMetrics.hasDoubleGreenDot).toBe(false);
      expect(detailMetrics.hasDoubleLightning).toBe(false);
      if (shotDir) {
        await page.screenshot({ path: path.join(shotDir, `sharing-detail-focus-${width}.png`) });
        await dialog.locator('button', { hasText: '累计全部统计' }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(shotDir, `sharing-detail-focus-bottom-${width}.png`) });
      }

      // 2. Missed partner detail view
      await page.evaluate(() => {
        const w = window as any;
        const todayStr = new Date().toISOString().slice(0, 10);
        const missedGrant = {
          id: 'g-missed',
          partnerId: 'owner-2',
          nickname: '小豆子同学',
          avatar: 'pose-0',
          createdAt: '',
          liveStatus: {
            state: 'missed',
            scheduledTime: '14:00',
            overdueHours: 2,
            missedText: '约定 14:00 学习，已超 2 小时未学',
            canPoke: true,
          },
        };
        const missedOverview = {
          ownerNickname: '小豆子同学',
          updatedAt: new Date().toISOString(),
          range: { from: todayStr, to: todayStr },
          selectedTotals: { minutes: 0, questions: 0, errors: 0, accuracy: null, lessons: 0 },
          allTimeTotals: { minutes: 1240, questions: 980, errors: 160, accuracy: 83.7, lessons: 18 },
          books: [],
          courses: [],
          records: { items: [], page: 1, pageSize: 30, total: 0 },
          studyDates: [],
        };
        w.__renderMobile(
          w.React.createElement(w.SharingModal, {
            isOpen: true,
            onClose: () => {},
            initialSelectedId: 'g-missed',
            initialOverview: missedOverview,
            initialGrants: { owned: [], received: [missedGrant], codes: [] },
          })
        );
      });

      const missedMetrics = await dialog.evaluate(el => {
        const missedSpan = Array.from(el.querySelectorAll('span')).find(s => s.textContent?.includes('约定 14:00 学习')) as HTMLElement;
        const pokeBtn = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.trim() === '戳一下') as HTMLElement;
        return {
          missedWidth: missedSpan.getBoundingClientRect().width,
          missedOverflow: missedSpan.scrollWidth > missedSpan.clientWidth + 1,
          missedTruncateClass: missedSpan.className.includes('truncate'),
          pokeHeight: pokeBtn.getBoundingClientRect().height,
          hasDoubleLightning: el.textContent?.includes('⚡️'),
        };
      });
      expect(missedMetrics.missedWidth).toBeGreaterThanOrEqual(180);
      expect(missedMetrics.missedOverflow).toBe(false);
      expect(missedMetrics.missedTruncateClass).toBe(false);
      expect(missedMetrics.pokeHeight).toBeLessThanOrEqual(38);
      expect(missedMetrics.hasDoubleLightning).toBe(false);
      if (shotDir) await page.screenshot({ path: path.join(shotDir, `sharing-detail-missed-${width}.png`) });

      // 3. Partner list view with focusing + missed cards
      await page.evaluate(({ longTitle }) => {
        const w = window as any;
        const grants = [
          {
            id: 'g-1',
            partnerId: 'o1',
            nickname: '阿土同学',
            avatar: 'pose-1',
            createdAt: '',
            liveStatus: {
              state: 'focusing',
              focusTitle: longTitle,
              focusMinutes: 34,
              canPoke: false,
            },
          },
          {
            id: 'g-2',
            partnerId: 'o2',
            nickname: '小豆子',
            avatar: 'pose-0',
            createdAt: '',
            liveStatus: {
              state: 'missed',
              scheduledTime: '14:00',
              missedText: '约定 14:00 学习，已超 2 小时未学',
              canPoke: true,
            },
          },
        ];
        w.__renderMobile(
          w.React.createElement(w.SharingModal, {
            isOpen: true,
            onClose: () => {},
            initialGrants: { owned: [], received: grants, codes: [] },
          })
        );
      }, { longTitle });

      const listBanner = dialog.getByTestId('partner-list-focus-banner');
      await listBanner.waitFor();
      const listMetrics = await dialog.evaluate((el, longTitle) => {
        const banner = el.querySelector('[data-testid="partner-list-focus-banner"]') as HTMLElement;
        const card = banner.parentElement as HTMLElement;
        const titleEl = banner.querySelector('p') as HTMLElement;
        const cardButtons = Array.from(el.querySelectorAll('button')).filter(b =>
          ['学情', '贴便签', '专注中', '戳一戳'].includes(b.textContent?.trim() || '')
        );
        return {
          dialogOverflow: el.scrollWidth > el.clientWidth + 1,
          bannerWidth: banner.getBoundingClientRect().width,
          cardWidth: card.getBoundingClientRect().width,
          titleOverflow: titleEl.scrollWidth > titleEl.clientWidth + 1,
          titleText: titleEl.textContent,
          maxButtonHeight: Math.max(...cardButtons.map(b => b.getBoundingClientRect().height)),
          hasDoubleGreenDot: banner.textContent?.includes('🟢'),
          hasDoubleLightning: el.textContent?.includes('⚡️'),
        };
      }, longTitle);

      expect(listMetrics.dialogOverflow).toBe(false);
      expect(listMetrics.bannerWidth).toBeGreaterThanOrEqual(listMetrics.cardWidth * 0.85);
      expect(listMetrics.titleOverflow).toBe(false);
      expect(listMetrics.titleText).toBe(`《${longTitle}》`);
      expect(listMetrics.maxButtonHeight).toBeLessThanOrEqual(38);
      expect(listMetrics.hasDoubleGreenDot).toBe(false);
      expect(listMetrics.hasDoubleLightning).toBe(false);
      if (shotDir) {
        await listBanner.locator('..').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(shotDir, `sharing-list-${width}.png`) });
      }
    } finally {
      await context.close();
    }
  }
}, 25000);

it('renders TodayView without removed yellow pending banner, includes Pomodoro minutes, renders untruncated status popover at 360px, and forwards timezone params', async () => {
  const shotDir = process.env.COMPANION_SHOT_DIR;
  if (shotDir) fs.mkdirSync(shotDir, { recursive: true });

  for (const width of [360, 375]) {
    const { page, context } = await setupMobilePage(width);
    const grantUrls: string[] = [];
    await page.route('**/api/sharing/grants**', async route => {
      grantUrls.push(route.request().url());
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, owned: [], received: [], codes: [] }),
      });
    });

    try {
      await page.evaluate(() => {
        const w = window as any;
        const d = new Date();
        const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const state = structuredClone(w.BLANK_STATE);
        state.plans = [
          {
            id: 'p1',
            name: '行测资料分析专项练习',
            date: todayStr,
            libraryId: 'lib1',
            type: 'book',
            sourceId: 'b1',
            subject: '资料分析',
            plannedMinutes: 60,
            actualMinutes: 45,
            accumulatedMs: 45 * 60 * 1000,
            timerStart: 0,
            done: false,
          },
        ];
        const ctxValue = {
          state,
          activeDate: todayStr,
          currentUser: { id: 'u-main', nickname: '我' },
          csrfToken: 'test-csrf',
          startTimer: async () => ({ ok: true }),
          pauseTimer: async () => ({ ok: true }),
          deletePlan: async () => ({ ok: true }),
        };
        w.__todayRoot = w.createRoot(document.getElementById('root')!);
        w.__todayRoot.render(
          w.React.createElement(
            w.AppContext.Provider,
            { value: ctxValue },
            w.React.createElement('div', { className: 'p-4 bg-cream min-h-screen' },
              w.React.createElement(w.TodayView, {
                onOpenAddPlan: () => {},
                onOpenFocus: () => {},
                onOpenComplete: () => {},
                onOpenCountdownEdit: () => {},
                onAddCountdown: () => {},
                initialShowStatusDetail: true,
                initialPartner: {
                  id: 'demo-atu',
                  nickname: '阿土同学',
                  avatar: 'pose-1',
                  createdAt: '',
                  liveStatus: {
                    state: 'focusing',
                    focusTitle: '行测真题 5000 题专项拔高',
                    focusMinutes: 34,
                    canPoke: false,
                  },
                },
              })
            )
          )
        );
      });

      const popover = page.getByRole('region', { name: '学友实时学情详情' });
      await popover.waitFor();

      const todayMetrics = await page.evaluate(() => {
        const docOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
        const hasPendingBanner = document.querySelector('[data-testid="today-pending-banner"]') !== null;
        const bodyText = document.body.textContent || '';
        const pop = document.querySelector('[aria-label="学友实时学情详情"]') as HTMLElement;
        const popText = Array.from(pop.querySelectorAll('span')).find(s => s.textContent?.includes('正在专注')) as HTMLElement;
        const popRect = pop.getBoundingClientRect();
        return {
          docOverflow,
          hasPendingBanner,
          bodyText,
          popRight: popRect.right,
          viewportWidth: window.innerWidth,
          popText: popText.textContent,
          popTextOverflow: popText.scrollWidth > popText.clientWidth + 1,
        };
      });

      expect(todayMetrics.docOverflow).toBe(false);
      expect(todayMetrics.hasPendingBanner).toBe(false);
      expect(todayMetrics.bodyText).toContain('含 45 分钟待登记投入');
      expect(todayMetrics.popRight).toBeLessThanOrEqual(width + 1);
      expect(todayMetrics.popTextOverflow).toBe(false);
      expect(todayMetrics.popText).toContain('34m');
      if (shotDir) await page.screenshot({ path: path.join(shotDir, `today-view-${width}.png`) });

      // Mount TodayView WITHOUT initialPartner to confirm /api/sharing/grants includes localDate & tzOffset
      await page.evaluate(() => {
        const w = window as any;
        const d = new Date();
        const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const state = structuredClone(w.BLANK_STATE);
        const ctxValue = {
          state,
          activeDate: todayStr,
          currentUser: { id: 'u-main', nickname: '我' },
          csrfToken: 'test-csrf',
          startTimer: async () => ({ ok: true }),
          pauseTimer: async () => ({ ok: true }),
          deletePlan: async () => ({ ok: true }),
        };
        w.__todayRoot.render(
          w.React.createElement(
            w.AppContext.Provider,
            { value: ctxValue },
            w.React.createElement(w.TodayView, {
              onOpenAddPlan: () => {},
              onOpenFocus: () => {},
              onOpenComplete: () => {},
              onOpenCountdownEdit: () => {},
              onAddCountdown: () => {},
            })
          )
        );
      });
      await page.waitForFunction(() => true);
      await new Promise(r => setTimeout(r, 150));
      expect(grantUrls.some(u => u.includes('localDate=') && u.includes('tzOffset='))).toBe(true);
    } finally {
      await context.close();
    }
  }
}, 25000);

it('switches SharingModal tabs (点击看全部, 累计资料, 全部统计, 当日学情) with zero React errors and auto-syncs study minutes on focus', async () => {
  const { page, context } = await setupMobilePage(375);
  const pageErrors: string[] = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  const overviewUrls: string[] = [];
  let currentLiveMinutes = 34;

  await page.route('**/api/sharing/grants**', async route => {
    const url = route.request().url();
    const d = new Date();
    const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (url.includes('/overview')) {
      overviewUrls.push(url);
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          overview: {
            ownerNickname: '阿土同学',
            updatedAt: new Date().toISOString(),
            range: { from: todayStr, to: todayStr },
            selectedTotals: { minutes: currentLiveMinutes, questions: 0, errors: 0, accuracy: null, lessons: 0 },
            allTimeTotals: { minutes: 100 + currentLiveMinutes, questions: 20, errors: 2, accuracy: 90, lessons: 1 },
            recordedMinutes: 0,
            pendingMinutes: currentLiveMinutes,
            books: [{ id: 'b1', name: '行测5000题', subject: '判断推理', done: 120, total: 500, errors: 10, minutes: 100 }],
            courses: [{ id: 'c1', name: '资料分析系统课', subject: '资料分析', done: 4, total: 10, minutes: 60 }],
            records: {
              items: [
                { date: '2026-10-20', type: 'book', subject: '判断推理', sourceName: '行测5000题', quantity: 20, minutes: 100, errors: 2 },
              ],
              page: 1,
              pageSize: 30,
              total: 1,
            },
            studyDates: ['2026-10-20'],
          },
        }),
      });
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        owned: [],
        received: [
          {
            id: 'g-live',
            nickname: '阿土同学',
            createdAt: '',
            liveStatus: {
              state: 'focusing',
              focusTitle: '独立番茄专注',
              focusMinutes: currentLiveMinutes,
              pendingMinutes: currentLiveMinutes,
            },
          },
        ],
        codes: [],
      }),
    });
  });

  try {
    await page.evaluate(() => {
      const w = window as any;
      const d = new Date();
      const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const state = structuredClone(w.BLANK_STATE);
      const ctxValue = {
        state,
        activeDate: todayStr,
        currentUser: { id: 'viewer-1', nickname: '我' },
        csrfToken: 'test-csrf',
      };
      w.__modalRoot = w.createRoot(document.getElementById('root')!);
      w.__modalRoot.render(
        w.React.createElement(
          w.AppContext.Provider,
          { value: ctxValue },
          w.React.createElement(w.SharingModal, {
            isOpen: true,
            onClose: () => {},
            initialSelectedId: 'g-live',
          })
        )
      );
    });

    const dialog = page.getByRole('dialog');
    await dialog.getByText('今日学情概况').waitFor();
    expect(await dialog.textContent()).toContain('34');
    expect(await dialog.textContent()).toContain('学习中 ⏱️');

    // Click "点击看全部" -> opens "全部学习记录统计" cleanly without React #300 crash
    await dialog.locator('button', { hasText: '点击看全部' }).click();
    await dialog.getByText('全部学习记录统计').waitFor();

    // Switch to "累计资料" tab
    await dialog.getByRole('tab', { name: /累计资料/ }).click();
    await dialog.getByText('累计资料进度').waitFor();
    expect(await dialog.textContent()).toContain('行测5000题');

    // Switch to "全部统计" tab
    await dialog.getByRole('tab', { name: '全部统计' }).click();
    await dialog.getByText('全部学习记录统计').waitFor();

    // Switch back to "当日学情" tab
    await dialog.getByRole('tab', { name: '当日学情' }).click();
    await dialog.getByText('今日学情概况').waitFor();

    // Simulate partner advancing study minutes and viewer window regaining focus
    currentLiveMinutes = 48;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await dialog.getByText('48', { exact: true }).waitFor();
    expect(await dialog.textContent()).toContain('148 分钟');

    expect(overviewUrls.some(u => u.includes('localDate=') && u.includes('tzOffset='))).toBe(true);
    expect(pageErrors).toEqual([]);

    // Also verify ErrorBoundary isolates a throwing child and resets cleanly
    await page.evaluate(() => {
      const w = window as any;
      let shouldThrow = true;
      function FragileChild() {
        if (shouldThrow) throw new Error('simulated tab crash');
        return w.React.createElement('div', { 'data-testid': 'recovered-child' }, '已恢复正常');
      }
      w.__modalRoot.render(
        w.React.createElement(
          w.ErrorBoundary,
          { onReset: () => { shouldThrow = false; }, title: '局部异常' },
          w.React.createElement(FragileChild)
        )
      );
    });
    await page.getByTestId('error-boundary-fallback').waitFor();
    await page.getByRole('button', { name: /重试/ }).click();
    await page.getByTestId('recovered-child').waitFor();
  } finally {
    await context.close();
  }
}, 25000);
