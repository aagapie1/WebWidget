import pg from 'pg';
import {
  validateTenantObject,
  type AssetSource,
  type Tenant,
  type TenantLogger,
  type TenantSource,
} from '../config/tenants.js';

type Env = Readonly<Record<string, string | undefined>>;

/** Channel used when a version is published (ADR 008); payload: the tenant id. */
export const CONFIG_CHANNEL = 'tenant_config';

/** Images stored in `tenant_assets` (seeded or uploaded). */
export class PgAssetSource implements AssetSource {
  constructor(private readonly pool: pg.Pool) {}

  async get(tenantId: string, name: string): Promise<Buffer | undefined> {
    const result = await this.pool.query<{ bytes: Buffer }>(
      'SELECT bytes FROM tenant_assets WHERE tenant_id = $1 AND name = $2',
      [tenantId, name],
    );
    return result.rows[0]?.bytes;
  }

  describe(tenantId: string): string {
    return `the images of tenant ${tenantId}`;
  }
}

interface VersionRow {
  tenant_id: string;
  version: number;
  config: unknown;
}

/**
 * Published configurations from Postgres (ADR 008). Same rules as the file source: a tenant is
 * never taken down by presentation errors; an invalid new version keeps the last valid one.
 * Every replica LISTENs on `tenant_config` and reloads the published tenant.
 */
export class PostgresTenantSource implements TenantSource {
  readonly #assets: PgAssetSource;

  constructor(
    private readonly pool: pg.Pool,
    private readonly listenUrl: string,
    private readonly env: Env,
    private readonly log: TenantLogger,
  ) {
    this.#assets = new PgAssetSource(pool);
  }

  async load(): Promise<Map<string, Tenant>> {
    const rows = await this.pool.query<VersionRow>(
      `SELECT DISTINCT ON (tenant_id) tenant_id, version, config
         FROM tenant_config_versions
        ORDER BY tenant_id, version DESC`,
    );
    const tenants = new Map<string, Tenant>();
    for (const row of rows.rows) {
      const tenant = await this.#validate(row, undefined);
      if (tenant) tenants.set(tenant.id, tenant);
    }
    if (tenants.size === 0) {
      throw new Error('No valid tenant configuration in Postgres (run `pnpm db:seed`)');
    }
    return tenants;
  }

  /** Reloads one tenant (published version) into the registry. */
  async reload(tenantId: string, registry: Map<string, Tenant>): Promise<void> {
    const rows = await this.pool.query<VersionRow>(
      `SELECT tenant_id, version, config FROM tenant_config_versions
        WHERE tenant_id = $1 ORDER BY version DESC LIMIT 1`,
      [tenantId],
    );
    const row = rows.rows[0];
    if (!row) return;
    const tenant = await this.#validate(row, registry.get(tenantId));
    if (tenant) {
      registry.set(tenant.id, tenant);
      this.log.info({ tenant: tenant.id, version: row.version }, 'tenant config reloaded');
    }
  }

  watch(registry: Map<string, Tenant>): () => void {
    const client = new pg.Client({ connectionString: this.listenUrl });
    let stopped = false;
    client.on('notification', (message) => {
      if (message.channel === CONFIG_CHANNEL && message.payload) {
        void this.reload(message.payload, registry).catch((error: unknown) => {
          this.log.error(
            { tenant: message.payload, err: String(error) },
            'tenant config reload failed',
          );
        });
      }
    });
    client.on('error', (error) => {
      this.log.error({ err: String(error) }, 'tenant config listener error');
    });
    void client
      .connect()
      .then(() => client.query(`LISTEN ${CONFIG_CHANNEL}`))
      .catch((error: unknown) => {
        if (!stopped)
          this.log.error({ err: String(error) }, 'tenant config hot reload unavailable');
      });
    return () => {
      stopped = true;
      void client.end().catch(() => undefined);
    };
  }

  async #validate(row: VersionRow, previous: Tenant | undefined): Promise<Tenant | undefined> {
    const label = `${row.tenant_id} v${String(row.version)} (postgres)`;
    const result = await validateTenantObject(row.config, {
      env: this.env,
      fileName: label,
      expectedId: row.tenant_id,
      assets: this.#assets,
    });
    if (result.errors.length === 0) return result.tenant;
    if (previous) {
      this.log.error(
        { tenant: label, errors: result.errors },
        'tenant config rejected; keeping the last valid configuration',
      );
      return previous;
    }
    if (result.tenant) {
      this.log.error(
        { tenant: label, errors: result.errors },
        'tenant config has errors; invalid sections use defaults',
      );
      return result.tenant;
    }
    this.log.error(
      { tenant: label, errors: result.errors },
      'tenant config rejected; tenant unavailable',
    );
    return undefined;
  }
}
