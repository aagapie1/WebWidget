import { expect, test, type Page } from '@playwright/test';
import { cspFor } from '../../admin/src/csp.js';
import { DIFY, GATEWAY, SITE } from '../constants.js';

/**
 * E5 A1 (ADR 010): a client site with a strict Content-Security-Policy runs the whole widget —
 * launcher with its image icon, proactive message, chat window, a question and its answer — with
 * every style applied and no CSP violation, in the page or in the chat iframe.
 *
 * The page's policy is built here from the list "Integrare pe site" gives clients
 * (admin/src/csp.ts), so it is exactly that list:
 * - `default-src 'none'` + the list (+ base-uri, form-action 'none');
 * - the most restrictive variant asked for: `default-src 'self'` + the list, nothing else.
 * Each in both style paths: constructable stylesheets, and the gateway's CSS file where they are
 * missing (forced here by removing them from the page). The brand tenant has an image launcher
 * icon, its own colors, a left launcher, a 400 px window and a proactive message.
 */
const ENTRIES = cspFor(GATEWAY);
const POLICIES = {
  "default-src 'none'": ["default-src 'none'", ...ENTRIES, "base-uri 'none'", "form-action 'none'"],
  "default-src 'self'": ["default-src 'self'", ...ENTRIES],
} as const;
const ACCENT = 'rgb(11, 110, 79)'; // #0b6e4f, e2e/tenants/e2e-brand.yaml

const widget = (page: Page) => page.locator('[data-chat-widget="e2e-brand"]');
const chat = (page: Page) => page.frameLocator('iframe[title="Asistent virtual"]');

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

/** The policy the page really received, as directive → sources. */
function directives(header: string | undefined): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const part of (header ?? '').split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) map.set(name, sources);
  }
  return map;
}

/** Computed CSS values of a part of the widget (not its on-screen box, which animations scale). */
async function computed(
  page: Page,
  selector: string,
  properties: string[],
): Promise<{ style: Record<string, string>; x: number }> {
  return widget(page)
    .locator(selector)
    .evaluate(
      (element, names) => ({
        style: Object.fromEntries(
          names.map((name) => [name, getComputedStyle(element).getPropertyValue(name)]),
        ),
        x: element.getBoundingClientRect().x,
      }),
      properties,
    );
}

/** Launcher, proactive message, window and a conversation, each with its styles applied. */
async function wholeWidgetWorks(page: Page): Promise<void> {
  // Launcher: fixed, round, on the left, in the tenant's color, with its image icon loaded.
  const launcher = widget(page).locator('.launcher');
  await expect(launcher).toBeVisible();
  const button = await computed(page, '.launcher', [
    'position',
    'width',
    'border-top-left-radius',
    'background-image',
  ]);
  expect(button.style.position).toBe('fixed');
  expect(button.style['border-top-left-radius']).not.toBe('0px');
  expect(button.style['background-image']).toContain(ACCENT);
  expect(button.style.width).not.toBe('auto');
  expect(button.x).toBeLessThan(100);
  const icon = widget(page).locator('.launcher__image');
  await expect(icon).toHaveAttribute('src', /\/w\/t\/e2e-brand\//);
  expect(
    await icon.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth),
  ).toBeGreaterThan(0);
  const iconBox = await computed(page, '.launcher__image', ['object-fit', 'width']);
  expect(iconBox.style).toEqual({ 'object-fit': 'contain', width: '34px' });

  // Proactive message: shown after its delay, fixed above the launcher, a styled card.
  const bubble = widget(page).locator('.proactive');
  await expect(bubble).toBeVisible({ timeout: 4000 });
  await expect(bubble).toContainText('Aveți o întrebare? Vă ajut imediat.');
  const card = await computed(page, '.proactive', ['position', 'background-color']);
  expect(card.style.position).toBe('fixed');
  expect(card.style['background-color']).not.toBe('rgba(0, 0, 0, 0)');
  const close = await computed(page, '.proactive__close', ['width', 'height']);
  expect(close.style).toEqual({ width: '32px', height: '32px' });

  // Window: opens from the launcher, fixed, the tenant's 400 px width, the chat answers.
  await launcher.click();
  const panel = widget(page).locator('.panel');
  await expect(panel).toBeVisible();
  const window = await computed(page, '.panel', ['position', 'width']);
  expect(window.style).toEqual({ position: 'fixed', width: '400px' });
  await expect(chat(page).getByText('Bună ziua! Sunt asistentul de test.')).toBeVisible();
  const input = chat(page).getByLabel('Mesajul dumneavoastră');
  await input.fill('Care e programul?');
  await input.press('Enter');
  await expect(chat(page).locator('.message--assistant').last()).toContainText(
    'Programul este luni–vineri, între 8 și 16.',
  );
  // The chat's own styles (its CSS file, under the gateway's style-src 'self') and the tenant's
  // theme are applied too: the visitor's bubble has the brand's color (userBubble #e3f1ea).
  const bubbleColor = await chat(page)
    .locator('.message--user .message__bubble')
    .last()
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(bubbleColor).toBe('rgb(227, 241, 234)');
}

test.beforeEach(async ({ page }) => {
  await page.request.get(`${DIFY}/__reset`);
});

for (const [label, policy] of Object.entries(POLICIES)) {
  for (const path of ['adopted', 'link'] as const) {
    const title =
      path === 'adopted'
        ? `strict CSP (${label} + only "Integrare pe site"): the whole widget, constructable sheets`
        : `strict CSP (${label} + only "Integrare pe site"): the whole widget, the gateway's CSS file`;
    test(title, async ({ page }) => {
      if (path === 'link') {
        // An engine without adoptedStyleSheets (forced): the loader links the gateway's file.
        await page.addInitScript(() => {
          delete (ShadowRoot.prototype as { adoptedStyleSheets?: unknown }).adoptedStyleSheets;
        });
      }
      const violations = await watchCsp(page);
      const css =
        path === 'link'
          ? page.waitForResponse((response) => response.url().includes('/w/loader.css?v='))
          : undefined;
      const url = `${SITE}/strict.html?tenant=e2e-brand&csp=${encodeURIComponent(policy.join('; '))}`;
      const response = await page.goto(url);

      // The page really has exactly this policy, and nothing in it allows inline code or styles.
      const header = response?.headers()['content-security-policy'];
      expect(header).toBe(policy.join('; '));
      const received = directives(header);
      expect([...received.keys()]).toEqual(policy.map((entry) => entry.split(' ')[0]));
      expect(received.get('style-src')).toEqual([GATEWAY]);
      expect(received.get('script-src')).toEqual([GATEWAY]);
      expect(header).not.toContain('unsafe-inline');
      expect(header).not.toContain('unsafe-eval');

      if (css) expect((await css).status()).toBe(200);
      await expect(page.locator('[data-chat-widget][data-ready="true"]')).toBeAttached();
      const styling = await widget(page).evaluate((host) => {
        const root = host.shadowRoot;
        return {
          // Removed from the page in the forced fallback.
          adopted: root && 'adoptedStyleSheets' in root ? root.adoptedStyleSheets.length : 0,
          links: root?.querySelectorAll('link[rel="stylesheet"]').length ?? 0,
          styles: root?.querySelectorAll('style').length ?? 0,
        };
      });
      expect(styling).toEqual(
        path === 'adopted'
          ? { adopted: 1, links: 0, styles: 0 }
          : { adopted: 0, links: 1, styles: 0 },
      );

      await wholeWidgetWorks(page);
      expect(await violations()).toEqual([]);
    });
  }
}
