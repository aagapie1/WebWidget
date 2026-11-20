/** Admin API client (same origin, session cookie + CSRF header, ADR 008). */

export type Role = 'widget-editor' | 'widget-admin' | 'super-admin';
export type Config = Record<string, unknown>;

export interface Session {
  user: { name: string; role: Role };
  org: string;
  tenants: string[];
  csrfToken: string;
  expiresAt: string;
  /** Public address of the gateway (integration snippet). */
  gatewayOrigin?: string;
}

export interface AssistantDefaults {
  welcome: string;
  suggestedQuestions: string[];
  /** False when the assistant could not be reached. */
  available: boolean;
}

export interface Installation {
  origin: string;
  lastSeen: string | null;
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
  permissions: {
    publish: boolean;
    assets: boolean;
    origins: boolean;
    name: boolean;
    /** The audit log retention and the audit screen's platform view: super-admin (E5 B9). */
    retention: boolean;
  };
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
  discardDraft(tenant: string): Promise<void>;
  assistantDefaults(tenant: string): Promise<AssistantDefaults>;
  installations(tenant: string): Promise<{ installations: Installation[] }>;
  /** File names the assistant cited recently (E4b.1 UX 13), most recent first. */
  citedDocuments(tenant: string): Promise<{ documents: { name: string; lastSeen: string }[] }>;
  logout(): Promise<{ redirect: string }>;
  /** The audit log (E5 B9): one page, newest first. */
  auditList(query: AuditQuery): Promise<AuditPage>;
}

/** Filters and paging of the audit log screen; empty values are left out. */
export type AuditQuery = Partial<
  Record<
    | 'chain'
    | 'from'
    | 'to'
    | 'user'
    | 'action'
    | 'section'
    | 'result'
    | 'q'
    | 'before'
    | 'limit'
    | 'opened',
    string
  >
>;

export interface AuditEventView {
  id: number;
  seq: number;
  at: string;
  chain: string;
  tenant: string;
  actor: {
    kind: 'user' | 'system';
    subject: string;
    name?: string;
    email?: string;
    role?: string;
    org?: string;
    source?: string;
  };
  context: { ip?: string; userAgent?: string; sessionHash?: string; requestId?: string };
  action: string;
  section?: string;
  result: 'success' | 'denied' | 'failed';
  reason?: string;
  version?: number;
  sensitive: boolean;
  details: Record<string, unknown>;
  source: string;
  hash?: string;
  prevHash?: string;
}

export interface AuditPage {
  chain: string;
  events: AuditEventView[];
  nextBefore?: number;
}

const auditSearch = (query: AuditQuery): string =>
  new URLSearchParams(
    Object.entries(query).filter((entry): entry is [string, string] => Boolean(entry[1])),
  ).toString();

/** The export link (a plain download: the browser sends the session cookie). */
export function auditExportUrl(query: AuditQuery, format: 'csv' | 'json'): string {
  return `/admin/api/audit/export?${auditSearch({ ...query, format } as AuditQuery)}`;
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
    discardDraft: (tenant) => call('DELETE', `${base(tenant)}/config/draft`),
    assistantDefaults: (tenant) => call('GET', `${base(tenant)}/assistant-defaults`),
    installations: (tenant) => call('GET', `${base(tenant)}/installations`),
    citedDocuments: (tenant) => call('GET', `${base(tenant)}/cited-documents`),
    logout: () => call('POST', '/admin/auth/logout', {}),
    auditList: (query) => call('GET', `/admin/api/audit?${auditSearch(query)}`),
  };
}

/** Where the browser goes to sign in again, coming back to the same screen. */
/** The gateway's sign-in start; `locale` makes the identity provider's page use the same language. */
export function loginUrl(org: string, returnTo: string, locale: 'ro' | 'en' = 'ro'): string {
  const params = new URLSearchParams({ org, returnTo, locale });
  return `/admin/auth/login?${params.toString()}`;
}
