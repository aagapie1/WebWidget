import { resolve } from 'node:path';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { loadTenants } from './config/tenants.js';

const env = loadEnv(process.env);
const tenants = await loadTenants(resolve(env.TENANTS_DIR), process.env);
const app = await buildApp({ env, tenants });

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
