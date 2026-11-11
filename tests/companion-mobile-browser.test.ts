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

it('renders TodayView pending registration banner and untruncated status popover at 360px and forwards timezone params', async () => {
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
        const todayStr = new Date().toISOString().slice(0, 10);
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

      const pendingBanner = page.getByTestId('today-pending-banner');
      await pendingBanner.waitFor();
      const popover = page.getByRole('region', { name: '学友实时学情详情' });
      await popover.waitFor();

      const todayMetrics = await page.evaluate(() => {
        const docOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
        const banner = document.querySelector('[data-testid="today-pending-banner"]') as HTMLElement;
        const pop = document.querySelector('[aria-label="学友实时学情详情"]') as HTMLElement;
        const popText = Array.from(pop.querySelectorAll('span')).find(s => s.textContent?.includes('正在专注')) as HTMLElement;
        const popRect = pop.getBoundingClientRect();
        return {
          docOverflow,
          bannerText: banner.textContent,
          bannerOverflow: banner.scrollWidth > banner.clientWidth + 1,
          popRight: popRect.right,
          viewportWidth: window.innerWidth,
          popText: popText.textContent,
          popTextOverflow: popText.scrollWidth > popText.clientWidth + 1,
        };
      });

      expect(todayMetrics.docOverflow).toBe(false);
      expect(todayMetrics.bannerOverflow).toBe(false);
      expect(todayMetrics.bannerText).toContain('有 1 项已投入 45 分钟待登记');
      expect(todayMetrics.bannerText).toContain('完成登记');
      expect(todayMetrics.popRight).toBeLessThanOrEqual(width + 1);
      expect(todayMetrics.popTextOverflow).toBe(false);
      expect(todayMetrics.popText).toContain('34m');
      if (shotDir) await page.screenshot({ path: path.join(shotDir, `today-view-${width}.png`) });

      // Mount TodayView WITHOUT initialPartner to confirm /api/sharing/grants includes localDate & tzOffset
      await page.evaluate(() => {
        const w = window as any;
        const todayStr = new Date().toISOString().slice(0, 10);
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
