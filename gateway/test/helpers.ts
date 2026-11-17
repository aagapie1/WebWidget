import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Tenant } from '../src/config/tenants.js';

export const testTenant: Tenant = {
  id: 'pilot',
  name: 'Pilot',
  difyBaseUrl: 'http://dify.test/v1',
  difyApiKey: 'app-test-secret-key',
  allowedOrigins: ['http://localhost:5173'],
  theme: {},
  texts: { ro: { 'errors.upstream_timeout': 'Text personalizat pentru timeout.' } },
};

export function fixture(name: string): string {
  return readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');
}
