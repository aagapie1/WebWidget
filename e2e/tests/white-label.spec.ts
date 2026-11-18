import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
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
  await expect(panel).toHaveCSS('left', '20px');
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
  const check = async () =>
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
    ).violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.help}`);
  expect(await check()).toEqual([]); // launcher + proactive message

  await launcher(page).click();
  await expect(chat(page).getByText('Bună ziua! Sunt asistentul de test.')).toBeVisible();
  expect(await check()).toEqual([]); // themed chat window
});
