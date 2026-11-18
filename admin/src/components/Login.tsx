import { useEffect, useState } from 'preact/hooks';
import { useI18n } from '../i18n.js';
import { loginUrl } from '../api.js';

interface LoginProps {
  org: string;
  error: string | undefined;
  returnTo: string;
  navigate?: (url: string) => void;
  loadOrgs?: () => Promise<string[]>;
}

async function fetchDevOrgs(): Promise<string[]> {
  const response = await fetch('/admin/auth/orgs');
  if (!response.ok) return [];
  const body = (await response.json()) as { orgs?: unknown };
  return Array.isArray(body.orgs) ? body.orgs.filter((id) => typeof id === 'string') : [];
}

/**
 * Sign-in entry: the organisation code chooses the client's own identity provider (realm). The
 * gateway then redirects to Keycloak (ADR 008).
 */
export function Login({
  org,
  error,
  returnTo,
  navigate = (url) => {
    window.location.assign(url);
  },
  loadOrgs = fetchDevOrgs,
}: LoginProps) {
  const { t } = useI18n();
  const [value, setValue] = useState(org);
  const [orgs, setOrgs] = useState<string[]>([]);

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
  const message = error ? (t.login.errors[error] ?? t.login.errors.default) : undefined;
  return (
    <main class="login card" aria-labelledby="login-title">
      <h1 id="login-title">{t.login.title}</h1>
      <p>{t.login.intro}</p>
      {message && (
        <p class="notice notice--error" role="alert">
          {message}
        </p>
      )}
      <form
        onSubmit={(event) => {
          // A script navigation, not a form submission: the CSP `form-action 'self'` would block
          // the gateway's redirect to the identity provider.
          event.preventDefault();
          if (event.currentTarget.checkValidity()) navigate(loginUrl(value, returnTo));
        }}
      >
        <div class="field">
          <label for="org">{t.login.org}</label>
          <input
            id="org"
            name="org"
            required
            autoComplete="organization"
            pattern="[a-z0-9\-]{1,64}"
            aria-describedby="org-hint"
            value={value}
            onInput={(event) => {
              setValue(event.currentTarget.value.trim().toLowerCase());
            }}
          />
          <p id="org-hint" class="field__hint">
            {t.login.orgHint}
          </p>
        </div>
        <button type="submit" class="button button--primary">
          {t.login.submit}
        </button>
      </form>
      {orgs.length > 0 && (
        <section class="login__orgs" aria-labelledby="orgs-title">
          <h2 id="orgs-title" class="small-heading">
            {t.login.devOrgs}
          </h2>
          <ul>
            {orgs.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  class="button"
                  onClick={() => {
                    navigate(loginUrl(id, returnTo));
                  }}
                >
                  {id}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
