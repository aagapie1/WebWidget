import { render } from 'preact';
import { loaderMessageSchema, message, type AppMessage } from '../shared/messages.js';
import { App } from './App.js';
import { fetchWidgetConfig, GatewayTransport } from './chat/api.js';
import { ChatController } from './chat/controller.js';
import { parseLocale, texts as textsFor } from './i18n/index.js';
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

let focusComposer: () => void = () => undefined;
window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (!parent || event.origin !== parent || event.source !== window.parent) return;
  const parsed = loaderMessageSchema.safeParse(event.data);
  // Only one loader → iframe message exists today (`shown`).
  if (parsed.success) focusComposer();
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

  const controller = new ChatController({
    transport: new GatewayTransport(tenant, locale, {
      code: 'internal_error',
      message: texts.errors.network,
      retryable: true,
    }),
    texts,
    toPlainText: markdownToText,
  });
  controller.setWelcome(config.welcomeMessage);
  document.title = config.assistantName;

  render(
    <App
      controller={controller}
      texts={texts}
      assistantName={config.assistantName}
      onHide={hide}
      registerFocus={(focus) => {
        focusComposer = focus;
      }}
    />,
    root,
  );
  postToParent(message({ type: 'ready' }));
}

void start();
