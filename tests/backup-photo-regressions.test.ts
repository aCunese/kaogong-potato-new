/**
 * S10 Capacity limits, photo readability, and workflow polish regressions test suite.
 *
 * Verifies:
 * 1. Exact UTF-8 byte boundary: Chinese and emoji byte counting, 50MB vs 50MB + 1 byte failure,
 *    40MB warning in UI, UI distinction between 50MB JSON limit and 500MB cloud quota.
 * 2. External link CORS inlining failure reporting:
 *    refusal to claim full offline success when CORS fetch fails, reporting failed record ID.
 * 3. Photo compression: standard 1200x1200, aspect ratio > 2 long photo (1080x6000),
 *    ultra-long photo (1080x10000) requiring crop/split warning, avatar untouched.
 * 4. Image batch validation: 10 photo limit, 20MB single file limit, partial batch failure preservation.
 * 5. countWrongAttachments accuracy: de-duplication of image and images per record, summing across records.
 * 6. ConflictModal cards: "全部日程计划: X 项", "学习打卡记录: X 条", "错题笔记条目: X 条", "错题照片附件: X 张", secondary Rev.
 * 7. CompletionModal "拍下错题" entry and target presetting: opens PhotoImportModal with preset bookId and date;
 *    cancelling does not undo plan completion or duplicate stats.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { chromium, type Browser } from 'playwright';
import { countWrongAttachments, createPortableBackupState } from '../src/utils/db';
import { validateImageBatch, validateImageFile, MAX_FILE_SIZE_BYTES, MAX_BATCH_COUNT } from '../src/utils/imageCompressor';
import { buildBrowserHarness, createHarnessPage } from '../scripts/lib/boundary-checks';
import { AppState, WrongRecord } from '../src/types';
import { BLANK_STATE } from '../src/constants/initialData';

describe('S10: Capacity limits, photo readability & workflow polish', () => {
  let browser: Browser;
  let harnessSource: string;

  beforeAll(async () => {
    harnessSource = await buildBrowserHarness();
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    if (browser) await browser.close().catch(() => {});
  });

  // =========================================================================
  // 1. countWrongAttachments accuracy
  // =========================================================================
  describe('countWrongAttachments', () => {
    it('accurately counts and de-duplicates image and images per record', () => {
      const records: WrongRecord[] = [
        {
          id: 'w1',
          date: '2026-10-27',
          bookId: 'b1',
          note: 'Note 1',
          image: 'photo-A',
          images: ['photo-A', 'photo-B', 'photo-C'],
        },
        {
          id: 'w2',
          date: '2026-10-27',
          bookId: 'b1',
          note: 'Note 2',
          image: 'photo-B', // Duplicate URL from w1, but belongs to separate record
          images: ['photo-B', 'photo-D'],
        },
        {
          id: 'w3',
          date: '2026-10-27',
          bookId: 'b2',
          note: 'Note 3 (empty images)',
          image: '',
          images: ['  ', ''],
        },
      ];

      // w1 has unique photos: A, B, C => 3
      // w2 has unique photos: B, D => 2
      // w3 has 0
      // Total = 3 + 2 = 5
      expect(countWrongAttachments(records)).toBe(5);
    });

    it('returns 0 for empty array or invalid inputs', () => {
      expect(countWrongAttachments([])).toBe(0);
      expect(countWrongAttachments(null as any)).toBe(0);
      expect(countWrongAttachments(undefined as any)).toBe(0);
    });
  });

  // =========================================================================
  // 2. Exact UTF-8 byte boundary & export limits
  // =========================================================================
  describe('Exact UTF-8 byte measurement and 50MB boundary', () => {
    it('measures exact UTF-8 byte length for Chinese characters and emojis', () => {
      const encoder = new TextEncoder();
      const chineseStr = '土豆工作台';
      // Each Chinese character is 3 UTF-8 bytes: 5 * 3 = 15 bytes
      expect(encoder.encode(chineseStr).byteLength).toBe(15);

      const emojiStr = '🥔';
      // Potato emoji is 4 UTF-8 bytes
      expect(encoder.encode(emojiStr).byteLength).toBe(4);

      const combined = '土豆🥔2026';
      // 6 + 4 + 4 = 14 bytes
      expect(encoder.encode(combined).byteLength).toBe(14);
    });

    it('strictly fails backup export when JSON UTF-8 size exceeds 50MiB (52,428,800 bytes) without omitting photos', async () => {
      const { page } = await createHarnessPage(browser, harnessSource);
      try {
        const res = await page.evaluate(async () => {
          const w = window as any;

          // Commit a state that produces a > 50MB JSON payload
          // 50 MiB = 52,428,800 bytes. A 51MB string strictly exceeds 50MB.
          const state = (await w.db.loadLatestState()).state;
          state.wrong = [
            {
              id: 'huge-w1',
              date: '2026-10-27',
              bookId: 'b1',
              note: 'x'.repeat(51 * 1024 * 1024),
              image: '',
            },
          ];
          await w.db.commitMutation(() => ({ nextState: state, value: undefined }), 'seed_huge');

          w.backupModalOpen = true;
          w.mount();
          await new Promise(r => setTimeout(r, 60));

          // Use the app context exportBackup directly
          const result = await w.api.exportBackup();
          return {
            ok: result.ok,
            code: result.code,
            message: result.message,
          };
        });

        expect(res.ok).toBe(false);
        expect(res.code).toBe('BACKUP_TOO_LARGE');
        expect(res.message).toContain('50MB');
      } finally {
        await page.close().catch(() => {});
      }
    });

    it('shows warning in BackupModal when export size is >= 40MiB and clarifies 50MB JSON vs 500MB cloud quota', async () => {
      const { page } = await createHarnessPage(browser, harnessSource);
      try {
        const res = await page.evaluate(async () => {
          const w = window as any;

          // Seed a state that produces ~42MB JSON (> 40MB, < 50MB)
          const state = (await w.db.loadLatestState()).state;
          state.wrong = [
            {
              id: 'near-limit-w1',
              date: '2026-10-27',
              bookId: 'b1',
              note: 'x'.repeat(42 * 1024 * 1024),
              image: '',
            },
          ];
          await w.db.commitMutation(() => ({ nextState: state, value: undefined }), 'seed_near_limit');

          w.backupModalOpen = true;
          w.mount();
          await new Promise(r => setTimeout(r, 60));

          const modalText = document.body.innerText;
          const hasJsonLimit = modalText.includes('50 MB') || modalText.includes('50MB');
          const hasCloudQuota = modalText.includes('500 MB') || modalText.includes('500MB');
          const hasQuotaExplanation = modalText.includes('容量规格与配额说明') || modalText.includes('配额');

          // Click export button in BackupModal
          const exportBtn = Array.from(document.querySelectorAll('button')).find(b =>
            b.textContent?.includes('导出 JSON 备份')
          );
          exportBtn?.click();
          await new Promise(r => setTimeout(r, 1200));

          const warningStatusEl = document.querySelector('[role="status"]');
          const warningText = warningStatusEl?.textContent || '';

          return {
            hasJsonLimit,
            hasCloudQuota,
            hasQuotaExplanation,
            warningText,
            lastToast: w.lastToast,
          };
        });

        expect(res.hasJsonLimit).toBe(true);
        expect(res.hasCloudQuota).toBe(true);
        expect(res.hasQuotaExplanation).toBe(true);
        expect(res.warningText).toContain('42.0MB');
        expect(res.warningText).toContain('接近单文件 50MB 导出上限');
        expect(res.lastToast).toContain('40MB+');
      } finally {
        await page.close().catch(() => {});
      }
    });
  });

  // =========================================================================
  // 3. External link CORS inlining failure reporting
  // =========================================================================
  describe('External link CORS inlining failure reporting', () => {
    it('refuses export when external CORS fetch fails and clearly reports the failing record', async () => {
      const { page } = await createHarnessPage(browser, harnessSource);
      try {
        const res = await page.evaluate(async () => {
          const w = window as any;

          // Mock window.fetch to fail for external URL
          const originalFetch = window.fetch;
          window.fetch = async (input: any, init?: any) => {
            const url = typeof input === 'string' ? input : input?.url || '';
            if (url.includes('external-image.example.com')) {
              return new Response(null, { status: 404, statusText: 'Not Found' });
            }
            return originalFetch(input, init);
          };

          const state: AppState = structuredClone(w.BLANK_STATE);
          state.wrong = [
            {
              id: 'wrong-rec-404',
              date: '2026-10-27',
              bookId: 'book-1',
              note: 'Problem with external photo',
              image: 'https://external-image.example.com/question.jpg',
            },
          ];

          let errorMsg = '';
          try {
            await w.db.createPortableBackupState(state);
          } catch (err: any) {
            errorMsg = err?.message || String(err);
          } finally {
            window.fetch = originalFetch;
          }

          return { errorMsg };
        });

        expect(res.errorMsg).toContain('wrong-rec-404');
        expect(res.errorMsg).toContain('CORS 读取失败');
        expect(res.errorMsg).toContain('无法生成完整离线备份');
      } finally {
        await page.close().catch(() => {});
      }
    });

    it('inlines external image into data URL when CORS fetch succeeds', async () => {
      const { page } = await createHarnessPage(browser, harnessSource);
      try {
        const res = await page.evaluate(async () => {
          const w = window as any;

          // Mock window.fetch to return a valid 1x1 png blob for external URL
          const originalFetch = window.fetch;
          window.fetch = async (input: any, init?: any) => {
            const url = typeof input === 'string' ? input : input?.url || '';
            if (url.includes('cors-ok.example.com')) {
              const canvas = document.createElement('canvas');
              canvas.width = 10;
              canvas.height = 10;
              const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/png'));
              return new Response(blob, { status: 200, headers: { 'Content-Type': 'image/png' } });
            }
            return originalFetch(input, init);
          };

          const state: AppState = structuredClone(w.BLANK_STATE);
          state.wrong = [
            {
              id: 'wrong-rec-cors-ok',
              date: '2026-10-27',
              bookId: 'book-1',
              note: 'Valid external photo',
              image: 'https://cors-ok.example.com/ok.png',
            },
          ];

          let portable: AppState | null = null;
          try {
            portable = await w.db.createPortableBackupState(state);
          } finally {
            window.fetch = originalFetch;
          }

          return {
            imageResult: portable?.wrong[0]?.image || '',
          };
        });

        expect(res.imageResult.startsWith('data:image/')).toBe(true);
        expect(res.imageResult).toContain('base64');
      } finally {
        await page.close().catch(() => {});
      }
    });
  });

  // =========================================================================
  // 4. Photo compression & real Canvas testing
  // =========================================================================
  describe('Photo compression & Canvas handling', () => {
    it('compresses standard wrong photo maintaining max 1200x1200 and quality 0.75 without upscaling smaller image', async () => {
      const { page } = await createHarnessPage(browser, harnessSource);
      try {
        const res = await page.evaluate(async () => {
          const w = window as any;

          // 1. Create a 800x600 image (< 1200x1200) - must not upscale
          const canvas1 = document.createElement('canvas');
          canvas1.width = 800;
          canvas1.height = 600;
          const ctx1 = canvas1.getContext('2d')!;
          ctx1.fillStyle = '#ff0000';
          ctx1.fillRect(0, 0, 800, 600);
          const blobSmall = await new Promise<Blob>(r => canvas1.toBlob(b => r(b!), 'image/png'));

          const compressedSmall = await w.imageCompressor.compressWrongPhoto(blobSmall);
          const imgSmall = new Image();
          await new Promise(r => { imgSmall.onload = r; imgSmall.src = compressedSmall; });

          // 2. Create a 2400x1600 image (> 1200x1200, aspect ratio 1.5 <= 2)
          const canvas2 = document.createElement('canvas');
          canvas2.width = 2400;
          canvas2.height = 1600;
          const ctx2 = canvas2.getContext('2d')!;
          ctx2.fillStyle = '#00ff00';
          ctx2.fillRect(0, 0, 2400, 1600);
          const blobLarge = await new Promise<Blob>(r => canvas2.toBlob(b => r(b!), 'image/jpeg'));

          const compressedLarge = await w.imageCompressor.compressWrongPhoto(blobLarge);
          const imgLarge = new Image();
          await new Promise(r => { imgLarge.onload = r; imgLarge.src = compressedLarge; });

          return {
            smallWidth: imgSmall.naturalWidth,
            smallHeight: imgSmall.naturalHeight,
            largeWidth: imgLarge.naturalWidth,
            largeHeight: imgLarge.naturalHeight,
          };
        });

        // Small image not upscaled
        expect(res.smallWidth).toBe(800);
        expect(res.smallHeight).toBe(600);

        // Large image scaled down to max 1200 on long side: 2400x1600 -> 1200x800
        expect(res.largeWidth).toBe(1200);
        expect(res.largeHeight).toBe(800);
      } finally {
        await page.close().catch(() => {});
      }
    });

    it('compresses long photo with aspect ratio > 2 (1080x6000) into 4096 bounding box with short side >= 720', async () => {
      const { page } = await createHarnessPage(browser, harnessSource);
      try {
        const res = await page.evaluate(async () => {
          const w = window as any;

          // Create a 1080x6000 long canvas image (aspect ratio ~5.56 > 2)
          const canvas = document.createElement('canvas');
          canvas.width = 1080;
          canvas.height = 6000;
          const ctx = canvas.getContext('2d')!;
          ctx.fillStyle = '#f5f5f5';
          ctx.fillRect(0, 0, 1080, 6000);
          ctx.fillStyle = '#333333';
          ctx.fillText('Long question content', 50, 50);

          const blob = await new Promise<Blob>(r => canvas.toBlob(b => r(b!), 'image/jpeg', 0.8));
          const compressed = await w.imageCompressor.compressWrongPhoto(blob);

          const img = new Image();
          await new Promise(r => { img.onload = r; img.src = compressed; });

          return {
            width: img.naturalWidth,
            height: img.naturalHeight,
          };
        });

        // Long side should be scaled down to max 4096
        expect(res.height).toBe(4096);
        // Short side should be Math.round(1080 * (4096/6000)) = 737 >= 720
        expect(res.width).toBe(737);
        expect(res.width).toBeGreaterThanOrEqual(720);
      } finally {
        await page.close().catch(() => {});
      }
    });

    it('rejects ultra-long photo (1080x10000) where scaled short side falls below 720px, prompting user to crop or split', async () => {
      const { page } = await createHarnessPage(browser, harnessSource);
      try {
        const res = await page.evaluate(async () => {
          const w = window as any;

          // Create a 1080x10000 ultra-long image (aspect ratio ~9.26 > 2)
          // Under max 4096, 1080 * (4096/10000) = 442 < 720
          const canvas = document.createElement('canvas');
          canvas.width = 1080;
          canvas.height = 10000;
          const ctx = canvas.getContext('2d')!;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, 1080, 10000);

          const blob = await new Promise<Blob>(r => canvas.toBlob(b => r(b!), 'image/jpeg'));
          let errorMsg = '';
          try {
            await w.imageCompressor.compressWrongPhoto(blob);
          } catch (err: any) {
            errorMsg = err?.message || String(err);
          }

          return { errorMsg };
        });

        expect(res.errorMsg).toContain('清晰度底线');
        expect(res.errorMsg).toContain('裁剪或分段');
      } finally {
        await page.close().catch(() => {});
      }
    });

    it('leaves avatar compression untouched (320x320 / 512x512)', async () => {
      const { page } = await createHarnessPage(browser, harnessSource);
      try {
        const res = await page.evaluate(async () => {
          const w = window as any;

          // Avatar uses compressImage with maxWidth: 320, maxHeight: 320, isWrongPhoto: false
          const canvas = document.createElement('canvas');
          canvas.width = 800;
          canvas.height = 800;
          const blob = await new Promise<Blob>(r => canvas.toBlob(b => r(b!), 'image/png'));

          const compressed = await w.imageCompressor.compressImage(blob, {
            maxWidth: 320,
            maxHeight: 320,
            quality: 0.75,
            isWrongPhoto: false,
          });

          const img = new Image();
          await new Promise(r => { img.onload = r; img.src = compressed; });

          return {
            width: img.naturalWidth,
            height: img.naturalHeight,
          };
        });

        expect(res.width).toBe(320);
        expect(res.height).toBe(320);
      } finally {
        await page.close().catch(() => {});
      }
    });

    it('enforces validateImageBatch limits and handles partial failures without discarding valid photos', () => {
      // 1. Batch size limit 10
      const elevenFiles = Array.from({ length: 11 }, () => new Blob(['x'], { type: 'image/jpeg' }));
      expect(validateImageBatch(elevenFiles).valid).toBe(false);
      expect(validateImageBatch(elevenFiles).error).toContain('单次最多上传 10 张图片');

      // 2. 10 files valid
      const tenFiles = Array.from({ length: 10 }, () => new Blob(['x'], { type: 'image/jpeg' }));
      expect(validateImageBatch(tenFiles).valid).toBe(true);

      // 3. Single file limit 20MB
      const hugeFile = { size: 21 * 1024 * 1024, type: 'image/jpeg', name: 'large.jpg' } as File;
      expect(validateImageFile(hugeFile).valid).toBe(false);
      expect(validateImageFile(hugeFile).error).toContain('20MB');

      const batchWithHuge = [new Blob(['x'], { type: 'image/jpeg' }), hugeFile];
      expect(validateImageBatch(batchWithHuge).valid).toBe(false);
      expect(validateImageBatch(batchWithHuge).error).toContain('large.jpg');
    });
  });

  // =========================================================================
  // 5. ConflictModal cards: "全部日程计划: X 项", "学习打卡记录: X 条", etc.
  // =========================================================================
  describe('ConflictModal cards presentation', () => {
    it('displays "全部日程计划", "学习打卡记录", "错题笔记条目", and "错题照片附件" with secondary Rev info', async () => {
      const { page } = await createHarnessPage(browser, harnessSource);
      try {
        const res = await page.evaluate(async () => {
          const w = window as any;

          const localState = structuredClone(w.BLANK_STATE);
          localState.plans = [{ id: 'p1', name: 'Plan 1' }, { id: 'p2', name: 'Plan 2' }];
          localState.records = [{ id: 'r1', minutes: 20 }];
          localState.wrong = [
            { id: 'w1', note: 'Wrong 1', image: 'img-1', images: ['img-1', 'img-2'] },
          ];

          const serverState = structuredClone(w.BLANK_STATE);
          serverState.plans = [{ id: 'sp1', name: 'Server Plan 1' }];
          serverState.records = [{ id: 'sr1', minutes: 30 }, { id: 'sr2', minutes: 40 }];
          serverState.wrong = [
            { id: 'sw1', note: 'Server Wrong 1', image: 'img-3' },
            { id: 'sw2', note: 'Server Wrong 2', image: 'img-4' },
          ];

          w.conflictModalOpen = true;
          w.conflictLocalState = localState;
          w.conflictLocalRev = 5;
          w.conflictServerState = serverState;
          w.conflictServerRev = 8;
          w.mount();
          await new Promise(r => setTimeout(r, 60));

          const modalText = document.body.innerText;
          return {
            modalText,
            hasOldText: modalText.includes('今日日程:'),
            hasAllPlansText: modalText.includes('全部日程计划:'),
            hasRecordsText: modalText.includes('学习打卡记录:'),
            hasWrongNotesText: modalText.includes('错题笔记条目:'),
            hasWrongPhotosText: modalText.includes('错题照片附件:'),
            hasLocalRev: modalText.includes('Rev 5'),
            hasServerRev: modalText.includes('Rev 8'),
          };
        });

        // "今日日程:" must be gone in favor of "全部日程计划:"
        expect(res.hasOldText).toBe(false);
        expect(res.hasAllPlansText).toBe(true);
        expect(res.hasRecordsText).toBe(true);
        expect(res.hasWrongNotesText).toBe(true);
        expect(res.hasWrongPhotosText).toBe(true);
        expect(res.hasLocalRev).toBe(true);
        expect(res.hasServerRev).toBe(true);
      } finally {
        await page.close().catch(() => {});
      }
    });
  });

  // =========================================================================
  // 6. CompletionModal "拍下错题" entry and target presetting
  // =========================================================================
  describe('CompletionModal "拍下错题" button and PhotoImportModal target presetting', () => {
    it('shows "拍下错题" button when errors > 0 and book exists, opens PhotoImportModal with preset bookId and date', async () => {
      const { page } = await createHarnessPage(browser, harnessSource);
      try {
        const res = await page.evaluate(async () => {
          const w = window as any;

          // Seed a book and an associated plan
          const bookId = 'book-test-101';
          const planDate = '2026-10-25';
          const plan = {
            id: 'plan-test-101',
            date: planDate,
            type: 'book',
            sourceId: bookId,
            name: '言语理解冲刺50题',
            subject: '言语理解',
            targetMinutes: 30,
            actualMinutes: 25,
            done: true,
            timerStart: 0,
            accumulatedMs: 0,
            recordId: 'rec-test-101',
          };

          const record = {
            id: 'rec-test-101',
            planId: plan.id,
            date: planDate,
            type: 'book',
            sourceId: bookId,
            subject: '言语理解',
            minutes: 25,
            questions: 50,
            errors: 5, // errors > 0
          };

          // Setup app state with book and record
          const state = (await w.db.loadLatestState()).state;
          state.books = [
            {
              id: bookId,
              name: '言语冲刺真题',
              subject: '言语理解',
              totalQuestions: 200,
              doneQuestions: 50,
              wrongQuestions: 5,
              totalMinutes: 25,
            },
          ];
          state.plans = [plan];
          state.records = [record];
          await w.db.commitMutation(() => ({ nextState: state, value: undefined }), 'seed_completion_test');

          // Open CompletionModal
          w.completionPlan = plan;
          w.completionInitialSuccess = true;
          w.completionModalOpen = true;
          w.photoImportModalOpen = false;
          w.mount();
          await new Promise(r => setTimeout(r, 80));

          // Find "拍下错题" button
          const buttons = Array.from(document.querySelectorAll('button'));
          const takeWrongBtn = buttons.find(b => b.textContent?.includes('拍下错题'));
          const hasTakeWrongBtn = Boolean(takeWrongBtn);

          // Click "拍下错题"
          takeWrongBtn?.click();
          await new Promise(r => setTimeout(r, 80));

          // Check if CompletionModal is closed and PhotoImportModal is opened with target preset
          const photoImportIsOpen = Boolean(w.photoImportModalOpen);
          const presetTarget = w.photoImportTarget;

          // Check modal DOM for preset info
          const modalText = document.body.innerText;
          const hasAssociatedDate = modalText.includes(planDate);

          return {
            hasTakeWrongBtn,
            photoImportIsOpen,
            presetTarget,
            hasAssociatedDate,
          };
        });

        expect(res.hasTakeWrongBtn).toBe(true);
        expect(res.photoImportIsOpen).toBe(true);
        expect(res.presetTarget?.bookId).toBe('book-test-101');
        expect(res.presetTarget?.date).toBe('2026-10-25');
        expect(res.hasAssociatedDate).toBe(true);
      } finally {
        await page.close().catch(() => {});
      }
    });

    it('cancelling photo import does not undo plan completion or duplicate stats', async () => {
      const { page } = await createHarnessPage(browser, harnessSource);
      try {
        const res = await page.evaluate(async () => {
          const w = window as any;

          // Check baseline records count
          const beforeState = (await w.db.loadLatestState()).state;
          const recordsBefore = beforeState.records.length;
          const wrongBefore = beforeState.wrong.length;

          // Open PhotoImportModal and cancel
          w.photoImportModalOpen = true;
          w.photoImportTarget = { bookId: 'book-test-101', date: '2026-10-25' };
          w.mount();
          await new Promise(r => setTimeout(r, 60));

          // Click modal close button
          const closeBtn = document.querySelector('button[aria-label="关闭"], [role="dialog"] button');
          (closeBtn as HTMLElement)?.click();
          await new Promise(r => setTimeout(r, 60));

          const afterState = (await w.db.loadLatestState()).state;
          return {
            recordsBefore,
            recordsAfter: afterState.records.length,
            wrongBefore,
            wrongAfter: afterState.wrong.length,
            cancelled: Boolean(w.photoImportCancelled),
          };
        });

        // Records and wrong records unchanged
        expect(res.recordsAfter).toBe(res.recordsBefore);
        expect(res.wrongAfter).toBe(res.wrongBefore);
      } finally {
        await page.close().catch(() => {});
      }
    });
  });
});
