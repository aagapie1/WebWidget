import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './harness.js';

let dist: string;
let h: Harness;

beforeEach(async () => {
  dist = await mkdtemp(join(tmpdir(), 'widget-dist-'));
  await mkdir(join(dist, 'app', 'assets'), { recursive: true });
  await writeFile(join(dist, 'loader.js'), 'console.log("loader");');
  await writeFile(join(dist, 'app', 'index.html'), '<!doctype html><title>chat</title>');
  await writeFile(join(dist, 'app', 'assets', 'app-abc123.js'), 'export {};');
  h = await startHarness({
    env: { WIDGET_DIST_DIR: dist },
    tenant: { allowedOrigins: ['http://localhost:5173', 'https://www.primarie.ro'] },
  });
});

afterEach(async () => {
  await h.close();
  await rm(dist, { recursive: true, force: true });
});

const appUrl = (query: string) => `${h.url}/w/app?${query}`;

describe('GET /w/app', () => {
  it('serves the iframe with frame-ancestors limited to the tenant sites', async () => {
    const response = await fetch(appUrl('tenant=pilot&parent=https%3A%2F%2Fwww.primarie.ro'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/html/);
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain('frame-ancestors http://localhost:5173 https://www.primarie.ro');
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBeNull();
    expect(await response.text()).toContain('<title>chat</title>');
  });

  it.each([
    ['a parent outside allowedOrigins', 'tenant=pilot&parent=https%3A%2F%2Fevil.example'],
    ['a missing parent', 'tenant=pilot'],
    ['an unknown tenant', 'tenant=nope&parent=http%3A%2F%2Flocalhost%3A5173'],
    ['an invalid tenant id', 'tenant=..%2F&parent=http%3A%2F%2Flocalhost%3A5173'],
  ])('refuses %s with 403 and frame-ancestors none', async (_label, query) => {
    const response = await fetch(appUrl(query));
    expect(response.status).toBe(403);
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('answers 503 when the widget has not been built', async () => {
    await rm(join(dist, 'app', 'index.html'));
    const response = await fetch(appUrl('tenant=pilot&parent=http%3A%2F%2Flocalhost%3A5173'));
    expect(response.status).toBe(503);
  });
});

describe('GET /w/loader.js and assets', () => {
  it('serves the loader as JavaScript with a short cache, embeddable cross-origin', async () => {
    const response = await fetch(`${h.url}/w/loader.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/javascript/);
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
  });

  it('serves hashed assets as immutable', async () => {
    const response = await fetch(`${h.url}/w/assets/app-abc123.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('immutable');
  });

  it('does not serve files outside the assets directory', async () => {
    const response = await fetch(`${h.url}/w/assets/..%2F..%2Floader.js`);
    expect(response.status).toBe(404);
  });
});
