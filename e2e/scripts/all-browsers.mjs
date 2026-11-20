/**
 * `pnpm e2e:all [playwright args]` — the e2e suite in Chromium, Firefox and WebKit, one browser
 * after another, each in its own Playwright run. Every run starts its own servers, which reset and
 * seed the e2e database (widget_e2e), so each browser starts from the same data, as in CI (one job
 * per browser). A single run with all three projects would share one database: a test that
 * publishes in Chromium would leave its values for the same test in WebKit.
 *
 * Browsers: E2E_BROWSERS=chromium,webkit (default: all three). Extra arguments go to Playwright,
 * e.g. `pnpm e2e:all tests/admin-audit.spec.ts`.
 */
import { spawnSync } from 'node:child_process';

const browsers = (process.env.E2E_BROWSERS ?? 'chromium,firefox,webkit')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);
const extra = process.argv.slice(2);

const results = [];
for (const browser of browsers) {
  console.log(`\n=== ${browser} ===`);
  const run = spawnSync('pnpm', ['exec', 'playwright', 'test', `--project=${browser}`, ...extra], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, E2E_ALL_BROWSERS: '1' },
  });
  results.push({ browser, ok: run.status === 0 });
}

console.log('\n=== summary ===');
for (const { browser, ok } of results) console.log(`${browser}: ${ok ? 'passed' : 'FAILED'}`);
process.exitCode = results.every((result) => result.ok) ? 0 : 1;
