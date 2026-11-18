import { defineConfig, devices } from '@playwright/test';
import { ADMIN, ADMIN_E2E, DIFY, DIFY_KEY, GATEWAY } from './constants.js';

/**
 * Locally only Chromium runs by default; set E2E_ALL_BROWSERS=1 to add Firefox and WebKit
 * (required before the final commit of a stage).
 */
const allBrowsers = process.env.E2E_ALL_BROWSERS === '1';

/**
 * Admin interface gateway (E4b.1): resets and seeds the widget_e2e database, then starts with
 * Postgres, Redis and the development Keycloak. Test values only.
 */
function adminServer() {
  const gateway = (args: string) => `pnpm --dir ../gateway exec tsx ${args}`;
  return {
    command: [
      gateway('src/cli/db.ts migrate'),
      gateway('src/cli/db.ts reset-test'),
      gateway('src/cli/db.ts seed ../e2e/admin/tenants'),
      gateway('src/index.ts'),
    ].join(' && '),
    url: `${ADMIN}/healthz`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      HOST: 'localhost',
      PORT: '3200',
      LOG_LEVEL: 'warn',
      PUBLIC_ORIGIN: ADMIN,
      TENANT_SOURCE: 'postgres',
      DATABASE_URL: 'postgres://widget_app:dev-widget-app@localhost:55432/widget_e2e',
      DATABASE_OWNER_URL: 'postgres://widget_owner:dev-widget-owner@localhost:55432/widget_e2e',
      REDIS_URL: 'redis://localhost:6379',
      ADMIN_AUTH_CONFIG: '../e2e/admin/admin-auth.yaml',
      ADMIN_OIDC_SECRET_PILOT: 'dev-secret-pilot-admin-ui',
      ADMIN_OIDC_SECRET_DEMO_PRIMARIE: 'dev-secret-demo-primarie-admin-ui',
      ADMIN_OIDC_SECRET_PLATFORM: 'dev-secret-platform-admin-ui',
      // Many logins from one address during a run (production default: 30 per 10 minutes).
      ADMIN_LOGIN_LIMIT: '1000',
      WIDGET_DIST_DIR: '../widget/dist',
      ADMIN_DIST_DIR: '../admin/dist',
      VISITOR_COOKIE_SECRET: 'e2e-cookie-secret-at-least-32-characters',
      DIFY_BASE_URL: `${DIFY}/v1`,
      DIFY_API_KEY_E2E: DIFY_KEY,
    },
  };
}

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  // In CI, failures also become GitHub annotations (readable without access to the logs).
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
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
        PORT: '3101',
        LOG_LEVEL: 'warn',
        PUBLIC_ORIGIN: GATEWAY,
        TENANTS_DIR: '../e2e/tenants',
        WIDGET_DIST_DIR: '../widget/dist',
        VISITOR_COOKIE_SECRET: 'e2e-cookie-secret-at-least-32-characters',
        DIFY_BASE_URL: `${DIFY}/v1`,
        DIFY_API_KEY_E2E: DIFY_KEY,
      },
    },
    ...(ADMIN_E2E ? [adminServer()] : []),
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
