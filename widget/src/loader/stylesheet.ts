import { LOADER_CSS } from './styles.js';

/**
 * Short, stable version of the loader CSS (FNV-1a), for the fallback file's URL: a new text gets
 * a new URL, so a cached old file is never applied to a new loader.
 */
export function cssVersion(css: string = LOADER_CSS): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < css.length; i += 1) {
    hash ^= css.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** URL of the same CSS as a file, served by the gateway (`/w/loader.css`, ADR 010). */
export const loaderCssUrl = (gatewayOrigin: string): string =>
  new URL(`/w/loader.css?v=${cssVersion()}`, gatewayOrigin).toString();

/**
 * Styles the Shadow DOM without `style-src 'unsafe-inline'` on the client's site (ADR 010):
 * a constructable stylesheet (CSSOM, not restricted by CSP), or, where `adoptedStyleSheets` is
 * missing, a `<link>` to the gateway's file (the site allows the gateway in `style-src`).
 * Returns which way was used.
 */
export function attachStyles(root: ShadowRoot, gatewayOrigin: string): 'adopted' | 'link' {
  const view = root.ownerDocument.defaultView;
  if (view && 'adoptedStyleSheets' in root && typeof view.CSSStyleSheet === 'function') {
    try {
      const sheet = new view.CSSStyleSheet();
      sheet.replaceSync(LOADER_CSS);
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
      return 'adopted';
    } catch {
      // Constructable sheets announced but not usable (old engines): the file below.
    }
  }
  const link = root.ownerDocument.createElement('link');
  link.rel = 'stylesheet';
  link.href = loaderCssUrl(gatewayOrigin);
  root.prepend(link);
  return 'link';
}
