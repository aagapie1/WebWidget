import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseTenant } from '../src/config/tenants.js';
import { loaderConfig } from '../src/tenant-assets/route.js';
import { loaderConfigSchema, widgetConfigSchema } from '../src/protocol/index.js';
import { startHarness, type Harness } from './harness.js';

const SITE = 'https://www.primarie.ro';
const yaml = `
schemaVersion: 1
id: pilot
name: Primăria Demo
difyBaseUrl: http://dify.test/v1
difyApiKeyEnv: KEY
allowedOrigins: [${SITE}]
identity:
  assistantName: Ana
  logo: logo.svg
  assistantAvatar: avatar.png
launcher:
  icon: logo.svg
  position: bottom-left
  offsetX: 16
  offsetY: 32
window:
  width: 420
  height: 600
theme:
  accent: '#0b6e4f'
  accentEnd: '#0b6e4f'
  link: '#0a5c42'
texts:
  ro:
    composer.placeholder: Întrebați-ne orice…
    launcher.open: Deschide chatul primăriei
    welcome: Bun venit la primărie!
proactive:
  enabled: true
  delaySeconds: 5
  text:
    ro: Aveți o întrebare? Vă putem ajuta.
    en: Have a question? We can help.
behavior:
  suggestionsAfterAnswer: true
`;

let dir: string;
let h: Harness;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tenant-assets-'));
  await mkdir(join(dir, 'pilot', 'assets'), { recursive: true });
  await writeFile(
    join(dir, 'pilot', 'assets', 'logo.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>',
  );
  await writeFile(
    join(dir, 'pilot', 'assets', 'avatar.png'),
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  );
  const tenant = await parseTenant(yaml, { KEY: 'app-x' }, 'pilot.yaml', dir);
  h = await startHarness({ tenant });
  h.dify.handler = (_req, res) => res.writeHead(200).end('{"opening_statement":"Din Dify"}');
});

afterEach(async () => {
  await h.close();
  await rm(dir, { recursive: true, force: true });
});

describe('GET /api/loader-config', () => {
  it('returns the launcher, window, colors, proactive message and loader texts', async () => {
    const response = await fetch(`${h.url}/api/loader-config?tenant=pilot`, {
      headers: { origin: SITE },
    });
    expect(response.status).toBe(200);
    const body = loaderConfigSchema.parse(await response.json());
    expect(body).toEqual({
      theme: { accent: '#0b6e4f', accentEnd: '#0b6e4f', onAccent: '#ffffff' },
      launcher: {
        position: 'bottom-left',
        offsetX: 16,
        offsetY: 32,
        iconUrl: expect.stringMatching(/^\/w\/t\/pilot\/[0-9a-f]{10}-logo\.svg$/) as unknown,
      },
      // window.position defaults to auto: it opens on the launcher's side.
      window: { width: 420, height: 600, position: 'bottom-left' },
      proactive: {
        text: 'Aveți o întrebare? Vă putem ajuta.',
        delaySeconds: 5,
        frequency: 'session',
        showOnMobile: false,
      },
      texts: { 'launcher.open': 'Deschide chatul primăriei' },
    });
  });

  it("sends the launcher's own color with an automatic icon color (E4b.1 UX 10)", async () => {
    const colored = await parseTenant(
      yaml.replace('  position: bottom-left\n', "  position: bottom-left\n  color: '#d97706'\n"),
      { KEY: 'app-x' },
      'pilot.yaml',
      dir,
    );
    expect(loaderConfig(colored, 'ro').launcher).toMatchObject({
      color: '#d97706',
      onColor: '#000000',
    });
    const plain = await parseTenant(yaml, { KEY: 'app-x' }, 'pilot.yaml', dir);
    expect(loaderConfig(plain, 'ro').launcher).not.toHaveProperty('color');
  });

  it('serves the current logo at a stable address for the sign-in theme (E4b.1 UX 17)', async () => {
    const logo = await fetch(`${h.url}/w/t/pilot/logo`, { redirect: 'manual' });
    expect(logo.status).toBe(302);
    expect(logo.headers.get('location')).toMatch(/^\/w\/t\/pilot\/[0-9a-f]{10}-logo\.svg$/);
    expect(logo.headers.get('cache-control')).toBe('public, max-age=300');
    // The redirect leads to the image itself.
    const image = await fetch(`${h.url}${logo.headers.get('location') ?? ''}`);
    expect(image.headers.get('content-type')).toContain('image/svg+xml');
    expect((await fetch(`${h.url}/w/t/nu-exista/logo`, { redirect: 'manual' })).status).toBe(404);
  });

  it('allows CORS only for the tenant origins, with Vary: Origin', async () => {
    const allowed = await fetch(`${h.url}/api/loader-config?tenant=pilot`, {
      headers: { origin: SITE, 'sec-fetch-site': 'cross-site' },
    });
    expect(allowed.headers.get('access-control-allow-origin')).toBe(SITE);
    expect(allowed.headers.get('vary')).toContain('Origin');
    expect(allowed.headers.get('access-control-allow-credentials')).toBeNull();

    const foreign = await fetch(`${h.url}/api/loader-config?tenant=pilot`, {
      headers: { origin: 'https://evil.example' },
    });
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('is cached briefly and answers 304 to a matching ETag', async () => {
    const first = await fetch(`${h.url}/api/loader-config?tenant=pilot&locale=en`);
    expect(first.headers.get('cache-control')).toBe('public, max-age=60');
    const etag = first.headers.get('etag') ?? '';
    expect(etag).toMatch(/^".+"$/);
    expect(((await first.json()) as { proactive: { text: string } }).proactive.text).toBe(
      'Have a question? We can help.',
    );
    const second = await fetch(`${h.url}/api/loader-config?tenant=pilot&locale=en`, {
      headers: { 'if-none-match': etag },
    });
    expect(second.status).toBe(304);
  });
});

describe('GET /api/widget-config (E4)', () => {
  it('adds theme, identity images, text overrides and behavior', async () => {
    const config = widgetConfigSchema.parse(
      await (await fetch(`${h.url}/api/widget-config?tenant=pilot`)).json(),
    );
    expect(config).toMatchObject({
      assistantName: 'Ana',
      welcomeMessage: 'Bun venit la primărie!',
      theme: { accent: '#0b6e4f', link: '#0a5c42', background: '#ffffff' },
      texts: {
        'composer.placeholder': 'Întrebați-ne orice…',
        'launcher.open': 'Deschide chatul primăriei',
      },
      suggestionsAfterAnswer: true,
    });
    expect(config.identity.logoUrl).toMatch(/-logo\.svg$/);
    expect(config.identity.assistantAvatar).toEqual({
      kind: 'image',
      url: expect.stringMatching(/-avatar\.png$/) as unknown,
    });
    expect(config.identity.userAvatar).toEqual({ kind: 'none' });
    expect(config.texts).not.toHaveProperty('welcome');
  });
});

describe('GET /w/t/:tenant/:file', () => {
  it('serves images with immutable cache and nosniff; SVG with a sandbox CSP', async () => {
    const { launcher } = loaderConfigSchema.parse(
      await (await fetch(`${h.url}/api/loader-config?tenant=pilot`)).json(),
    );
    const svg = await fetch(`${h.url}${launcher.iconUrl ?? ''}`);
    expect(svg.status).toBe(200);
    expect(svg.headers.get('content-type')).toBe('image/svg+xml');
    expect(svg.headers.get('x-content-type-options')).toBe('nosniff');
    expect(svg.headers.get('content-security-policy')).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    expect(svg.headers.get('cache-control')).toContain('immutable');
  });

  it('answers 404 for a wrong hash, an unknown file or tenant', async () => {
    for (const path of [
      '/w/t/pilot/0000000000-logo.svg',
      '/w/t/pilot/0000000000-secret.txt',
      '/w/t/other/0000000000-logo.svg',
      '/w/t/pilot/..%2F..%2Fpilot.yaml',
    ]) {
      expect((await fetch(`${h.url}${path}`)).status).toBe(404);
    }
  });
});
