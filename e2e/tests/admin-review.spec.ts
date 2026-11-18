import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN, ADMIN_E2E } from '../constants.js';

/**
 * Review screenshots of the admin interface (docs/review/admin/), on the e2e test tenant — never
 * real client data. Run on demand: E2E_ADMIN=1 REVIEW=1 playwright test admin-review --project
 * chromium. Development test user (deploy/keycloak/README.md).
 */
test.skip(!ADMIN_E2E || process.env.REVIEW !== '1', 'review screenshots on demand (REVIEW=1)');

const OUT = '../docs/review/admin';

async function signIn(page: Page): Promise<void> {
  await page.goto(`${ADMIN}/admin/?org=pilot`);
  await page.getByRole('button', { name: 'Continuă spre autentificare' }).click();
  await page.locator('#username').fill('pilot-admin');
  await page.locator('#password').fill('dev-pilot-admin-Pass1');
  await page.locator('#kc-login').click();
  await page.waitForURL(`${ADMIN}/admin/**`);
}

async function ready(page: Page): Promise<void> {
  await expect(page.getByLabel('Numele clientului')).toBeVisible();
  const chat = page
    .frameLocator('iframe[title="Previzualizarea widget-ului cu ciorna"]')
    .frameLocator('iframe[title="Asistent virtual"]');
  await expect(chat.getByText('Care este programul cu publicul?')).toBeVisible();
  await page.waitForTimeout(500); // the window's opening animation
}

test('admin interface at 1280x720, 1440x900 and 1920x1080', async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync(OUT, { recursive: true });
  await signIn(page);
  for (const [width, height] of [
    [1280, 720],
    [1440, 900],
    [1920, 1080],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(`${ADMIN}/admin/`);
    await ready(page);
    await page.screenshot({ path: `${OUT}/${String(width)}x${String(height)}.png` });
    // The preview always fits the window, below the sticky status bar.
    const canvas = await page.locator('.preview__canvas').boundingBox();
    expect((canvas?.y ?? 0) + (canvas?.height ?? 0)).toBeLessThanOrEqual(height);
  }

  // Scrolled into the form: the status bar and the preview stay in view.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${ADMIN}/admin/`);
  await ready(page);
  await page.getByLabel('Poziție', { exact: true }).focus();
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/1280x720-scrolled-launcher.png` });

  // Phone frame (390x844), scaled to fit.
  await page.getByRole('button', { name: 'Telefon' }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/1280x720-phone.png` });

  // Below 1280 px: the preview opens as a side panel.
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto(`${ADMIN}/admin/`);
  await expect(page.getByLabel('Numele clientului')).toBeVisible();
  await page.screenshot({ path: `${OUT}/1100x800-panel-closed.png` });
  await page.getByRole('button', { name: 'Previzualizare' }).click();
  await ready(page);
  await page.screenshot({ path: `${OUT}/1100x800-panel-open.png` });
});
