import AxeBuilder from '@axe-core/playwright';
import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { DIFY, GATEWAY, SITE } from '../constants.js';

interface DifyRequest {
  method: string;
  url: string;
  body?: { rating?: string | null; name?: string };
}

test.beforeEach(async ({ page }) => {
  await page.request.get(`${DIFY}/__reset`);
});

const launcher = (page: Page) =>
  page.locator('[data-chat-widget]').getByRole('button', { name: /asistentul virtual/ });
const chat = (page: Page): FrameLocator => page.frameLocator('iframe[title="Asistent virtual"]');
const input = (page: Page) => chat(page).getByLabel('Mesajul dumneavoastră');
const lastAnswer = (page: Page) => chat(page).locator('.message--assistant').last();

async function openChat(page: Page): Promise<void> {
  await page.goto(`${SITE}/`);
  await expect(page.locator('[data-chat-widget][data-ready="true"]')).toBeAttached();
  await launcher(page).click();
  await expect(input(page)).toBeVisible();
}

async function ask(page: Page, question: string): Promise<void> {
  await input(page).fill(question);
  await input(page).press('Enter');
  await expect(lastAnswer(page)).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
}

async function difyRequests(page: Page): Promise<DifyRequest[]> {
  return (await (await page.request.get(`${DIFY}/__requests`)).json()) as DifyRequest[];
}

test('history survives a page reload (from the gateway, nothing in localStorage)', async ({
  page,
}) => {
  await openChat(page);
  await ask(page, 'Care e programul?');
  await openChat(page);
  await expect(chat(page).locator('.message--user .message__text')).toHaveText([
    'Care e programul?',
  ]);
  await expect(lastAnswer(page)).toContainText('luni–vineri');

  const frame = page.frames().find((f) => f.url().startsWith(`${GATEWAY}/w/app`));
  expect(await frame?.evaluate(() => localStorage.length)).toBe(0);
});

test('an answer that finished while the visitor was away appears when they come back', async ({
  page,
}) => {
  await openChat(page);
  await input(page).fill('întrebare absent');
  await input(page).press('Enter');
  await expect(lastAnswer(page)).toContainText('Răspuns');
  await page.goto('about:blank'); // the visitor leaves mid-answer
  await page.waitForTimeout(2500);

  await openChat(page);
  await expect(lastAnswer(page)).toContainText('Răspuns terminat în lipsa vizitatorului.');
  expect((await difyRequests(page)).some((r) => r.url.endsWith('/stop'))).toBe(false);
});

test('suggested questions are shown until the first question and send on click', async ({
  page,
}) => {
  await openChat(page);
  const suggestions = chat(page).getByRole('group', { name: 'Întrebări sugerate' });
  await expect(suggestions.getByRole('button')).toHaveText([
    'Care e programul?',
    'Ce taxe sunt? surse',
  ]);
  await suggestions.getByRole('button', { name: 'Care e programul?' }).click();
  await expect(lastAnswer(page)).toHaveAttribute('aria-busy', 'false');
  await expect(chat(page).locator('.message--user .message__text')).toHaveText([
    'Care e programul?',
  ]);
  await expect(suggestions).toHaveCount(0);
});

test('sources are grouped per document with the tenant title, no snippets by default', async ({
  page,
}) => {
  await openChat(page);
  await ask(page, 'Ce taxe sunt? surse');
  const sources = lastAnswer(page).locator('.citations__item');
  await expect(sources).toHaveText(['Regulamentul de organizare', 'Tarife 2026']);
  await expect(lastAnswer(page).locator('details')).toHaveCount(0);
});

test('rating an answer reaches Dify and survives a reload', async ({ page }) => {
  await openChat(page);
  await ask(page, 'Care e programul?');
  const like = lastAnswer(page).getByRole('button', { name: 'Răspuns util' });
  await like.click();
  await expect(like).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(
      async () =>
        (await difyRequests(page)).find((r) => r.url.includes('/feedbacks'))?.body?.rating,
    )
    .toBe('like');

  await openChat(page);
  await expect(lastAnswer(page).getByRole('button', { name: 'Răspuns util' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('conversation list: titles from the question, switch, delete with confirmation', async ({
  page,
}) => {
  await openChat(page);
  await ask(page, 'Care sunt condițiile de participare la cursul de prim ajutor?');
  await chat(page).getByRole('button', { name: 'Conversațiile mele' }).click();
  await chat(page).getByRole('button', { name: 'Conversație nouă' }).click();
  await ask(page, 'Cum mă înscriu?');

  await chat(page).getByRole('button', { name: 'Conversațiile mele' }).click();
  const heading = chat(page).getByRole('heading', { level: 2, name: 'Conversațiile mele' });
  await expect(heading).toBeFocused();
  const items = chat(page).locator('.conversation-list__title');
  await expect(items).toHaveText([
    'Cum mă înscriu?',
    'Care sunt condițiile de participare la cursul de…',
  ]);

  await chat(page)
    .getByRole('button', { name: /^Care sunt condițiile/ })
    .click();
  await expect(input(page)).toBeFocused();
  await expect(chat(page).locator('.message--user .message__text')).toHaveText([
    'Care sunt condițiile de participare la cursul de prim ajutor?',
  ]);

  await chat(page).getByRole('button', { name: 'Conversațiile mele' }).click();
  await chat(page).getByRole('button', { name: 'Șterge conversația „Cum mă înscriu?”' }).click();
  await expect(chat(page).getByText('Ștergeți definitiv această conversație?')).toBeVisible();
  await chat(page).getByRole('button', { name: 'Șterge', exact: true }).click();
  await expect(items).toHaveText(['Care sunt condițiile de participare la cursul de…']);
  expect((await difyRequests(page)).filter((r) => r.method === 'DELETE')).toHaveLength(1);
});

test('closing a conversation asks for feedback and starts a new one', async ({ page }) => {
  const feedbackStatus: number[] = [];
  page.on('response', (response) => {
    if (/\/api\/conversations\/[^/]+\/feedback$/.test(response.url())) {
      feedbackStatus.push(response.status());
    }
  });
  await openChat(page);
  await ask(page, 'Care e programul?');
  await chat(page).getByRole('button', { name: 'Închide conversația' }).click();
  await expect(chat(page).getByRole('heading', { name: 'Cum a fost conversația?' })).toBeFocused();
  await chat(page).getByText('Utilă', { exact: true }).click();
  await chat(page).getByLabel('Comentariu (opțional)').fill('Foarte util, sunați-mă la 0722123456');
  await chat(page).getByRole('button', { name: 'Trimite și închide' }).click();

  await expect(input(page)).toBeFocused();
  await expect(chat(page).locator('.message--user')).toHaveCount(0);
  await expect(chat(page).locator('[aria-live="polite"]')).toHaveText(
    'Mulțumim! Conversația a fost închisă.',
  );
  expect(feedbackStatus).toEqual([204]);

  // The closed conversation stays in the list and can be resumed.
  await chat(page).getByRole('button', { name: 'Conversațiile mele' }).click();
  await expect(chat(page).locator('.conversation-list__title')).toHaveText(['Care e programul?']);
});

test('no serious or critical accessibility violations in the list and closing views', async ({
  page,
}) => {
  await openChat(page);
  await ask(page, 'Ce taxe sunt? surse');
  const analyze = async () => {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    return results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.help}`);
  };
  expect(await analyze()).toEqual([]); // sources + rating buttons

  await chat(page).getByRole('button', { name: 'Conversațiile mele' }).click();
  await expect(chat(page).locator('.conversation-list__title')).toHaveCount(1);
  await chat(page)
    .getByRole('button', { name: /^Șterge conversația/ })
    .click();
  expect(await analyze()).toEqual([]); // list with the delete confirmation open

  await chat(page).getByRole('button', { name: 'Anulează' }).click();
  await chat(page).getByRole('button', { name: 'Înapoi la conversație' }).click();
  await chat(page).getByRole('button', { name: 'Închide conversația' }).click();
  expect(await analyze()).toEqual([]); // closing feedback form
});
