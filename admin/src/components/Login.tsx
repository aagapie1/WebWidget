import { useEffect, useRef, useState } from 'preact/hooks';
import { useI18n } from '../i18n.js';
import { loginUrl } from '../api.js';

/** One organisation as the gateway names it (`/admin/auth/org`, `/admin/auth/orgs`). */
export interface KnownOrg {
  org: string;
  kind: 'tenant' | 'platform';
  /** The client's name (tenant organisations). */
  name?: string;
}

interface LoginProps {
  /** `?org=` from the link: wins over the host and the browser's last choice. */
  linkOrg: string | undefined;
  /** The organisation used last in this browser. */
  storedOrg: string | undefined;
  error: string | undefined;
  returnTo: string;
  navigate?: (url: string) => void;
  /** Development and test gateways list their organisations; production answers 404. */
  loadOrgs?: () => Promise<KnownOrg[]>;
  /** The organisation named by a code, or (no code) the one this host belongs to. */
  resolveOrg?: (code?: string) => Promise<KnownOrg | undefined>;
}

const isOrg = (value: unknown): value is KnownOrg =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as KnownOrg).org === 'string' &&
  ((value as KnownOrg).kind === 'tenant' || (value as KnownOrg).kind === 'platform');

async function fetchDevOrgs(): Promise<KnownOrg[]> {
  const response = await fetch('/admin/auth/orgs');
  if (!response.ok) return [];
  const body = (await response.json()) as { orgs?: unknown };
  return Array.isArray(body.orgs) ? body.orgs.filter(isOrg) : [];
}

async function fetchOrg(code?: string): Promise<KnownOrg | undefined> {
  const query = code ? `?org=${encodeURIComponent(code)}` : '';
  const response = await fetch(`/admin/auth/org${query}`);
  if (!response.ok) return undefined;
  const body = (await response.json()) as unknown;
  return isOrg(body) ? body : undefined;
}

type Mode =
  { kind: 'resolving' } | { kind: 'known'; org: KnownOrg } | { kind: 'code'; unknown?: string };

/**
 * Sign-in entry (E4b.1 UX 16). The organisation chooses the client's own identity provider
 * (realm); the gateway then redirects to Keycloak (ADR 008). When the organisation is known (the
 * link, the host, or the last one used here) the page names it and offers one button; the code
 * field is only the fallback, behind "Altă organizație?". No automatic redirect.
 */
export function Login({
  linkOrg,
  storedOrg,
  error,
  returnTo,
  navigate = (url) => {
    window.location.assign(url);
  },
  loadOrgs = fetchDevOrgs,
  resolveOrg = fetchOrg,
}: LoginProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>({ kind: 'resolving' });
  const [value, setValue] = useState(linkOrg ?? storedOrg ?? '');
  const [orgs, setOrgs] = useState<KnownOrg[]>([]);
  const codeInput = useRef<HTMLInputElement>(null);
  const focusCode = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const settle = (next: Mode) => {
      if (!cancelled) setMode(next);
    };
    void (async () => {
      try {
        if (linkOrg) {
          const found = await resolveOrg(linkOrg);
          settle(found ? { kind: 'known', org: found } : { kind: 'code', unknown: linkOrg });
          return;
        }
        const found = (await resolveOrg()) ?? (storedOrg ? await resolveOrg(storedOrg) : undefined);
        settle(found ? { kind: 'known', org: found } : { kind: 'code' });
      } catch {
        settle({ kind: 'code' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [linkOrg, storedOrg, resolveOrg]);

  // Development and test gateways list their organisations; production answers 404.
  useEffect(() => {
    let cancelled = false;
    loadOrgs()
      .then((list) => {
        if (!cancelled) setOrgs(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [loadOrgs]);

  useEffect(() => {
    if (mode.kind === 'code' && focusCode.current) {
      focusCode.current = false;
      codeInput.current?.focus();
    }
  }, [mode]);

  const orgName = (org: KnownOrg) =>
    org.name ?? (org.kind === 'platform' ? t.login.platform : org.org);
  const gatewayError = error ? (t.login.errors[error] ?? t.login.errors.default) : undefined;
  const codeError = mode.kind === 'code' && mode.unknown ? t.login.unknownOrg : undefined;

  return (
    <main class="login card" aria-labelledby="login-title" aria-busy={mode.kind === 'resolving'}>
      <h1 id="login-title">{t.login.title}</h1>
      {gatewayError && (
        <p class="notice notice--error" role="alert">
          {gatewayError}
        </p>
      )}
      {mode.kind === 'resolving' && <p>{t.loading}</p>}

      {mode.kind === 'known' && (
        <>
          <p class="login__org">{orgName(mode.org)}</p>
          <p>{t.login.redirect}</p>
          <button
            type="button"
            class="button button--primary"
            onClick={() => {
              navigate(loginUrl(mode.org.org, returnTo));
            }}
          >
            {t.login.submit}
          </button>
          <p class="login__other">
            <button
              type="button"
              class="link-button"
              onClick={() => {
                focusCode.current = true;
                setValue('');
                setMode({ kind: 'code' });
              }}
            >
              {t.login.otherOrg}
            </button>
          </p>
        </>
      )}

      {mode.kind === 'code' && (
        <>
          <p>{t.login.intro}</p>
          <form
            onSubmit={(event) => {
              // A script navigation, not a form submission: the CSP `form-action 'self'` would
              // block the gateway's redirect to the identity provider.
              event.preventDefault();
              if (event.currentTarget.checkValidity()) navigate(loginUrl(value, returnTo));
            }}
          >
            <div class={codeError ? 'field field--invalid' : 'field'}>
              <label for="org">{t.login.org}</label>
              <input
                ref={codeInput}
                id="org"
                name="org"
                required
                autoComplete="organization"
                pattern="[a-z0-9\-]{1,64}"
                aria-invalid={codeError ? true : undefined}
                aria-describedby={codeError ? 'org-error org-hint' : 'org-hint'}
                value={value}
                onInput={(event) => {
                  setValue(event.currentTarget.value.trim().toLowerCase());
                }}
              />
              {codeError && (
                <ul id="org-error" class="field__errors">
                  <li>{codeError}</li>
                </ul>
              )}
              <p id="org-hint" class="field__hint">
                {t.login.orgHint}
              </p>
            </div>
            <p>{t.login.redirect}</p>
            <button type="submit" class="button button--primary">
              {t.login.submit}
            </button>
          </form>
        </>
      )}

      {orgs.length > 0 && (
        <section class="login__orgs" aria-labelledby="orgs-title">
          <h2 id="orgs-title" class="small-heading">
            {t.login.devOrgs}
          </h2>
          <ul>
            {orgs.map((org) => (
              <li key={org.org}>
                <button
                  type="button"
                  class="button"
                  onClick={() => {
                    navigate(loginUrl(org.org, returnTo));
                  }}
                >
                  {orgName(org)} <span class="login__code">({org.org})</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
