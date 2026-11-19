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
  // The sign-in screens (E4b.1 UX 16, 17): the known organisation, the fallback, Keycloak.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${ADMIN}/admin/?org=nu-exista`);
  await expect(page.getByLabel('Codul organizației')).toBeVisible();
  await page.screenshot({ path: `${OUT}/login-fallback.png` });
  await page.goto(`${ADMIN}/admin/?org=pilot`);
  await expect(page.locator('.login__org')).toBeVisible();
  await page.screenshot({ path: `${OUT}/login-org-known.png` });
  await page.getByRole('button', { name: 'Continuă spre autentificare' }).click();
  await expect(page.locator('#widget-logo')).toBeVisible();
  await page.waitForTimeout(300); // fonts
  await page.screenshot({ path: `${OUT}/keycloak-pilot-ro.png` });
  // A wrong password: the message, in Romanian, on the same themed page.
  await page.locator('#username').fill('pilot-admin');
  await page.locator('#password').fill('parola-gresita');
  await page.locator('#kc-login').click();
  await expect(page.locator('#input-error-username')).toBeVisible();
  await page.screenshot({ path: `${OUT}/keycloak-wrong-password.png` });
  await page.locator('#username').fill('pilot-admin');
  await page.locator('#password').fill('dev-pilot-admin-Pass1');
  await page.locator('#kc-login').click();
  await page.waitForURL(`${ADMIN}/admin/**`);
}

async function ready(page: Page): Promise<void> {
  await expect(page.getByLabel('Numele clientului')).toBeVisible();
  const chat = page
    .frameLocator('iframe[title="Previzualizarea asistentului cu ciorna"]')
    .frameLocator('iframe[title="Asistent virtual"]');
  await expect(chat.getByText('Care este programul cu publicul?')).toBeVisible();
  await page.waitForTimeout(500); // the window's opening animation
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Zone de configurare' });

/** The three review views of the P2 frame: Identitate, Culori, Integrare pe site. */
const VIEWS: { file: string; open: (page: Page) => Promise<void> }[] = [
  { file: 'identitate', open: () => Promise.resolve() },
  {
    file: 'culori',
    open: async (page) => {
      await nav(page).getByRole('link', { name: 'Culori', exact: true }).click();
      await page.waitForTimeout(400);
    },
  },
  {
    file: 'integrare',
    open: async (page) => {
      await nav(page).getByRole('link', { name: 'Integrare pe site', exact: true }).click();
      await expect(page.locator('#section-integration')).toBeVisible();
    },
  },
];

test('admin interface at 1280x720, 1440x900 and 1920x1080', async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(OUT, { recursive: true });
  await signIn(page);
  for (const [width, height] of [
    [1280, 720],
    [1440, 900],
    [1920, 1080],
  ] as const) {
    await page.setViewportSize({ width, height });
    for (const view of VIEWS) {
      await page.goto(`${ADMIN}/admin/`);
      await ready(page);
      await view.open(page);
      await page.screenshot({ path: `${OUT}/${String(width)}x${String(height)}-${view.file}.png` });
      // The preview always fits the window, below the sticky status bar.
      const canvas = await page.locator('.preview__canvas').boundingBox();
      expect((canvas?.y ?? 0) + (canvas?.height ?? 0)).toBeLessThanOrEqual(height);
    }
  }

  // Editing the launcher: the window closes, the launcher stays in view.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${ADMIN}/admin/`);
  await ready(page);
  await nav(page).getByRole('link', { name: 'Buton de pornire', exact: true }).click();
  await page.getByLabel('Poziție', { exact: true }).focus();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/1280x720-launcher.png` });

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

  // Tablet (E4b.1 UX 19): 1024 px with the sidebar, 768 px with the row of areas.
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(`${ADMIN}/admin/`);
  await expect(page.getByLabel('Numele clientului')).toBeVisible();
  await nav(page).getByRole('link', { name: 'Culori', exact: true }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/1024x768-culori.png` });
  await page.getByRole('button', { name: 'Previzualizare', exact: true }).click();
  await ready(page);
  await page.screenshot({ path: `${OUT}/1024x768-preview-open.png` });

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto(`${ADMIN}/admin/`);
  await expect(page.getByLabel('Numele clientului')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/768x1024-identitate.png` });

  // The controls reference (docs/review/admin/controls.md): the "Domenii permise" area.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${ADMIN}/admin/`);
  await nav(page)
    .getByRole('link', { name: /^Domenii permise/ })
    .click();
  await expect(page.getByRole('button', { name: 'Adaugă domeniu' })).toBeVisible();
  await expect(
    page
      .frameLocator('iframe[title="Previzualizarea asistentului cu ciorna"]')
      .frameLocator('iframe[title="Asistent virtual"]')
      .getByText('Care este programul cu publicul?'),
  ).toBeVisible();
  await page.waitForTimeout(700); // the window's opening animation
  await page.screenshot({ path: `${OUT}/controls.png` });
});
