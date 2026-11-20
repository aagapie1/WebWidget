import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { DIFY, SITE } from '../constants.js';

/**
 * E5 A1 (ADR 010): a client site with a strict Content-Security-Policy — only the gateway, no
 * `'unsafe-inline'` for styles — gets a styled launcher and a working chat, with no CSP
 * violation on the page or in the chat iframe. Both style paths: constructable stylesheets, and
 * the gateway's CSS file where they are missing (forced here by removing them from the page).
 */
const STRICT = `${SITE}/strict.html`;

const launcher = (page: Page) =>
  page.locator('[data-chat-widget]').getByRole('button', { name: /asistentul virtual/ });
const chat = (page: Page): FrameLocator => page.frameLocator('iframe[title="Asistent virtual"]');

/** Collects CSP violations in every frame (the page and the chat iframe), and console reports. */
async function watchCsp(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const store = window as unknown as { __csp: string[] };
    store.__csp = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      store.__csp.push(`${event.effectiveDirective} ${event.blockedURI} (${location.origin})`);
    });
  });
  const console: string[] = [];
  page.on('console', (message) => {
    if (/content.security.policy|refused to apply|refused to load/i.test(message.text())) {
      console.push(message.text());
    }
  });
  return async () => {
    const found = [...console];
    for (const frame of page.frames()) {
      const list = await frame
        .evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])
        .catch(() => []);
      found.push(...list);
    }
    return found;
  };
}

/** The launcher really styled by the loader CSS: fixed, round, colored. */
async function expectStyledLauncher(page: Page): Promise<void> {
  await expect(launcher(page)).toBeVisible();
  const style = await launcher(page).evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      position: computed.position,
      radius: computed.borderTopLeftRadius,
      background: computed.backgroundImage + computed.backgroundColor,
      width: element.getBoundingClientRect().width,
    };
  });
  expect(style.position).toBe('fixed');
  expect(style.radius).not.toBe('0px');
  expect(style.background).not.toBe('nonergba(0, 0, 0, 0)');
  expect(style.width).toBeGreaterThan(40);
}

async function chatWorks(page: Page): Promise<void> {
  await launcher(page).click();
  await expect(chat(page).getByText('Bună ziua! Sunt asistentul de test.')).toBeVisible();
  const input = chat(page).getByLabel('Mesajul dumneavoastră');
  await input.fill('Care e programul?');
  await input.press('Enter');
  await expect(chat(page).locator('.message--assistant').last()).toContainText(
    'Programul este luni–vineri, între 8 și 16.',
  );
}

test.beforeEach(async ({ page }) => {
  await page.request.get(`${DIFY}/__reset`);
});

test('strict CSP site: styled launcher and working chat, no CSP violation (constructable sheets)', async ({
  page,
}) => {
  const violations = await watchCsp(page);
  await page.goto(STRICT);
  await expect(page.locator('[data-chat-widget][data-ready="true"]')).toBeAttached();
  const way = await page.locator('[data-chat-widget]').evaluate((host) => ({
    adopted: host.shadowRoot?.adoptedStyleSheets.length ?? 0,
    links: host.shadowRoot?.querySelectorAll('link[rel="stylesheet"]').length ?? 0,
    styles: host.shadowRoot?.querySelectorAll('style').length ?? 0,
  }));
  expect(way).toEqual({ adopted: 1, links: 0, styles: 0 });
  await expectStyledLauncher(page);
  await chatWorks(page);
  expect(await violations()).toEqual([]);
});

test("strict CSP site without constructable sheets: the gateway's CSS file, no violation", async ({
  page,
}) => {
  // An engine without adoptedStyleSheets (forced): the loader links the gateway's file instead.
  await page.addInitScript(() => {
    delete (ShadowRoot.prototype as { adoptedStyleSheets?: unknown }).adoptedStyleSheets;
  });
  const violations = await watchCsp(page);
  const css = page.waitForResponse((response) => response.url().includes('/w/loader.css?v='));
  await page.goto(STRICT);
  expect((await css).status()).toBe(200);
  await expect(page.locator('[data-chat-widget][data-ready="true"]')).toBeAttached();
  const links = await page
    .locator('[data-chat-widget]')
    .evaluate((host) => host.shadowRoot?.querySelectorAll('link[rel="stylesheet"]').length ?? 0);
  expect(links).toBe(1);
  await expectStyledLauncher(page);
  await chatWorks(page);
  expect(await violations()).toEqual([]);
});
