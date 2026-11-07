import path from 'node:path';
import { chromium } from 'playwright';

async function capture() {
  const htmlPath = path.resolve('output/poke-email-preview.html');
  const outPath = path.resolve('output/poke-email-preview.png');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 680, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.goto(`file://${htmlPath}`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: outPath, fullPage: true });
  await browser.close();
  console.log('Screenshot saved to:', outPath);
}

capture().catch(err => {
  console.error(err);
  process.exit(1);
});
