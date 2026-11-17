import { expect, test } from '@playwright/test';
import { GATEWAY, SITE } from '../constants.js';

test('long conversations scroll inside the message list only; the input stays at the bottom', async ({
  page,
}) => {
  await page.goto(`${SITE}/`);
  await expect(page.locator('[data-chat-widget][data-ready="true"]')).toBeAttached();
  await page.locator('[data-chat-widget]').getByRole('button').click();
  const chat = page.frameLocator('iframe[title="Asistent virtual"]');
  const input = chat.getByLabel('Mesajul dumneavoastră');

  for (let i = 0; i < 6; i++) {
    await input.fill(`Întrebarea ${String(i)}: care e programul?`);
    await input.press('Enter');
    await expect(chat.locator('.message--assistant').last()).toHaveAttribute('aria-busy', 'false');
  }

  const frame = page.frames().find((f) => f.url().startsWith(`${GATEWAY}/w/app`));
  const layout = await frame?.evaluate(() => {
    const list = document.querySelector<HTMLElement>('.messages');
    const composer = document.querySelector<HTMLElement>('.composer');
    return {
      documentScrolls: document.documentElement.scrollHeight > window.innerHeight + 1,
      listScrolls: (list?.scrollHeight ?? 0) > (list?.clientHeight ?? 0),
      composerBottom: Math.round(composer?.getBoundingClientRect().bottom ?? 0),
      viewportHeight: window.innerHeight,
    };
  });
  expect(layout?.documentScrolls).toBe(false);
  expect(layout?.listScrolls).toBe(true);
  expect(layout?.composerBottom).toBe(layout?.viewportHeight);
});
