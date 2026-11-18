import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tenant } from '../src/config/tenants.js';
import { migrate } from '../src/db/migrate.js';
import { CONFIG_CHANNEL, PostgresTenantSource } from '../src/db/postgres-source.js';
import { seedFromYaml } from '../src/db/seed.js';

// Real Postgres, a dedicated test database (the tests truncate tables):
// TEST_DATABASE_URL (app role) and TEST_DATABASE_OWNER_URL, e.g. .../widget_test.
const appUrl = process.env.TEST_DATABASE_URL;
const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const env = { DIFY_BASE_URL: 'http://dify.test/v1', KEY: 'app-x' };
const log = { info: vi.fn(), error: vi.fn() };

const yaml = (id: string, accent = '#3a36d0') => `schemaVersion: 1
id: ${id}
name: ${id}
difyBaseUrl: \${DIFY_BASE_URL}
difyApiKeyEnv: KEY
allowedOrigins: [http://localhost:5173]
identity:
  logo: logo.png
theme:
  accent: '${accent}'
`;

describe.skipIf(!appUrl || !ownerUrl)('Postgres storage (ADR 008)', () => {
  let app: pg.Pool;
  let owner: pg.Pool;
  let dir: string;

  beforeAll(async () => {
    await migrate(ownerUrl ?? '', resolve('migrations'), () => undefined);
    app = new pg.Pool({ connectionString: appUrl });
    owner = new pg.Pool({ connectionString: ownerUrl });
  });

  afterAll(async () => {
    await app.end();
    await owner.end();
  });

  beforeEach(async () => {
    await owner.query(
      'TRUNCATE tenant_config_versions, tenant_config_drafts, tenant_assets, audit_log RESTART IDENTITY',
    );
    dir = await mkdtemp(join(tmpdir(), 'seed-'));
    for (const id of ['alpha', 'beta']) {
      await writeFile(join(dir, `${id}.yaml`), yaml(id));
      await mkdir(join(dir, id, 'assets'), { recursive: true });
      await writeFile(
        join(dir, id, 'assets', 'logo.png'),
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]),
      );
    }
    log.info.mockClear();
    log.error.mockClear();
    return () => rm(dir, { recursive: true, force: true });
  });

  it('seeds YAML tenants (with images) once, as version 1, with an audit record', async () => {
    expect(await seedFromYaml(app, dir)).toEqual({ seeded: ['alpha', 'beta'], skipped: [] });
    expect(await seedFromYaml(app, dir)).toEqual({ seeded: [], skipped: ['alpha', 'beta'] });
    const versions = await app.query(
      'SELECT tenant_id, version, created_by FROM tenant_config_versions ORDER BY 1',
    );
    expect(versions.rows).toEqual([
      { tenant_id: 'alpha', version: 1, created_by: 'seed:yaml' },
      { tenant_id: 'beta', version: 1, created_by: 'seed:yaml' },
    ]);
    const audit = await app.query(
      "SELECT tenant_id, action FROM audit_log WHERE action = 'seed' ORDER BY 1",
    );
    expect(audit.rows).toHaveLength(2);
  });

  it('loads the latest published version of each tenant with images from Postgres', async () => {
    await seedFromYaml(app, dir);
    await app.query(
      "INSERT INTO tenant_config_versions (tenant_id, version, config, created_by) VALUES ('alpha', 2, $1, 'test')",
      [JSON.stringify({ ...(await configOf(app, 'alpha')), name: 'Alpha v2' })],
    );
    const source = new PostgresTenantSource(app, appUrl ?? '', env, log);
    const tenants = await source.load();
    expect([...tenants.keys()].sort()).toEqual(['alpha', 'beta']);
    expect(tenants.get('alpha')?.name).toBe('Alpha v2');
    const logo = tenants.get('alpha')?.assets.get('logo.png');
    expect(logo?.url).toMatch(/^\/w\/t\/alpha\/[0-9a-f]{10}-logo\.png$/);
    expect((await logo?.read())?.length).toBe(5);
  });

  it('hot-reloads a tenant on NOTIFY and keeps the last valid version on an invalid one', async () => {
    await seedFromYaml(app, dir);
    const source = new PostgresTenantSource(app, appUrl ?? '', env, log);
    const registry = await source.load();
    const stop = source.watch(registry);
    try {
      await new Promise((r) => setTimeout(r, 300)); // LISTEN established
      const base = await configOf(app, 'alpha');
      await app.query(
        "INSERT INTO tenant_config_versions (tenant_id, version, config, created_by) VALUES ('alpha', 2, $1, 'test')",
        [JSON.stringify({ ...base, name: 'Alpha publicat' })],
      );
      await app.query('SELECT pg_notify($1, $2)', [CONFIG_CHANNEL, 'alpha']);
      await vi.waitFor(
        () => {
          expect(registry.get('alpha')?.name).toBe('Alpha publicat');
        },
        { timeout: 3000 },
      );

      const before: Tenant | undefined = registry.get('alpha');
      await app.query(
        "INSERT INTO tenant_config_versions (tenant_id, version, config, created_by) VALUES ('alpha', 3, $1, 'test')",
        [JSON.stringify({ ...base, theme: { accent: '#ffff00' } })],
      );
      await app.query('SELECT pg_notify($1, $2)', [CONFIG_CHANNEL, 'alpha']);
      await vi.waitFor(
        () => {
          expect(log.error).toHaveBeenCalledWith(
            expect.objectContaining({ tenant: 'alpha v3 (postgres)' }),
            'tenant config rejected; keeping the last valid configuration',
          );
        },
        { timeout: 3000 },
      );
      expect(registry.get('alpha')).toBe(before);
    } finally {
      stop();
    }
  });

  it('the application role cannot change or delete the audit log or published versions', async () => {
    await seedFromYaml(app, dir);
    const denied = async (sql: string) => {
      await expect(app.query(sql)).rejects.toMatchObject({ code: '42501' }); // insufficient_privilege
    };
    await denied("UPDATE audit_log SET action = 'x'");
    await denied('DELETE FROM audit_log');
    await denied('TRUNCATE audit_log');
    await denied("UPDATE tenant_config_versions SET comment = 'x'");
    await denied('DELETE FROM tenant_config_versions');
    await denied('CREATE TABLE intruder (id int)');
    // Drafts are the only mutable configuration.
    await app.query(
      "INSERT INTO tenant_config_drafts (tenant_id, config, updated_by) VALUES ('alpha', '{}', 't')",
    );
    await app.query("UPDATE tenant_config_drafts SET updated_by = 'u' WHERE tenant_id = 'alpha'");
  });
});

async function configOf(pool: pg.Pool, id: string): Promise<Record<string, unknown>> {
  const rows = await pool.query<{ config: Record<string, unknown> }>(
    'SELECT config FROM tenant_config_versions WHERE tenant_id = $1 ORDER BY version DESC LIMIT 1',
    [id],
  );
  return rows.rows[0]?.config ?? {};
}
