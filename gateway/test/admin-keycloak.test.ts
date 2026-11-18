import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseAdminAuthConfig } from '../src/admin/auth-config.js';
import { MemoryKeyValueStore } from '../src/admin/kv.js';
import { OpenIdClient } from '../src/admin/oidc.js';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { testTenant } from './helpers.js';

/**
 * Real Keycloak (deploy/docker-compose.dev.yml, realms in deploy/keycloak). Skipped unless
 * TEST_KEYCLOAK_URL is set, e.g. http://localhost:8081. The test logs in through the Keycloak
 * forms like a browser, with the development users of deploy/keycloak/README.md.
 */
const KEYCLOAK = process.env.TEST_KEYCLOAK_URL?.replace(/\/+$/, '');
const PORT = 3100; // registered as a redirect URI in the development realms
const ORIGIN = `http://localhost:${String(PORT)}`;

/** Minimal browser cookie jar: cookies are per host (not port) and path. */
class Jar {
  readonly #cookies = new Map<string, { name: string; value: string; path: string }>();

  store(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      const [pair = '', ...attributes] = header.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      const path =
        attributes
          .map((attribute) => attribute.trim())
          .find((attribute) => attribute.toLowerCase().startsWith('path='))
          ?.slice(5) ?? '/';
      const expired = /max-age=0|expires=thu, 01 jan 1970/i.test(header);
      if (expired || value === '') this.#cookies.delete(`${name};${path}`);
      else this.#cookies.set(`${name};${path}`, { name, value, path });
    }
  }

  header(url: URL): string {
    return [...this.#cookies.values()]
      .filter((cookie) => url.pathname.startsWith(cookie.path.replace(/\/$/, '')))
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ');
  }
}

const decode = (value: string): string =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&#x3D;/gi, '=')
    .replace(/&quot;/g, '"');

async function go(jar: Jar, url: string, init: RequestInit = {}): Promise<Response> {
  const target = new URL(url);
  const response = await fetch(target, {
    ...init,
    redirect: 'manual',
    headers: { ...(init.headers as Record<string, string>), cookie: jar.header(target) },
  });
  jar.store(response);
  return response;
}

/** Follows redirects until a page (200) or a URL matching `stop`. */
async function follow(jar: Jar, start: Response, base: string, stop?: RegExp) {
  let response = start;
  let url = base;
  while (response.status >= 300 && response.status < 400) {
    url = new URL(response.headers.get('location') ?? '', url).href;
    if (stop?.test(url)) return { response, url, stopped: true };
    response = await go(jar, url);
  }
  return { response, url, stopped: false };
}

async function submitLogin(jar: Jar, html: string, username: string, password: string) {
  const action = /<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/.exec(html)?.[1];
  if (!action) throw new Error('no Keycloak login form');
  return go(jar, decode(action), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password, credentialId: '' }).toString(),
  });
}

describe.skipIf(!KEYCLOAK)('admin login against the development Keycloak', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const realm = (name: string) => `${KEYCLOAK ?? ''}/realms/${name}`;
    const auth = parseAdminAuthConfig(
      `
tenants:
  - { tenant: pilot, issuer: ${realm('pilot')}, clientId: widget-admin-ui, clientSecretEnv: S_PILOT }
  - { tenant: demo-primarie, issuer: ${realm('demo-primarie')}, clientId: widget-admin-ui, clientSecretEnv: S_DEMO }
platform: { issuer: ${realm('platform')}, clientId: widget-admin-ui, clientSecretEnv: S_PLATFORM }
`,
      {
        S_PILOT: 'dev-secret-pilot-admin-ui',
        S_DEMO: 'dev-secret-demo-primarie-admin-ui',
        S_PLATFORM: 'dev-secret-platform-admin-ui',
      },
    );
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
      admin: { auth, store: new MemoryKeyValueStore(), oidc: new OpenIdClient(true) },
    });
    await app.listen({ host: '127.0.0.1', port: PORT });
  });
  afterAll(async () => {
    await app.close();
  });

  /** Gateway login → Keycloak form(s) → callback; returns where the gateway sent the browser. */
  async function login(org: string, username: string, password: string, broker?: string) {
    const jar = new Jar();
    const start = await go(jar, `${ORIGIN}/admin/auth/login?org=${org}`);
    let page = await follow(jar, start, `${ORIGIN}/admin/auth/login`);
    if (broker) {
      const link = new RegExp(`href="([^"]*/broker/${broker}/[^"]*)"`).exec(
        await page.response.text(),
      )?.[1];
      if (!link) throw new Error(`no ${broker} button on the login page`);
      page = await follow(jar, await go(jar, new URL(decode(link), page.url).href), page.url);
    }
    const submitted = await submitLogin(jar, await page.response.text(), username, password);
    const done = await follow(
      jar,
      submitted,
      page.url,
      /^http:\/\/localhost:3100\/admin\/(?!auth)/,
    );
    const session = await go(jar, `${ORIGIN}/admin/api/session`);
    return {
      location: done.url.replace(ORIGIN, ''),
      status: session.status,
      session: session.ok
        ? ((await session.json()) as { user: { role: string }; tenants: string[] })
        : undefined,
    };
  }

  it('logs in a client administrator and an editor of their own realm', async () => {
    const admin = await login('pilot', 'pilot-admin', 'dev-pilot-admin-Pass1');
    expect(admin.location).toBe('/admin/');
    expect(admin.session).toMatchObject({ user: { role: 'widget-admin' }, tenants: ['pilot'] });
    const editor = await login('demo-primarie', 'demo-editor', 'dev-demo-editor-Pass1');
    expect(editor.session).toMatchObject({
      user: { role: 'widget-editor' },
      tenants: ['demo-primarie'],
    });
  });

  it('refuses a realm user without a widget group', async () => {
    const viewer = await login('pilot', 'pilot-viewer', 'dev-pilot-viewer-Pass1');
    expect(viewer.location).toBe('/admin/?error=no_role');
    expect(viewer.status).toBe(401);
  });

  it('gives the platform super-admin every tenant', async () => {
    const root = await login('platform', 'platform-admin', 'dev-platform-admin-Pass1');
    expect(root.session).toMatchObject({
      user: { role: 'super-admin' },
      tenants: ['demo-primarie', 'pilot'],
    });
  });

  it('maps brokered identity provider groups to roles', async () => {
    const alice = await login('pilot', 'alice', 'dev-idp-alice-Pass1', 'idp-sim');
    expect(alice.session).toMatchObject({ user: { role: 'widget-admin' }, tenants: ['pilot'] });
    const carol = await login('pilot', 'carol', 'dev-idp-carol-Pass1', 'idp-sim');
    expect(carol.location).toBe('/admin/?error=no_role');
  });

  it('rejects an authorization response from another client realm', async () => {
    // A pilot login is started in this browser...
    const jar = new Jar();
    const start = await go(jar, `${ORIGIN}/admin/auth/login?org=pilot`);
    const state = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? '';
    // ...but the code comes from a demo-primarie login (another realm, another client).
    const other = new Jar();
    const demoStart = await go(other, `${ORIGIN}/admin/auth/login?org=demo-primarie`);
    const page = await follow(other, demoStart, ORIGIN);
    const submitted = await submitLogin(
      other,
      await page.response.text(),
      'demo-admin',
      'dev-demo-admin-Pass1',
    );
    const callback = new URL(submitted.headers.get('location') ?? '');
    expect(callback.pathname).toBe('/admin/auth/callback');
    callback.searchParams.set('state', state);

    const response = await go(jar, callback.href);
    expect(response.headers.get('location')).toBe('/admin/?error=login_failed');
    expect((await go(jar, `${ORIGIN}/admin/api/session`)).status).toBe(401);
  });
});
