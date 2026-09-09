import { test, expect, views, openIceberg, selectItem, noScrollbars, settle, labelY } from './helpers';

test.use({ controlledClock: true });

for (const view of views) {
  test(`${view}: a wheel-less mouse can focus and navigate with page and arrow keys`, async ({ page }) => {
    await openIceberg(page, `view=${view}&embedded&item=entry-23`);
    await page.locator('#iceberg').evaluate(el => el.scrollIntoView());
    await page.keyboard.press('Escape');
    const canvas = page.locator('canvas');
    const empty = await canvas.evaluate(el => {
      const box = el.getBoundingClientRect();
      for (let y = 8; y < box.height; y += 40) {
        for (let x = 8; x < box.width; x += 40) {
          if (document.elementFromPoint(box.x + x, box.y + y) === el) return { x, y };
        }
      }
      throw new Error('No exposed canvas for mouse navigation');
    });
    await canvas.click({ position: empty });
    await expect(canvas).toBeFocused();
    const pageY = await page.evaluate(() => scrollY);
    const initial = await labelY(page, 'entry-23');
    const highest = await highestVisibleWorldY(page);
    await page.keyboard.press('PageDown');
    await settle(page);
    await expect(page.locator('article[data-slug="entry-23"]')).toBeHidden();
    expect(await highestVisibleWorldY(page)).toBeLessThan(highest);
    await page.keyboard.press('PageUp');
    await settle(page);
    expect(await labelY(page, 'entry-23')).toBeCloseTo(initial, 0);
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown');
    await settle(page);
    expect(await labelY(page, 'entry-23')).toBeLessThan(initial - 30);
    expect(await page.evaluate(() => scrollY)).toBe(pageY);
    await page.keyboard.press('End');
    await settle(page);
    await expect(page.locator('article[data-slug="entry-110"]')).toBeVisible();
    await page.keyboard.press('Home');
    await settle(page);
    await expect(page.locator('article[data-slug="entry-1"]')).toBeVisible();
    await noScrollbars(page, false);
  });

  test(`${view}: Space and Shift+Space navigate without scrolling the page`, async ({ page }) => {
    await openIceberg(page, `view=${view}&embedded&item=entry-23`);
    await page.keyboard.press('Escape');
    await page.locator('canvas').focus();
    const pageY = await page.evaluate(() => scrollY);
    const initial = await labelY(page, 'entry-23');
    const highest = await highestVisibleWorldY(page);
    await page.keyboard.press('Space');
    await settle(page);
    await expect(page.locator('article[data-slug="entry-23"]')).toBeHidden();
    expect(await highestVisibleWorldY(page)).toBeLessThan(highest);
    await page.keyboard.press('Shift+Space');
    await settle(page);
    expect(await labelY(page, 'entry-23')).toBeCloseTo(initial, 0);
    expect(await page.evaluate(() => scrollY)).toBe(pageY);
    await noScrollbars(page, false);
  });

  test(`${view}: responsive layout, selector, descriptions, and no scrollbars`, async ({ page }) => {
    await openIceberg(page, `view=${view}&still`);
    await noScrollbars(page);
    const trigger = page.locator('.iceberg-viewer__view-trigger');
    const geometry = await trigger.evaluate(el => {
      const box = el.getBoundingClientRect();
      const name = document.querySelector('.iceberg-viewer__item-name')!;
      return { right: innerWidth - box.right, top: box.top, font: getComputedStyle(el).fontSize, nameFont: getComputedStyle(name).fontSize };
    });
    expect(geometry.right).toBeCloseTo(16, 0);
    expect(geometry.top).toBeCloseTo(16, 0);
    expect(geometry.font).toBe(geometry.nameFont);
    await trigger.click();
    await expect(page.getByRole('menuitemradio')).toHaveText(['Orbit', 'Arc', 'List']);
    const boxes = await page.getByRole('menuitemradio').evaluateAll(es => es.map(e => e.getBoundingClientRect().toJSON()));
    expect(boxes[1].top).toBeGreaterThanOrEqual(boxes[0].bottom);
    expect(boxes[2].top).toBeGreaterThanOrEqual(boxes[1].bottom);
    await noScrollbars(page);
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(page.getByRole('menu')).toBeHidden();

    await selectItem(page);
    const details = page.locator('.is-pinned .iceberg-viewer__item-details');
    await expect(details).toBeVisible();
    const card = await details.boundingBox();
    expect(card!.x).toBeGreaterThanOrEqual(0);
    expect(card!.x + card!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(card!.y).toBeGreaterThanOrEqual(0);
    expect(card!.y + card!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await noScrollbars(page);
    // Narrower than the normal mobile profile, plus landscape.
    for (const size of [{ width: 320, height: 720 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(size);
      await settle(page);
      await noScrollbars(page);
      await expect(details).toBeVisible();
    }
  });

  test(`${view}: wheel over a pinned description keeps descending; final entry is reachable`, async ({ page }) => {
    await openIceberg(page, `view=${view}&embedded`);
    await page.locator('#iceberg').evaluate(el => el.scrollIntoView());
    await selectItem(page);
    const before = await labelY(page, 'entry-56');
    const scrollY = await page.evaluate(() => window.scrollY);
    const card = await page.locator('.is-pinned .iceberg-viewer__item-details').boundingBox();
    await page.mouse.move(card!.x + card!.width / 2, card!.y + 32);
    await page.mouse.wheel(0, 240);
    await settle(page);
    await expect.poll(() => labelY(page, 'entry-56')).toBeLessThan(before - 2);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
    await noScrollbars(page, false);
    await page.keyboard.press('Escape');
    await page.mouse.move(8, Math.min(400, page.viewportSize()!.height - 20));
    // Native wheel input exercises the host's complete path rather than moving
    // a private camera. Stop immediately at the last label to avoid page handoff.
    const last = page.locator('article[data-slug="entry-110"]');
    for (let i = 0; i < 80; i++) {
      if (await last.isVisible()) {
        const name = await last.locator('.iceberg-viewer__item-name').boundingBox();
        const bounds = await page.locator('#iceberg').boundingBox();
        if (name && bounds && name.y >= bounds.y && name.y + name.height <= bounds.y + bounds.height) break;
      }
      await page.mouse.wheel(0, 200);
      await settle(page);
    }
    await expect(last).toBeVisible();
    await settle(page);
    const finalName = await last.locator('.iceberg-viewer__item-name').boundingBox();
    const host = await page.locator('#iceberg').boundingBox();
    expect(finalName!.y).toBeGreaterThanOrEqual(host!.y);
    expect(finalName!.y + finalName!.height).toBeLessThanOrEqual(host!.y + host!.height);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
    await noScrollbars(page, false);
  });
}

test('view switching retains deep links and world anchor heights while scrolling', async ({ page }) => {
  await openIceberg(page, 'view=orbit');
  const heights = () => page.locator('article[data-world-y]').evaluateAll(es => es.map(e => Number((e as HTMLElement).dataset.worldY)));
  const orbit = await heights();
  await selectItem(page);
  for (const [view, title] of [['arc', 'Arc'], ['list', 'List'], ['orbit', 'Orbit']] as const) {
    await page.locator('.iceberg-viewer__view-trigger').click();
    await page.getByRole('menuitemradio', { name: title, exact: true }).click();
    await settle(page);
    await expect(page.locator('#iceberg')).toHaveAttribute('data-iceberg-view', view);
    await expect(page.locator('.is-pinned')).toHaveAttribute('data-slug', 'entry-56');
    expect(new URL(page.url()).searchParams.get('item')).toBe('entry-56');
    const placed = await heights();
    if (view !== 'list') placed.forEach((y, i) => expect(y).toBeCloseTo(orbit[i], 8));
    else {
      expect(placed[0]).toBeCloseTo(orbit[0]);
      expect(placed.at(-1)!).toBeCloseTo(orbit.at(-1)!);
      const gap = placed[0] - placed[1];
      for (let i = 1; i < placed.length; i++) expect(placed[i - 1] - placed[i]).toBeCloseTo(gap);
      const centers = await page.locator('article:not([hidden]) .iceberg-viewer__item-name').evaluateAll(es => es.map(e => { const r = e.getBoundingClientRect(); return r.x + r.width / 2; }));
      for (const x of centers) expect(x).toBeCloseTo(page.viewportSize()!.width / 2, 0);
    }
    await page.mouse.move(8, 300);
    await page.mouse.wheel(0, 120);
    await settle(page);
    expect(await heights()).toEqual(placed);
    await noScrollbars(page);
  }
});

test('horizontal wheel gestures enforce Arc and List rotation limits', async ({ page }) => {
  const x = () => page.locator('article[data-slug="entry-56"]').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m41);
  for (const view of views) {
    await openIceberg(page, `view=${view}&item=entry-56`);
    const initial = await x();
    await page.mouse.move(8, 300);
    await page.mouse.wheel(view === 'orbit' ? 80 : 5000, 0);
    await settle(page);
    const turned = await x();
    if (view === 'list') expect(turned).toBeCloseTo(initial, 0);
    else expect(Math.abs(turned - initial)).toBeGreaterThan(1);
    if (view === 'arc') {
      await page.mouse.wheel(5000, 0);
      await settle(page);
      expect(await x()).toBeCloseTo(turned, 0);
      await page.mouse.wheel(-10000, 0);
      await settle(page);
      expect((await x() - initial) * (turned - initial)).toBeLessThan(0);
    }
    await noScrollbars(page);
  }
});

test('native touch swipes over descriptions and taps remain usable', async ({ page, browserName, isMobile }) => {
  test.skip(browserName !== 'chromium' || !isMobile, 'Native CDP touch injection is Chrome-only; all four profiles run layout and wheel tests.');
  await openIceberg(page, 'view=list');
  await selectItem(page);
  const before = await labelY(page, 'entry-56');
  const card = await page.locator('.is-pinned .iceberg-viewer__item-details').boundingBox();
  const x = card!.x + card!.width / 2, y = card!.y + 80;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 5; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - i * 12 }] });
    await page.clock.runFor(30);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  // Simulate inertia only until the projected label stops moving. Rendering
  // a fixed 1.8s of frames wastes software-GPU work after the gesture settles.
  let previous = await labelY(page, 'entry-56'), stable = 0;
  for (let i = 0; i < 32 && stable < 2; i++) {
    await page.clock.runFor(64);
    const current = await labelY(page, 'entry-56');
    stable = current === previous ? stable + 1 : 0;
    previous = current;
  }
  expect(stable, 'touch inertia settles').toBe(2);
  await expect.poll(() => labelY(page, 'entry-56')).toBeLessThan(before - 2);
  await settle(page);
  await noScrollbars(page);
  await selectItem(page);
  await page.locator('.is-pinned .iceberg-viewer__item-close').tap();
  await expect(page.locator('.is-pinned')).toHaveCount(0);
});

// Exercise the production render loop, including the elapsed-time value passed
// to easing: a unit test of easeCamera alone cannot catch a caller's time cap.
test('camera easing follows elapsed time even when frames are sparse', async ({ page }) => {
  const positions: number[] = [];
  for (const dense of [true, false]) {
    await openIceberg(page, 'view=list&item=entry-23');
    await page.keyboard.press('Escape');
    await page.locator('canvas').focus();
    // Start on the clock's 16ms RAF boundary, so both paths advance exactly
    // the same elapsed time rather than including a partial initial frame.
    await page.clock.runFor(16 - await page.evaluate(() => performance.now() % 16));
    const initial = await labelY(page, 'entry-23');
    await page.keyboard.press('ArrowDown');
    // Two 32ms frames and one 64ms frame must produce the same result.
    if (dense) { await page.clock.fastForward(32); await page.clock.fastForward(32); }
    else await page.clock.fastForward(64);
    await expect(page.locator('article[data-slug="entry-23"]')).toBeVisible();
    const current = await labelY(page, 'entry-23');
    expect(current).toBeLessThan(initial - 5);
    positions.push(current);
  }
  expect(positions[1]).toBeCloseTo(positions[0], 0);
});

test('idle animation slows, stops, and resumes on keyboard input', async ({ page }) => {
  await openIceberg(page, 'view=list');
  await page.locator('canvas').focus();
  await page.keyboard.press('Home');
  const frames = () => page.evaluate(() => window.icebergTest.frameCount);
  await page.clock.fastForward(14_000);
  let before = await frames();
  await page.clock.runFor(64);
  expect(await frames() - before).toBeGreaterThanOrEqual(3);
  await page.clock.fastForward(1_000);
  before = await frames();
  await page.clock.runFor(400);
  expect(await frames() - before).toBeGreaterThan(0);
  expect(await frames() - before).toBeLessThanOrEqual(4);
  await page.clock.fastForward(5_000);
  before = await frames();
  await page.clock.fastForward(60_000);
  expect(await frames()).toBe(before);
  await page.keyboard.press('ArrowDown');
  await page.clock.runFor(64);
  expect(await frames() - before).toBeGreaterThanOrEqual(3);
});

test('disposing removes the renderer and overlays without browser errors', async ({ page }) => {
  await openIceberg(page);
  await page.evaluate(() => window.icebergTest.controller.dispose());
  await expect(page.locator('#iceberg > *')).toHaveCount(0);
  await page.mouse.wheel(0, 100);
  await page.keyboard.press('Escape');
  await noScrollbars(page);
});

// A page-sized jump can hide the old anchor in one frame. Its DOM transform
// then deliberately stops updating; use the visible world heights to verify
// direction rather than treating an offscreen label's stale transform as motion.
async function highestVisibleWorldY(page: import('@playwright/test').Page) {
  const highest = await page.locator('article[data-world-y]:not([hidden])').evaluateAll(es =>
    Math.max(...es.map(el => Number((el as HTMLElement).dataset.worldY))));
  expect(Number.isFinite(highest), 'the iceberg still has visible labels').toBe(true);
  return highest;
}
