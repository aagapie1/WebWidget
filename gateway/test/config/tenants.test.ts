import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contrastRatio } from '../../src/config/contrast.js';
import {
  FileTenantSource,
  loadTenants,
  parseTenant,
  TenantConfigError,
  validateTenant,
  type Tenant,
} from '../../src/config/tenants.js';

const env = {
  DIFY_BASE_URL: 'http://localhost:8080/v1',
  DIFY_API_KEY_PILOT: 'app-secret-pilot',
};

const validYaml = `
schemaVersion: 1
id: pilot
name: Pilot
difyBaseUrl: \${DIFY_BASE_URL}
difyApiKeyEnv: DIFY_API_KEY_PILOT
allowedOrigins:
  - http://localhost:5173
texts:
  ro:
    composer.placeholder: Scrieți întrebarea…
`;

async function errorsOf(yaml: string, options: { checkOnly?: boolean } = {}) {
  return (await validateTenant(yaml, { env, fileName: 'pilot.yaml', ...options })).errors.join(
    '\n',
  );
}

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('validateTenant / parseTenant', () => {
  it('parses a valid tenant with defaults, interpolates env vars and resolves the key', async () => {
    const tenant = await parseTenant(validYaml, env, 'pilot.yaml');
    expect(tenant.difyBaseUrl).toBe('http://localhost:8080/v1');
    expect(tenant.difyApiKey).toBe('app-secret-pilot');
    expect(tenant.texts.ro?.['composer.placeholder']).toBe('Scrieți întrebarea…');
    expect(tenant.launcher).toEqual({ position: 'bottom-right', offsetX: 24, offsetY: 24 });
    expect(tenant.window).toEqual({ width: 380, height: 640 });
    expect(tenant.identity.userAvatar).toBe('none');
    expect(tenant.proactive).toMatchObject({
      enabled: false,
      frequency: 'session',
      showOnMobile: false,
    });
    expect(tenant.behavior).toEqual({ suggestionsAfterAnswer: false, visitorCookieDays: 30 });
    expect(tenant.citations).toEqual({ documentTitles: {}, showSnippets: false });
    expect(tenant.feedback).toEqual({ retentionDays: 90 });
    expect(tenant.theme.accent).toBe('#3a36d0');
  });

  it('requires schemaVersion 1', async () => {
    expect(await errorsOf(validYaml.replace('schemaVersion: 1', 'schemaVersion: 2'))).toMatch(
      /schemaVersion/,
    );
  });

  it('rejects unknown text keys', async () => {
    expect(await errorsOf(`${validYaml}    composer.placeholdr: greșit\n`)).toMatch(
      /texts\.ro.*composer\.placeholdr|Unrecognized key/,
    );
  });

  it('rejects colors below WCAG AA and names the pair and ratio', async () => {
    const yaml = `${validYaml}theme:\n  accent: '#9fa8ff'\n  accentEnd: '#9fa8ff'\n`;
    const errors = await errorsOf(yaml);
    expect(errors).toMatch(/onAccent #ffffff and accent #9fa8ff/);
    expect(errors).toMatch(/below 4\.5:1/);
  });

  it('requires the proactive text when enabled and rejects the unimplemented daily frequency', async () => {
    expect(await errorsOf(`${validYaml}proactive:\n  enabled: true\n`)).toMatch(/proactive\.text/);
    expect(
      await errorsOf(
        `${validYaml}proactive:\n  enabled: true\n  frequency: day\n  text:\n    ro: Salut\n`,
      ),
    ).toMatch(/proactive\.frequency/);
  });

  it('rejects an API key written directly in the file, without echoing it', async () => {
    const errors = await errorsOf(`${validYaml}difyApiKey: app-should-not-be-here\n`);
    expect(errors).toMatch(/difyApiKey/);
    expect(errors).not.toContain('app-should-not-be-here');
  });

  it('falls back to defaults for invalid presentation sections, keeping the tenant', async () => {
    const yaml = `${validYaml}theme:\n  accent: '#ffff00'\n`;
    const result = await validateTenant(yaml, { env, fileName: 'pilot.yaml' });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.tenant?.theme.accent).toBe('#3a36d0');
    expect(result.tenant?.texts.ro?.['composer.placeholder']).toBe('Scrieți întrebarea…');
  });

  it('makes the tenant unavailable when the core is invalid', async () => {
    const result = await validateTenant(validYaml.replace('http://localhost:5173', 'nope'), {
      env,
      fileName: 'pilot.yaml',
    });
    expect(result.tenant).toBeUndefined();
    expect(result.errors.join()).toMatch(/allowedOrigins/);
  });

  it('check mode needs no secrets', async () => {
    const result = await validateTenant(validYaml, {
      env: {},
      fileName: 'pilot.yaml',
      checkOnly: true,
    });
    expect(result.errors).toEqual([]);
  });

  it('fails without the key variable outside check mode', async () => {
    await expect(
      parseTenant(validYaml, { DIFY_BASE_URL: 'http://x' }, 'pilot.yaml'),
    ).rejects.toThrow(TenantConfigError);
  });

  it('rejects an id that does not match the file name', async () => {
    await expect(parseTenant(validYaml, env, 'other.yaml')).rejects.toThrow(/file name/);
  });
});

describe('assets', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tenants-'));
    await mkdir(join(dir, 'pilot', 'assets'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('resolves referenced images with a content-hash URL', async () => {
    await writeFile(
      join(dir, 'pilot', 'assets', 'logo.png'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
    const tenant = await parseTenant(
      `${validYaml}identity:\n  logo: logo.png\n`,
      env,
      'pilot.yaml',
      dir,
    );
    const logo = tenant.assets.get('logo.png');
    expect(logo?.contentType).toBe('image/png');
    expect(logo?.url).toMatch(/^\/w\/t\/pilot\/[0-9a-f]{10}-logo\.png$/);
  });

  it('reports missing and oversized files, and rejects other file types', async () => {
    expect(
      (
        await validateTenant(`${validYaml}identity:\n  logo: missing.png\n`, {
          env,
          fileName: 'pilot.yaml',
          tenantsDir: dir,
        })
      ).errors.join(),
    ).toMatch(/identity\.logo: missing\.png not found/);

    await writeFile(join(dir, 'pilot', 'assets', 'big.png'), Buffer.alloc(201 * 1024));
    expect(
      (
        await validateTenant(`${validYaml}launcher:\n  icon: big.png\n`, {
          env,
          fileName: 'pilot.yaml',
          tenantsDir: dir,
        })
      ).errors.join(),
    ).toMatch(/larger than 200 KB/);

    expect(await errorsOf(`${validYaml}identity:\n  logo: script.js\n`)).toMatch(/identity\.logo/);
  });
});

describe('FileTenantSource', () => {
  let dir: string;
  const log = { info: vi.fn(), error: vi.fn() };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tenants-'));
    log.info.mockClear();
    log.error.mockClear();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('loads valid tenants and skips (with a log) a tenant whose core is invalid', async () => {
    await writeFile(join(dir, 'pilot.yaml'), validYaml);
    await writeFile(join(dir, 'broken.yaml'), 'schemaVersion: 1\nid: broken\n');
    const tenants = await new FileTenantSource(dir, env, log).load();
    expect([...tenants.keys()]).toEqual(['pilot']);
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ file: 'broken.yaml' }),
      'tenant config rejected; tenant unavailable',
    );
  });

  it('hot-reloads a valid change and keeps the last valid config on an invalid one', async () => {
    await writeFile(join(dir, 'pilot.yaml'), validYaml);
    const source = new FileTenantSource(dir, env, log);
    const registry = await source.load();
    const stop = source.watch(registry);
    try {
      await writeFile(join(dir, 'pilot.yaml'), `${validYaml}window:\n  width: 420\n`);
      await vi.waitFor(
        () => {
          expect(registry.get('pilot')?.window.width).toBe(420);
        },
        { timeout: 3000 },
      );

      const before: Tenant | undefined = registry.get('pilot');
      await writeFile(join(dir, 'pilot.yaml'), `${validYaml}theme:\n  accent: '#ffff00'\n`);
      await vi.waitFor(
        () => {
          expect(log.error).toHaveBeenCalledWith(
            expect.objectContaining({ file: 'pilot.yaml' }),
            'tenant config rejected; keeping the last valid configuration',
          );
        },
        { timeout: 3000 },
      );
      expect(registry.get('pilot')).toBe(before);
    } finally {
      stop();
    }
  });

  it('fails when no tenant is valid', async () => {
    await expect(new FileTenantSource(dir, env, log).load()).rejects.toThrow(/No valid tenant/);
  });
});

describe('loadTenants (strict)', () => {
  it('throws on the first invalid file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tenants-'));
    try {
      await writeFile(join(dir, 'pilot.yaml'), `${validYaml}theme:\n  accent: '#ffff00'\n`);
      await expect(loadTenants(dir, env)).rejects.toThrow(/contrast/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
