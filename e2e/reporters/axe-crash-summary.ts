import { appendFileSync } from 'node:fs';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { FIREFOX_AXE_CRASH } from '../axe-notes.js';

/**
 * Counts the "Firefox axe crash" notes of a run (e2e/axe.ts, docs/BACKLOG.md), per browser, so
 * that we can see whether they go away after dependency updates (Playwright, Firefox, axe-core).
 * Printed at the end of every run; on GitHub also in the job summary and as a notice in the run.
 */
export default class AxeCrashSummary implements Reporter {
  readonly #byBrowser = new Map<string, string[]>();

  onTestEnd(test: TestCase, result: TestResult): void {
    const browser = test.parent.project()?.name ?? 'unknown';
    const notes = result.annotations.filter((note) => note.type === FIREFOX_AXE_CRASH);
    const list = this.#byBrowser.get(browser) ?? [];
    list.push(...notes.map((note) => note.description ?? test.title));
    this.#byBrowser.set(browser, list);
  }

  onEnd(): void {
    const counts = [...this.#byBrowser].map(([browser, notes]) => ({ browser, notes }));
    if (counts.length === 0) return;
    const line = counts
      .map(({ browser, notes }) => `${browser}: ${String(notes.length)}`)
      .join(', ');
    console.log(`\nFirefox axe crash notes — ${line}`);
    for (const { notes } of counts) for (const note of notes) console.log(`  - ${note}`);

    if (process.env.GITHUB_ACTIONS !== 'true') return;
    const total = counts.reduce((sum, { notes }) => sum + notes.length, 0);
    console.log(`::notice title=Firefox axe crash notes::${String(total)} (${line})`);
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (!summary) return;
    appendFileSync(
      summary,
      [
        '### Firefox axe crash notes',
        '',
        'Scans that crashed in Firefox and were reported as notes instead of failures',
        '(docs/BACKLOG.md). The number should fall to 0 after the fixing dependency update.',
        '',
        '| Browser | Notes |',
        '| --- | --- |',
        ...counts.map(({ browser, notes }) => `| ${browser} | ${String(notes.length)} |`),
        '',
        ...counts.flatMap(({ notes }) => notes.map((note) => `- ${note}`)),
        '',
      ].join('\n'),
    );
  }

  printsToStdio(): boolean {
    return false;
  }
}
