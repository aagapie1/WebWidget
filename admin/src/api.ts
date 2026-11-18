/** Admin API client (same origin, session cookie + CSRF header, ADR 008). */

export type Role = 'widget-editor' | 'widget-admin' | 'super-admin';
export type Config = Record<string, unknown>;

export interface Session {
  user: { name: string; role: Role };
  org: string;
  tenants: string[];
  csrfToken: string;
  expiresAt: string;
}

export interface ConfigState {
  tenant: string;
  published: { version: number; createdAt: string; createdBy: string; config: Config };
  draft: {
    revision: number;
    baseVersion: number | null;
    updatedAt: string;
    updatedBy: string;
    config: Config;
  } | null;
  errors: string[];
  permissions: { publish: boolean; assets: boolean; origins: boolean };
}

export interface DraftConflict {
  publishedVersion: number;
  draft: { revision: number; updatedAt: string; updatedBy: string } | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

type Fetch = typeof fetch;

export interface AdminApi {
  session(): Promise<Session>;
  config(tenant: string): Promise<ConfigState>;
  saveDraft(
    tenant: string,
    body: { config: Config; baseVersion: number; draftRevision: number | null },
  ): Promise<{ savedAt: string; revision: number; errors: string[] }>;
  publish(
    tenant: string,
    body: { comment?: string; draftRevision: number },
  ): Promise<{ version: number }>;
  uploadAsset(tenant: string, file: Blob, name: string): Promise<{ file: string; url: string }>;
  previewToken(tenant: string): Promise<{ id: string; url: string; expiresAt: string }>;
  logout(): Promise<{ redirect: string }>;
}

export function createApi(fetchImpl: Fetch = (...args) => fetch(...args)): AdminApi {
  let csrf = '';

  async function call<T>(
    method: string,
    path: string,
    body?: BodyInit | object,
    type?: string,
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (method !== 'GET') headers['x-csrf-token'] = csrf;
    let payload: BodyInit | undefined;
    if (body instanceof Blob) {
      payload = body;
      headers['content-type'] = type ?? 'application/octet-stream';
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['content-type'] = 'application/json';
    }
    const response = await fetchImpl(path, {
      method,
      headers,
      credentials: 'same-origin',
      ...(payload === undefined ? {} : { body: payload }),
    });
    if (response.status === 204) return undefined as T;
    const data = (await response.json().catch(() => ({}))) as {
      error?: { code?: string } & Record<string, unknown>;
    };
    if (!response.ok) {
      const { code = 'internal_error', ...details } = data.error ?? {};
      throw new ApiError(response.status, code, details);
    }
    return data as T;
  }

  const base = (tenant: string) => `/admin/api/tenants/${encodeURIComponent(tenant)}`;

  return {
    async session() {
      const session = await call<Session>('GET', '/admin/api/session');
      csrf = session.csrfToken;
      return session;
    },
    config: (tenant) => call('GET', `${base(tenant)}/config`),
    saveDraft: (tenant, body) => call('PUT', `${base(tenant)}/config/draft`, body),
    publish: (tenant, body) => call('POST', `${base(tenant)}/config/publish`, body),
    uploadAsset: (tenant, file, name) =>
      call(
        'POST',
        `${base(tenant)}/assets?name=${encodeURIComponent(name)}`,
        file,
        file.type || undefined,
      ),
    previewToken: (tenant) => call('POST', `${base(tenant)}/preview-token`, {}),
    logout: () => call('POST', '/admin/auth/logout', {}),
  };
}

/** Where the browser goes to sign in again, coming back to the same screen. */
export function loginUrl(org: string, returnTo: string): string {
  const params = new URLSearchParams({ org, returnTo });
  return `/admin/auth/login?${params.toString()}`;
}
