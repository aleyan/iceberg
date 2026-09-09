import { test as base, expect, type Page } from '@playwright/test';
import type {} from './fixture/main';

const controlledPages = new WeakSet<Page>();
type Scene = { page: Page; context: import('@playwright/test').BrowserContext };
export const test = base.extend<{ browserErrors: void; controlledClock: boolean }, { scenes: Map<string, Scene> }>({
  controlledClock: [false, { option: true }],
  scenes: [async ({}, use) => {
    const scenes = new Map<string, Scene>();
    await use(scenes);
    for (const { context } of scenes.values()) await context.close();
  }, { scope: 'worker' }],
  page: async ({ context: isolatedContext, browser, scenes, controlledClock, viewport, deviceScaleFactor, isMobile, hasTouch, baseURL, colorScheme, locale, timezoneId }, use) => {
    if (!controlledClock) { const page = await isolatedContext.newPage(); await use(page); return; }
    const options = { viewport, deviceScaleFactor, isMobile, hasTouch, baseURL, colorScheme, locale, timezoneId };
    const key = JSON.stringify(options);
    let scene = scenes.get(key);
    if (!scene) {
      // Playwright 1.63's artifact recorder also tracks browser.newContext and
      // starts a new trace chunk per test, including on these reused contexts.
      // Do not start a second manual tracing session here.
      const context = await browser.newContext(options);
      const page = await context.newPage();
      const epoch = new Date('2026-01-01T00:00:00Z');
      await page.clock.install({ time: epoch });
      await page.clock.pauseAt(epoch);
      controlledPages.add(page);
      scene = { page, context };
      scenes.set(key, scene);
    }
    if (viewport) await scene.page.setViewportSize(viewport);
    await scene.page.mouse.move(0, 0);
    await use(scene.page);
  },
  browserErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    const onError = (error: Error) => errors.push(error.message);
    page.on('pageerror', onError);
    await use();
    page.off('pageerror', onError);
    expect(errors, 'uncaught browser errors').toEqual([]);
  }, { auto: true }],
});
export { expect };
export const views = ['orbit', 'arc', 'list'] as const;

export async function openIceberg(page: Page, query = '') {
  if (controlledPages.has(page)) {
    const params = new URLSearchParams(query);
    // The clock, rather than a second RAF interceptor, controls static renders.
    params.delete('visual');
    params.set('still', '');
    const mounted = await page.evaluate(() => !!window.icebergTest && !!document.querySelector('#iceberg canvas'));
    if (!mounted) {
      await page.goto('/?' + params);
      await expect.poll(() => page.evaluate(() => window.icebergTest?.assetsLoaded), { intervals: [10, 25, 50] }).toBe(true);
    }
    await page.evaluate(query => {
      // Reset public viewer state, embedding, selection, focus, and orientation.
      // Keep the renderer/assets; no private camera or input handlers are mocked.
      const params = new URLSearchParams(query);
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      document.body.classList.toggle('embedded', params.has('embedded'));
      window.scrollTo(0, 0);
      history.replaceState(null, '', '/?' + params);
    }, params.toString());
    // Classic scrollbars change the viewer width when embedding is toggled.
    // Wait for its real resize observer before rebuilding label placements.
    await expect.poll(() => page.evaluate(() => {
      const host = document.querySelector('#iceberg')!.getBoundingClientRect();
      const canvas = document.querySelector('canvas')!;
      const ratio = Math.min(devicePixelRatio, 1.75);
      return canvas.width === Math.floor(Math.round(host.width) * ratio)
        && canvas.height === Math.floor(Math.round(host.height) * ratio);
    }), { intervals: [10, 25, 50] }).toBe(true);
    await page.evaluate(() => {
      const params = new URLSearchParams(location.search);
      dispatchEvent(new PopStateEvent('popstate'));
      const view = (params.get('view') ?? 'orbit') as import('../../src/index').IcebergView;
      const controller = window.icebergTest.controller;
      controller.setView(view === 'list' ? 'orbit' : 'list');
      controller.setView(view);
      const canvas = document.querySelector('canvas')!;
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      if (!params.has('item')) canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    });
    await settle(page);
    return;
  }
  await page.goto('/?' + query);
  await page.waitForFunction(() => window.icebergTest?.ready, undefined, { polling: 50 });
  await page.locator('.iceberg-viewer__loading').waitFor({ state: 'detached' });
  if (!new URLSearchParams(query).has('benchmark')) await settle(page);
}

export async function settle(page: Page) {
  if (controlledPages.has(page)) {
    await page.clock.fastForward(2500);
    // Expanded cards need one more projection after their resize observer.
    // Plain labels are already positioned by the first frame.
    if (await page.evaluate(() => !!document.querySelector('.iceberg-viewer__item-details:not([hidden])'))) {
      await page.clock.runFor(16);
    }
    return;
  }
  // Require stable projections across actual rendered frames. On a software
  // GPU, six timer ticks can all occur before the next animation frame.
  await page.evaluate(async timeout => {
    let previous = '', stable = 0, lastFrame = -1, stableSince = performance.now();
    const deadline = performance.now() + timeout;
    while (performance.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
      const frame = window.icebergTest.frameCount;
      if (frame === lastFrame) continue;
      lastFrame = frame;
      const current = [...document.querySelectorAll<HTMLElement>('.iceberg-viewer__item:not([hidden])')]
        .map(e => e.dataset.slug + ':' + e.style.transform).join('|');
      if (current && current === previous) stable++;
      else { stable = 0; stableSince = performance.now(); }
      if (stable >= 2 && performance.now() - stableSince >= 150) return;
      previous = current;
    }
    throw new Error(`Iceberg did not settle within ${timeout}ms`);
  }, process.env.CI ? 20_000 : 5_000);
}

export async function selectItem(page: Page, slug = 'entry-56') {
  await page.evaluate(slug => {
    const url = new URL(location.href);
    url.searchParams.set('item', slug);
    history.replaceState(null, '', url);
    dispatchEvent(new PopStateEvent('popstate'));
  }, slug);
  await settle(page);
  await expect(page.locator(`article[data-slug="${slug}"].is-pinned`)).toBeVisible();
}

export async function noScrollbars(page: Page, includeDocument = true) {
  const offenders = await page.evaluate(includeDocument => {
    const host = document.querySelector<HTMLElement>('#iceberg')!;
    const errors: string[] = [];
    for (const el of [host, ...host.querySelectorAll<HTMLElement>('*')]) {
      if (!el.getClientRects().length) continue;
      const style = getComputedStyle(el);
      for (const axis of ['X', 'Y'] as const) {
        const overflow = style[`overflow${axis}`];
        const content = axis === 'X' ? el.scrollWidth : el.scrollHeight;
        const size = axis === 'X' ? el.clientWidth : el.clientHeight;
        if (overflow === 'scroll' || (['auto', 'overlay'].includes(overflow) && content > size + 1)) {
          errors.push(`${el.className || el.tagName}: ${axis} ${overflow} ${content}/${size}`);
        }
      }
      if (el.scrollLeft || el.scrollTop) errors.push(`${el.className}: nested scroll offset`);
    }
    if (includeDocument) {
      const root = document.scrollingElement!;
      if (root.scrollWidth > root.clientWidth + 1 || root.scrollHeight > root.clientHeight + 1) errors.push('document overflow');
      if (scrollX || scrollY) errors.push('document scroll offset');
    }
    return errors;
  }, includeDocument);
  expect(offenders, 'scrollbars or unintended scrolling').toEqual([]);
}

export async function labelY(page: Page, slug: string) {
  return page.locator(`article[data-slug="${slug}"]`).evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m42);
}
