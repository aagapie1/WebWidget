import { useEffect, useId, useRef, useState } from 'preact/hooks';
import {
  ApiError,
  auditExportUrl,
  type AdminApi,
  type AuditEventView,
  type AuditQuery,
} from '../api.js';
import { useI18n, type Locale } from '../i18n.js';

/** The filters as typed in the form; `to` is inclusive here and exclusive in the API. */
interface FilterForm {
  from: string;
  to: string;
  user: string;
  action: string;
  section: string;
  result: string;
  q: string;
}
const EMPTY: FilterForm = {
  from: '',
  to: '',
  user: '',
  action: '',
  section: '',
  result: '',
  q: '',
};
const PAGE = 50;
export const PLATFORM = 'platform';

const ROMANIA = 'Europe/Bucharest';
const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: ROMANIA,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

/** Midnight in Romania on a `YYYY-MM-DD` day (plus `days`), as a UTC instant for the API. */
export function romaniaMidnight(day: string, days = 0): string {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
  const guess = Date.UTC(year, month - 1, date + days);
  const value = (type: string) =>
    Number(parts.formatToParts(guess).find((part) => part.type === type)?.value ?? 0);
  const local = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second'),
  );
  return new Date(guess - (local - guess)).toISOString();
}

/** The form → the API's query (empty values left out, the period in Romanian days). */
export function toQuery(form: FilterForm): AuditQuery {
  return {
    ...(form.from ? { from: romaniaMidnight(form.from) } : {}),
    ...(form.to ? { to: romaniaMidnight(form.to, 1) } : {}),
    ...(form.user.trim() ? { user: form.user.trim() } : {}),
    ...(form.action ? { action: form.action } : {}),
    ...(form.section.trim() ? { section: form.section.trim() } : {}),
    ...(form.result ? { result: form.result } : {}),
    ...(form.q.trim() ? { q: form.q.trim() } : {}),
  };
}

/** Always the time in Romania (the log is kept in UTC), in the interface's language. */
export function formatRomaniaTime(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleString(locale === 'en' ? 'en-GB' : 'ro-RO', {
    timeZone: ROMANIA,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

interface AuditLogProps {
  api: AdminApi;
  /** The client whose log opens first. */
  tenant: string;
  /** Super-admin: the logs to choose from (the clients, then the platform). */
  chains?: readonly string[] | undefined;
  onSessionExpired: () => void;
}

type Status = 'loading' | 'ready' | 'failed';

/** "Jurnal de audit" (E5 B9): filters, the events newest first, details with the diff, export. */
export function AuditLog({ api, tenant, chains, onSessionExpired }: AuditLogProps) {
  const { t, locale } = useI18n();
  const id = useId();
  const [chain, setChain] = useState(tenant);
  const [form, setForm] = useState<FilterForm>(EMPTY);
  const [applied, setApplied] = useState<AuditQuery>({});
  const [events, setEvents] = useState<AuditEventView[]>([]);
  const [nextBefore, setNextBefore] = useState<number | undefined>();
  const [status, setStatus] = useState<Status>('loading');
  const [selected, setSelected] = useState<AuditEventView | undefined>();
  // Only the newest request may fill the table (a slow page must not overwrite a newer filter).
  const request = useRef(0);

  const query = (filters: AuditQuery): AuditQuery =>
    chains ? { ...filters, chain } : { ...filters };

  const load = (filters: AuditQuery, options: { opened?: boolean; before?: number } = {}) => {
    const mine = ++request.current;
    setStatus('loading');
    api
      .auditList({
        ...query(filters),
        limit: String(PAGE),
        ...(options.opened ? { opened: '1' } : {}),
        ...(options.before === undefined ? {} : { before: String(options.before) }),
      })
      .then(
        (page) => {
          if (mine !== request.current) return;
          setEvents((current) =>
            options.before === undefined ? page.events : [...current, ...page.events],
          );
          setNextBefore(page.nextBefore);
          setStatus('ready');
        },
        (error: unknown) => {
          if (mine !== request.current) return;
          if (error instanceof ApiError && error.status === 401) onSessionExpired();
          else setStatus('failed');
        },
      );
  };

  // Opening the screen (or another client's log) is recorded once by the gateway (`opened`).
  useEffect(() => {
    load(applied, { opened: true });
  }, [chain]);

  const field =
    (key: keyof FilterForm) =>
    (event: Event): void => {
      const value = (event.currentTarget as HTMLInputElement | HTMLSelectElement).value;
      setForm((current) => ({ ...current, [key]: value }));
    };

  const actionLabel = (action: string): string =>
    t.audit.actions[action] ??
    (action.startsWith('keycloak.') ? t.audit.otherKeycloak(action.slice(9)) : action);
  const who = (event: AuditEventView): string =>
    event.actor.name ??
    event.actor.email ??
    (event.actor.kind === 'system' ? t.audit.system : event.actor.subject);

  return (
    <section class="audit" aria-labelledby="area-title">
      <p class="audit__intro">{t.audit.intro}</p>
      {chains && (
        <div class="field audit__chain">
          <label for={`${id}-chain`}>{t.audit.chain}</label>
          <select
            id={`${id}-chain`}
            value={chain}
            onChange={(event) => {
              // The same log again: nothing to reload (clearing it would leave the table empty).
              if (event.currentTarget.value === chain) return;
              setEvents([]);
              setNextBefore(undefined);
              setChain(event.currentTarget.value);
            }}
          >
            {chains.map((item) => (
              <option key={item} value={item}>
                {item === PLATFORM ? t.audit.platformChain : item}
              </option>
            ))}
          </select>
        </div>
      )}
      <form
        class="audit__filters"
        aria-label={t.audit.filters}
        onSubmit={(event) => {
          event.preventDefault();
          const next = toQuery(form);
          setApplied(next);
          load(next);
        }}
      >
        <div class="field">
          <label for={`${id}-from`}>{t.audit.from}</label>
          <input id={`${id}-from`} type="date" value={form.from} onInput={field('from')} />
        </div>
        <div class="field">
          <label for={`${id}-to`}>{t.audit.to}</label>
          <input id={`${id}-to`} type="date" value={form.to} onInput={field('to')} />
        </div>
        <div class="field">
          <label for={`${id}-user`}>{t.audit.user}</label>
          <input id={`${id}-user`} type="text" value={form.user} onInput={field('user')} />
        </div>
        <div class="field">
          <label for={`${id}-action`}>{t.audit.action}</label>
          <select id={`${id}-action`} value={form.action} onChange={field('action')}>
            <option value="">{t.audit.anyAction}</option>
            {t.audit.actionGroups.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div class="field">
          <label for={`${id}-section`}>{t.audit.section}</label>
          <input id={`${id}-section`} type="text" value={form.section} onInput={field('section')} />
        </div>
        <div class="field">
          <label for={`${id}-result`}>{t.audit.result}</label>
          <select id={`${id}-result`} value={form.result} onChange={field('result')}>
            <option value="">{t.audit.anyResult}</option>
            {(['success', 'denied', 'failed'] as const).map((value) => (
              <option key={value} value={value}>
                {t.audit.results[value]}
              </option>
            ))}
          </select>
        </div>
        <div class="field audit__search">
          <label for={`${id}-q`}>{t.audit.search}</label>
          <input id={`${id}-q`} type="search" value={form.q} onInput={field('q')} />
        </div>
        <div class="audit__filter-actions">
          <button type="submit" class="button button--primary">
            {t.audit.apply}
          </button>
          <button
            type="button"
            class="button"
            onClick={() => {
              setForm(EMPTY);
              setApplied({});
              load({});
            }}
          >
            {t.audit.reset}
          </button>
        </div>
      </form>

      <div class="audit__export">
        <a class="button" href={auditExportUrl(query(applied), 'csv')} download>
          {t.audit.exportCsv}
        </a>
        <a class="button" href={auditExportUrl(query(applied), 'json')} download>
          {t.audit.exportJson}
        </a>
        <p class="field__hint">{t.audit.exportHint}</p>
      </div>

      <p class="visually-hidden" role="status" aria-live="polite">
        {status === 'loading'
          ? t.audit.loading
          : status === 'ready'
            ? events.length === 0
              ? t.audit.empty
              : t.audit.caption(events.length)
            : ''}
      </p>
      {status === 'failed' && (
        <p class="notice notice--error" role="alert">
          {t.audit.failed}
        </p>
      )}
      {status === 'ready' && events.length === 0 && <p class="audit__empty">{t.audit.empty}</p>}
      {events.length > 0 && (
        <div class="audit__table-wrap" tabIndex={0} aria-labelledby={`${id}-caption`}>
          <table class="audit__table">
            <caption id={`${id}-caption`}>{t.audit.caption(events.length)}</caption>
            <thead>
              <tr>
                <th scope="col">{t.audit.when}</th>
                <th scope="col">{t.audit.who}</th>
                <th scope="col">{t.audit.action}</th>
                <th scope="col">{t.audit.section}</th>
                <th scope="col">{t.audit.result}</th>
                <th scope="col">
                  <span class="visually-hidden">{t.audit.details}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => {
                const when = formatRomaniaTime(event.at, locale);
                return (
                  <tr key={event.id}>
                    <td>
                      <time dateTime={event.at}>{when}</time>
                    </td>
                    <td>{who(event)}</td>
                    <td>
                      {actionLabel(event.action)}
                      {event.sensitive && (
                        <span class="audit__sensitive"> · {t.audit.sensitive}</span>
                      )}
                    </td>
                    <td>{event.section ?? ''}</td>
                    <td>
                      <span class={`audit__result audit__result--${event.result}`}>
                        {t.audit.results[event.result]}
                      </span>
                      {event.reason && (
                        <span class="audit__reason">
                          {' '}
                          ({t.audit.reasons[event.reason] ?? event.reason})
                        </span>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        class="button audit__details"
                        aria-label={t.audit.detailsFor(actionLabel(event.action), when)}
                        onClick={() => {
                          setSelected(event);
                        }}
                      >
                        {t.audit.details}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {nextBefore !== undefined && status !== 'loading' && (
        <button
          type="button"
          class="button audit__more"
          onClick={() => {
            load(applied, { before: nextBefore });
          }}
        >
          {t.audit.more}
        </button>
      )}
      {selected && (
        <AuditDetail
          event={selected}
          title={t.audit.detailsFor(
            actionLabel(selected.action),
            formatRomaniaTime(selected.at, locale),
          )}
          who={who(selected)}
          onClose={() => {
            setSelected(undefined);
          }}
        />
      )}
    </section>
  );
}

interface Change {
  path: string;
  before?: unknown;
  after?: unknown;
}

const isChange = (value: unknown): value is Change =>
  value !== null &&
  typeof value === 'object' &&
  typeof (value as { path?: unknown }).path === 'string';

const show = (value: unknown, empty: string): string =>
  value === undefined || value === null || value === ''
    ? empty
    : typeof value === 'string'
      ? value
      : JSON.stringify(value, null, 1);

/** One event: who, from where, what, and the old → new values (native dialog, Escape closes). */
function AuditDetail(props: {
  event: AuditEventView;
  title: string;
  who: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const { event } = props;
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const opener = document.activeElement as HTMLElement | null;
    if (typeof element.showModal === 'function') element.showModal();
    else element.setAttribute('open', '');
    return () => {
      opener?.focus();
    };
  }, []);

  const changes = Array.isArray(event.details.changes)
    ? event.details.changes.filter(isChange)
    : [];
  const other = Object.fromEntries(
    Object.entries(event.details).filter(([key]) => key !== 'changes'),
  );
  const labels = t.audit.labels;
  const row = (label: string, value: string | number | undefined) =>
    value === undefined || value === '' ? null : (
      <>
        <dt>{label}</dt>
        <dd>{value}</dd>
      </>
    );

  return (
    <dialog
      ref={dialog}
      class="dialog dialog--wide audit-detail"
      aria-labelledby={`${id}-title`}
      onCancel={(cancel) => {
        cancel.preventDefault();
        props.onClose();
      }}
    >
      <h2 id={`${id}-title`}>{props.title}</h2>
      <div class="audit-detail__grid">
        <section aria-labelledby={`${id}-who`}>
          <h3 id={`${id}-who`}>{t.audit.whoTitle}</h3>
          <dl>
            {row(t.audit.who, props.who)}
            {row(labels.email, event.actor.email)}
            {row(labels.role, event.actor.role)}
            {row(labels.org, event.actor.org)}
            {row(
              labels.source,
              event.actor.source
                ? (t.audit.sources[event.actor.source] ?? event.actor.source)
                : undefined,
            )}
            {row(labels.subject, event.actor.subject)}
          </dl>
        </section>
        <section aria-labelledby={`${id}-where`}>
          <h3 id={`${id}-where`}>{t.audit.whereTitle}</h3>
          <dl>
            {row(labels.ip, event.context.ip)}
            {row(labels.userAgent, event.context.userAgent)}
            {row(labels.session, event.context.sessionHash)}
            {row(labels.request, event.context.requestId)}
          </dl>
        </section>
        <section aria-labelledby={`${id}-what`}>
          <h3 id={`${id}-what`}>{t.audit.whatTitle}</h3>
          <dl>
            {row(t.audit.section, event.section)}
            {row(
              t.audit.result,
              `${t.audit.results[event.result] ?? event.result}${event.sensitive ? ` · ${t.audit.sensitive}` : ''}`,
            )}
            {row(
              labels.reason,
              event.reason ? (t.audit.reasons[event.reason] ?? event.reason) : undefined,
            )}
            {row(labels.version, event.version)}
            {row(labels.hash, event.hash)}
          </dl>
        </section>
      </div>
      {changes.length > 0 && (
        <section aria-labelledby={`${id}-changes`}>
          <h3 id={`${id}-changes`}>{t.audit.changesTitle}</h3>
          <div class="audit__table-wrap" tabIndex={0} aria-labelledby={`${id}-changes`}>
            <table class="audit__table audit__diff">
              <thead>
                <tr>
                  <th scope="col">{t.audit.field}</th>
                  <th scope="col">{t.audit.before}</th>
                  <th scope="col">{t.audit.after}</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((change) => (
                  <tr key={change.path}>
                    <th scope="row">
                      <code>{change.path}</code>
                    </th>
                    <td class="audit__before">
                      <pre>{show(change.before, t.audit.noValue)}</pre>
                    </td>
                    <td class="audit__after">
                      <pre>{show(change.after, t.audit.noValue)}</pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {Object.keys(other).length > 0 && (
        <section aria-labelledby={`${id}-other`}>
          <h3 id={`${id}-other`}>{t.audit.otherDetails}</h3>
          <pre class="audit-detail__json">{JSON.stringify(other, null, 2)}</pre>
        </section>
      )}
      <div class="dialog__actions">
        <button type="button" class="button" onClick={props.onClose}>
          {t.audit.close}
        </button>
      </div>
    </dialog>
  );
}
