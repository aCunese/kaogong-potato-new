import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { chromium, type Browser } from 'playwright';
import fs from 'node:fs';
import { isHeicImage } from '../src/utils/imageCompressor';
import { buildBrowserHarness, createHarnessPage } from '../scripts/lib/boundary-checks';

import path from 'node:path';

const FIXTURE_HEIC = path.resolve('tests/fixtures/sample.heic');
const REAL_HEIC_PATH = fs.existsSync(FIXTURE_HEIC)
  ? FIXTURE_HEIC
  : '/Users/ruyne./Library/Caches/com.apple.AppleMediaServices/Engagement/internal/downloads/c9f97730-9acc-11ef-b054-9bbbb1252411zh-hans+marketing%3Atcc-pre-warm-full-sheet-books%3AbreakoutFullScreen.heic';

describe('HEIC Photo Support & Compression Regressions', () => {
  let browser: Browser;
  let harnessSource: string;

  beforeAll(async () => {
    harnessSource = await buildBrowserHarness();
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    if (browser) await browser.close().catch(() => {});
  });

  describe('isHeicImage detector', () => {
    it('detects HEIC/HEIF by file extension', async () => {
      const f1 = new File(['fake'], '1000330562.heic', { type: '' });
      const f2 = new File(['fake'], 'IMG_2026.HEIC', { type: '' });
      const f3 = new File(['fake'], 'photo.heif', { type: '' });
      const f4 = new File(['fake'], 'photo.HEIF', { type: '' });
      const f5 = new File(['fake'], 'photo.jpg', { type: '' });

      expect(await isHeicImage(f1)).toBe(true);
      expect(await isHeicImage(f2)).toBe(true);
      expect(await isHeicImage(f3)).toBe(true);
      expect(await isHeicImage(f4)).toBe(true);
      expect(await isHeicImage(f5)).toBe(false);
    });

    it('detects HEIC/HEIF by MIME type', async () => {
      const b1 = new Blob(['fake'], { type: 'image/heic' });
      const b2 = new Blob(['fake'], { type: 'image/heif' });
      const b3 = new Blob(['fake'], { type: 'image/heic-sequence' });
      const b4 = new Blob(['fake'], { type: 'image/jpeg' });
      const b5 = new Blob(['fake'], { type: 'image/png' });

      expect(await isHeicImage(b1)).toBe(true);
      expect(await isHeicImage(b2)).toBe(true);
      expect(await isHeicImage(b3)).toBe(true);
      expect(await isHeicImage(b4)).toBe(false);
      expect(await isHeicImage(b5)).toBe(false);
    });

    it('detects HEIC by binary magic bytes even if filename and mime are generic', async () => {
      if (fs.existsSync(REAL_HEIC_PATH)) {
        const buf = fs.readFileSync(REAL_HEIC_PATH);
        const genericBlob = new Blob([buf], { type: 'application/octet-stream' });
        expect(await isHeicImage(genericBlob)).toBe(true);
      }
    });
  });

  describe('Browser HEIC compression pipeline', () => {
    it('successfully decodes and compresses real mobile HEIC photo in browser', async () => {
      expect(fs.existsSync(REAL_HEIC_PATH)).toBe(true);
      const heicBuf = fs.readFileSync(REAL_HEIC_PATH);
      const base64Heic = heicBuf.toString('base64');

      const { page } = await createHarnessPage(browser, harnessSource);
      try {
        const result = await page.evaluate(async (b64) => {
          const w = window as any;
          const binary = atob(b64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }

          // Simulate mobile file selection (name: 1000330562.heic)
          const file = new File([bytes], '1000330562.heic', { type: 'image/heic' });

          // Test compressWrongPhoto
          const dataUrl = await w.imageCompressor.compressWrongPhoto(file);

          // Verify image loads cleanly in browser
          const img = new Image();
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error('Loaded compressed output failed'));
            img.src = dataUrl;
          });

          return {
            isDataUrl: dataUrl.startsWith('data:image/jpeg;base64,'),
            width: img.naturalWidth,
            height: img.naturalHeight,
            dataUrlLength: dataUrl.length,
          };
        }, base64Heic);

        expect(result.isDataUrl).toBe(true);
        expect(result.width).toBeGreaterThan(0);
        expect(result.height).toBeGreaterThan(0);
        // Standard wrong photo max dimension 1200px
        expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(1200);
        expect(result.dataUrlLength).toBeGreaterThan(1000);
      } finally {
        await page.close().catch(() => {});
      }
    });
  });
});
