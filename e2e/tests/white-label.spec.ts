import { expect, test, type Page } from '@playwright/test';
import { describe, serious, WCAG21_AA } from '../axe.js';
import { DIFY, GATEWAY, SITE } from '../constants.js';

test.beforeEach(async ({ page }) => {
  await page.request.get(`${DIFY}/__reset`);
});

const widget = (page: Page) => page.locator('[data-chat-widget="e2e-brand"]');
const launcher = (page: Page) => widget(page).locator('.launcher');
const chat = (page: Page) => page.frameLocator('iframe[title="Asistent virtual"]');

async function gotoBrand(page: Page): Promise<void> {
  await page.goto(`${SITE}/brand.html`);
  await expect(widget(page)).toHaveAttribute('data-ready', 'true');
}

test('the launcher uses the tenant look and position, loaded with CORS', async ({ page }) => {
  const loaderConfig = page.waitForResponse((r) => r.url().includes('/api/loader-config'));
  await gotoBrand(page);
  const response = await loaderConfig;
  expect(response.headers()['access-control-allow-origin']).toBe(SITE);

  await expect(launcher(page)).toHaveAttribute('aria-label', 'Deschide asistentul primăriei');
  const box = await launcher(page).boundingBox();
  const viewport = page.viewportSize();
  expect(box?.x).toBeLessThan((viewport?.width ?? 0) / 2); // bottom-left
  expect(Math.round(box?.x ?? 0)).toBe(20);
  await expect(launcher(page)).toHaveCSS('background-image', /rgb\(11, 110, 79\)/);
  await expect(widget(page).locator('.launcher__image')).toHaveAttribute(
    'src',
    new RegExp(`^${GATEWAY}/w/t/e2e-brand/[0-9a-f]{10}-logo\\.svg$`),
  );
});

test('the chat window uses the tenant colors, logo, name and texts', async ({ page }) => {
  await gotoBrand(page);
  await launcher(page).click();
  const header = chat(page).locator('.header');
  await expect(header.getByRole('heading', { name: 'Asistentul Primăriei' })).toBeVisible();
  await expect(header.getByText('Ghișeu online')).toBeVisible();
  await expect(header).toHaveCSS('background-image', /rgb\(11, 110, 79\)/);
  await expect(header.locator('.avatar__image')).toHaveAttribute('src', /-logo\.svg$/);
  await expect(chat(page).getByLabel('Mesajul dumneavoastră')).toHaveAttribute(
    'placeholder',
    'Întrebați primăria…',
  );

  // Computed style, not the bounding box: the opening animation briefly scales the panel.
  const panel = widget(page).locator('.panel');
  await expect(panel).toHaveCSS('width', '400px');
  // window.position is separate from the launcher: launcher left, window right.
  await expect(panel).toHaveCSS('right', '20px');
  const box = await panel.boundingBox();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeGreaterThan((page.viewportSize()?.width ?? 0) / 2);
});

test('optional user bubble and button colors are applied', async ({ page }) => {
  await gotoBrand(page);
  await launcher(page).click();
  const input = chat(page).getByLabel('Mesajul dumneavoastră');
  await input.fill('Care e programul?');
  await expect(chat(page).getByRole('button', { name: 'Trimite' })).toHaveCSS(
    'background-color',
    'rgb(138, 28, 28)',
  );
  await input.press('Enter');
  const bubble = chat(page).locator('.message--user .message__bubble');
  await expect(bubble).toHaveCSS('background-color', 'rgb(227, 241, 234)');
  await expect(bubble).toHaveCSS('color', 'rgb(11, 61, 44)');
});

test('a disabled tenant shows no launcher and its API answers tenant_disabled', async ({
  page,
}) => {
  const responses: number[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/api/loader-config')) responses.push(response.status());
  });
  await page.goto(`${SITE}/off.html`);
  await expect.poll(() => responses).toEqual([503]);
  await expect(page.locator('[data-chat-widget]')).toHaveCount(0);
  await page.waitForTimeout(2500); // past the idle preload: the chat must never load
  expect(page.frames().some((frame) => frame.url().includes('/w/app'))).toBe(false);

  const api = await page.request.get(`${GATEWAY}/api/widget-config?tenant=e2e-off`);
  expect(api.status()).toBe(503);
  expect(await api.json()).toEqual({
    error: {
      code: 'tenant_disabled',
      message: 'Asistentul nu este disponibil momentan pe acest site.',
      retryable: false,
    },
  });
});

test('proactive message: after the delay, as a status, opens the chat, once per session', async ({
  page,
}) => {
  await gotoBrand(page);
  const bubble = widget(page).locator('.proactive');
  await expect(bubble).toBeVisible({ timeout: 4000 });
  await expect(bubble).toHaveAttribute('role', 'status');
  await expect(bubble).toContainText('Aveți o întrebare? Vă ajut imediat.');
  // It must not take the focus away from the page.
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');

  await bubble.locator('.proactive__text').click();
  await expect(bubble).toHaveCount(0);
  await expect(chat(page).getByLabel('Mesajul dumneavoastră')).toBeVisible();

  await gotoBrand(page); // same tab: already shown in this session
  await page.waitForTimeout(2000);
  await expect(widget(page).locator('.proactive')).toHaveCount(0);
});

test('proactive message can be dismissed with its labelled close button', async ({ page }) => {
  await gotoBrand(page);
  const bubble = widget(page).locator('.proactive');
  await expect(bubble).toBeVisible({ timeout: 4000 });
  await bubble.getByRole('button', { name: 'Închide mesajul' }).click();
  await expect(bubble).toHaveCount(0);
  await expect(launcher(page)).toHaveAttribute('aria-expanded', 'false');
});

test('tenant images come from the gateway only, SVG with a sandbox CSP', async ({ page }) => {
  const imageHosts = new Set<string>();
  let svgCsp = '';
  page.on('response', (response) => {
    if (response.request().resourceType() === 'image')
      imageHosts.add(new URL(response.url()).origin);
    if (response.url().endsWith('logo.svg'))
      svgCsp = response.headers()['content-security-policy'] ?? '';
  });
  await gotoBrand(page);
  await launcher(page).click();
  await expect(chat(page).locator('.header .avatar__image')).toBeVisible();
  expect([...imageHosts]).toEqual([GATEWAY]);
  expect(svgCsp).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
});

test('no serious or critical accessibility violations with the tenant theme', async ({ page }) => {
  await gotoBrand(page);
  await expect(widget(page).locator('.proactive')).toBeVisible({ timeout: 4000 });
  // Two scans in one test: a Firefox crash fails it (as before) rather than hiding the second.
  const check = async () =>
    describe(await serious(page, { tags: WCAG21_AA, firefoxCrash: 'throw' }));
  expect(await check()).toEqual([]); // launcher + proactive message

  await launcher(page).click();
  await expect(chat(page).getByText('Bună ziua! Sunt asistentul de test.')).toBeVisible();
  expect(await check()).toEqual([]); // themed chat window
});
