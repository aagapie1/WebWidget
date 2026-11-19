import { useId, useState } from 'preact/hooks';
import type { Installation } from '../api.js';
import { formatDateTime, useI18n } from '../i18n.js';

interface IntegrationSectionProps {
  tenant: string;
  /** The gateway's public address (server configuration). */
  gatewayOrigin: string;
  /** The published allowed domains. */
  origins: readonly string[];
  checkInstallations: () => Promise<{ installations: Installation[] }>;
  /** Allowed domains of the draft: valid, missing or with errors (checklist state). */
  domainsStatus?: 'ok' | 'missing' | 'invalid';
  /** Opens "Domenii permise". */
  onDomains?: () => void;
  /** Writes to the clipboard; tests pass a stub. */
  copy?: (text: string) => Promise<void>;
}

/** The embed code of the widget (one line), as on the client's site. */
export function embedSnippet(gatewayOrigin: string, tenant: string, locale: 'ro' | 'en'): string {
  const lang = locale === 'en' ? ' data-locale="en"' : '';
  return `<script src="${gatewayOrigin}/w/loader.js" data-tenant="${tenant}"${lang} async></script>`;
}

/** Content-Security-Policy additions for sites that have one. */
export function cspFor(gatewayOrigin: string): string[] {
  return [
    `script-src ${gatewayOrigin}`,
    `frame-src ${gatewayOrigin}`,
    `connect-src ${gatewayOrigin}`,
    `img-src ${gatewayOrigin}`,
  ];
}

/**
 * Site integration (E4b.1 UX, like Dify's embed dialog): the code ready to copy, where it goes,
 * the optional attributes, a checklist, and "Verifică instalarea" (the gateway records when the
 * widget last loaded on each allowed site).
 */
export function IntegrationSection(props: IntegrationSectionProps) {
  const { t, locale: uiLocale } = useI18n();
  const id = useId();
  const [locale, setLocale] = useState<'ro' | 'en'>('ro');
  const [copyStatus, setCopyStatus] = useState('');
  const [check, setCheck] = useState<
    | { state: 'idle' }
    | { state: 'checking' }
    | { state: 'done'; list: Installation[] }
    | { state: 'failed' }
  >({ state: 'idle' });
  const snippet = embedSnippet(props.gatewayOrigin, props.tenant, locale);
  const copy =
    props.copy ??
    ((text: string) => {
      return navigator.clipboard.writeText(text);
    });
  const text = t.ux.integration;
  const domainsOk = (props.domainsStatus ?? (props.origins.length > 0 ? 'ok' : 'missing')) === 'ok';

  return (
    <section class="card" aria-labelledby="section-integration">
      <h2 id="section-integration">{text.title}</h2>
      <p>{text.intro}</p>

      <fieldset class="field">
        <legend>{text.locale}</legend>
        {(['ro', 'en'] as const).map((value) => (
          <label key={value} class="choice">
            <input
              type="radio"
              name={`${id}-locale`}
              checked={locale === value}
              onChange={() => {
                setLocale(value);
              }}
            />
            {value === 'ro' ? text.localeRo : text.localeEn}
          </label>
        ))}
      </fieldset>

      <div class="field">
        <p class="field__label" id={`${id}-code`}>
          {text.code}
        </p>
        <pre class="code" aria-labelledby={`${id}-code`} tabIndex={0}>
          <code>{snippet}</code>
        </pre>
        <div class="row-actions">
          <button
            type="button"
            class="button"
            onClick={() => {
              copy(snippet).then(
                () => {
                  setCopyStatus(text.copied);
                },
                () => {
                  setCopyStatus(text.copyFailed);
                },
              );
            }}
          >
            {text.copy}
          </button>
          <p class="field__hint" role="status" aria-live="polite">
            {copyStatus}
          </p>
        </div>
        <p class="field__hint">{text.noCss}</p>
      </div>

      <h3>{text.checklist}</h3>
      <ul class="checklist">
        <li class={`checklist__item checklist__item--${domainsOk ? 'ok' : 'warn'}`}>
          <span class="checklist__state" aria-hidden="true">
            {domainsOk ? '✓' : '⚠'}
          </span>
          <span class="visually-hidden">{domainsOk ? t.ux.checkOk : t.ux.checkWarn}: </span>
          <span>
            {text.domains}{' '}
            <a
              href="#domains"
              onClick={(event) => {
                if (props.onDomains) {
                  event.preventDefault();
                  props.onDomains();
                }
              }}
            >
              {text.domainsLink}
            </a>
            .{' '}
            {props.domainsStatus === 'missing'
              ? t.ux.domainsMissing
              : props.domainsStatus === 'invalid'
                ? t.ux.domainsInvalid
                : text.domainsNow(props.origins.join(', '))}
          </span>
        </li>
        <li class="checklist__item checklist__item--info">
          <span class="checklist__state" aria-hidden="true">
            i
          </span>
          <span>
            {text.csp}
            <pre class="code" tabIndex={0}>
              <code>{cspFor(props.gatewayOrigin).join(';\n')}</code>
            </pre>
            <p class="field__hint">{text.cspNote}</p>
          </span>
        </li>
      </ul>

      <div class="row-actions">
        <button
          type="button"
          class="button"
          aria-disabled={check.state === 'checking' ? 'true' : undefined}
          onClick={() => {
            if (check.state === 'checking') return;
            setCheck({ state: 'checking' });
            props.checkInstallations().then(
              (result) => {
                setCheck({ state: 'done', list: result.installations });
              },
              () => {
                setCheck({ state: 'failed' });
              },
            );
          }}
        >
          {check.state === 'checking' ? text.checking : text.check}
        </button>
      </div>
      <div role="status" aria-live="polite">
        {check.state === 'failed' && <p class="field__errors">{text.checkFailed}</p>}
        {check.state === 'done' &&
          (check.list.length === 0 ? (
            <p>{text.noOrigins}</p>
          ) : (
            <ul class="installations">
              {check.list.map((item) => (
                <li key={item.origin} class={item.lastSeen ? 'ok' : undefined}>
                  {item.lastSeen
                    ? text.seen(item.origin, formatDateTime(item.lastSeen, uiLocale))
                    : text.notSeen(item.origin)}
                </li>
              ))}
            </ul>
          ))}
      </div>
    </section>
  );
}
