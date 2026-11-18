/**
 * loader.js — included on the client's site with one line:
 *   <script src="https://<gateway>/w/loader.js" data-tenant="<id>" async></script>
 * Renders the launcher in a Shadow DOM and creates the chat iframe (ADR 004). Its look comes from
 * the tenant configuration (`/api/loader-config`, ADR 007).
 * Plain TypeScript, no framework: budget < 15 KB gzip.
 */
import { errorResponseSchema, loaderConfigSchema, type LoaderConfig } from 'gateway/protocol';
import { parseLocale, texts } from '../app/i18n/index.js';
import {
  appMessageSchema,
  message,
  PREVIEW_STATES,
  previewControlSchema,
  type LoaderMessage,
  type PreviewState,
} from '../shared/messages.js';
import { LOADER_CSS } from './styles.js';
import { iconElement, LAUNCHER_ICONS } from '../shared/icons/index.js';

// Static markup only (no external data): safe to assign as HTML.
const ICON_CHAT =
  '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01" stroke-width="2.6"/></svg>';
const ICON_CLOSE =
  '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
const ICON_X =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

/** How long the launcher may stay hidden while its configuration loads. */
const CONFIG_WAIT_MS = 1500;
const PHONE_QUERY = '(max-width: 480px)';

export interface LoaderOptions {
  tenant: string;
  /** Origin serving loader.js, the iframe and the API. */
  gatewayOrigin: string;
  locale: 'ro' | 'en';
  /** Origin of the host page, sent to the gateway as `parent`. */
  pageOrigin: string;
  /** Load the chat iframe in the background once the page is idle (default true). */
  preloadWhenIdle?: boolean;
  /** Fetches the tenant's loader configuration; tests pass a stub. */
  loadConfig?: () => Promise<LoaderConfig | 'disabled' | undefined>;
  /**
   * Admin preview (ADR 008, `data-preview`): starts in this state and follows the admin
   * interface's `preview` messages. Never steals focus.
   */
  preview?: PreviewState;
}

export interface LoaderHandle {
  open(): void;
  hide(): void;
  readonly root: ShadowRoot;
  /** Resolves once the configuration was applied (or the defaults kept). */
  readonly configured: Promise<void>;
}

/**
 * Real fetch of `/api/loader-config` (CORS, no credentials). `disabled` when the tenant was turned
 * off (E4b §5.6); undefined on any other problem (the launcher then uses the defaults).
 */
export function fetchLoaderConfig(
  options: LoaderOptions,
): Promise<LoaderConfig | 'disabled' | undefined> {
  const url = new URL('/api/loader-config', options.gatewayOrigin);
  url.searchParams.set('tenant', options.tenant);
  url.searchParams.set('locale', options.locale);
  return fetch(url, { mode: 'cors', credentials: 'omit' })
    .then(async (response) => {
      const json = (await response.json()) as unknown;
      const error = errorResponseSchema.safeParse(json);
      if (response.status === 503 && error.success && error.data.error.code === 'tenant_disabled') {
        return 'disabled' as const;
      }
      const parsed = loaderConfigSchema.safeParse(json);
      return response.ok && parsed.success ? parsed.data : undefined;
    })
    .catch(() => undefined);
}

export function mountLoader(options: LoaderOptions, doc: Document = document): LoaderHandle {
  const view = doc.defaultView;
  const defaults = texts(options.locale);
  const labels = {
    open: defaults.launcher.open,
    close: defaults.launcher.close,
    frameTitle: defaults.frameTitle,
    proactiveClose: defaults.proactive.close,
  };

  const host = doc.createElement('div');
  host.setAttribute('data-chat-widget', options.tenant);
  // Hidden until the tenant's colors are known (at most CONFIG_WAIT_MS).
  host.style.visibility = 'hidden';
  const root = host.attachShadow({ mode: 'open' });

  const style = doc.createElement('style');
  style.textContent = LOADER_CSS;

  const panel = doc.createElement('div');
  panel.className = 'panel';
  panel.id = 'chat-widget-panel';
  panel.hidden = true;

  const launcher = doc.createElement('button');
  launcher.type = 'button';
  launcher.className = 'launcher';
  launcher.setAttribute('aria-controls', panel.id);
  const openIcon = doc.createElement('span');
  openIcon.className = 'launcher__icon launcher__icon--open';
  openIcon.innerHTML = ICON_CHAT;
  const closeIcon = doc.createElement('span');
  closeIcon.className = 'launcher__icon launcher__icon--close';
  closeIcon.innerHTML = ICON_CLOSE;
  launcher.append(openIcon, closeIcon);

  root.append(style, panel, launcher);
  doc.body.append(host);

  let iframe: HTMLIFrameElement | undefined;
  let ready = false;
  let pendingShown = false;
  let everOpened = false;
  let proactive: HTMLElement | undefined;
  let proactiveTimer: number | undefined;
  let appliedConfig: LoaderConfig | undefined;

  const post = (payload: LoaderMessage): void => {
    iframe?.contentWindow?.postMessage(payload, options.gatewayOrigin);
  };

  const render = (open: boolean): void => {
    panel.hidden = !open;
    launcher.setAttribute('aria-expanded', String(open));
    launcher.setAttribute('aria-label', open ? labels.close : labels.open);
  };

  const createIframe = (): HTMLIFrameElement => {
    const frame = doc.createElement('iframe');
    const src = new URL('/w/app', options.gatewayOrigin);
    src.searchParams.set('tenant', options.tenant);
    src.searchParams.set('parent', options.pageOrigin);
    src.searchParams.set('locale', options.locale);
    frame.src = src.toString();
    frame.title = labels.frameTitle;
    frame.className = 'frame';
    frame.setAttribute('allow', 'clipboard-write');
    frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    panel.append(frame);
    return frame;
  };

  /**
   * The chat is loaded ahead of the first click (hidden), so that opening it moves focus into a
   * ready frame during the click itself: browsers only move focus across origins reliably inside
   * a user gesture (ADR 004). It also makes the window open instantly.
   */
  const preload = (): void => {
    iframe ??= createIframe();
  };

  const removeProactive = (): void => {
    if (proactiveTimer !== undefined) view?.clearTimeout(proactiveTimer);
    proactiveTimer = undefined;
    proactive?.remove();
    proactive = undefined;
  };

  const open = (): void => {
    everOpened = true;
    removeProactive();
    iframe ??= createIframe();
    render(true);
    // Move keyboard focus into the window; the app then focuses its composer on `shown`.
    iframe.focus();
    if (ready) post(message({ type: 'shown' }));
    else pendingShown = true;
  };

  const hide = (): void => {
    if (panel.hidden) return;
    render(false);
    launcher.focus();
  };

  launcher.addEventListener('click', () => {
    if (panel.hidden) open();
    else hide();
  });

  // Escape while focus is in the loader (inside the iframe, the app sends `hide`).
  root.addEventListener('keydown', (event) => {
    if (!(event instanceof KeyboardEvent) || event.key !== 'Escape') return;
    if (!panel.hidden) hide();
    else removeProactive();
  });

  // Admin preview only: the admin interface (same origin as the gateway) chooses the state.
  if (options.preview) {
    view?.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (event.origin !== options.gatewayOrigin || event.source !== view.parent) return;
      const parsed = previewControlSchema.safeParse(event.data);
      if (parsed.success) showPreview(parsed.data.show);
    });
  }

  view?.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.origin !== options.gatewayOrigin) return;
    if (!iframe || event.source !== iframe.contentWindow) return;
    const parsed = appMessageSchema.safeParse(event.data);
    if (!parsed.success) return;
    switch (parsed.data.type) {
      case 'ready':
        ready = true;
        // Observable state (tests, host page debugging); no data about the conversation.
        host.setAttribute('data-ready', 'true');
        if (pendingShown && !panel.hidden) {
          // Opened before the preload finished: best effort, focus may stay on the frame element
          // in some browsers (the user can Tab into it).
          iframe.focus();
          post(message({ type: 'shown' }));
        }
        pendingShown = false;
        break;
      case 'hide':
        hide();
        break;
    }
  });

  /** Shows the proactive bubble now (announced politely; focus stays where the visitor is). */
  const showProactive = (config: NonNullable<LoaderConfig['proactive']>): void => {
    removeProactive();
    const bubble = doc.createElement('div');
    bubble.className = 'proactive';
    // Announced once, politely; focus stays where the visitor is.
    bubble.setAttribute('role', 'status');
    const textButton = doc.createElement('button');
    textButton.type = 'button';
    textButton.className = 'proactive__text';
    textButton.textContent = config.text;
    textButton.addEventListener('click', open);
    const dismiss = doc.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'proactive__close';
    dismiss.setAttribute('aria-label', labels.proactiveClose);
    dismiss.title = labels.proactiveClose;
    dismiss.innerHTML = ICON_X;
    dismiss.addEventListener('click', removeProactive);
    bubble.append(textButton, dismiss);
    proactive = bubble;
    root.append(bubble);
  };

  /** Proactive message (ADR 007): once per browsing session, never steals focus. */
  const scheduleProactive = (config: NonNullable<LoaderConfig['proactive']>): void => {
    const key = `chat-widget-proactive:${options.tenant}`;
    if (readSession(view, key)) return;
    if (!config.showOnMobile && view?.matchMedia(PHONE_QUERY).matches) return;
    proactiveTimer = view?.setTimeout(() => {
      proactiveTimer = undefined;
      if (everOpened) return;
      writeSession(view, key);
      showProactive(config);
    }, config.delaySeconds * 1000);
  };

  /**
   * Admin preview: shows one state at once, without delays, session memory or moving focus
   * (the administrator keeps typing in the form next to it).
   */
  const showPreview = (state: PreviewState): void => {
    removeProactive();
    if (state === 'window') {
      iframe ??= createIframe();
      render(true);
      return;
    }
    render(false);
    if (state === 'proactive' && appliedConfig?.proactive) showProactive(appliedConfig.proactive);
  };

  const applyConfig = (config: LoaderConfig | undefined): void => {
    if (config) {
      const set = (name: string, value: string) => {
        host.style.setProperty(name, value);
      };
      set('--cw-accent', config.theme.accent);
      set('--cw-accent-2', config.theme.accentEnd);
      set('--cw-on-accent', config.theme.onAccent);
      set('--cw-offset-x', `${String(config.launcher.offsetX)}px`);
      set('--cw-offset-y', `${String(config.launcher.offsetY)}px`);
      set('--cw-width', `${String(config.window.width)}px`);
      set('--cw-height', `${String(config.window.height)}px`);
      host.classList.toggle('is-left', config.launcher.position === 'bottom-left');
      // The window has its own side (configured separately, or following the launcher).
      host.classList.toggle('window-left', config.window.position === 'bottom-left');

      labels.open = config.texts['launcher.open'] ?? labels.open;
      labels.close = config.texts['launcher.close'] ?? labels.close;
      labels.frameTitle = config.texts.frameTitle ?? labels.frameTitle;
      labels.proactiveClose = config.texts['proactive.close'] ?? labels.proactiveClose;
      if (iframe) iframe.title = labels.frameTitle;

      if (config.launcher.iconUrl) {
        const image = doc.createElement('img');
        image.src = new URL(config.launcher.iconUrl, options.gatewayOrigin).toString();
        image.alt = ''; // decorative: the button has its own label
        image.className = 'launcher__image';
        openIcon.replaceChildren(image);
      } else if (config.launcher.icon) {
        // Built-in icon from the bundled set (the default `chat` icon is already drawn).
        openIcon.replaceChildren(iconElement(doc, LAUNCHER_ICONS[config.launcher.icon], 28));
      }
      appliedConfig = config;
      if (config.proactive && !options.preview) scheduleProactive(config.proactive);
    }
    render(!panel.hidden);
    host.style.removeProperty('visibility');
    if (options.preview) showPreview(options.preview);
  };

  // Preload on intent (pointer over, keyboard focus, touch) or when the page is idle.
  for (const type of ['pointerenter', 'focus', 'touchstart'] as const) {
    launcher.addEventListener(type, preload, { once: true, passive: true });
  }
  render(false);
  let disabled = false;
  const load = options.loadConfig ?? (() => fetchLoaderConfig(options));
  const configured = Promise.race([
    load(),
    new Promise<undefined>((resolve) => {
      view?.setTimeout(() => {
        resolve(undefined);
      }, CONFIG_WAIT_MS);
    }),
  ]).then((config) => {
    if (config === 'disabled') {
      // Tenant turned off: nothing is shown and the chat is never loaded.
      disabled = true;
      host.remove();
      return;
    }
    applyConfig(config);
  });
  if (options.preloadWhenIdle !== false) {
    whenIdle(doc, () => {
      void configured.then(() => {
        if (!disabled) preload();
      });
    });
  }
  return { open, hide, root, configured };
}

// The host page's storage may be blocked: never fatal, the message is then shown per page load.
function readSession(view: Window | null, key: string): boolean {
  try {
    return view?.sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeSession(view: Window | null, key: string): void {
  try {
    view?.sessionStorage.setItem(key, '1');
  } catch {
    // ignore
  }
}

/** Runs `task` after the page has loaded and the browser is idle (or after 2 s at most). */
function whenIdle(doc: Document, task: () => void): void {
  const view = doc.defaultView;
  if (!view) return;
  // Older Safari versions have no requestIdleCallback.
  const idle = (view as Partial<Pick<Window, 'requestIdleCallback'>>).requestIdleCallback;
  const schedule = () => {
    if (idle) idle.call(view, task, { timeout: 2000 });
    else view.setTimeout(task, 1000);
  };
  if (doc.readyState === 'complete') schedule();
  else view.addEventListener('load', schedule, { once: true });
}

/** Reads options from the `<script>` tag that loaded this file. */
export function optionsFromScript(
  script: HTMLScriptElement | null,
  pageOrigin: string,
): LoaderOptions | undefined {
  const tenant = script?.dataset.tenant;
  if (!script?.src || !tenant || !/^[a-z0-9-]{1,100}$/.test(tenant)) return undefined;
  const preview = PREVIEW_STATES.find((state) => state === script.dataset.preview);
  return {
    tenant,
    gatewayOrigin: new URL(script.src).origin,
    locale: parseLocale(script.dataset.locale),
    pageOrigin,
    ...(preview ? { preview } : {}),
  };
}
