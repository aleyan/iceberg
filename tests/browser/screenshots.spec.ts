import { test, expect, views, openIceberg, noScrollbars } from './helpers';

for (const view of views) {
  test(`${view}: visual baseline`, async ({ page }) => {
    await openIceberg(page, `view=${view}&still&visual`);
    await page.evaluate(() => window.icebergTest.pauseRendering());
    await expect(page).toHaveScreenshot(`${view}-surface.png`);
    // A deep-linked mount gives an exact camera pose without timing an animation.
    await openIceberg(page, `view=${view}&still&visual&item=entry-56`);
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.icebergTest.pauseRendering());
    await expect(page).toHaveScreenshot(`${view}-underwater.png`);
  });
}

test('selector and description visual baselines', async ({ page }) => {
  await openIceberg(page, 'view=list&still&visual&item=entry-56');
  await noScrollbars(page);
  await page.evaluate(() => window.icebergTest.pauseRendering());
  await expect(page.locator('.is-pinned .iceberg-viewer__item-details')).toHaveScreenshot('description.png');
  await page.locator('.iceberg-viewer__view-trigger').click();
  await expect(page.getByRole('menu')).toHaveScreenshot('view-menu.png');
});
