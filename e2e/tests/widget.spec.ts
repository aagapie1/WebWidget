import AxeBuilder from '@axe-core/playwright';
import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { DIFY, DIFY_KEY, FORBIDDEN_SITE, GATEWAY, SITE } from '../constants.js';

interface DifyRequest {
  method: string;
  url: string;
  authorization?: string;
  body?: { query?: string; auto_generate_name?: boolean; user?: string };
}

async function difyRequests(page: Page): Promise<DifyRequest[]> {
  const response = await page.request.get(`${DIFY}/__requests`);
  return (await response.json()) as DifyRequest[];
}

test.beforeEach(async ({ page }) => {
  await page.request.get(`${DIFY}/__reset`);
});

const launcher = (page: Page) =>
  page.locator('[data-chat-widget]').getByRole('button', { name: /asistentul virtual/ });
const chat = (page: Page): FrameLocator => page.frameLocator('iframe[title="Asistent virtual"]');
const input = (page: Page) => chat(page).getByLabel('Mesajul dumneavoastră');

/** Opens the client site and waits for the background preload of the chat (ADR 004). */
async function gotoSite(page: Page): Promise<void> {
  await page.goto(`${SITE}/`);
  await expect(page.locator('[data-chat-widget][data-ready="true"]')).toBeAttached();
}

async function openChat(page: Page): Promise<void> {
  await gotoSite(page);
  await launcher(page).click();
  await expect(chat(page).getByText('Bună ziua! Sunt asistentul de test.')).toBeVisible();
}

async function ask(page: Page, question: string): Promise<void> {
  await input(page).fill(question);
  await input(page).press('Enter');
}

test('one <script> line: launcher opens the chat with the welcome message, focus in the input', async ({
  page,
}) => {
  await openChat(page);
  await expect(launcher(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(input(page)).toBeFocused();
  await expect(chat(page).getByRole('heading', { name: 'Asistent de test' })).toBeVisible();
});

test('streams an answer with Markdown and sends auto_generate_name: false', async ({ page }) => {
  await openChat(page);
  await ask(page, 'Care e programul?');

  const answer = chat(page).locator('.message--assistant').last();
  await expect(answer).toContainText('Programul este luni–vineri, între 8 și 16.');
  await expect(answer.locator('strong')).toHaveText('luni–vineri');
  await expect(answer).toHaveAttribute('aria-busy', 'false');
  // Announced once, in full, through the separate live region.
  await expect(chat(page).locator('[aria-live="polite"]')).toHaveText(
    'Programul este luni–vineri, între 8 și 16.',
  );
  await expect(chat(page).locator('.messages')).not.toHaveAttribute('aria-live', /.*/);

  const chatRequests = (await difyRequests(page)).filter((r) => r.url === '/v1/chat-messages');
  expect(chatRequests).toHaveLength(1);
  expect(chatRequests[0]?.body?.auto_generate_name).toBe(false);
  expect(chatRequests[0]?.authorization).toBe(`Bearer ${DIFY_KEY}`);
});

test('model HTML is sanitized: no script, no images, safe links only', async ({ page }) => {
  await openChat(page);
  await ask(page, 'test xss');
  const answer = chat(page).locator('.message--assistant').last();
  await expect(answer).toContainText('Text sigur.');
  await expect(answer).toHaveAttribute('aria-busy', 'false');

  await expect(answer.locator('img, script')).toHaveCount(0);
  const safe = answer.getByRole('link', { name: /site/ });
  await expect(safe).toHaveAttribute('href', 'https://example.org/pagina');
  await expect(safe).toHaveAttribute('target', '_blank');
  await expect(safe).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(answer.locator('a', { hasText: 'rău' })).not.toHaveAttribute('href', /.*/);

  const frame = page.frames().find((f) => f.url().startsWith(`${GATEWAY}/w/app`));
  expect(await frame?.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();
});

test('stop keeps the partial answer and asks Dify to stop the task', async ({ page }) => {
  await openChat(page);
  await ask(page, 'un răspuns lung');
  const answer = chat(page).locator('.message--assistant').last();
  await expect(answer).toContainText('cuvânt3');
  await expect(answer).toHaveAttribute('aria-busy', 'true');

  await chat(page).getByRole('button', { name: 'Oprește răspunsul' }).click();
  await expect(answer).toContainText('Răspuns oprit.');
  await expect(answer).toHaveAttribute('aria-busy', 'false');
  await expect(input(page)).toBeFocused();
  await expect
    .poll(async () => (await difyRequests(page)).some((r) => r.url.endsWith('/stop')))
    .toBe(true);
});

test('retry after a temporary error does not repeat the question', async ({ page }) => {
  await openChat(page);
  await ask(page, 'provoacă o eroare');
  // Shown in the message and announced once in the live region.
  const messages = chat(page).getByRole('region', { name: 'Mesaje' });
  await expect(messages.getByText(/nu este disponibil momentan/)).toBeVisible();
  await expect(chat(page).locator('[aria-live="polite"]')).toContainText('nu este disponibil');
  await chat(page).getByRole('button', { name: 'Încearcă din nou' }).click();
  await expect(chat(page).locator('.message--assistant').last()).toContainText('Programul este');
  await expect(chat(page).locator('.message--user')).toHaveCount(1);
});

test('keyboard: open from the launcher, Escape minimizes and returns focus; conversation kept', async ({
  page,
}) => {
  await gotoSite(page);
  await launcher(page).focus();
  await page.keyboard.press('Enter');
  await expect(input(page)).toBeFocused();
  await ask(page, 'Care e programul?');
  await expect(chat(page).locator('.message--assistant').last()).toContainText('8 și 16');

  await input(page).press('Escape');
  await expect(launcher(page)).toBeFocused();
  await expect(launcher(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('iframe[title="Asistent virtual"]')).toBeHidden();

  await page.keyboard.press('Enter');
  await expect(chat(page).locator('.message--user')).toHaveText(/Care e programul\?/);
});

test('mobile: full-screen window, the launcher does not cover the send button', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await openChat(page);
  await expect(launcher(page)).toBeHidden();
  await input(page).fill('Bună');
  const send = chat(page).getByRole('button', { name: 'Trimite' });
  await expect(send).toBeInViewport();
  await send.click(); // fails if anything covers it
  await expect(chat(page).locator('.message--user')).toHaveCount(1);

  await chat(page).getByRole('button', { name: 'Minimizează fereastra' }).click();
  await expect(launcher(page)).toBeVisible();
  await expect(launcher(page)).toBeFocused();
});

test('minimize only hides; "Conversație nouă" starts over', async ({ page }) => {
  await openChat(page);
  await ask(page, 'Care e programul?');
  await expect(chat(page).locator('.message--assistant').last()).toContainText('8 și 16');

  await chat(page).getByRole('button', { name: 'Minimizează fereastra' }).click();
  await expect(launcher(page)).toBeFocused();
  await launcher(page).click();
  await expect(chat(page).locator('.message--user')).toHaveCount(1);

  await chat(page).getByRole('button', { name: 'Conversație nouă' }).click();
  await expect(chat(page).locator('.message--user')).toHaveCount(0);
  await expect(chat(page).getByText('Bună ziua! Sunt asistentul de test.')).toBeVisible();
  await expect(input(page)).toBeFocused();
});

test('no serious or critical accessibility violations (host page with the chat open)', async ({
  page,
}) => {
  await openChat(page);
  await ask(page, 'Care e programul?');
  await expect(chat(page).locator('.message--assistant').last()).toContainText('8 și 16');

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(blocking.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  // The chat iframe was analysed too (targets inside a frame have more than one selector).
  const inFrame = results.passes.some((rule) => rule.nodes.some((node) => node.target.length > 1));
  expect(inFrame).toBe(true);
  const other = results.violations.map((v) => `${v.impact ?? 'unknown'} ${v.id}`);
  test
    .info()
    .annotations.push({ type: 'axe (moderate/minor)', description: other.join(', ') || 'none' });
});

test('a site outside allowedOrigins cannot load the chat', async ({ page }) => {
  const responses: number[] = [];
  page.on('response', (response) => {
    if (response.url().startsWith(`${GATEWAY}/w/app`)) responses.push(response.status());
  });
  await page.goto(`${FORBIDDEN_SITE}/`);
  await launcher(page).click();
  await expect.poll(() => responses).toContain(403);
  expect(await chatInputsRendered(page)).toBe(0);
});

test('frame-ancestors blocks a foreign site that spoofs an allowed parent', async ({ page }) => {
  let csp = '';
  page.on('response', (response) => {
    if (response.url().startsWith(`${GATEWAY}/w/app`)) {
      csp = response.headers()['content-security-policy'] ?? '';
    }
  });
  await page.goto(`${FORBIDDEN_SITE}/spoof.html`);
  await expect.poll(() => csp).toContain('frame-ancestors');
  expect(csp).toContain(`frame-ancestors ${SITE}`);
  expect(csp).not.toContain(FORBIDDEN_SITE);
  await page.waitForTimeout(1000);
  expect(await chatInputsRendered(page)).toBe(0);
});

/**
 * Counts chat inputs rendered in any frame. A frame blocked by the browser (CSP frame-ancestors)
 * may never finish loading, so each frame gets a short, bounded check instead of a locator wait.
 */
async function chatInputsRendered(page: Page): Promise<number> {
  let total = 0;
  for (const frame of page.frames()) {
    const count = await Promise.race([
      frame.evaluate(() => document.querySelectorAll('#composer-input').length).catch(() => 0),
      new Promise<number>((resolve) => {
        setTimeout(() => {
          resolve(0);
        }, 1000);
      }),
    ]);
    total += count;
  }
  return total;
}

test('the Dify key never reaches the browser', async ({ page }) => {
  const seen: string[] = [];
  page.on('response', async (response) => {
    if (!response.url().startsWith(GATEWAY)) return;
    const headers = JSON.stringify(response.headers());
    const body = await response.text().catch(() => '');
    seen.push(headers + body);
  });
  await openChat(page);
  await ask(page, 'Care e programul?');
  await expect(chat(page).locator('.message--assistant').last()).toContainText('8 și 16');
  expect(seen.length).toBeGreaterThan(3);
  for (const text of seen) {
    expect(text).not.toContain(DIFY_KEY);
    expect(text).not.toContain('app-e2e');
  }
});
