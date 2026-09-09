import { test, expect, views, openIceberg, labelY, noScrollbars } from './helpers';

const percentile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)];

for (const view of views) {
  test(`${view}: sustained scrolling stays within the frame budget`, async ({ page }, testInfo) => {
    const ci = process.env.ICEBERG_PERF_PROFILE === 'ci';
    await openIceberg(page, `view=${view}&item=entry-23&benchmark`); // Real time and animated water.
    await page.keyboard.press('Escape');
    await page.mouse.move(page.viewportSize()!.width / 2, page.viewportSize()!.height / 2);
    await page.evaluate(() => window.icebergTest.resumeRendering());
    const idle = await sampleFrames(page, 1000, 20);
    const idleSamples = idle.samples;
    expect(idleSamples.length, 'idle renderer keeps producing frames').toBeGreaterThanOrEqual(20);
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
    // Keep a native wheel probe, but don't serialize the benchmark behind 90
    // driver acknowledgements. Generate the sustained workload in the page so
    // browser protocol latency cannot insert idle gaps into the measurement.
    const nativeStart = performance.now();
    await page.mouse.wheel(0, 10);
    const nativeWheelAcknowledgementMs = performance.now() - nativeStart;
    const scrolling = await sampleFrames(page, Math.min(12000, Math.max(2000, idleFrameP95 * 36)), 31, 900);
    const samples = scrolling.samples;
    const frames = samples.map(s => s.interval), work = samples.map(s => s.work);
    const metrics = {
      browser: testInfo.project.name, view, samples: samples.length,
      input: 'native probe plus in-page wheel stream',
      nativeWheelAcknowledgementMs, wheelEvents: scrolling.events,
      idleDurationMs: idle.duration, scrollDurationMs: scrolling.duration,
      deviceScaleFactor: testInfo.project.use.deviceScaleFactor,
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

/** Sample real rendered frames. No virtual clock is installed in these tests. */
async function sampleFrames(page: import('@playwright/test').Page, duration: number, minimum: number, scrollPixels = 0) {
  return page.evaluate(async ({ duration, minimum, scrollPixels }) => {
    const fixture = window.icebergTest;
    const start = performance.now(), firstFrame = fixture.frameCount;
    let sent = 0, events = 0;
    fixture.startMeasurement();
    while (performance.now() - start < duration || fixture.frameCount - firstFrame <= minimum) {
      await new Promise(resolve => setTimeout(resolve, 16));
      const elapsed = performance.now() - start;
      if (elapsed > 20000) throw new Error('Renderer stopped producing performance samples');
      const due = scrollPixels * Math.min(1, elapsed / duration);
      if (due > sent) {
        const x = innerWidth / 2, y = innerHeight / 2;
        const target = document.elementFromPoint(x, y)!;
        target.dispatchEvent(new WheelEvent('wheel', { deltaY: due - sent, clientX: x, clientY: y, bubbles: true, cancelable: true }));
        sent = due;
        events++;
      }
    }
    if (scrollPixels) fixture.pauseRendering();
    return { samples: fixture.endMeasurement(), duration: performance.now() - start, events };
  }, { duration, minimum, scrollPixels });
}
