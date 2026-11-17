import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadTenants, parseTenant, TenantConfigError } from '../../src/config/tenants.js';

const env = {
  DIFY_BASE_URL: 'http://localhost:8080/v1',
  DIFY_API_KEY_PILOT: 'app-secret-pilot',
};

const validYaml = `
id: pilot
name: Pilot
difyBaseUrl: \${DIFY_BASE_URL}
difyApiKeyEnv: DIFY_API_KEY_PILOT
allowedOrigins:
  - http://localhost:5173
texts:
  ro:
    errors.timeout: Răspunsul întârzie.
`;

describe('parseTenant', () => {
  it('parses a valid tenant, interpolates env vars and resolves the API key', () => {
    const tenant = parseTenant(validYaml, env, 'pilot.yaml');
    expect(tenant.id).toBe('pilot');
    expect(tenant.difyBaseUrl).toBe('http://localhost:8080/v1');
    expect(tenant.difyApiKey).toBe('app-secret-pilot');
    expect(tenant.allowedOrigins).toEqual(['http://localhost:5173']);
    expect(tenant.texts.ro?.['errors.timeout']).toBe('Răspunsul întârzie.');
    expect(tenant.theme).toEqual({});
  });

  it('strips a trailing slash from the Dify base URL', () => {
    const tenant = parseTenant(
      validYaml,
      { ...env, DIFY_BASE_URL: 'http://dify/v1/' },
      'pilot.yaml',
    );
    expect(tenant.difyBaseUrl).toBe('http://dify/v1');
  });

  it('fails when an interpolated variable is missing', () => {
    expect(() => parseTenant(validYaml, { DIFY_API_KEY_PILOT: 'x' }, 'pilot.yaml')).toThrow(
      /DIFY_BASE_URL/,
    );
  });

  it('fails when the API key variable is missing, without leaking other values', () => {
    const error = captureError(() =>
      parseTenant(validYaml, { DIFY_BASE_URL: env.DIFY_BASE_URL }, 'pilot.yaml'),
    );
    expect(error).toBeInstanceOf(TenantConfigError);
    expect(error.message).toMatch(/DIFY_API_KEY_PILOT/);
  });

  it('rejects an API key written directly in the file', () => {
    const yaml = validYaml + 'difyApiKey: app-should-not-be-here\n';
    const error = captureError(() => parseTenant(yaml, env, 'pilot.yaml'));
    expect(error.message).toMatch(/difyApiKey/);
    expect(error.message).not.toContain('app-should-not-be-here');
  });

  it('rejects an id that does not match the file name', () => {
    expect(() => parseTenant(validYaml, env, 'other.yaml')).toThrow(/file name/);
  });

  it('rejects allowedOrigins that are not bare origins', () => {
    const yaml = validYaml.replace('http://localhost:5173', 'https://example.ro/path');
    expect(() => parseTenant(yaml, env, 'pilot.yaml')).toThrow(/allowedOrigins/);
  });

  it('rejects an invalid tenant id', () => {
    const yaml = validYaml.replace('id: pilot', 'id: Pilot_1');
    expect(() => parseTenant(yaml, env, 'Pilot_1.yaml')).toThrow(/id/);
  });
});

describe('loadTenants', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tenants-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('loads every *.yaml file in the directory, keyed by id', async () => {
    await writeFile(join(dir, 'pilot.yaml'), validYaml);
    await writeFile(join(dir, 'README.md'), 'ignored');
    const tenants = await loadTenants(dir, env);
    expect([...tenants.keys()]).toEqual(['pilot']);
  });

  it('fails when the directory has no tenants', async () => {
    await expect(loadTenants(dir, env)).rejects.toThrow(/no tenant/i);
  });
});

function captureError(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error('expected function to throw');
}
