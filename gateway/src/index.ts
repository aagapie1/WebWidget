import { resolve } from 'node:path';
import { buildApp, type BuildAppOptions } from './app.js';
import { loadAdminAuthConfig } from './admin/auth-config.js';
import { RedisKeyValueStore, type KeyValueStore } from './admin/kv.js';
import { OpenIdClient } from './admin/oidc.js';
import { loadEnv } from './config/env.js';
import pg from 'pg';
import pino from 'pino';
import { FileTenantSource, type TenantSource } from './config/tenants.js';
import { PostgresTenantSource } from './db/postgres-source.js';
import { MemoryFeedbackStore, RedisFeedbackStore, type FeedbackStore } from './feedback/store.js';

const env = loadEnv(process.env);
// Tenant configuration: per-tenant validation, fallback and hot reload (ADR 007), from YAML files
// or Postgres (ADR 008, TENANT_SOURCE).
const configLog = pino({ level: env.LOG_LEVEL, name: 'tenant-config' });
let database: pg.Pool | undefined;
let tenantSource: TenantSource;
if (env.TENANT_SOURCE === 'postgres') {
  if (!env.DATABASE_URL) throw new Error('TENANT_SOURCE=postgres requires DATABASE_URL');
  database = new pg.Pool({ connectionString: env.DATABASE_URL });
  tenantSource = new PostgresTenantSource(database, env.DATABASE_URL, process.env, configLog);
} else {
  tenantSource = new FileTenantSource(resolve(env.TENANTS_DIR), process.env, configLog);
}
const tenants = await tenantSource.load();
const stopWatching = tenantSource.watch(tenants);
configLog.info({ source: env.TENANT_SOURCE }, 'tenant configuration source');
let feedbackStore: FeedbackStore;
if (env.REDIS_URL) {
  feedbackStore = await RedisFeedbackStore.connect(env.REDIS_URL);
} else if (env.NODE_ENV === 'production') {
  throw new Error('REDIS_URL is required in production (closing feedback storage, ADR 005)');
} else {
  feedbackStore = new MemoryFeedbackStore();
}

// Admin interface (ADR 008): only with a server auth configuration; sessions need Redis.
let adminStore: KeyValueStore | undefined;
let admin: BuildAppOptions['admin'];
if (env.ADMIN_AUTH_CONFIG) {
  if (!env.REDIS_URL) throw new Error('ADMIN_AUTH_CONFIG requires REDIS_URL (admin sessions)');
  adminStore = await RedisKeyValueStore.connect(env.REDIS_URL);
  admin = {
    auth: await loadAdminAuthConfig(resolve(env.ADMIN_AUTH_CONFIG), process.env),
    store: adminStore,
    oidc: new OpenIdClient(env.NODE_ENV !== 'production'),
  };
}

const app = await buildApp({ env, tenants, feedbackStore, ...(admin ? { admin } : {}) });
app.log.info({ admin: admin ? [...admin.auth.realms.keys()] : false }, 'admin interface');
if (!env.REDIS_URL) {
  app.log.warn('REDIS_URL not set: closing feedback is kept in memory (development only)');
}
app.addHook('onClose', async () => {
  stopWatching();
  await feedbackStore.close();
  await adminStore?.close();
  await database?.end();
});

app.log.info({ tenants: [...tenants.keys()] }, 'tenants loaded');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}

await app.listen({ host: env.HOST, port: env.PORT });
