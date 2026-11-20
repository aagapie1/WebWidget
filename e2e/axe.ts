import AxeBuilder from '@axe-core/playwright';
import { test, type Page } from '@playwright/test';

/**
 * Serious and critical axe violations of the page (or of `include`, a CSS selector). Call it last
 * in a test: in Firefox, axe sometimes crashes the page ("Page crashed", docs/BACKLOG.md). A crash
 * is not a finding (Chromium and WebKit scan the same page): it is reported as a
 * `firefox-axe-crash` annotation, and real violations still fail in every browser.
 */
export async function serious(page: Page, include?: string) {
  try {
    const builder = new AxeBuilder({ page });
    if (include) builder.include(include);
    return (await builder.analyze()).violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
  } catch (error) {
    const firefox = page.context().browser()?.browserType().name() === 'firefox';
    if (!firefox || !String(error).includes('Page crashed')) throw error;
    test.info().annotations.push({
      type: 'firefox-axe-crash',
      description: `${test.info().title} (docs/BACKLOG.md)`,
    });
    return [];
  }
}
