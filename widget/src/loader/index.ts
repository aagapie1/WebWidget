import { mountLoader, optionsFromScript } from './loader.js';

declare global {
  interface Window {
    __chatWidgetLoaded?: boolean;
  }
}

// `document.currentScript` is only available while this file executes, also with `async`.
const script = document.currentScript instanceof HTMLScriptElement ? document.currentScript : null;

function start(): void {
  if (window.__chatWidgetLoaded) return;
  const options = optionsFromScript(script, window.location.origin);
  if (!options) {
    console.error('[chat-widget] missing or invalid data-tenant on the <script> tag');
    return;
  }
  window.__chatWidgetLoaded = true;
  mountLoader(options);
}

// A script in <head> without `async` runs before <body> exists.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
