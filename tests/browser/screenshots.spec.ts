import { test, expect, views, openIceberg, noScrollbars, settle } from './helpers';

test.use({ deviceScaleFactor: 1, controlledClock: true });

for (const view of views) {
  test(`${view}: visual baseline`, async ({ page }, testInfo) => {
    await openIceberg(page, `view=${view}&still&visual`);
    // These reviewed Chrome desktop surface images include a hover preview.
    // Set it explicitly instead of depending on Xvfb's initial pointer position.
    if (testInfo.project.name === 'chrome-desktop' && view !== 'arc') {
      await page.locator('article[data-slug="entry-7"] .iceberg-viewer__item-name').hover();
      await settle(page);
    }
    const frame = await page.evaluate(() => window.icebergTest.frameCount);
    await expect(page).toHaveScreenshot(`${view}-surface.png`);
    expect(await page.evaluate(() => window.icebergTest.frameCount), 'static screenshots stop rendering').toBe(frame);
    // Reset through the public view/deep-link API while retaining loaded assets.
    await openIceberg(page, `view=${view}&still&visual&item=entry-56`);
    await page.keyboard.press('Escape');
    await expect(page).toHaveScreenshot(`${view}-underwater.png`);
  });
}

test('selector and description visual baselines', async ({ page }) => {
  await openIceberg(page, 'view=list&still&visual&item=entry-56');
  await noScrollbars(page);
  await expect(page.locator('.is-pinned .iceberg-viewer__item-details')).toHaveScreenshot('description.png');
  await page.locator('.iceberg-viewer__view-trigger').click();
  await expect(page.getByRole('menu')).toHaveScreenshot('view-menu.png');
});
