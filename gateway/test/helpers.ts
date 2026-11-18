import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tenantSchema } from '../src/config/schema.js';
import type { Tenant } from '../src/config/tenants.js';

const parsed = tenantSchema.parse({
  schemaVersion: 1,
  id: 'pilot',
  name: 'Pilot',
  difyBaseUrl: 'http://dify.test/v1',
  difyApiKeyEnv: 'DIFY_API_KEY_PILOT',
  allowedOrigins: ['http://localhost:5173'],
  texts: { ro: { 'errors.upstream_timeout': 'Text personalizat pentru timeout.' } },
  citations: { documentTitles: { 'Regulament.pdf': 'Regulamentul intern' } },
});

// The runtime tenant has the resolved key instead of the variable name.
const config: Partial<typeof parsed> = { ...parsed };
delete config.difyApiKeyEnv;

export const testTenant: Tenant = {
  ...(config as Omit<typeof parsed, 'difyApiKeyEnv'>),
  difyApiKey: 'app-test-secret-key',
  assets: new Map(),
};

export function fixture(name: string): string {
  return readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');
}
