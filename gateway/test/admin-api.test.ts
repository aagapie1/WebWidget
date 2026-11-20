import type { FastifyInstance } from 'fastify';
import { resolve } from 'node:path';
import pg from 'pg';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAdminAuthConfig } from '../src/admin/auth-config.js';
import type { AdminIdentity } from '../src/admin/identity.js';
import { MemoryKeyValueStore } from '../src/admin/kv.js';
import { recordCited } from '../src/cited/index.js';
import type { OidcClient } from '../src/admin/oidc.js';
import { AdminSessions, SESSION_COOKIE } from '../src/admin/sessions.js';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import type { Tenant } from '../src/config/tenants.js';
import { migrate } from '../src/db/migrate.js';
import { PostgresTenantSource } from '../src/db/postgres-source.js';
import { FakeDify } from './fake-dify.js';
import { PREVIEW_ID } from '../src/admin/preview.js';
import { verifyChain } from '../src/audit/log.js';
import { chainHash } from '../src/audit/chain.js';

// Real Postgres (same test database as db.test.ts; this file only touches its own tenants).
const appUrl = process.env.TEST_DATABASE_URL;
const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const ORIGIN = 'https://gateway.test';
const TENANTS = ['gamma', 'delta'];
const tenantEnv: Record<string, string> = {
  DIFY_BASE_URL: 'http://dify.test/v1',
  KEY_GAMMA: 'app-secret-gamma-key',
};
const dify = new FakeDify();

const seedConfig = (id: string) => ({
  schemaVersion: 1,
  id,
  name: `Client ${id}`,
  difyBaseUrl: '${DIFY_BASE_URL}',
  difyApiKeyEnv: 'KEY_GAMMA',
  allowedOrigins: ['http://localhost:5173'],
  theme: { accent: '#3a36d0' },
});

/** The identity provider's answer at the next sign-in (claims of the ID token). */
let oidcClaims: Record<string, unknown> = {};
const fakeOidc: OidcClient = {
  authorizationUrl: (realm, request) =>
    Promise.resolve(new URL(`${realm.issuer}/protocol/openid-connect/auth?state=${request.state}`)),
  exchange: () => Promise.resolve({ claims: oidcClaims, idToken: 'id-token' }),
  endSessionUrl: () => Promise.resolve(undefined),
};

describe.skipIf(!appUrl || !ownerUrl)('admin configuration API (Postgres)', () => {
  let pool: pg.Pool;
  let owner: pg.Pool;
  let app: FastifyInstance;
  let registry: Map<string, Tenant>;
  let stopWatching: () => void;
  let sessions: AdminSessions;
  let kv: MemoryKeyValueStore;
  // Clock of the session / token store (preview token expiry).
  let now = Date.now();

  beforeAll(async () => {
    tenantEnv.DIFY_BASE_URL = await dify.start();
    await migrate(ownerUrl ?? '', resolve('migrations'), () => undefined);
    pool = new pg.Pool({ connectionString: appUrl });
    owner = new pg.Pool({ connectionString: ownerUrl });
  });
  afterAll(async () => {
    await dify.stop();
    await pool.end();
    await owner.end();
  });

  beforeEach(async () => {
    for (const table of [
      'tenant_config_versions',
      'tenant_config_drafts',
      'tenant_assets',
      'audit_log',
    ]) {
      await owner.query(
        table === 'audit_log'
          ? 'DELETE FROM audit_log WHERE tenant_id = ANY($1) OR chain = ANY($1)'
          : `DELETE FROM ${table} WHERE tenant_id = ANY($1)`,
        [TENANTS],
      );
    }
    for (const id of TENANTS) {
      await pool.query(
        `INSERT INTO tenant_config_versions (tenant_id, version, config, created_by)
         VALUES ($1, 1, $2, 'test')`,
        [id, JSON.stringify(seedConfig(id))],
      );
    }
    const source = new PostgresTenantSource(pool, appUrl ?? '', tenantEnv, {
      info: () => undefined,
      error: () => undefined,
    });
    const loaded = await source.load();
    registry = new Map([...loaded].filter(([id]) => TENANTS.includes(id)));
    stopWatching = source.watch(registry);
    now = Date.now();
    const store = new MemoryKeyValueStore(() => now);
    kv = store;
    sessions = new AdminSessions(store);
    app = await buildApp({
      env: loadEnv({
        PUBLIC_ORIGIN: ORIGIN,
        VISITOR_COOKIE_SECRET: 's'.repeat(40),
        LOG_LEVEL: 'silent',
      }),
      tenants: registry,
      admin: {
        auth: parseAdminAuthConfig(
          'tenants: [{ tenant: gamma, issuer: http://kc.test/realms/gamma, clientId: c, clientSecretEnv: S }]',
          { S: 's' },
        ),
        store,
        oidc: fakeOidc,
        api: { db: pool, tenantEnv },
      },
    });
    await new Promise((done) => setTimeout(done, 200)); // LISTEN established
    return async () => {
      stopWatching();
      await app.close();
    };
  });

  /** An admin session as the login would create it, and a request helper bound to it. */
  async function as(role: AdminIdentity['role'], tenant = 'gamma') {
    const identity: AdminIdentity = {
      issuer: `http://kc.test/realms/${tenant}`,
      subject: `${role}-1`,
      name: `Test ${role}`,
      role,
      tenant: role === 'super-admin' ? '*' : tenant,
    };
    const { id, session } = await sessions.create(identity, tenant, 3600);
    return (method: 'GET' | 'PUT' | 'POST' | 'DELETE', url: string, body?: unknown, headers = {}) =>
      app.inject({
        method,
        url,
        cookies: { [SESSION_COOKIE]: id },
        headers: { origin: ORIGIN, 'x-csrf-token': session.csrf, ...headers },
        ...(body === undefined
          ? {}
          : Buffer.isBuffer(body)
            ? {
                body,
                headers: {
                  origin: ORIGIN,
                  'x-csrf-token': session.csrf,
                  'content-type': 'application/octet-stream',
                  ...headers,
                },
              }
            : { payload: body as Record<string, unknown> }),
      });
  }

  type ConfigResponse = {
    published: { version: number; config: Record<string, unknown> };
    draft: { config: Record<string, unknown>; revision: number } | null;
    errors: string[];
    permissions: Record<string, boolean>;
  };
  const CONFIG = '/admin/api/tenants/gamma/config';

  const accentOf = async (tenant = 'gamma') =>
    (await app.inject({ url: `/api/loader-config?tenant=${tenant}` })).json<{
      theme: { accent: string };
    }>().theme.accent;

  const auditRows = async () =>
    (
      await pool.query<{
        action: string;
        actor_name: string;
        version: number | null;
        sensitive: boolean;
        result: string;
        ip: string | null;
        request_id: string | null;
        session_hash: string | null;
        details: Record<string, unknown>;
      }>(
        `SELECT action, actor_name, version, sensitive, result, ip, request_id, session_hash, details
           FROM audit_log WHERE tenant_id = 'gamma' ORDER BY id`,
      )
    ).rows;

  type Client = Awaited<ReturnType<typeof as>>;
  /** Saves from the state the editor last loaded, as the admin interface does. */
  const saveDraft = async (client: Client, body: { config: Record<string, unknown> }) => {
    const state = (await client('GET', CONFIG)).json<ConfigResponse>();
    return client('PUT', `${CONFIG}/draft`, {
      ...body,
      baseVersion: state.published.version,
      draftRevision: state.draft?.revision ?? null,
    });
  };

  it('returns the editable configuration without the Dify connection or key', async () => {
    const editor = await as('widget-editor');
    const response = await editor('GET', CONFIG);
    expect(response.statusCode).toBe(200);
    const body = response.json<ConfigResponse>();
    expect(body.published.version).toBe(1);
    expect(body.published.config).toMatchObject({
      name: 'Client gamma',
      theme: { accent: '#3a36d0' },
    });
    expect(body.draft).toBeNull();
    expect(body.errors).toEqual([]);
    expect(body.permissions).toEqual({
      publish: false,
      assets: false,
      origins: false,
      name: false,
      retention: false,
    });
    for (const secret of [
      'difyApiKeyEnv',
      'KEY_GAMMA',
      'app-secret-gamma-key',
      'difyBaseUrl',
      'dify.test',
    ]) {
      expect(response.body).not.toContain(secret);
    }
  });

  it('isolates tenants: another tenant answers 403, super-admin sees every tenant', async () => {
    const admin = await as('widget-admin');
    expect((await admin('GET', '/admin/api/tenants/delta/config')).statusCode).toBe(403);
    expect(
      (await admin('PUT', '/admin/api/tenants/delta/config/draft', { config: {} })).statusCode,
    ).toBe(403);
    expect((await admin('POST', '/admin/api/tenants/delta/config/publish', {})).statusCode).toBe(
      403,
    );
    expect((await admin('GET', '/admin/api/tenants/unknown/config')).statusCode).toBe(403);
    const root = await as('super-admin');
    expect((await root('GET', '/admin/api/tenants/delta/config')).statusCode).toBe(200);
    expect((await root('GET', '/admin/api/tenants/unknown/config')).statusCode).toBe(404);
  });

  it('lets an editor save a draft that the public widget does not see, but not publish it', async () => {
    const editor = await as('widget-editor');
    const { published } = (await editor('GET', CONFIG)).json<ConfigResponse>();
    const config = { ...published.config, theme: { accent: '#0b6e4f' } };
    const saved = await saveDraft(editor, { config });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ errors: [] });
    expect((await editor('GET', CONFIG)).json<ConfigResponse>().draft?.config).toMatchObject({
      theme: { accent: '#0b6e4f' },
    });
    expect(await accentOf()).toBe('#3a36d0');

    expect((await editor('POST', `${CONFIG}/publish`, {})).json()).toEqual({
      error: { code: 'forbidden' },
    });
    // Allowed origins are reserved to widget-admin.
    const origins = await saveDraft(editor, {
      config: { ...config, allowedOrigins: ['https://evil.test'] },
    });
    expect(origins.statusCode).toBe(403);
    // The save succeeded; the publish and the domains were refused, and recorded as such (B9).
    expect((await auditRows()).map((row) => [row.action, row.result])).toEqual([
      ['draft.save', 'success'],
      ['access.denied', 'denied'],
      ['draft.save', 'denied'],
    ]);
  });

  it("reserves the client's name to the super-admin", async () => {
    for (const role of ['widget-editor', 'widget-admin'] as const) {
      const user = await as(role);
      const { published } = (await user('GET', CONFIG)).json<ConfigResponse>();
      const renamed = await saveDraft(user, { config: { ...published.config, name: 'Alt nume' } });
      expect(renamed.statusCode, role).toBe(403);
    }
    const root = await as('super-admin');
    const { published } = (await root('GET', CONFIG)).json<ConfigResponse>();
    expect((await root('GET', CONFIG)).json<ConfigResponse>().permissions).toMatchObject({
      name: true,
    });
    const renamed = await saveDraft(root, { config: { ...published.config, name: 'Alt nume' } });
    expect(renamed.statusCode).toBe(200);
  });

  it('publishes a valid draft: new version, hot reload without restart, audit with the diff', async () => {
    const admin = await as('widget-admin');
    const { published } = (await admin('GET', CONFIG)).json<ConfigResponse>();
    const config = {
      ...published.config,
      theme: { accent: '#0b6e4f' },
      allowedOrigins: ['http://localhost:5173', 'https://www.gamma.ro'],
      // Server fields sent by a client are ignored.
      difyApiKeyEnv: 'OTHER_KEY',
      id: 'delta',
    };
    expect((await saveDraft(admin, { config })).statusCode).toBe(200);
    const result = await admin('POST', `${CONFIG}/publish`, { comment: 'Culori noi' });
    expect(result.json()).toEqual({ version: 2 });

    await vi.waitFor(async () => {
      expect(await accentOf()).toBe('#0b6e4f');
    });
    const after = (await admin('GET', CONFIG)).json<ConfigResponse>();
    expect(after.published.version).toBe(2);
    expect(after.draft).toBeNull();
    const stored = await pool.query<{ config: Record<string, unknown> }>(
      "SELECT config FROM tenant_config_versions WHERE tenant_id = 'gamma' AND version = 2",
    );
    expect(stored.rows[0]?.config).toMatchObject({ id: 'gamma', difyApiKeyEnv: 'KEY_GAMMA' });

    const audit = await auditRows();
    expect(audit.map((row) => row.action)).toEqual(['draft.save', 'publish', 'origins.change']);
    // Allowed domains are marked sensitive.
    expect(audit[2]?.sensitive).toBe(true);
    expect(audit[1]).toMatchObject({
      actor_name: 'Test widget-admin',
      version: 2,
      result: 'success',
      // Where from (E5 B9): the request's address and id, a hash of the session (never the id).
      ip: expect.any(String) as unknown,
      request_id: expect.any(String) as unknown,
      session_hash: expect.stringMatching(/^[\w-]{22}$/) as unknown,
      details: {
        comment: 'Culori noi',
        changes: expect.arrayContaining([
          { path: 'theme.accent', before: '#3a36d0', after: '#0b6e4f' },
        ]) as unknown,
      },
    });
  });

  it('blocks publishing a configuration below the AA contrast, and publishing without a draft', async () => {
    const admin = await as('widget-admin');
    expect((await admin('POST', `${CONFIG}/publish`, {})).json()).toEqual({
      error: { code: 'no_draft' },
    });
    const { published } = (await admin('GET', CONFIG)).json<ConfigResponse>();
    const config = { ...published.config, theme: { accent: '#3a36d0', onAccent: '#4a46e0' } };
    const saved = (await saveDraft(admin, { config })).json<{ errors: string[] }>();
    expect(saved.errors.join('\n')).toMatch(/^theme\.onAccent: contrast/m);

    const refused = await admin('POST', `${CONFIG}/publish`, {});
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toMatchObject({ error: { code: 'invalid_config' } });
    expect((await admin('GET', CONFIG)).json<ConfigResponse>().published.version).toBe(1);
  });

  it('accepts re-encoded PNG/JPEG/WebP from admins only and refuses SVG or fake images', async () => {
    const png = await sharp({
      create: { width: 64, height: 64, channels: 4, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    const editor = await as('widget-editor');
    expect(
      (await editor('POST', '/admin/api/tenants/gamma/assets?name=logo.png', png)).statusCode,
    ).toBe(403);

    const admin = await as('widget-admin');
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>');
    const svgUpload = await admin('POST', '/admin/api/tenants/gamma/assets?name=logo.svg', svg, {
      'content-type': 'image/svg+xml',
    });
    expect(svgUpload.json()).toEqual({ error: { code: 'unsupported_type' } });
    expect(svgUpload.statusCode).toBe(415);
    const fake = await admin(
      'POST',
      '/admin/api/tenants/gamma/assets?name=logo.png',
      Buffer.from('not an image'),
    );
    expect(fake.statusCode).toBe(415);
    const text = await admin('POST', '/admin/api/tenants/gamma/assets', Buffer.from('x'), {
      'content-type': 'text/plain',
    });
    expect(text.statusCode).toBe(415);

    const upload = await admin('POST', '/admin/api/tenants/gamma/assets?name=Logo.png', png);
    expect(upload.statusCode).toBe(201);
    const { file, url } = upload.json<{ file: string; url: string }>();
    expect(file).toMatch(/^logo-[0-9a-f]{12}\.png$/);
    const thumbnail = await admin('GET', url);
    expect(thumbnail.headers['content-type']).toBe('image/png');

    // The uploaded image is public only once a configuration using it is published.
    const { published } = (await admin('GET', CONFIG)).json<ConfigResponse>();
    await saveDraft(admin, {
      config: { ...published.config, launcher: { icon: { type: 'asset', file } } },
    });
    expect((await admin('POST', `${CONFIG}/publish`, {})).statusCode).toBe(200);
    await vi.waitFor(() => {
      expect(registry.get('gamma')?.assets.get(file)).toBeDefined();
    });
    const publicUrl = registry.get('gamma')?.assets.get(file)?.url ?? '';
    expect((await app.inject({ url: publicUrl })).statusCode).toBe(200);
    expect((await auditRows()).map((row) => row.action)).toContain('asset.upload');
  });

  it('previews the draft through a session-bound token, without changing the public widget', async () => {
    const admin = await as('widget-admin');
    const { published } = (await admin('GET', CONFIG)).json<ConfigResponse>();
    await saveDraft(admin, {
      config: { ...published.config, theme: { accent: '#0b6e4f' } },
    });
    const created = await admin('POST', '/admin/api/tenants/gamma/preview-token', {});
    expect(created.statusCode).toBe(200);
    const { id, url } = created.json<{ id: string; url: string }>();
    expect(id).toMatch(PREVIEW_ID);

    // The preview page: real loader, preview tenant id, framed by the admin only.
    const page = await admin('GET', url);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain(`data-tenant="${id}"`);
    // Opens on the chat window by default; the admin interface may start on another state.
    expect(page.body).toContain('data-preview="window"');
    expect((await admin('GET', `${url}&show=proactive`)).body).toContain(
      'data-preview="proactive"',
    );
    expect((await admin('GET', `${url}&show=everything`)).statusCode).toBe(404);
    // The chat window of a preview shows the sample conversation.
    const widgetConfig = await app.inject({ url: `/api/widget-config?tenant=${id}` });
    expect(widgetConfig.json()).toMatchObject({ preview: true });
    expect(
      (await app.inject({ url: '/api/widget-config?tenant=gamma' })).json(),
    ).not.toHaveProperty('preview');
    expect(page.headers['content-security-policy']).toContain("frame-ancestors 'self'");

    // Draft in the preview, published version for visitors.
    const loader = await app.inject({
      url: `/api/loader-config?tenant=${id}`,
      headers: { origin: ORIGIN },
    });
    expect(loader.json<{ theme: { accent: string } }>().theme.accent).toBe('#0b6e4f');
    expect(loader.headers['access-control-allow-origin']).toBe(ORIGIN);
    // The preview always shows the draft as it is now: never cached by the browser.
    expect(loader.headers['cache-control']).toBe('no-store');
    expect(await accentOf()).toBe('#3a36d0');

    // Preview traffic is marked for Dify (statistics exclude it).
    dify.requests.length = 0;
    await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { origin: ORIGIN },
      payload: { tenant: id, message: 'Bună' },
    });
    const user = (dify.requests[0]?.body as { user?: string } | undefined)?.user;
    expect(user).toMatch(/^preview-[0-9a-f-]{36}$/);

    // Another tenant cannot use or open this preview; a forged token resolves nothing.
    const other = await as('widget-admin', 'delta');
    expect((await other('GET', url)).statusCode).toBe(403);
    const forged = id.replace(/[0-9a-f]{32}$/, '0'.repeat(32));
    expect((await app.inject({ url: `/api/loader-config?tenant=${forged}` })).statusCode).toBe(404);

    // Logging out ends the preview.
    await admin('POST', '/admin/auth/logout', {});
    expect((await app.inject({ url: `/api/loader-config?tenant=${id}` })).statusCode).toBe(404);
  });

  it('lets editors preview but not open a preview id of another tenant', async () => {
    const editor = await as('widget-editor');
    expect((await editor('POST', '/admin/api/tenants/gamma/preview-token', {})).statusCode).toBe(
      200,
    );
    expect((await editor('POST', '/admin/api/tenants/delta/preview-token', {})).statusCode).toBe(
      403,
    );
    expect((await editor('GET', '/admin/preview?id=delta--p-' + 'a'.repeat(32))).statusCode).toBe(
      403,
    );
    expect((await editor('GET', '/admin/preview?id=<script>')).statusCode).toBe(404);
  });

  it('refuses a draft save based on an outdated revision instead of overwriting it', async () => {
    const ana = await as('widget-editor');
    const ion = await as('widget-admin');
    const { published } = (await ana('GET', CONFIG)).json<ConfigResponse>();

    // Both start from the published version, with no draft.
    const first = await ana('PUT', `${CONFIG}/draft`, {
      config: { ...published.config, identity: { assistantName: 'Ana' } },
      baseVersion: 1,
      draftRevision: null,
    });
    expect(first.json()).toMatchObject({ revision: 1 });
    const stale = await ion('PUT', `${CONFIG}/draft`, {
      config: { ...published.config, identity: { assistantName: 'Ion' } },
      baseVersion: 1,
      draftRevision: null,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      error: {
        code: 'draft_conflict',
        publishedVersion: 1,
        draft: { revision: 1, updatedBy: 'Test widget-editor' },
      },
    });
    // Ana's work is intact; Ana keeps saving from her revision.
    const state = (await ion('GET', CONFIG)).json<ConfigResponse>();
    expect(state.draft).toMatchObject({
      revision: 1,
      config: { identity: { assistantName: 'Ana' } },
    });
    const second = await ana('PUT', `${CONFIG}/draft`, {
      config: { ...published.config, identity: { assistantName: 'Ana 2' } },
      baseVersion: 1,
      draftRevision: 1,
    });
    expect(second.json()).toMatchObject({ revision: 2 });
    expect(
      (
        await ion('PUT', `${CONFIG}/draft`, {
          config: published.config,
          baseVersion: 1,
          draftRevision: 1,
        })
      ).statusCode,
    ).toBe(409);
    // A stale publish (reviewed revision 1, draft now at 2) is refused too.
    expect((await ion('POST', `${CONFIG}/publish`, { draftRevision: 1 })).json()).toMatchObject({
      error: { code: 'draft_conflict' },
    });
    // After a publish, a draft started from the old version conflicts.
    expect((await ion('POST', `${CONFIG}/publish`, { draftRevision: 2 })).statusCode).toBe(200);
    const late = await ana('PUT', `${CONFIG}/draft`, {
      config: published.config,
      baseVersion: 1,
      draftRevision: 2,
    });
    expect(late.json()).toMatchObject({
      error: { code: 'draft_conflict', publishedVersion: 2, draft: null },
    });
  });

  it('keeps a preview token alive while it is used and ends it 10 minutes after the last use', async () => {
    const admin = await as('widget-admin');
    const { id } = (await admin('POST', '/admin/api/tenants/gamma/preview-token', {})).json<{
      id: string;
    }>();
    const use = async () =>
      (await app.inject({ url: '/api/loader-config?tenant=' + id })).statusCode;
    const minutes = (n: number) => {
      now += n * 60_000;
    };
    minutes(9);
    expect(await use()).toBe(200);
    minutes(9); // 18 minutes after creation, 9 after the last use
    expect(await use()).toBe(200);
    minutes(11);
    expect(await use()).toBe(404);
  });

  it('records where the widget is installed (allowed sites only, never previews)', async () => {
    const admin = await as('widget-editor');
    const list = async () =>
      (await admin('GET', '/admin/api/tenants/gamma/installations')).json<{
        installations: { origin: string; lastSeen: string | null }[];
      }>().installations;
    expect(await list()).toEqual([{ origin: 'http://localhost:5173', lastSeen: null }]);

    await app.inject({
      url: '/api/loader-config?tenant=gamma',
      headers: { origin: 'http://localhost:5173' },
    });
    await app.inject({
      url: '/api/loader-config?tenant=gamma',
      headers: { origin: 'https://not-allowed.test' },
    });
    await vi.waitFor(async () => {
      expect((await list())[0]?.lastSeen).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T/);
    });
    expect(await list()).toHaveLength(1);
    const other = await as('widget-admin', 'delta');
    expect((await other('GET', '/admin/api/tenants/gamma/installations')).statusCode).toBe(403);
  });

  describe('audit events (E5 B9)', () => {
    const rows = async (chain: string) =>
      (
        await pool.query<Record<string, unknown>>(
          `SELECT action, result, reason, tenant_id, actor_subject, actor_email, actor_role,
                  actor_org, actor_source, ip, user_agent, session_hash, request_id, section,
                  sensitive FROM audit_log WHERE chain = $1 ORDER BY seq`,
          [chain],
        )
      ).rows;
    const LOGIN_COOKIE = '__Secure-admin-login';
    async function signIn(claims: Record<string, unknown>) {
      const start = await app.inject({ url: '/admin/auth/login?org=gamma' });
      const state = new URL(String(start.headers.location)).searchParams.get('state') ?? '';
      const loginCookie = start.cookies.find((cookie) => cookie.name === LOGIN_COOKIE)?.value ?? '';
      oidcClaims = { iss: 'http://kc.test/realms/gamma', sub: 'user-9', ...claims };
      return app.inject({
        url: `/admin/auth/callback?code=c&state=${state}`,
        cookies: { [LOGIN_COOKIE]: loginCookie },
        headers: { 'user-agent': 'AuditTest/1.0' },
      });
    }

    it('records sign-in, refused sign-in, sign-out and an expired session, with who and where', async () => {
      const ok = await signIn({
        name: 'Ana Pop',
        email: 'ana@gamma.test',
        roles: ['widget-admin'],
        identity_provider: 'idp-sim',
      });
      expect(ok.statusCode).toBe(302);
      const session = ok.cookies.find((cookie) => cookie.name === SESSION_COOKIE)?.value ?? '';
      const refused = await signIn({ name: 'Fără rol', roles: [] });
      expect(String(refused.headers.location)).toContain('error=no_role');

      const me = (
        await app.inject({ url: '/admin/api/session', cookies: { [SESSION_COOKIE]: session } })
      ).json<{ csrfToken: string }>();
      await app.inject({
        method: 'POST',
        url: '/admin/auth/logout',
        cookies: { [SESSION_COOKIE]: session },
        headers: { origin: ORIGIN, 'x-csrf-token': me.csrfToken },
      });

      // A session that ends by itself: recorded at the next request, once.
      const short = await as('widget-editor');
      now += 3601 * 1000;
      expect((await short('GET', CONFIG)).statusCode).toBe(401);
      expect((await short('GET', CONFIG)).statusCode).toBe(401);
      now = Date.now();

      const events = await rows('gamma');
      expect(events.map((event) => [event.action, event.result, event.reason ?? null])).toEqual([
        ['auth.login', 'success', null],
        ['auth.login', 'denied', 'no_role'],
        ['auth.logout', 'success', null],
        ['auth.session_expired', 'denied', 'session_expired'],
      ]);
      expect(events[0]).toMatchObject({
        actor_subject: 'user-9',
        actor_email: 'ana@gamma.test',
        actor_role: 'widget-admin',
        actor_org: 'gamma',
        actor_source: 'idp-sim',
        user_agent: 'AuditTest/1.0',
        ip: expect.any(String) as unknown,
        session_hash: expect.stringMatching(/^[\w-]{22}$/) as unknown,
        request_id: expect.any(String) as unknown,
      });
      expect((await verifyChain(pool, 'gamma')).problems).toEqual([]);
    });

    it('records refusals: an editor publishing, a draft conflict, another client, the domains', async () => {
      const editor = await as('widget-editor');
      expect((await editor('POST', `${CONFIG}/publish`, {})).statusCode).toBe(403);
      const { published } = (await editor('GET', CONFIG)).json<ConfigResponse>();
      const stale = await editor('PUT', `${CONFIG}/draft`, {
        config: published.config,
        baseVersion: published.version + 5,
        draftRevision: null,
      });
      expect(stale.statusCode).toBe(409);
      const domains = await editor('PUT', `${CONFIG}/draft`, {
        config: { ...published.config, allowedOrigins: ['https://alt.test'] },
        baseVersion: published.version,
        draftRevision: null,
      });
      expect(domains.statusCode).toBe(403);
      // A client's admin asking for another client: in both chains.
      const admin = await as('widget-admin');
      expect((await admin('GET', '/admin/api/tenants/delta/config')).statusCode).toBe(403);

      const gamma = await rows('gamma');
      expect(gamma.map((event) => [event.action, event.reason, event.tenant_id])).toEqual([
        ['access.denied', 'forbidden', 'gamma'],
        ['draft.save', 'draft_conflict', 'gamma'],
        ['draft.save', 'forbidden', 'gamma'],
        ['access.denied', 'forbidden', 'delta'],
      ]);
      expect(gamma[2]).toMatchObject({ section: 'allowedOrigins', sensitive: true });
      expect((await rows('delta')).map((event) => [event.action, event.actor_subject])).toEqual([
        ['access.denied', 'widget-admin-1'],
      ]);
      for (const chain of TENANTS) expect((await verifyChain(pool, chain)).problems).toEqual([]);
    });
  });

  describe('the audit log screen API (E5 B9)', () => {
    type AuditPage = {
      chain: string;
      events: {
        seq: number;
        action: string;
        result: string;
        reason?: string;
        actor: { name?: string };
        details: Record<string, unknown>;
      }[];
      nextBefore?: number;
    };

    it('lists the own organisation with filters and pages; records the opening once', async () => {
      const admin = await as('widget-admin');
      const editor = await as('widget-editor');
      const { published } = (await admin('GET', CONFIG)).json<ConfigResponse>();
      await saveDraft(editor, { config: { ...published.config, theme: { accent: '#0b6e4f' } } });
      await editor('POST', `${CONFIG}/publish`, {}); // refused: an editor
      await admin('POST', `${CONFIG}/publish`, {});

      const all = (await admin('GET', '/admin/api/audit?opened=1')).json<AuditPage>();
      expect(all.chain).toBe('gamma');
      // Newest first; the opening of the screen recorded before the list was read.
      expect(all.events.map((event) => event.action)).toEqual([
        'audit.view',
        'publish',
        'access.denied',
        'draft.save',
      ]);
      const denied = (await admin('GET', '/admin/api/audit?result=denied')).json<AuditPage>();
      expect(denied.events.map((event) => [event.action, event.reason])).toEqual([
        ['access.denied', 'forbidden'],
      ]);
      const byUser = (await admin('GET', '/admin/api/audit?user=widget-editor')).json<AuditPage>();
      expect(new Set(byUser.events.map((event) => event.actor.name))).toEqual(
        new Set(['Test widget-editor']),
      );
      const search = (await admin('GET', '/admin/api/audit?q=0b6e4f')).json<AuditPage>();
      expect(search.events.map((event) => event.action)).toEqual(['publish', 'draft.save']);
      const prefix = (await admin('GET', '/admin/api/audit?action=audit.*')).json<AuditPage>();
      expect(prefix.events.every((event) => event.action.startsWith('audit.'))).toBe(true);
      const future = (await admin('GET', '/admin/api/audit?from=2099-01-01')).json<AuditPage>();
      expect(future.events).toEqual([]);
      // Pages: two by two.
      const first = (await admin('GET', '/admin/api/audit?limit=2')).json<AuditPage>();
      expect(first.events).toHaveLength(2);
      const second = (
        await admin('GET', `/admin/api/audit?limit=2&before=${String(first.nextBefore)}`)
      ).json<AuditPage>();
      expect(second.events[0]?.seq).toBeLessThan(first.events[1]?.seq ?? 0);
      // Only one audit.view: the later reads were not openings.
      const views = (await admin('GET', '/admin/api/audit?action=audit.view')).json<AuditPage>();
      expect(views.events).toHaveLength(1);
    });

    it('editors have no access; another client is refused (and recorded); super-admin sees all', async () => {
      const editor = await as('widget-editor');
      expect((await editor('GET', '/admin/api/audit')).statusCode).toBe(403);
      const admin = await as('widget-admin');
      expect((await admin('GET', '/admin/api/audit?chain=delta')).statusCode).toBe(403);
      expect((await admin('GET', '/admin/api/audit/export?chain=delta')).statusCode).toBe(403);
      const root = await as('super-admin');
      const gamma = (await root('GET', '/admin/api/audit?chain=gamma')).json<AuditPage>();
      expect(
        gamma.events
          .filter((event) => event.action === 'access.denied')
          .map((event) => event.reason),
      ).toEqual(['forbidden', 'forbidden', 'forbidden']);
      const delta = (await root('GET', '/admin/api/audit?chain=delta')).json<AuditPage>();
      expect(delta.events.map((event) => event.action)).toEqual(['access.denied', 'access.denied']);
      expect((await root('GET', '/admin/api/audit?chain=platform')).statusCode).toBe(200);
      expect((await root('GET', '/admin/api/audit?chain=nu-exista')).statusCode).toBe(404);
    });

    it('exports CSV and JSON with a header an auditor can check; the export is recorded', async () => {
      const admin = await as('widget-admin');
      const { published } = (await admin('GET', CONFIG)).json<ConfigResponse>();
      await saveDraft(admin, { config: { ...published.config, theme: { accent: '#0b6e4f' } } });
      await admin('POST', `${CONFIG}/publish`, { comment: 'Culori „noi”' });

      const json = await admin('GET', '/admin/api/audit/export?format=json');
      expect(json.headers['content-disposition']).toMatch(
        /^attachment; filename="jurnal-audit-gamma-.+\.json"$/,
      );
      const body = json.json<{
        header: Record<string, unknown>;
        events: { record: Record<string, unknown>; prevHash: string; hash: string }[];
      }>();
      expect(body.header).toMatchObject({
        generatedBy: { name: 'Test widget-admin', role: 'widget-admin', org: 'gamma' },
        chain: 'gamma',
        count: 2,
        contiguous: true,
        startsAfter: { seq: 0, hash: '' },
      });
      // Every record can be recomputed by the auditor, and they link to each other.
      for (const [index, event] of body.events.entries()) {
        expect(chainHash(event.prevHash, event.record)).toBe(event.hash);
        if (index > 0) expect(event.prevHash).toBe(body.events[index - 1]?.hash);
      }
      expect(body.header.lastHash).toBe(body.events.at(-1)?.hash);

      const csv = await admin('GET', '/admin/api/audit/export?format=csv&action=publish');
      expect(csv.headers['content-type']).toBe('text/csv; charset=utf-8');
      const lines = csv.body.replace(/^\uFEFF/, '').split('\r\n');
      expect(lines[0]).toBe('# Jurnal de audit — gamma');
      expect(lines[1]).toBe('# generat de: Test widget-admin (widget-admin, gamma)');
      expect(lines.find((line) => line.startsWith('# continuu:'))).toBeUndefined();
      expect(lines.find((line) => line.startsWith('# înregistrări:'))).toBe(
        '# înregistrări: 1; continuu: nu',
      );
      const columns = lines.find((line) => line.startsWith('seq,'))?.split(',') ?? [];
      const row = lines[lines.findIndex((line) => line.startsWith('seq,')) + 1] ?? '';
      expect(columns.slice(0, 4)).toEqual(['seq', 'at_utc', 'at_romania', 'action']);
      expect(row).toContain(',publish,');
      expect(row).toContain('Culori „noi”');

      // Both exports are in the log, with what they contained.
      const exports = (
        await admin('GET', '/admin/api/audit?action=audit.export')
      ).json<AuditPage>();
      expect(exports.events.map((event) => event.details)).toEqual([
        expect.objectContaining({ format: 'csv', count: 1, filters: { action: 'publish' } }),
        expect.objectContaining({ format: 'json', count: 2, filters: {} }),
      ]);
    });
  });

  it('lists the documents the assistant cited recently (E4b.1 UX 13)', async () => {
    await recordCited(kv, 'gamma', ['regulament.pdf'], now - 60_000);
    await recordCited(kv, 'gamma--p-abc', ['ghid.pdf'], now);
    await recordCited(kv, 'delta', ['alt.pdf'], now);
    const editor = await as('widget-editor');
    const answer = await editor('GET', '/admin/api/tenants/gamma/cited-documents');
    expect(answer.statusCode).toBe(200);
    expect(
      answer.json<{ documents: { name: string }[] }>().documents.map((doc) => doc.name),
    ).toEqual(['ghid.pdf', 'regulament.pdf']);
    const other = await as('widget-admin', 'delta');
    expect((await other('GET', '/admin/api/tenants/gamma/cited-documents')).statusCode).toBe(403);
  });

  it("gives the assistant's own welcome and starter questions (Dify /parameters)", async () => {
    dify.handler = (_req, res) =>
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          opening_statement: ' Bună ziua! ',
          suggested_questions: ['Care e programul?', ' ', 'Cum mă înscriu?'],
        }),
      );
    const editor = await as('widget-editor');
    expect((await editor('GET', '/admin/api/tenants/gamma/assistant-defaults')).json()).toEqual({
      welcome: 'Bună ziua!',
      suggestedQuestions: ['Care e programul?', 'Cum mă înscriu?'],
      available: true,
    });
    dify.handler = (_req, res) => res.writeHead(500).end();
  });
});
