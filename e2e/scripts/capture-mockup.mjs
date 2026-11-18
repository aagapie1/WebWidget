// Screenshots of the static P2 design mockup (docs/review/admin/design-p2/mockup.html).
// Run from e2e/: node scripts/capture-mockup.mjs
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const dir = resolve('../docs/review/admin/design-p2');
const page_ = pathToFileURL(resolve(dir, 'mockup.html')).href;
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [width, height] of [
  [1280, 720],
  [1440, 900],
  [1920, 1080],
]) {
  await page.setViewportSize({ width, height });
  for (const area of ['identitate', 'culori', 'integrare']) {
    await page.goto(`${page_}#${area}`);
    await page.screenshot({ path: `${dir}/${String(width)}x${String(height)}-${area}.png` });
  }
}
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${page_}?menu=1#identitate`);
await page.screenshot({ path: `${dir}/1440x900-user-menu.png` });
await browser.close();
console.log('saved in', dir);
