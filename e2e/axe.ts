// The only module that imports axe: an ESLint rule (no-restricted-imports) sends every e2e test
// here, so that the known Firefox crash is handled the same way everywhere.
import AxeBuilder from '@axe-core/playwright';
import { test, type Page } from '@playwright/test';
import { FIREFOX_AXE_CRASH } from './axe-notes.js';

export { FIREFOX_AXE_CRASH };

export type AxeResults = Awaited<ReturnType<AxeBuilder['analyze']>>;
export type AxeViolation = AxeResults['violations'][number];

export interface AxeOptions {
  /** A CSS selector: only that part of the page. */
  include?: string;
  /** axe tags (e.g. the WCAG 2.1 A/AA set); all rules when left out. */
  tags?: string[];
  /**
   * In Firefox, axe sometimes crashes the page ("Page crashed", docs/BACKLOG.md). `annotate`
   * (the default): the crash is not a finding (Chromium and WebKit scan the same page), it is
   * reported as a `firefox-axe-crash` annotation and the scan returns nothing. `throw`: for callers
   * that retry or split the scan themselves.
   */
  firefoxCrash?: 'annotate' | 'throw';
}

export const WCAG21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Serious and critical axe violations of the page (or of `include`). Call it last in a test: after
 * a Firefox crash the page is gone. Real violations still fail in every browser.
 */
export async function serious(page: Page, options: AxeOptions = {}): Promise<AxeViolation[]> {
  try {
    return (await analyze(page, options)).violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
  } catch (error) {
    if (options.firefoxCrash === 'throw' || !isFirefoxCrash(page, error)) throw error;
    noteFirefoxCrash();
    return [];
  }
}

/**
 * The full axe results (passes included), for tests that look beyond the violations. No crash
 * handling: a Firefox crash throws (see `serious` and `isFirefoxCrash`).
 */
export async function analyze(
  page: Page,
  options: Pick<AxeOptions, 'include' | 'tags'> = {},
): Promise<AxeResults> {
  const builder = new AxeBuilder({ page });
  if (options.include) builder.include(options.include);
  if (options.tags) builder.withTags(options.tags);
  return builder.analyze();
}

/** Is this error the known Firefox crash inside axe? */
export function isFirefoxCrash(page: Page, error: unknown): boolean {
  const firefox = page.context().browser()?.browserType().name() === 'firefox';
  return firefox && String(error).includes('Page crashed');
}

/** Records one Firefox axe crash on the current test (counted in the CI summary). */
export function noteFirefoxCrash(where = ''): void {
  test.info().annotations.push({
    type: FIREFOX_AXE_CRASH,
    description: `${test.info().title}${where ? ` — ${where}` : ''} (docs/BACKLOG.md)`,
  });
}

/** `id: help` lines, for readable assertion failures. */
export const describe = (violations: readonly AxeViolation[]): string[] =>
  violations.map((violation) => `${violation.id}: ${violation.help}`);
