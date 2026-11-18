import { render } from 'preact';
import { loaderMessageSchema, message, type AppMessage } from '../shared/messages.js';
import { App } from './App.js';
import { fetchWidgetConfig, GatewayTransport } from './chat/api.js';
import { ChatController } from './chat/controller.js';
import { parseLocale, texts as textsFor, withOverrides } from './i18n/index.js';
import { applyTheme } from './theme.js';
import { markdownToText, setNewTabNote } from './markdown.js';
import './styles.css';

const params = new URLSearchParams(window.location.search);
const tenant = params.get('tenant') ?? '';
const locale = parseLocale(params.get('locale'));
const texts = textsFor(locale);
document.documentElement.lang = locale;
setNewTabNote(texts.links.newTab);

/** The gateway only serves this page when `parent` is one of the tenant's allowed origins. */
function parentOrigin(): string | undefined {
  const parent = params.get('parent');
  if (!parent) return undefined;
  try {
    return new URL(parent).origin === parent ? parent : undefined;
  } catch {
    return undefined;
  }
}
const parent = parentOrigin();

function postToParent(payload: AppMessage): void {
  if (parent && window.parent !== window) window.parent.postMessage(payload, parent);
}

const hide = () => {
  postToParent(message({ type: 'hide' }));
};

// `shown` can arrive before <App> registered its focus function (effects run after `ready` is
// posted): remember the request and apply it on registration.
let focusComposer: (() => void) | undefined;
let focusRequested = false;
window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (!parent || event.origin !== parent || event.source !== window.parent) return;
  const parsed = loaderMessageSchema.safeParse(event.data);
  // Only one loader → iframe message exists today (`shown`).
  if (!parsed.success) return;
  if (focusComposer) focusComposer();
  else focusRequested = true;
});

const root = document.getElementById('root');

async function start(): Promise<void> {
  if (!root) return;
  let config;
  try {
    config = await fetchWidgetConfig(tenant, locale);
  } catch {
    render(
      <p class="load-error" role="alert">
        {texts.errors.loadFailed}
      </p>,
      root,
    );
    return;
  }

  // Tenant look and texts (ADR 007); colors are pre-validated for WCAG AA by the gateway.
  applyTheme(document.documentElement, config.theme);
  const tenantTexts = withOverrides(texts, config.texts);
  setNewTabNote(tenantTexts.links.newTab);

  const controller = new ChatController({
    transport: new GatewayTransport(tenant, locale, {
      code: 'internal_error',
      message: tenantTexts.errors.network,
      retryable: true,
    }),
    texts: tenantTexts,
    toPlainText: markdownToText,
    suggestionsAfterAnswer: config.suggestionsAfterAnswer,
  });
  controller.setWelcome(config.welcomeMessage);
  controller.setSuggestions(config.suggestedQuestions);
  // Resume the latest conversation with its history (ADR 005); no-op for new visitors.
  void controller.resumeLatest();
  document.title = config.assistantName;

  render(
    <App
      locale={locale}
      controller={controller}
      texts={tenantTexts}
      identity={config.identity}
      assistantName={config.assistantName}
      onHide={hide}
      registerFocus={(focus) => {
        focusComposer = focus;
        if (focusRequested) {
          focusRequested = false;
          focus();
        }
      }}
    />,
    root,
  );
  postToParent(message({ type: 'ready' }));
}

void start();
