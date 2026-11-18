// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { message } from '../shared/messages.js';
import { mountLoader, optionsFromScript, type LoaderHandle } from './loader.js';

const GATEWAY = 'https://chat.gateway.test';
let handle: LoaderHandle;

beforeEach(() => {
  document.body.innerHTML = '';
  handle = mountLoader({
    tenant: 'pilot',
    gatewayOrigin: GATEWAY,
    locale: 'ro',
    pageOrigin: 'https://www.primarie.ro',
    preloadWhenIdle: false,
    loadConfig: () => Promise.resolve(undefined),
  });
});

afterEach(() => {
  document.body.innerHTML = '';
});

const launcher = () => handle.root.querySelector<HTMLButtonElement>('.launcher');
const panel = () => handle.root.querySelector<HTMLDivElement>('.panel');
const iframe = () => handle.root.querySelector<HTMLIFrameElement>('iframe');

function receive(data: unknown, origin = GATEWAY, source: unknown = iframe()?.contentWindow) {
  window.dispatchEvent(new MessageEvent('message', { data, origin, source: source as Window }));
}

describe('loader', () => {
  it('renders an accessible launcher and no iframe until opened', () => {
    expect(launcher()?.getAttribute('aria-label')).toBe('Deschide asistentul virtual');
    expect(launcher()?.getAttribute('aria-expanded')).toBe('false');
    expect(launcher()?.getAttribute('aria-controls')).toBe(panel()?.id);
    expect(panel()?.hidden).toBe(true);
    expect(iframe()).toBeNull();
  });

  it('preloads the hidden iframe on keyboard focus or pointer over the launcher', () => {
    launcher()?.dispatchEvent(new FocusEvent('focus'));
    expect(iframe()).not.toBeNull();
    expect(panel()?.hidden).toBe(true);
    launcher()?.dispatchEvent(new PointerEvent('pointerenter'));
    expect(handle.root.querySelectorAll('iframe')).toHaveLength(1);
  });

  it('preloads the iframe when the page is idle', async () => {
    document.body.innerHTML = '';
    handle = mountLoader({
      tenant: 'pilot',
      gatewayOrigin: GATEWAY,
      locale: 'ro',
      pageOrigin: 'https://www.primarie.ro',
      loadConfig: () => Promise.resolve(undefined),
    });
    expect(iframe()).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 2100));
    expect(iframe()).not.toBeNull();
    expect(panel()?.hidden).toBe(true);
  });

  it('creates the iframe on first open with tenant, parent and locale', () => {
    launcher()?.click();
    const src = new URL(iframe()?.src ?? '');
    expect(src.origin).toBe(GATEWAY);
    expect(src.pathname).toBe('/w/app');
    expect(src.searchParams.get('tenant')).toBe('pilot');
    expect(src.searchParams.get('parent')).toBe('https://www.primarie.ro');
    expect(src.searchParams.get('locale')).toBe('ro');
    expect(iframe()?.title).toBe('Asistent virtual');
    expect(panel()?.hidden).toBe(false);
    expect(launcher()?.getAttribute('aria-expanded')).toBe('true');
    expect(launcher()?.getAttribute('aria-label')).toBe('Minimizează asistentul virtual');
  });

  it('hides on a valid `hide` message and returns focus to the launcher', () => {
    launcher()?.click();
    receive(message({ type: 'hide' }));
    expect(panel()?.hidden).toBe(true);
    expect(handle.root.activeElement).toBe(launcher());
    // Reopening keeps the same iframe (conversation preserved).
    const first = iframe();
    launcher()?.click();
    expect(iframe()).toBe(first);
  });

  it.each([
    ['a foreign origin', message({ type: 'hide' }), 'https://evil.example', undefined],
    ['another window', message({ type: 'hide' }), GATEWAY, window],
    ['an invalid payload', { type: 'hide' }, GATEWAY, undefined],
    ['an unknown type', { source: 'chat-widget', v: 1, type: 'eval' }, GATEWAY, undefined],
  ])('ignores messages from %s', (_label, data, origin, source) => {
    launcher()?.click();
    receive(data, origin, source ?? iframe()?.contentWindow);
    expect(panel()?.hidden).toBe(false);
  });

  it('hides with Escape when focus is on the launcher', () => {
    launcher()?.click();
    launcher()?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
    );
    expect(panel()?.hidden).toBe(true);
  });
});

describe('optionsFromScript', () => {
  function script(attrs: Record<string, string>): HTMLScriptElement {
    const element = document.createElement('script');
    for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
    return element;
  }

  it('derives the gateway origin from the script src', () => {
    expect(
      optionsFromScript(
        script({ src: `${GATEWAY}/w/loader.js`, 'data-tenant': 'pilot', 'data-locale': 'en' }),
        'https://site.ro',
      ),
    ).toEqual({
      tenant: 'pilot',
      gatewayOrigin: GATEWAY,
      locale: 'en',
      pageOrigin: 'https://site.ro',
    });
  });

  it('rejects a missing or invalid tenant', () => {
    expect(optionsFromScript(script({ src: `${GATEWAY}/w/loader.js` }), 'x')).toBeUndefined();
    expect(
      optionsFromScript(script({ src: `${GATEWAY}/w/loader.js`, 'data-tenant': '<x>' }), 'x'),
    ).toBeUndefined();
  });
});

describe('admin preview mode (ADR 008)', () => {
  const proactiveConfig = {
    theme: { accent: '#3a36d0', accentEnd: '#1166c4', onAccent: '#ffffff' },
    launcher: {
      position: 'bottom-right' as const,
      offsetX: 24,
      offsetY: 24,
      icon: 'headset' as const,
    },
    window: { width: 380, height: 640, position: 'bottom-right' as const },
    proactive: {
      text: 'Vă putem ajuta?',
      delaySeconds: 30,
      frequency: 'session' as const,
      showOnMobile: false,
    },
    texts: {},
  };

  async function mountPreview(preview: 'launcher' | 'proactive' | 'window') {
    document.body.innerHTML = '';
    handle = mountLoader({
      tenant: 'pilot--p-0123456789abcdef0123456789abcdef',
      gatewayOrigin: GATEWAY,
      locale: 'ro',
      pageOrigin: GATEWAY,
      preloadWhenIdle: false,
      loadConfig: () => Promise.resolve(proactiveConfig),
      preview,
    });
    await handle.configured;
  }

  it('opens the window at once, and never takes the focus from the admin form', async () => {
    await mountPreview('window');
    expect(panel()?.hidden).toBe(false);
    expect(iframe()).not.toBeNull();
    const field = document.createElement('input');
    document.body.prepend(field);
    field.focus();
    receive(message({ type: 'preview', show: 'launcher' } as const), GATEWAY, window.parent);
    receive(message({ type: 'preview', show: 'window' } as const), GATEWAY, window.parent);
    expect(panel()?.hidden).toBe(false);
    expect(document.activeElement).toBe(field);
  });

  it('shows the proactive bubble without its delay, and the chosen launcher icon', async () => {
    await mountPreview('proactive');
    expect(panel()?.hidden).toBe(true);
    expect(handle.root.querySelector('.proactive')?.textContent).toContain('Vă putem ajuta?');
    expect(handle.root.querySelector('.launcher__icon--open svg')).not.toBeNull();
  });

  it('follows the admin interface (parent window on the gateway origin only)', async () => {
    await mountPreview('window');
    const control = (show: 'launcher' | 'proactive' | 'window') =>
      message({ type: 'preview', show } as const);
    receive(control('launcher'), GATEWAY, window.parent);
    expect(panel()?.hidden).toBe(true);
    receive(control('proactive'), GATEWAY, window.parent);
    expect(handle.root.querySelector('.proactive')).not.toBeNull();
    // Another origin, or not the parent window: ignored.
    receive(control('window'), 'https://evil.test', window.parent);
    receive(control('window'), GATEWAY, iframe()?.contentWindow ?? null);
    expect(panel()?.hidden).toBe(true);
    receive(control('window'), GATEWAY, window.parent);
    expect(panel()?.hidden).toBe(false);
    expect(handle.root.querySelector('.proactive')).toBeNull();
  });

  it('ignores preview messages outside preview mode', () => {
    receive(message({ type: 'preview', show: 'window' } as const), GATEWAY, window.parent);
    expect(panel()?.hidden).toBe(true);
  });
});

describe('optionsFromScript preview attribute', () => {
  it('accepts only the known preview states', () => {
    const script = document.createElement('script');
    script.src = `${GATEWAY}/w/loader.js`;
    script.dataset.tenant = 'pilot';
    script.dataset.preview = 'window';
    expect(optionsFromScript(script, GATEWAY)?.preview).toBe('window');
    script.dataset.preview = 'everything';
    expect(optionsFromScript(script, GATEWAY)?.preview).toBeUndefined();
  });
});
