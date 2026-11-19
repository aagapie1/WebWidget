import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { ApiError, createApi, loginUrl, type AdminApi, type Session } from './api.js';
import { AppHeader } from './components/AppHeader.js';
import { Editor } from './components/Editor.js';
import { Login } from './components/Login.js';
import { dictionaries, I18n, type Locale } from './i18n.js';

const LOCALE_KEY = 'admin:locale';
const ORG_KEY = 'admin:org';

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // preference only
  }
};

export function App({
  api: givenApi,
  location = window.location,
}: {
  api?: AdminApi;
  location?: Location;
}) {
  const api = useMemo(() => givenApi ?? createApi(), [givenApi]);
  const params = useMemo(() => new URLSearchParams(location.search), [location]);
  const [locale, setLocale] = useState<Locale>(read(LOCALE_KEY) === 'en' ? 'en' : 'ro');
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [tenant, setTenant] = useState<string | undefined>();
  const t = dictionaries[locale];

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t.appTitle;
  }, [locale, t]);

  useEffect(() => {
    api.session().then(
      (value) => {
        setSession(value);
        write(ORG_KEY, value.org);
        const wanted = params.get('tenant');
        setTenant(wanted && value.tenants.includes(wanted) ? wanted : value.tenants[0]);
      },
      (error: unknown) => {
        if (error instanceof ApiError && error.status === 401) setSession(null);
        else setSession(null);
      },
    );
  }, [api, params]);

  // Session expired while editing: the edits are stashed; sign in again and come back here.
  const onSessionExpired = useCallback(() => {
    const org = session?.org ?? read(ORG_KEY) ?? '';
    location.assign(loginUrl(org, `/admin/?tenant=${encodeURIComponent(tenant ?? '')}`, locale));
  }, [session, tenant, location, locale]);

  const chooseLocale = (next: Locale) => {
    setLocale(next);
    write(LOCALE_KEY, next);
  };

  const logout = async () => {
    try {
      location.assign((await api.logout()).redirect);
    } catch {
      location.assign('/admin/');
    }
  };

  return (
    <I18n.Provider value={{ locale, t }}>
      <a class="skip-link" href="#main">
        {t.appTitle}
      </a>
      {!session && <AppHeader assistantName={t.appTitle} clientName="" onLocale={chooseLocale} />}
      <div id="main" tabIndex={-1}>
        {session === undefined && <p class="page">{t.loading}</p>}
        {session === null && (
          <Login
            linkOrg={params.get('org') ?? undefined}
            storedOrg={read(ORG_KEY) ?? undefined}
            error={params.get('error') ?? undefined}
            returnTo={`/admin/${params.get('tenant') ? `?tenant=${encodeURIComponent(params.get('tenant') ?? '')}` : ''}`}
          />
        )}
        {session && tenant && (
          <Editor
            key={tenant}
            api={api}
            tenant={tenant}
            onSessionExpired={onSessionExpired}
            gatewayOrigin={session.gatewayOrigin}
            frame={{
              user: { name: session.user.name, role: session.user.role, org: session.org },
              tenants: session.tenants,
              onTenant: setTenant,
              onLocale: chooseLocale,
              onLogout: () => {
                void logout();
              },
            }}
          />
        )}
      </div>
    </I18n.Provider>
  );
}
