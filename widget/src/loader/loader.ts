/**
 * loader.js — included on the client's site with one line:
 *   <script src="https://<gateway>/w/loader.js" data-tenant="<id>" async></script>
 * Renders the launcher in a Shadow DOM and creates the chat iframe on first open (ADR 004).
 * Plain TypeScript, no framework: budget < 15 KB gzip.
 */
import { parseLocale, texts } from '../app/i18n/index.js';
import { appMessageSchema, message, type LoaderMessage } from '../shared/messages.js';
import { LOADER_CSS } from './styles.js';

const ICON_CHAT =
  '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01" stroke-width="2.6"/></svg>';
const ICON_CLOSE =
  '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

export interface LoaderOptions {
  tenant: string;
  /** Origin serving loader.js, the iframe and the API. */
  gatewayOrigin: string;
  locale: 'ro' | 'en';
  /** Origin of the host page, sent to the gateway as `parent`. */
  pageOrigin: string;
}

export interface LoaderHandle {
  open(): void;
  hide(): void;
  readonly root: ShadowRoot;
}

export function mountLoader(options: LoaderOptions, doc: Document = document): LoaderHandle {
  const t = texts(options.locale);
  const host = doc.createElement('div');
  host.setAttribute('data-chat-widget', options.tenant);
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

  root.append(style, panel, launcher);
  doc.body.append(host);

  let iframe: HTMLIFrameElement | undefined;
  let ready = false;
  let pendingShown = false;

  const post = (payload: LoaderMessage): void => {
    iframe?.contentWindow?.postMessage(payload, options.gatewayOrigin);
  };

  const render = (open: boolean): void => {
    panel.hidden = !open;
    launcher.setAttribute('aria-expanded', String(open));
    launcher.setAttribute('aria-label', open ? t.launcher.close : t.launcher.open);
    launcher.innerHTML = open ? ICON_CLOSE : ICON_CHAT; // static icons only, no external data
  };

  const createIframe = (): HTMLIFrameElement => {
    const frame = doc.createElement('iframe');
    const src = new URL('/w/app', options.gatewayOrigin);
    src.searchParams.set('tenant', options.tenant);
    src.searchParams.set('parent', options.pageOrigin);
    src.searchParams.set('locale', options.locale);
    frame.src = src.toString();
    frame.title = t.frameTitle;
    frame.className = 'frame';
    frame.setAttribute('allow', 'clipboard-write');
    frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    panel.append(frame);
    return frame;
  };

  const open = (): void => {
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

  // Escape while focus is on the launcher (inside the iframe, the app sends `hide`).
  root.addEventListener('keydown', (event) => {
    if (event instanceof KeyboardEvent && event.key === 'Escape' && !panel.hidden) hide();
  });

  doc.defaultView?.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.origin !== options.gatewayOrigin) return;
    if (!iframe || event.source !== iframe.contentWindow) return;
    const parsed = appMessageSchema.safeParse(event.data);
    if (!parsed.success) return;
    switch (parsed.data.type) {
      case 'ready':
        ready = true;
        if (pendingShown && !panel.hidden) {
          // First open: focusing the iframe before its page loaded does not stick in every
          // browser, so focus it again now that the app is ready, then let it focus the input.
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

  render(false);
  return { open, hide, root };
}

/** Reads options from the `<script>` tag that loaded this file. */
export function optionsFromScript(
  script: HTMLScriptElement | null,
  pageOrigin: string,
): LoaderOptions | undefined {
  const tenant = script?.dataset.tenant;
  if (!script?.src || !tenant || !/^[a-z0-9-]{1,64}$/.test(tenant)) return undefined;
  return {
    tenant,
    gatewayOrigin: new URL(script.src).origin,
    locale: parseLocale(script.dataset.locale),
    pageOrigin,
  };
}
