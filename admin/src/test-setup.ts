import { cleanup, configure } from '@testing-library/preact';
import { afterAll, afterEach } from 'vitest';

// Autosave waits 1.2 s after the last change: async queries need more than the 1 s default.
configure({ asyncUtilTimeout: 3000 });

// Vitest globals are off, so Testing Library cannot register its automatic cleanup.
afterEach(() => {
  cleanup();
});

// Preact runs effects and their cleanups after paint (requestAnimationFrame or a 35 ms timer).
// Without this wait, one scheduled by a file's last test can fire after jsdom is torn down
// ("window is not defined"), which Vitest reports as an error (seen in CI on Editor.test.tsx).
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
});

// jsdom does not implement scrolling: the editor scrolls to the area or field it opens.
Element.prototype.scrollIntoView = function scrollIntoView() {
  // no layout in jsdom
};
