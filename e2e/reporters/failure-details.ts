import { appendFileSync, readFileSync, statSync } from 'node:fs';
import { relative } from 'node:path';
import type { Reporter, TestCase, TestResult, TestStep } from '@playwright/test/reporter';

/**
 * In CI, for each failed test: the error, the last Playwright actions and a text snapshot of the
 * page at the failure (Playwright's error context: the accessibility tree), as a GitHub annotation
 * and in the log. Annotations can be read through the public API, without signing in to GitHub;
 * the trace and the screenshot stay in the job's artifact (they need a signed-in download).
 */
const LAST_ACTIONS = 15;
const SNAPSHOT_CHARS = 5000;

/** Every step, depth first, in the order they ran. */
function flatten(steps: readonly TestStep[]): TestStep[] {
  return steps.flatMap((step) => [step, ...flatten(step.steps)]);
}

const plain = (text: string): string =>
  // eslint-disable-next-line no-control-regex -- removes terminal colors from Playwright's messages
  text.replace(/\u001b\[[0-9;]*m/g, '');

/** GitHub workflow command escaping (data, then property values). */
const data = (text: string): string =>
  text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const property = (text: string): string => data(text).replace(/:/g, '%3A').replace(/,/g, '%2C');

export default class FailureDetails implements Reporter {
  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status === 'passed' || result.status === 'skipped') return;
    if (process.env.GITHUB_ACTIONS !== 'true') return;

    const browser = test.parent.project()?.name ?? 'unknown';
    const actions = flatten(result.steps)
      .filter((step) => ['pw:api', 'expect', 'test.step'].includes(step.category))
      .slice(-LAST_ACTIONS)
      .map(
        (step) =>
          `- ${step.title} (${String(step.duration)} ms)${step.error ? ` — ${plain(step.error.message ?? '').split('\n')[0] ?? ''}` : ''}`,
      );
    const error = plain(result.errors[0]?.message ?? result.error?.message ?? '(no message)')
      .split('\n')
      .slice(0, 12)
      .join('\n');
    const context = result.attachments.find((item) => item.name === 'error-context');
    let snapshot = '(no page snapshot)';
    if (context?.path) {
      try {
        const text = readFileSync(context.path, 'utf8');
        const start = text.indexOf('# Page snapshot');
        const end = text.indexOf('# Test source');
        snapshot = text
          .slice(Math.max(start, 0), end > start ? end : undefined)
          .slice(0, SNAPSHOT_CHARS);
      } catch {
        // the error context is optional
      }
    }
    // What was moving on the page (e2e/diagnostics.ts), when the spec records it.
    const motion = result.attachments.find((item) => item.name === 'motion');
    const movement = motion?.body ? motion.body.toString('utf8') : '(not recorded for this spec)';
    const screenshot = result.attachments.find((item) => item.name === 'screenshot');
    const image = screenshot?.path
      ? `${relative(process.cwd(), screenshot.path)} (${String(Math.round(statSync(screenshot.path).size / 1024))} KB, artifact playwright-${browser})`
      : '(none)';

    // titlePath: '', project, file, describe…, test.
    const title = `[${browser}] ${test.titlePath().slice(2).join(' › ')} — ${result.status}`;
    const body = [
      error,
      '',
      `Last ${String(actions.length)} actions:`,
      ...actions,
      '',
      'Motion at the failure:',
      movement,
      '',
      `Screenshot: ${image}`,
      '',
      snapshot,
    ].join('\n');

    const file = relative(process.cwd(), test.location.file).replace(/\\/g, '/');
    console.log(
      `::error file=${property(`e2e/${file}`)},line=${String(test.location.line)},title=${property(`Failure details: ${title}`)}::${data(body)}`,
    );
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary) {
      appendFileSync(summary, `\n### Failure details: ${title}\n\n\`\`\`text\n${body}\n\`\`\`\n`);
    }
  }

  printsToStdio(): boolean {
    return false;
  }
}
