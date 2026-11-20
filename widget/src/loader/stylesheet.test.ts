// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountLoader } from './loader.js';
import { attachStyles, cssVersion, loaderCssUrl } from './stylesheet.js';
import { LOADER_CSS } from './styles.js';

const GATEWAY = 'https://chat.gateway.test';

afterEach(() => {
  document.body.innerHTML = '';
});

const shadow = (): ShadowRoot => {
  const host = document.createElement('div');
  document.body.append(host);
  return host.attachShadow({ mode: 'open' });
};

describe('loader styles without inline <style> (ADR 010)', () => {
  it('the mounted loader has no <style> element', () => {
    const handle = mountLoader({
      tenant: 'pilot',
      gatewayOrigin: GATEWAY,
      locale: 'ro',
      pageOrigin: 'https://www.primarie.ro',
      preloadWhenIdle: false,
      loadConfig: () => Promise.resolve(undefined),
    });
    expect(handle.root.querySelector('style')).toBeNull();
    // Either an adopted sheet or the gateway's file: never inline CSS.
    const link = handle.root.querySelector('link[rel="stylesheet"]');
    expect(handle.root.adoptedStyleSheets.length > 0 || link !== null).toBe(true);
  });

  it('uses a constructable stylesheet where the browser has one', () => {
    const root = shadow();
    expect(attachStyles(root, GATEWAY)).toBe('adopted');
    expect(root.adoptedStyleSheets).toHaveLength(1);
    expect(root.querySelector('link')).toBeNull();
  });

  const expectLink = (root: ShadowRoot) => {
    const link = root.querySelector('link');
    expect(link?.rel).toBe('stylesheet');
    expect(link?.href).toBe(`${GATEWAY}/w/loader.css?v=${cssVersion()}`);
    expect(root.firstChild).toBe(link);
    expect(root.adoptedStyleSheets).toHaveLength(0);
  };

  it("falls back to the gateway's versioned CSS file without constructable stylesheets", () => {
    vi.stubGlobal('CSSStyleSheet', undefined);
    try {
      const root = shadow();
      expect(attachStyles(root, GATEWAY)).toBe('link');
      expectLink(root);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('falls back too when a constructable stylesheet cannot be filled', () => {
    vi.stubGlobal(
      'CSSStyleSheet',
      class {
        replaceSync(): void {
          throw new Error('NotAllowedError');
        }
      },
    );
    try {
      const root = shadow();
      expect(attachStyles(root, GATEWAY)).toBe('link');
      expectLink(root);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('versions the file by its text', () => {
    expect(cssVersion()).toBe(cssVersion(LOADER_CSS));
    expect(cssVersion('a')).not.toBe(cssVersion('b'));
    expect(loaderCssUrl(GATEWAY)).toMatch(
      /^https:\/\/chat\.gateway\.test\/w\/loader\.css\?v=[0-9a-z]+$/,
    );
  });
});
