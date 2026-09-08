import { test, expect, views, openIceberg, selectItem, labelY, noScrollbars } from './helpers';

const percentile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)];

for (const view of views) {
  test(`${view}: sustained scrolling stays within the frame budget`, async ({ page }, testInfo) => {
    const ci = process.env.ICEBERG_PERF_PROFILE === 'ci';
    await openIceberg(page, `view=${view}`); // Water is animated in performance runs.
    await selectItem(page, 'entry-23');
    await page.keyboard.press('Escape');
    await page.mouse.move(page.viewportSize()!.width / 2, page.viewportSize()!.height / 2);
    // Warm up shaders and font uploads before measuring the scrolling path.
    await page.waitForTimeout(1000);
    await page.evaluate(() => window.icebergTest.startMeasurement());
    await page.waitForTimeout(ci ? 3000 : 1500);
    const idleSamples = await page.evaluate(() => window.icebergTest.endMeasurement());
    expect(idleSamples.length, 'idle renderer keeps producing frames').toBeGreaterThan(6);
    const idleFrameP95 = percentile(idleSamples.map(s => s.interval), .95);
    const idleWorkP95 = percentile(idleSamples.map(s => s.work), .95);
    const slowThreshold = ci ? Math.max(50, idleFrameP95 * 1.25 + 10) : 50;
    const limits = {
      frameP95: ci ? Math.min(500, Math.max(100, idleFrameP95 * 1.35 + 10)) : 34,
      frameMax: ci ? 1000 : 200,
      workP95: ci ? Math.min(50, Math.max(12, idleWorkP95 + 8)) : 16,
      slowFrameRatio: ci ? .15 : .05,
    };
    const start = await labelY(page, 'entry-23');
    await page.evaluate(() => window.icebergTest.startMeasurement());
    for (let i = 0; i < 90; i++) {
      await page.mouse.wheel(0, 10);
      await page.waitForTimeout(24);
    }
    const samples = await page.evaluate(() => window.icebergTest.endMeasurement());
    const frames = samples.map(s => s.interval), work = samples.map(s => s.work);
    const metrics = {
      browser: testInfo.project.name, view, samples: samples.length,
      frameP50: percentile(frames, .5), frameP95: percentile(frames, .95), frameMax: Math.max(...frames),
      workP95: percentile(work, .95), workMax: Math.max(...work),
      idleFrameP95, idleWorkP95, slowThreshold,
      slowFrameRatio: frames.filter(ms => ms > slowThreshold).length / frames.length,
    };
    await testInfo.attach('scroll-performance.json', { body: JSON.stringify({ metrics, limits, samples, idleSamples }, null, 2), contentType: 'application/json' });
    console.log(JSON.stringify(metrics));
    // Software WebGL's fill rate is machine-dependent. CI checks added scroll
    // overhead against the same scene at rest, with absolute ceilings as well.
    // Native hardware runs retain the strict, absolute interactive budgets.
    expect(samples.length, 'renderer keeps producing frames').toBeGreaterThan(30);
    expect(metrics.frameP95).toBeLessThan(limits.frameP95);
    expect(metrics.frameMax).toBeLessThan(limits.frameMax);
    expect(metrics.workP95).toBeLessThan(limits.workP95);
    expect(metrics.slowFrameRatio).toBeLessThan(limits.slowFrameRatio);
    expect(await labelY(page, 'entry-23'), 'scrolling actually moved the labels').toBeLessThan(start - 10);
    await noScrollbars(page);
  });
}
