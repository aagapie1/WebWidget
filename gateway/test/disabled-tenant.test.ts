import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { postJson, startHarness, type Harness } from './harness.js';

const SITE = 'http://localhost:5173';
let h: Harness;

beforeEach(async () => {
  h = await startHarness({ tenant: { enabled: false } });
});

afterEach(async () => {
  await h.close();
});

const disabled = {
  error: {
    code: 'tenant_disabled',
    message: 'Asistentul nu este disponibil momentan pe acest site.',
    retryable: false,
  },
};

describe('disabled tenant (E4b §5.6)', () => {
  it.each([
    ['loader-config', '/api/loader-config?tenant=pilot'],
    ['widget-config', '/api/widget-config?tenant=pilot'],
    ['conversations', '/api/conversations?tenant=pilot'],
  ])('%s answers 503 tenant_disabled', async (_label, path) => {
    const response = await fetch(`${h.url}${path}`, { headers: { origin: SITE } });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(disabled);
  });

  it('chat answers tenant_disabled and Dify is never called', async () => {
    const response = await postJson(`${h.url}/api/chat`, { tenant: 'pilot', message: 'Bună' });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(disabled);
    expect(h.dify.requests).toHaveLength(0);
  });

  it('localizes the message and closes the chat page', async () => {
    const en = await fetch(`${h.url}/api/widget-config?tenant=pilot&locale=en`);
    expect(((await en.json()) as typeof disabled).error.message).toBe(
      'The assistant is currently not available on this site.',
    );
    const page = await fetch(`${h.url}/w/app?tenant=pilot&parent=${encodeURIComponent(SITE)}`);
    expect(page.status).toBe(503);
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });
});
