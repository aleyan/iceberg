import { test as base, expect, type Page } from '@playwright/test';
import type {} from './fixture/main';

export const test = base.extend<{ browserErrors: void }>({
  browserErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await use();
    expect(errors, 'uncaught browser errors').toEqual([]);
  }, { auto: true }],
});
export { expect };
export const views = ['orbit', 'arc', 'list'] as const;

export async function openIceberg(page: Page, query = '') {
  await page.goto('/?' + query);
  await page.waitForFunction(() => window.icebergTest?.ready, undefined, { polling: 50 });
  await page.locator('.iceberg-viewer__loading').waitFor({ state: 'detached' });
  await settle(page);
}

export async function settle(page: Page) {
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
