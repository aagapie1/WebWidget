import { cleanup, configure } from '@testing-library/preact';
import { afterEach } from 'vitest';

// Autosave waits 1.2 s after the last change: async queries need more than the 1 s default.
configure({ asyncUtilTimeout: 3000 });

// Vitest globals are off, so Testing Library cannot register its automatic cleanup.
afterEach(() => {
  cleanup();
});

// jsdom does not implement scrolling: the editor scrolls to the area or field it opens.
Element.prototype.scrollIntoView = function scrollIntoView() {
  // no layout in jsdom
};
