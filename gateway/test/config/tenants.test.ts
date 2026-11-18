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
    expect(tenant.window).toEqual({ width: 380, height: 640, position: 'auto' });
    expect(tenant.enabled).toBe(true);
    expect(tenant.launcher.icon).toBeUndefined();
    expect(tenant.identity.userAvatar).toEqual({ type: 'none' });
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

describe('E4 completions (schema version 1, all optional)', () => {
  it('checks the optional user bubble and button colors for contrast', async () => {
    const ok = `${validYaml}theme:\n  userBubble: '#e8f0fe'\n  onUserBubble: '#0b2a5b'\n  button: '#b42318'\n  onButton: '#ffffff'\n`;
    expect(await errorsOf(ok)).toBe('');
    const tenant = await parseTenant(ok, env, 'pilot.yaml');
    expect(tenant.theme).toMatchObject({ userBubble: '#e8f0fe', button: '#b42318' });

    const badUser = `${validYaml}theme:\n  userBubble: '#e8f0fe'\n`; // white text on a light bubble
    expect(await errorsOf(badUser)).toMatch(
      /onAccent #ffffff and userBubble #e8f0fe \(user message text\)/,
    );
    const badButton = `${validYaml}theme:\n  onButton: '#d0d0d0'\n`;
    expect(await errorsOf(badButton)).toMatch(/onButton #d0d0d0 and accent/);
  });

  it('accepts a window position separate from the launcher', async () => {
    const tenant = await parseTenant(
      `${validYaml}launcher:\n  position: bottom-left\nwindow:\n  position: bottom-right\n`,
      env,
      'pilot.yaml',
    );
    expect(tenant.launcher.position).toBe('bottom-left');
    expect(tenant.window.position).toBe('bottom-right');
    expect(await errorsOf(`${validYaml}window:\n  position: top-left\n`)).toMatch(
      /window\.position/,
    );
  });

  it('launcher.icon: builtin or asset; a bare file name is the asset form; unknown builtin fails', async () => {
    const builtin = await parseTenant(
      `${validYaml}launcher:\n  icon:\n    type: builtin\n    name: chat\n`,
      env,
      'pilot.yaml',
    );
    expect(builtin.launcher.icon).toEqual({ type: 'builtin', name: 'chat' });
    const asset = await validateTenant(
      `${validYaml}launcher:\n  icon:\n    type: asset\n    file: logo.png\n`,
      {
        env,
        fileName: 'pilot.yaml',
      },
    );
    expect(asset.tenant?.launcher.icon).toEqual({ type: 'asset', file: 'logo.png' });
    const legacy = await validateTenant(`${validYaml}launcher:\n  icon: logo.png\n`, {
      env,
      fileName: 'pilot.yaml',
    });
    expect(legacy.tenant?.launcher.icon).toEqual({ type: 'asset', file: 'logo.png' });
    expect(
      await errorsOf(`${validYaml}launcher:\n  icon:\n    type: builtin\n    name: rocket\n`),
    ).toMatch(/launcher\.icon/);
  });

  it('accepts every built-in launcher icon of the visual set', async () => {
    for (const name of ['chat-dots', 'help', 'info', 'headset', 'landmark', 'sparkles']) {
      const tenant = await parseTenant(
        `${validYaml}launcher:\n  icon:\n    type: builtin\n    name: ${name}\n`,
        env,
        'pilot.yaml',
      );
      expect(tenant.launcher.icon).toEqual({ type: 'builtin', name });
    }
  });

  it('avatars: initials, built-in icons, images (also the legacy forms) or none', async () => {
    const parse = (identity: string) =>
      validateTenant(`${validYaml}identity:\n${identity}`, { env, fileName: 'pilot.yaml' });
    const forms = await parse(
      '  assistantAvatar:\n    type: builtin\n    name: bot\n  userAvatar:\n    type: initials\n',
    );
    expect(forms.tenant?.identity).toMatchObject({
      assistantAvatar: { type: 'builtin', name: 'bot' },
      userAvatar: { type: 'initials' },
    });
    // Version 1 files written before E4b keep working.
    const legacy = await parse('  assistantAvatar: avatar.png\n  userAvatar: none\n');
    expect(legacy.tenant?.identity).toMatchObject({
      assistantAvatar: { type: 'asset', file: 'avatar.png' },
      userAvatar: { type: 'none' },
    });
    expect((await parse('  userAvatar:\n    type: builtin\n    name: person\n')).errors).toEqual(
      [],
    );
    expect(
      await errorsOf(
        `${validYaml}identity:\n  assistantAvatar:\n    type: builtin\n    name: person\n`,
      ),
    ).toMatch(/identity\.assistantAvatar/);
  });

  it('starter questions per language: at most 5, each 1–200 characters', async () => {
    // validYaml ends inside texts.ro: the questions belong to that block.
    const questions =
      '    suggestedQuestions:\n      - Care este programul?\n      - Ce acte îmi trebuie?\n';
    const tenant = await parseTenant(validYaml + questions, env, 'pilot.yaml');
    expect(tenant.texts.ro?.suggestedQuestions).toEqual([
      'Care este programul?',
      'Ce acte îmi trebuie?',
    ]);
    const six = Array.from({ length: 6 }, (_, i) => '      - Întrebarea ' + String(i) + '\n').join(
      '',
    );
    expect(await errorsOf(validYaml + '    suggestedQuestions:\n' + six)).toMatch(
      /texts\.ro\.suggestedQuestions/,
    );
  });

  it('enabled defaults to true and can be turned off', async () => {
    const tenant = await parseTenant(`${validYaml}enabled: false\n`, env, 'pilot.yaml');
    expect(tenant.enabled).toBe(false);
  });
});
