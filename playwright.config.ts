import { defineConfig } from '@playwright/test';

const mobile = { width: 390, height: 844 };
const desktop = { width: 1280, height: 900 };
// CI has no hardware GPU. Mesa avoids SwiftShader's costly software command
// path; local hardware runs retain the browser's normal graphics backend.
const chromeLaunch = process.env.CI ? {
  args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'],
} : undefined;
const chromeUse = {
  browserName: 'chromium' as const,
  channel: process.env.ICEBERG_CHROME_CHANNEL ?? 'chromium',
  launchOptions: chromeLaunch,
};

export default defineConfig({
  testDir: './tests/browser',
  outputDir: process.env.CI ? 'test-results/ci' : 'test-results/local',
  testMatch: '**/*.spec.ts',
  // Performance measurements must not compete with another renderer.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Report the first failure promptly rather than repeating a shared setup or
  // rendering failure for every case in the same isolated CI browser job.
  maxFailures: process.env.CI ? 1 : 0,
  timeout: Number(process.env.ICEBERG_TEST_TIMEOUT ?? (process.env.CI ? 240_000 : 45_000)),
  expect: { timeout: 10_000, toHaveScreenshot: { animations: 'disabled', maxDiffPixelRatio: 0.002 } },
  updateSnapshots: 'none',
  snapshotPathTemplate: '{testDir}/screenshots/{platform}/{projectName}/{arg}{ext}',
  reporter: [['list'], ['html', { open: 'never' }], ['./tests/browser/timing-reporter.ts']],
  use: {
    baseURL: 'http://127.0.0.1:4179',
    // Hosted runners have no GPU. Keep CSS geometry intact while bounding
    // software fill cost; visual tests explicitly restore full resolution.
    deviceScaleFactor: process.env.ICEBERG_PERF_PROFILE === 'ci' ? 0.25 : 1,
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'UTC',
    // Continuous trace screenshots force GPU readbacks and distort frame
    // measurements. Keep DOM/network traces and explicit failure screenshots.
    trace: { mode: 'retain-on-failure', screenshots: false },
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'chrome-desktop', use: { ...chromeUse, viewport: desktop } },
    { name: 'chrome-mobile', use: { ...chromeUse, viewport: mobile, isMobile: true, hasTouch: true } },
    { name: 'firefox-desktop', use: { browserName: 'firefox', viewport: desktop } },
    // Firefox supports viewport/touch testing, but not Playwright's isMobile option.
    { name: 'firefox-mobile', use: { browserName: 'firefox', viewport: mobile, hasTouch: true } },
  ],
  webServer: {
    command: 'bun tests/browser/server.ts',
    url: 'http://127.0.0.1:4179/health',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
