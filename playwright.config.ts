import { defineConfig } from '@playwright/test';

const mobile = { width: 390, height: 844 };
const desktop = { width: 1280, height: 900 };

export default defineConfig({
  testDir: './tests/browser',
  outputDir: process.env.CI ? 'test-results/ci' : 'test-results/local',
  testMatch: '**/*.spec.ts',
  // Performance measurements must not compete with another renderer.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: Number(process.env.ICEBERG_TEST_TIMEOUT ?? (process.env.CI ? 120_000 : 45_000)),
  expect: { timeout: 10_000, toHaveScreenshot: { animations: 'disabled', maxDiffPixelRatio: 0.002 } },
  updateSnapshots: 'none',
  snapshotPathTemplate: '{testDir}/screenshots/{platform}/{projectName}/{arg}{ext}',
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4179',
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'chrome-desktop', use: { browserName: 'chromium', channel: process.env.ICEBERG_CHROME_CHANNEL ?? 'chromium', viewport: desktop } },
    { name: 'chrome-mobile', use: { browserName: 'chromium', channel: process.env.ICEBERG_CHROME_CHANNEL ?? 'chromium', viewport: mobile, isMobile: true, hasTouch: true } },
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
