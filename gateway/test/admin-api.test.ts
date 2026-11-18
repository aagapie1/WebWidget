import type { FastifyInstance } from 'fastify';
import { resolve } from 'node:path';
import pg from 'pg';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAdminAuthConfig } from '../src/admin/auth-config.js';
import type { AdminIdentity } from '../src/admin/identity.js';
import { MemoryKeyValueStore } from '../src/admin/kv.js';
import type { OidcClient } from '../src/admin/oidc.js';
import { AdminSessions, SESSION_COOKIE } from '../src/admin/sessions.js';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import type { Tenant } from '../src/config/tenants.js';
import { migrate } from '../src/db/migrate.js';
import { PostgresTenantSource } from '../src/db/postgres-source.js';

// Real Postgres (same test database as db.test.ts; this file only touches its own tenants).
const appUrl = process.env.TEST_DATABASE_URL;
const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const ORIGIN = 'https://gateway.test';
const TENANTS = ['gamma', 'delta'];
const tenantEnv = { DIFY_BASE_URL: 'http://dify.test/v1', KEY_GAMMA: 'app-secret-gamma-key' };

const seedConfig = (id: string) => ({
  schemaVersion: 1,
  id,
  name: `Client ${id}`,
  difyBaseUrl: '${DIFY_BASE_URL}',
  difyApiKeyEnv: 'KEY_GAMMA',
  allowedOrigins: ['http://localhost:5173'],
  theme: { accent: '#3a36d0' },
});

const unusedOidc: OidcClient = {
  authorizationUrl: () => Promise.reject(new Error('not used')),
  exchange: () => Promise.reject(new Error('not used')),
  endSessionUrl: () => Promise.resolve(undefined),
};

describe.skipIf(!appUrl || !ownerUrl)('admin configuration API (Postgres)', () => {
  let pool: pg.Pool;
  let owner: pg.Pool;
  let app: FastifyInstance;
  let registry: Map<string, Tenant>;
  let stopWatching: () => void;
  let sessions: AdminSessions;

  beforeAll(async () => {
    await migrate(ownerUrl ?? '', resolve('migrations'), () => undefined);
    pool = new pg.Pool({ connectionString: appUrl });
    owner = new pg.Pool({ connectionString: ownerUrl });
  });
  afterAll(async () => {
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
      await owner.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1)`, [TENANTS]);
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
    const store = new MemoryKeyValueStore();
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
        oidc: unusedOidc,
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
    draft: { config: Record<string, unknown> } | null;
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
      await pool.query<{ action: string; actor_name: string; details: Record<string, unknown> }>(
        "SELECT action, actor_name, details FROM audit_log WHERE tenant_id = 'gamma' ORDER BY id",
      )
    ).rows;

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
    expect(body.permissions).toEqual({ publish: false, assets: false, origins: false });
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
    const saved = await editor('PUT', `${CONFIG}/draft`, { config, baseVersion: 1 });
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
    const origins = await editor('PUT', `${CONFIG}/draft`, {
      config: { ...config, allowedOrigins: ['https://evil.test'] },
    });
    expect(origins.statusCode).toBe(403);
    expect((await auditRows()).map((row) => row.action)).toEqual(['draft.save']);
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
    expect((await admin('PUT', `${CONFIG}/draft`, { config })).statusCode).toBe(200);
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
    expect(audit[1]).toMatchObject({
      actor_name: 'Test widget-admin',
      details: {
        version: 2,
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
    const saved = (await admin('PUT', `${CONFIG}/draft`, { config })).json<{ errors: string[] }>();
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
    await admin('PUT', `${CONFIG}/draft`, {
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
});
