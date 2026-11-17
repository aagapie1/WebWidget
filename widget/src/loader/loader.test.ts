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
