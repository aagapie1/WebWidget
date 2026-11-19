import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApi, loginUrl } from './api.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('admin API client', () => {
  it('sends the CSRF token from the session on every change', async () => {
    const fetchMock = vi.fn((url: RequestInfo | URL) =>
      Promise.resolve(
        typeof url === 'string' && url === '/admin/api/session'
          ? json(200, {
              csrfToken: 'tok',
              org: 'pilot',
              tenants: ['pilot'],
              user: {},
              expiresAt: '',
            })
          : json(200, { savedAt: 'x', revision: 1, errors: [] }),
      ),
    );
    const api = createApi(fetchMock);
    await api.session();
    await api.saveDraft('pilot', { config: {}, baseVersion: 1, draftRevision: null });
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe('/admin/api/tenants/pilot/config/draft');
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['x-csrf-token']).toBe('tok');
    expect(JSON.parse(init.body as string)).toEqual({
      config: {},
      baseVersion: 1,
      draftRevision: null,
    });
  });

  it('uploads images as the raw body with their type', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(201, { file: 'a.png', url: '/x' })));
    const api = createApi(fetchMock);
    await api.uploadAsset('pilot', new Blob(['x'], { type: 'image/png' }), 'Logo nou.png');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/admin/api/tenants/pilot/assets?name=Logo%20nou.png');
    expect((init.headers as Record<string, string>)['content-type']).toBe('image/png');
    expect(init.body).toBeInstanceOf(Blob);
  });

  it('turns error answers into ApiError with code and details', async () => {
    const api = createApi(() =>
      Promise.resolve(
        json(409, { error: { code: 'draft_conflict', publishedVersion: 2, draft: null } }),
      ),
    );
    const error = await api.publish('pilot', { draftRevision: 1 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: 'draft_conflict',
      details: { publishedVersion: 2, draft: null },
    });
  });

  it('builds the re-login URL that comes back to the same screen', () => {
    expect(loginUrl('pilot', '/admin/?tenant=pilot')).toBe(
      '/admin/auth/login?org=pilot&returnTo=%2Fadmin%2F%3Ftenant%3Dpilot&locale=ro',
    );
    // The identity provider's page follows the admin interface's language.
    expect(loginUrl('pilot', '/admin/', 'en')).toContain('&locale=en');
  });
});
