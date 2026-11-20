import { test } from '@playwright/test';

/**
 * On a failed test, records what is moving on the page: running animations and transitions, the
 * buttons and links whose position changed within 200 ms, the reduced-motion setting and the font
 * loading state. Attached as `motion`; the CI failure-details reporter prints it. For "element is
 * not stable" click timeouts (docs/BACKLOG.md): it only observes, it changes no setting.
 */
export function diagnoseMotionOnFailure(): void {
  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return;
    const report = await page
      .evaluate(async () => {
        const name = (element: Element | null | undefined): string => {
          if (!element) return '?';
          const label = element.textContent.trim().replace(/\s+/g, ' ').slice(0, 40);
          const classes = typeof element.className === 'string' ? element.className.trim() : '';
          return `${element.tagName.toLowerCase()}${classes ? `.${classes.split(/\s+/).join('.')}` : ''}${label ? ` "${label}"` : ''}`;
        };
        const animations = document.getAnimations().map((animation) => {
          const kind =
            'animationName' in animation
              ? `animation ${String(animation.animationName)}`
              : 'transitionProperty' in animation
                ? `transition ${String(animation.transitionProperty)}`
                : 'script animation';
          const target =
            animation.effect instanceof KeyframeEffect ? animation.effect.target : undefined;
          return `${kind} on ${name(target)} (${animation.playState})`;
        });
        const controls = [...document.querySelectorAll('button, a[href]')];
        const boxes = () =>
          controls.map((element) => {
            const box = element.getBoundingClientRect();
            return `${String(Math.round(box.x))},${String(Math.round(box.y))},${String(Math.round(box.width))}x${String(Math.round(box.height))}`;
          });
        const before = boxes();
        await new Promise((resolve) => setTimeout(resolve, 200));
        const after = boxes();
        const moved = controls
          .map((element, index) => ({ element, from: before[index], to: after[index] }))
          .filter(({ from, to }) => from !== to)
          .map(({ element, from, to }) => `${name(element)}: ${from ?? ''} → ${to ?? ''}`);
        return [
          `prefers-reduced-motion: ${matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduce' : 'no-preference'}`,
          `document: ${document.readyState}; fonts: ${document.fonts.status}; viewport ${String(innerWidth)}x${String(innerHeight)}`,
          `running animations/transitions: ${animations.length ? `\n  ${animations.join('\n  ')}` : 'none'}`,
          `buttons/links that moved within 200 ms: ${moved.length ? `\n  ${moved.join('\n  ')}` : 'none'}`,
        ].join('\n');
      })
      .catch((error: unknown) => `(page not available: ${String(error).split('\n')[0] ?? ''})`);
    await testInfo.attach('motion', { body: report, contentType: 'text/plain' });
  });
}
