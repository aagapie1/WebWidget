import { defineConfig, devices } from '@playwright/test';
import { DIFY, DIFY_KEY, GATEWAY } from './constants.js';

/**
 * Locally only Chromium runs by default; set E2E_ALL_BROWSERS=1 to add Firefox and WebKit
 * (required before the final commit of a stage).
 */
const allBrowsers = process.env.E2E_ALL_BROWSERS === '1';

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 30_000,
  use: { trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'node servers.mjs',
      url: `${DIFY}/__requests`,
      reuseExistingServer: false,
      env: { E2E_GATEWAY: GATEWAY },
    },
    {
      command: 'pnpm --dir ../gateway exec tsx src/index.ts',
      url: `${GATEWAY}/healthz`,
      reuseExistingServer: false,
      env: {
        // Both 127.0.0.1 and ::1: browsers may resolve localhost to either.
        HOST: 'localhost',
        PORT: '3100',
        LOG_LEVEL: 'warn',
        PUBLIC_ORIGIN: GATEWAY,
        TENANTS_DIR: '../e2e/tenants',
        WIDGET_DIST_DIR: '../widget/dist',
        VISITOR_COOKIE_SECRET: 'e2e-cookie-secret-at-least-32-characters',
        DIFY_BASE_URL: `${DIFY}/v1`,
        DIFY_API_KEY_E2E: DIFY_KEY,
      },
    },
  ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(allBrowsers
      ? [
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        ]
      : []),
  ],
});
