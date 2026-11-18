import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import {
  validateTenantObject,
  type Tenant,
  type TenantAsset,
  type TenantRegistry,
} from '../config/tenants.js';
import { PgAssetSource } from '../db/postgres-source.js';
import { AdminConfigStore } from './config-store.js';
import { editableView, mergeServerFields } from './editable.js';
import type { KeyValueStore } from './kv.js';
import { sessionKey } from './sessions.js';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Preview tenant id: `<tenant>--p-<token>`. The widget carries its tenant id everywhere (loader,
 * iframe, API), so the preview needs no widget change: requests with this id use the draft.
 */
export const PREVIEW_ID = /^([a-z0-9-]{1,64})--p-([0-9a-f]{32})$/;
export const PREVIEW_TTL_SECONDS = 600;

const recordSchema = z.object({ tenant: z.string(), session: z.string() });
const recordKey = (token: string): string =>
  `admin:preview:${createHash('sha256').update(token).digest('base64url')}`;

/** Removes preview tokens from text that may be logged (URLs). */
export const redactPreview = (text: string): string =>
  text.replace(/--p-[0-9a-f]{32}/g, '--p-[redacted]');

/**
 * Short-lived preview tokens (ADR 008): 10 minutes, bound to the admin session that created them
 * (logging out ends the preview) and to one tenant. Kept in Redis for every replica.
 */
export class PreviewService {
  readonly #configs: AdminConfigStore;
  readonly #assets: PgAssetSource;

  constructor(
    private readonly store: KeyValueStore,
    db: pg.Pool,
    private readonly tenantEnv: Env,
    private readonly publicOrigin: string,
  ) {
    this.#configs = new AdminConfigStore(db);
    this.#assets = new PgAssetSource(db);
  }

  async create(tenant: string, sessionCookie: string): Promise<{ id: string; expiresAt: string }> {
    const token = randomBytes(16).toString('hex');
    await this.store.set(
      recordKey(token),
      JSON.stringify({ tenant, session: sessionKey(sessionCookie) }),
      PREVIEW_TTL_SECONDS,
    );
    return {
      id: `${tenant}--p-${token}`,
      expiresAt: new Date(Date.now() + PREVIEW_TTL_SECONDS * 1000).toISOString(),
    };
  }

  /** The draft (or, without a draft, the published) configuration as a preview tenant. */
  async resolve(id: string): Promise<Tenant | undefined> {
    const match = PREVIEW_ID.exec(id);
    if (!match) return undefined;
    const [, tenantId = '', token = ''] = match;
    const raw = await this.store.get(recordKey(token));
    const record = raw ? recordSchema.safeParse(JSON.parse(raw)) : undefined;
    if (!record?.success || record.data.tenant !== tenantId) return undefined;
    // Bound to the admin session: no session, no preview.
    if (!(await this.store.get(record.data.session))) return undefined;

    const published = await this.#configs.published(tenantId);
    if (!published) return undefined;
    const draft = await this.#configs.draft(tenantId);
    const config = mergeServerFields(
      editableView(draft?.config ?? published.config),
      published.config,
    );
    // Like the tenant sources: invalid presentation sections fall back to their defaults.
    const { tenant } = await validateTenantObject(config, {
      env: this.tenantEnv,
      fileName: `${tenantId} (preview)`,
      expectedId: tenantId,
      assets: this.#assets,
    });
    if (!tenant) return undefined;

    const assets = new Map<string, TenantAsset>();
    for (const [name, asset] of tenant.assets) {
      assets.set(name, { ...asset, url: `/w/t/${id}/${asset.hash}-${name}` });
    }
    return {
      ...tenant,
      id,
      enabled: true,
      // The preview page is served by the gateway itself.
      allowedOrigins: [...new Set([...tenant.allowedOrigins, this.publicOrigin])],
      assets,
      preview: { tenantId },
    };
  }
}

const CACHE_MS = 30_000;

/**
 * The tenant registry seen by the widget routes: published tenants, plus the preview tenants
 * resolved by the request hook just before the handler runs (so lookups stay synchronous). The
 * cache only bridges the hook and the handler; Redis and Postgres remain the source of truth.
 */
export class TenantsWithPreviews implements TenantRegistry {
  readonly #previews = new Map<string, { tenant: Tenant; expiresAt: number }>();

  constructor(private readonly base: TenantRegistry) {}

  remember(id: string, tenant: Tenant | undefined): void {
    const now = Date.now();
    for (const [key, entry] of this.#previews) {
      if (entry.expiresAt <= now) this.#previews.delete(key);
    }
    if (tenant) this.#previews.set(id, { tenant, expiresAt: now + CACHE_MS });
    else this.#previews.delete(id);
  }

  get(id: string): Tenant | undefined {
    const published = this.base.get(id);
    if (published) return published;
    const entry = this.#previews.get(id);
    return entry && entry.expiresAt > Date.now() ? entry.tenant : undefined;
  }

  has(id: string): boolean {
    return this.get(id) !== undefined;
  }

  get size(): number {
    return this.base.size;
  }

  forEach(callback: (value: Tenant, key: string, map: ReadonlyMap<string, Tenant>) => void): void {
    this.base.forEach((value, key) => {
      callback(value, key, this);
    });
  }

  entries(): MapIterator<[string, Tenant]> {
    return this.base.entries();
  }

  keys(): MapIterator<string> {
    return this.base.keys();
  }

  values(): MapIterator<Tenant> {
    return this.base.values();
  }

  [Symbol.iterator](): MapIterator<[string, Tenant]> {
    return this.base[Symbol.iterator]();
  }
}
