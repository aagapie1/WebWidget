import { resolve } from 'node:path';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { FileTenantSource } from './config/tenants.js';
import pino from 'pino';
import { MemoryFeedbackStore, RedisFeedbackStore, type FeedbackStore } from './feedback/store.js';

const env = loadEnv(process.env);
// Tenant configuration: per-tenant validation, fallback and hot reload (ADR 007).
const configLog = pino({ level: env.LOG_LEVEL, name: 'tenant-config' });
const tenantSource = new FileTenantSource(resolve(env.TENANTS_DIR), process.env, configLog);
const tenants = await tenantSource.load();
const stopWatching = tenantSource.watch(tenants);
let feedbackStore: FeedbackStore;
if (env.REDIS_URL) {
  feedbackStore = await RedisFeedbackStore.connect(env.REDIS_URL);
} else if (env.NODE_ENV === 'production') {
  throw new Error('REDIS_URL is required in production (closing feedback storage, ADR 005)');
} else {
  feedbackStore = new MemoryFeedbackStore();
}

const app = await buildApp({ env, tenants, feedbackStore });
if (!env.REDIS_URL) {
  app.log.warn('REDIS_URL not set: closing feedback is kept in memory (development only)');
}
app.addHook('onClose', async () => {
  stopWatching();
  await feedbackStore.close();
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
