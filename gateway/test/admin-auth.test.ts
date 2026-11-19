import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseAdminAuthConfig, type AdminRealm } from '../src/admin/auth-config.js';
import { can, identityFromClaims, type AdminIdentity } from '../src/admin/identity.js';
import { MemoryKeyValueStore } from '../src/admin/kv.js';
import type { CodeExchangeChecks, OidcClient } from '../src/admin/oidc.js';
import { AdminSessions, LOGIN_COOKIE, SESSION_COOKIE } from '../src/admin/sessions.js';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { testTenant } from './helpers.js';

const ORIGIN = 'https://gateway.test';
const KC = 'http://kc.test/realms';
const CONFIG_YAML = `
tenants:
  - tenant: pilot
    issuer: ${KC}/pilot
    clientId: widget-admin-ui
    clientSecretEnv: SECRET_PILOT
  - tenant: demo-primarie
    issuer: ${KC}/demo-primarie/
    clientId: widget-admin-ui
    clientSecretEnv: SECRET_DEMO
    sessionHours: 1
platform:
  issuer: ${KC}/platform
  clientId: widget-admin-ui
  clientSecretEnv: SECRET_PLATFORM
`;
const SECRETS = { SECRET_PILOT: 'p', SECRET_DEMO: 'd', SECRET_PLATFORM: 'x' };
const auth = parseAdminAuthConfig(CONFIG_YAML, SECRETS);

describe('admin auth configuration (server only)', () => {
  it('maps issuers to tenants and reads secrets from the environment', () => {
    expect(auth.byIssuer.get(`${KC}/pilot`)?.tenant).toBe('pilot');
    // Trailing slash normalised.
    expect(auth.byIssuer.get(`${KC}/demo-primarie`)?.sessionSeconds).toBe(3600);
    expect(auth.realms.get('pilot')?.sessionSeconds).toBe(8 * 3600);
    expect(auth.realms.get('platform')?.kind).toBe('platform');
    expect(auth.realms.get('pilot')?.clientSecret).toBe('p');
  });

  it('fails clearly on a missing secret, a duplicate issuer or an unknown key', () => {
    expect(() => parseAdminAuthConfig(CONFIG_YAML, {})).toThrow(/SECRET_PILOT is not set/);
    const duplicate = CONFIG_YAML.replace(`${KC}/demo-primarie/`, `${KC}/pilot`);
    expect(() => parseAdminAuthConfig(duplicate, SECRETS)).toThrow(/mapped twice/);
    expect(() =>
      parseAdminAuthConfig(CONFIG_YAML.replace('sessionHours: 1', 'clientSecret: inline'), SECRETS),
    ).toThrow(/admin auth configuration/);
  });
});

describe('identity from ID token claims', () => {
  const claims = (realm: string, roles: unknown, extra: Record<string, unknown> = {}) => ({
    iss: `${KC}/${realm}`,
    sub: 'user-1',
    preferred_username: 'pilot-admin',
    roles,
    ...extra,
  });

  it('derives the tenant from the issuer and the highest role', () => {
    const admin = identityFromClaims(
      claims('pilot', ['widget-editor', 'widget-admin']),
      'pilot',
      auth,
    );
    expect(admin).toEqual({
      ok: true,
      identity: {
        issuer: `${KC}/pilot`,
        subject: 'user-1',
        name: 'pilot-admin',
        role: 'widget-admin',
        tenant: 'pilot',
      },
    });
    const editor = identityFromClaims(claims('pilot', ['widget-editor']), 'pilot', auth);
    expect(editor.ok && editor.identity.role).toBe('widget-editor');
  });

  it('ignores tenant-like claims: only the issuer decides', () => {
    const result = identityFromClaims(
      claims('pilot', ['widget-admin'], { tenant: 'demo-primarie', azp: 'demo-primarie' }),
      'pilot',
      auth,
    );
    expect(result.ok && result.identity.tenant).toBe('pilot');
  });

  it('rejects a token from another client realm, an unknown issuer and users without a role', () => {
    expect(identityFromClaims(claims('demo-primarie', ['widget-admin']), 'pilot', auth)).toEqual({
      ok: false,
      reason: 'wrong_realm',
    });
    expect(identityFromClaims(claims('elsewhere', ['widget-admin']), 'pilot', auth)).toEqual({
      ok: false,
      reason: 'unknown_issuer',
    });
    expect(identityFromClaims(claims('pilot', ['offline_access']), 'pilot', auth)).toEqual({
      ok: false,
      reason: 'no_role',
    });
    expect(identityFromClaims(claims('pilot', 'widget-admin'), 'pilot', auth)).toEqual({
      ok: false,
      reason: 'no_role',
    });
  });

  it('accepts super-admin only from the platform realm', () => {
    expect(identityFromClaims(claims('pilot', ['super-admin']), 'pilot', auth)).toEqual({
      ok: false,
      reason: 'no_role',
    });
    const platform = identityFromClaims(claims('platform', ['super-admin']), 'platform', auth);
    expect(platform.ok && platform.identity).toMatchObject({ role: 'super-admin', tenant: '*' });
    expect(identityFromClaims(claims('platform', ['widget-admin']), 'platform', auth).ok).toBe(
      false,
    );
  });
});

describe('authorization', () => {
  const who = (role: AdminIdentity['role'], tenant: string): AdminIdentity => ({
    issuer: 'i',
    subject: 's',
    name: 'n',
    role,
    tenant,
  });

  it('editors edit, admins also publish, nobody crosses tenants except super-admin', () => {
    const editor = who('widget-editor', 'pilot');
    expect(can(editor, 'pilot', 'read')).toBe(true);
    expect(can(editor, 'pilot', 'edit')).toBe(true);
    for (const action of ['publish', 'assets', 'origins'] as const) {
      expect(can(editor, 'pilot', action)).toBe(false);
      expect(can(who('widget-admin', 'pilot'), 'pilot', action)).toBe(true);
    }
    expect(can(who('widget-admin', 'pilot'), 'demo-primarie', 'read')).toBe(false);
    expect(can(who('super-admin', '*'), 'demo-primarie', 'publish')).toBe(true);
  });
});

/** Stands in for Keycloak: returns the claims the test chose, after checking the login state. */
class FakeOidc implements OidcClient {
  claims: Record<string, unknown> = {};
  lastChecks: CodeExchangeChecks | undefined;
  failExchange = false;

  authorizationUrl(realm: AdminRealm, request: { state: string; redirectUri: string }) {
    const url = new URL(`${realm.issuer}/protocol/openid-connect/auth`);
    url.searchParams.set('state', request.state);
    url.searchParams.set('redirect_uri', request.redirectUri);
    return Promise.resolve(url);
  }

  exchange(_realm: AdminRealm, callbackUrl: URL, checks: CodeExchangeChecks) {
    this.lastChecks = checks;
    if (this.failExchange || callbackUrl.searchParams.get('state') !== checks.state) {
      return Promise.reject(new Error('invalid response'));
    }
    return Promise.resolve({ claims: this.claims, idToken: 'id-token' });
  }

  endSessionUrl(realm: AdminRealm, params: { postLogoutRedirectUri: string }) {
    const url = new URL(`${realm.issuer}/protocol/openid-connect/logout`);
    url.searchParams.set('post_logout_redirect_uri', params.postLogoutRedirectUri);
    return Promise.resolve(url);
  }
}

describe('admin login, session and guard', () => {
  let app: FastifyInstance;
  let oidc: FakeOidc;
  let store: MemoryKeyValueStore;

  beforeEach(async () => {
    oidc = new FakeOidc();
    store = new MemoryKeyValueStore();
    app = await buildApp({
      env: loadEnv({
        PUBLIC_ORIGIN: ORIGIN,
        VISITOR_COOKIE_SECRET: 's'.repeat(40),
        LOG_LEVEL: 'silent',
      }),
      tenants: new Map([
        ['pilot', { ...testTenant, id: 'pilot' }],
        ['demo-primarie', { ...testTenant, id: 'demo-primarie' }],
      ]),
      admin: { auth, store, oidc },
    });
  });
  afterEach(async () => {
    await app.close();
  });

  const cookieOf = (response: { cookies: { name: string; value: string }[] }, name: string) =>
    response.cookies.find((cookie) => cookie.name === name)?.value;

  async function login(org: string, claims: Record<string, unknown>, returnTo?: string) {
    const start = await app.inject({
      url: `/admin/auth/login?org=${org}${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ''}`,
    });
    const state = new URL(String(start.headers.location)).searchParams.get('state') ?? '';
    oidc.claims = claims;
    const callback = await app.inject({
      url: `/admin/auth/callback?code=c&state=${state}`,
      cookies: { [LOGIN_COOKIE]: cookieOf(start, LOGIN_COOKIE) ?? '' },
    });
    return { start, state, callback, session: cookieOf(callback, SESSION_COOKIE) };
  }

  const pilotAdmin = { iss: `${KC}/pilot`, sub: 'u1', name: 'Ana Pilot', roles: ['widget-admin'] };

  it('starts the login with PKCE state bound to the browser and a callback on PUBLIC_ORIGIN', async () => {
    const { start } = await login('pilot', pilotAdmin);
    expect(start.statusCode).toBe(302);
    const location = new URL(String(start.headers.location));
    expect(location.origin + location.pathname).toBe(`${KC}/pilot/protocol/openid-connect/auth`);
    expect(location.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/admin/auth/callback`);
    const cookie = start.cookies.find((item) => item.name === LOGIN_COOKIE);
    expect(cookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/admin/auth',
    });
  });

  it('creates a Redis session with a strict cookie and exposes it to the admin interface', async () => {
    const { callback, session } = await login('pilot', pilotAdmin, '/admin/settings');
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('/admin/settings');
    expect(oidc.lastChecks?.codeVerifier).toMatch(/^[\w-]{43,}$/);
    expect(callback.cookies.find((item) => item.name === SESSION_COOKIE)).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      path: '/admin',
      maxAge: 8 * 3600,
    });

    const me = await app.inject({
      url: '/admin/api/session',
      cookies: { [SESSION_COOKIE]: session ?? '' },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      user: { name: 'Ana Pilot', role: 'widget-admin' },
      org: 'pilot',
      tenants: ['pilot'],
    });
    expect(me.headers['cache-control']).toBe('no-store');
    expect(me.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('lists every tenant for the platform super-admin', async () => {
    const { session } = await login('platform', {
      iss: `${KC}/platform`,
      sub: 'root',
      roles: ['super-admin'],
    });
    const me = await app.inject({
      url: '/admin/api/session',
      cookies: { [SESSION_COOKIE]: session ?? '' },
    });
    expect(me.json()).toMatchObject({
      tenants: ['demo-primarie', 'pilot'],
      user: { role: 'super-admin' },
    });
  });

  it('rejects a token issued by another client realm (no session)', async () => {
    const { callback, session } = await login('pilot', {
      ...pilotAdmin,
      iss: `${KC}/demo-primarie`,
    });
    expect(callback.headers.location).toBe('/admin/?error=wrong_realm');
    expect(session).toBeUndefined();
  });

  it('rejects users without a widget role', async () => {
    const { callback, session } = await login('pilot', { ...pilotAdmin, roles: [] });
    expect(callback.headers.location).toBe('/admin/?error=no_role');
    expect(session).toBeUndefined();
  });

  it('refuses a callback whose state is not bound to this browser, or is reused', async () => {
    const start = await app.inject({ url: '/admin/auth/login?org=pilot' });
    const state = new URL(String(start.headers.location)).searchParams.get('state') ?? '';
    oidc.claims = pilotAdmin;
    const foreign = await app.inject({ url: `/admin/auth/callback?code=c&state=${state}` });
    expect(foreign.headers.location).toBe('/admin/?error=login_state');

    const cookies = { [LOGIN_COOKIE]: state };
    const first = await app.inject({ url: `/admin/auth/callback?code=c&state=${state}`, cookies });
    expect(cookieOf(first, SESSION_COOKIE)).toBeDefined();
    const replay = await app.inject({ url: `/admin/auth/callback?code=c&state=${state}`, cookies });
    expect(replay.headers.location).toBe('/admin/?error=login_state');
  });

  it('reports a failed code exchange without creating a session', async () => {
    oidc.failExchange = true;
    const { callback, session } = await login('pilot', pilotAdmin);
    expect(callback.headers.location).toBe('/admin/?error=login_failed');
    expect(session).toBeUndefined();
  });

  it('answers 404 for an unknown organisation and never redirects outside the admin', async () => {
    expect((await app.inject({ url: '/admin/auth/login?org=nope' })).statusCode).toBe(404);
    for (const returnTo of [
      'https://evil.test/',
      '//evil.test/admin/',
      '/admin/\\evil',
      '/api/x',
    ]) {
      const { callback } = await login('pilot', pilotAdmin, returnTo);
      expect(callback.headers.location).toBe('/admin/');
    }
  });

  it('accepts only the session cookie: no cookie or a bearer token is unauthenticated', async () => {
    expect((await app.inject({ url: '/admin/api/session' })).json()).toEqual({
      error: { code: 'unauthenticated' },
    });
    const bearer = await app.inject({
      url: '/admin/api/session',
      headers: { authorization: 'Bearer eyJ.from-another-realm.sig' },
    });
    expect(bearer.statusCode).toBe(401);
    const forged = await app.inject({
      url: '/admin/api/session',
      cookies: { [SESSION_COOKIE]: 'forged' },
    });
    expect(forged.statusCode).toBe(401);
  });

  it('requires the CSRF token and the gateway Origin on state-changing requests', async () => {
    const { session } = await login('pilot', pilotAdmin);
    const cookies = { [SESSION_COOKIE]: session ?? '' };
    const me = (await app.inject({ url: '/admin/api/session', cookies })).json<{
      csrfToken: string;
    }>();

    const noToken = await app.inject({
      method: 'POST',
      url: '/admin/auth/logout',
      cookies,
      headers: { origin: ORIGIN },
    });
    expect(noToken.json()).toEqual({ error: { code: 'csrf' } });
    const wrongOrigin = await app.inject({
      method: 'POST',
      url: '/admin/auth/logout',
      cookies,
      headers: { origin: 'https://evil.test', 'x-csrf-token': me.csrfToken },
    });
    expect(wrongOrigin.json()).toEqual({ error: { code: 'forbidden_origin' } });
    const crossSite = await app.inject({
      url: '/admin/api/session',
      cookies,
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(crossSite.statusCode).toBe(403);

    const logout = await app.inject({
      method: 'POST',
      url: '/admin/auth/logout',
      cookies,
      headers: { origin: ORIGIN, 'x-csrf-token': me.csrfToken },
    });
    expect(logout.statusCode).toBe(200);
    const redirect = new URL(logout.json<{ redirect: string }>().redirect);
    expect(redirect.pathname).toBe('/realms/pilot/protocol/openid-connect/logout');
    expect(redirect.searchParams.get('post_logout_redirect_uri')).toBe(`${ORIGIN}/admin/`);
    expect((await app.inject({ url: '/admin/api/session', cookies })).statusCode).toBe(401);
  });

  it('lists the organisations for the login page outside production only', async () => {
    expect((await app.inject({ url: '/admin/auth/orgs' })).json()).toEqual({
      orgs: [
        { org: 'pilot', kind: 'tenant', name: expect.any(String) as unknown },
        { org: 'demo-primarie', kind: 'tenant', name: expect.any(String) as unknown },
        { org: 'platform', kind: 'platform' },
      ],
    });
    const production = await buildApp({
      env: loadEnv({
        PUBLIC_ORIGIN: ORIGIN,
        VISITOR_COOKIE_SECRET: 's'.repeat(40),
        LOG_LEVEL: 'silent',
        NODE_ENV: 'production',
      }),
      tenants: new Map(),
      admin: { auth, store, oidc },
    });
    expect((await production.inject({ url: '/admin/auth/orgs' })).statusCode).toBe(404);
    await production.close();
  });

  it('names one organisation for the login page, from the link or the host, in production too', async () => {
    const production = await buildApp({
      env: loadEnv({
        PUBLIC_ORIGIN: ORIGIN,
        VISITOR_COOKIE_SECRET: 's'.repeat(40),
        LOG_LEVEL: 'silent',
        NODE_ENV: 'production',
        ADMIN_ORG_HOSTS: 'admin.pilot.test=pilot, admin.gol.test=necunoscut',
      }),
      tenants: new Map(),
      admin: { auth, store, oidc },
    });
    // From the link.
    expect((await production.inject({ url: '/admin/auth/org?org=demo-primarie' })).json()).toEqual({
      org: 'demo-primarie',
      kind: 'tenant',
      name: 'demo-primarie',
    });
    expect((await production.inject({ url: '/admin/auth/org?org=platform' })).json()).toEqual({
      org: 'platform',
      kind: 'platform',
    });
    // From the host (ADMIN_ORG_HOSTS); an unknown organisation or host is not found.
    const byHost = await production.inject({
      url: '/admin/auth/org',
      headers: { host: 'admin.pilot.test' },
    });
    expect(byHost.json()).toMatchObject({ org: 'pilot', kind: 'tenant' });
    for (const request of [
      { url: '/admin/auth/org?org=nu-exista' },
      { url: '/admin/auth/org', headers: { host: 'admin.gol.test' } },
      { url: '/admin/auth/org', headers: { host: 'alt.test' } },
    ]) {
      expect((await production.inject(request)).statusCode).toBe(404);
    }
    await production.close();
  });

  it('rejects malformed ADMIN_ORG_HOSTS', () => {
    expect(() =>
      loadEnv({
        PUBLIC_ORIGIN: ORIGIN,
        VISITOR_COOKIE_SECRET: 's'.repeat(40),
        ADMIN_ORG_HOSTS: 'admin.pilot.test',
      }),
    ).toThrow(/ADMIN_ORG_HOSTS: invalid host=org pair/);
  });

  it('rate-limits login attempts per client address', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      statuses.push((await app.inject({ url: '/admin/auth/login?org=pilot' })).statusCode);
    }
    expect(statuses.slice(0, 30).every((status) => status === 302)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});

describe('admin sessions', () => {
  it('expire after their lifetime and are stored under a hash of the cookie', async () => {
    let now = 1_000_000;
    const store = new MemoryKeyValueStore(() => now);
    const sessions = new AdminSessions(store, () => now);
    const identity: AdminIdentity = {
      issuer: 'i',
      subject: 's',
      name: 'n',
      role: 'widget-editor',
      tenant: 'pilot',
    };
    const { id } = await sessions.create(identity, 'pilot', 60);
    expect(await store.get(`admin:session:${id}`)).toBeUndefined();
    expect((await sessions.get(id))?.identity).toEqual(identity);
    now += 61_000;
    expect(await sessions.get(id)).toBeUndefined();
  });
});

describe('admin interface page (separate bundle)', () => {
  it('serves the built page with a strict CSP, its hashed assets cached, and / redirects', async () => {
    const dist = await mkdtemp(join(tmpdir(), 'admin-dist-'));
    await mkdir(join(dist, 'assets'));
    await writeFile(join(dist, 'index.html'), '<!doctype html><title>Admin</title>');
    await writeFile(join(dist, 'assets', 'index-abc.js'), 'console.log(1)');
    const app = await buildApp({
      env: loadEnv({
        PUBLIC_ORIGIN: ORIGIN,
        VISITOR_COOKIE_SECRET: 's'.repeat(40),
        LOG_LEVEL: 'silent',
        ADMIN_DIST_DIR: dist,
      }),
      tenants: new Map(),
      admin: { auth, store: new MemoryKeyValueStore(), oidc: new FakeOidc() },
    });
    try {
      const page = await app.inject({ url: '/admin/' });
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('<title>Admin</title>');
      const csp = String(page.headers['content-security-policy']);
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toContain('unsafe-inline');
      expect(page.headers['cache-control']).toBe('no-store');

      const asset = await app.inject({ url: '/admin/assets/index-abc.js' });
      expect(asset.statusCode).toBe(200);
      expect(asset.headers['cache-control']).toContain('immutable');

      expect((await app.inject({ url: '/' })).headers.location).toBe('/admin/');
      expect((await app.inject({ url: '/admin' })).statusCode).toBe(200);
    } finally {
      await app.close();
      await rm(dist, { recursive: true, force: true });
    }
  });
});

describe('admin cookies', () => {
  it('are __Secure- over https and plain (not Secure) only over http (development)', async () => {
    const { adminCookies } = await import('../src/admin/sessions.js');
    expect(adminCookies('https://admin.example.ro')).toEqual({
      session: '__Secure-admin',
      login: '__Secure-admin-login',
      secure: true,
    });
    expect(adminCookies('http://localhost:3100')).toEqual({
      session: 'admin',
      login: 'admin-login',
      secure: false,
    });
  });
});
