// @vitest-environment happy-dom
import type { LoaderConfig } from 'gateway/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountLoader, type LoaderHandle } from './loader.js';

const GATEWAY = 'https://chat.gateway.test';

const proactive = {
  text: 'Aveți o întrebare?',
  delaySeconds: 3,
  frequency: 'session' as const,
  showOnMobile: false,
};

const config: LoaderConfig = {
  theme: { accent: '#0b6e4f', accentEnd: '#0a5c42', onAccent: '#ffffff' },
  launcher: {
    position: 'bottom-left',
    offsetX: 16,
    offsetY: 32,
    iconUrl: '/w/t/pilot/0123456789-logo.svg',
  },
  window: { width: 420, height: 600, position: 'bottom-left' },
  proactive,
  texts: { 'launcher.open': 'Deschide chatul primăriei', 'proactive.close': 'Ascunde' },
};

function mount(loaderConfig: LoaderConfig | null = config): LoaderHandle {
  return mountLoader({
    tenant: 'pilot',
    gatewayOrigin: GATEWAY,
    locale: 'ro',
    pageOrigin: 'https://www.primarie.ro',
    preloadWhenIdle: false,
    loadConfig: () => Promise.resolve(loaderConfig ?? undefined),
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
  sessionStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

const hostOf = (handle: LoaderHandle) => handle.root.host as HTMLElement;
const launcherOf = (handle: LoaderHandle) =>
  handle.root.querySelector<HTMLButtonElement>('.launcher');
const proactiveOf = (handle: LoaderHandle) => handle.root.querySelector<HTMLElement>('.proactive');

describe('loader configuration (E4)', () => {
  it('stays hidden until the configuration is applied, then uses the tenant look', async () => {
    const handle = mount();
    expect(hostOf(handle).style.visibility).toBe('hidden');
    await handle.configured;
    const host = hostOf(handle);
    expect(host.style.visibility).toBe('');
    expect(host.style.getPropertyValue('--cw-accent')).toBe('#0b6e4f');
    expect(host.style.getPropertyValue('--cw-offset-y')).toBe('32px');
    expect(host.style.getPropertyValue('--cw-width')).toBe('420px');
    expect(host.classList.contains('is-left')).toBe(true);
    expect(launcherOf(handle)?.getAttribute('aria-label')).toBe('Deschide chatul primăriei');
    const icon = handle.root.querySelector<HTMLImageElement>('.launcher__image');
    expect(icon?.src).toBe(`${GATEWAY}/w/t/pilot/0123456789-logo.svg`);
    expect(icon?.alt).toBe('');
  });

  it('shows itself with the defaults when the configuration cannot be loaded', async () => {
    const handle = mount(null);
    await handle.configured;
    expect(hostOf(handle).style.visibility).toBe('');
    expect(launcherOf(handle)?.getAttribute('aria-label')).toBe('Deschide asistentul virtual');
    expect(hostOf(handle).classList.contains('is-left')).toBe(false);
  });

  it('shows the proactive message after the delay, as a status, without taking focus', async () => {
    const handle = mount();
    await handle.configured;
    vi.advanceTimersByTime(2900);
    expect(proactiveOf(handle)).toBeNull();
    vi.advanceTimersByTime(200);
    const bubble = proactiveOf(handle);
    expect(bubble?.getAttribute('role')).toBe('status');
    expect(bubble?.textContent).toContain('Aveți o întrebare?');
    expect(handle.root.activeElement).toBeNull();
    expect(handle.root.querySelector('.proactive__close')?.getAttribute('aria-label')).toBe(
      'Ascunde',
    );
  });

  it('opens the chat from the message and can be dismissed', async () => {
    const handle = mount();
    await handle.configured;
    vi.advanceTimersByTime(3000);
    handle.root.querySelector<HTMLButtonElement>('.proactive__text')?.click();
    expect(proactiveOf(handle)).toBeNull();
    expect(launcherOf(handle)?.getAttribute('aria-expanded')).toBe('true');

    document.body.innerHTML = '';
    sessionStorage.clear();
    const second = mount();
    await second.configured;
    vi.advanceTimersByTime(3000);
    second.root.querySelector<HTMLButtonElement>('.proactive__close')?.click();
    expect(proactiveOf(second)).toBeNull();
  });

  it('is shown once per session', async () => {
    const first = mount();
    await first.configured;
    vi.advanceTimersByTime(3000);
    expect(proactiveOf(first)).not.toBeNull();

    document.body.innerHTML = '';
    const reloaded = mount();
    await reloaded.configured;
    vi.advanceTimersByTime(10_000);
    expect(proactiveOf(reloaded)).toBeNull();
  });

  it('is not shown if the visitor already opened the chat', async () => {
    const handle = mount();
    await handle.configured;
    launcherOf(handle)?.click();
    vi.advanceTimersByTime(5000);
    expect(proactiveOf(handle)).toBeNull();
  });

  it('is not shown on phones unless showOnMobile', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    const handle = mount();
    await handle.configured;
    vi.advanceTimersByTime(5000);
    expect(proactiveOf(handle)).toBeNull();

    document.body.innerHTML = '';
    const mobile = mount({ ...config, proactive: { ...proactive, showOnMobile: true } });
    await mobile.configured;
    vi.advanceTimersByTime(5000);
    expect(proactiveOf(mobile)).not.toBeNull();
    vi.restoreAllMocks();
  });
});

describe('loader: window side and disabled tenant (E4 completions)', () => {
  it('places the window on its own side, independent of the launcher', async () => {
    const handle = mount({ ...config, window: { ...config.window, position: 'bottom-right' } });
    await handle.configured;
    const host = hostOf(handle);
    expect(host.classList.contains('is-left')).toBe(true); // launcher on the left
    expect(host.classList.contains('window-left')).toBe(false); // window on the right
  });

  it('shows nothing and never loads the chat for a disabled tenant', async () => {
    vi.useRealTimers();
    const handle = mountLoader({
      tenant: 'pilot',
      gatewayOrigin: GATEWAY,
      locale: 'ro',
      pageOrigin: 'https://www.primarie.ro',
      loadConfig: () => Promise.resolve('disabled'),
    });
    await handle.configured;
    expect(document.querySelector('[data-chat-widget]')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 1200)); // idle preload window
    expect(handle.root.querySelector('iframe')).toBeNull();
  });
});
