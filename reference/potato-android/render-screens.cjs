async (page) => {
  const base = 'http://127.0.0.1:8765/';
  await page.goto(base + '?screen=today');
  const ids = await page.evaluate(() => [...DESIGN_SCREENS.core, ...DESIGN_SCREENS.flow]);
  const context = await page.context().browser().newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });
  const render = await context.newPage();
  const errors = [];
  render.on('pageerror', error => errors.push(error.message));
  const report = [];
  const out = '/Users/ruyne./Library/Mobile Documents/com~apple~CloudDocs/落地项目/考公工作台/output/design/potato-android/';
  for (let index = 0; index < ids.length; index++) {
    const id = ids[index];
    await render.goto(base + '?screen=' + id);
    await render.evaluate(async () => {
      await document.fonts.ready;
      const asset = new Image();
      asset.src = 'assets/potato-poses.png';
      await asset.decode();
    });
    const metrics = await render.evaluate(() => {
      const phone = document.getElementById('phone');
      const main = document.querySelector('.screen-main');
      const all = [...phone.querySelectorAll('[data-go]')];
      return { id: phone.dataset.screen, width: phone.clientWidth, height: phone.clientHeight, horizontalOverflow: main.scrollWidth - main.clientWidth, verticalScroll: main.scrollHeight - main.clientHeight, invalidLinks: all.filter(a => !PAGES[a.dataset.go]).map(a => a.dataset.go) };
    });
    const filename = String(index + 1).padStart(2, '0') + '-' + id + '.png';
    await render.locator('#phone').screenshot({ path: out + 'screens/' + filename });
    report.push({ ...metrics, filename });
  }
  await render.setViewportSize({ width: 360, height: 800 });
  for (const id of ['today', 'book-edit', 'monthly', 'login']) {
    await render.goto(base + '?screen=' + id);
    await render.evaluate(() => document.fonts.ready);
    await render.locator('#phone').screenshot({ path: out + 'screens/check-360-' + id + '.png' });
    report.push(await render.evaluate(() => ({ id: document.getElementById('phone').dataset.screen, viewport: '360x800', horizontalOverflow: document.querySelector('.screen-main').scrollWidth - document.querySelector('.screen-main').clientWidth })));
  }
  const boardContext = await page.context().browser().newContext({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 1 });
  const board = await boardContext.newPage();
  for (const name of ['core', 'flows']) {
    await board.goto(base + '?board=' + name);
    await board.locator('iframe').last().waitFor();
    await Promise.all(board.frames().slice(1).map(frame => frame.waitForSelector('#phone')));
    await board.evaluate(async () => {
      await Promise.all([...document.querySelectorAll('iframe')].map(async f => {
        const doc = f.contentDocument;
        if (doc) await doc.fonts.ready;
      }));
    });
    await board.screenshot({ path: out + (name === 'core' ? '00-core-overview.png' : '00-flows-overview.png'), fullPage: true });
  }
  await boardContext.close();
  await context.close();
  return { screens: ids.length, errors, report };
}
