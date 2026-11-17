import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/** Configuration error at startup. Messages never include secret values. */
export class TenantConfigError extends Error {
  override name = 'TenantConfigError';
}

type Env = Readonly<Record<string, string | undefined>>;

const originSchema = z.string().refine(
  (value) => {
    try {
      return new URL(value).origin === value;
    } catch {
      return false;
    }
  },
  { message: 'must be a bare origin, e.g. https://www.example.ro' },
);

const textsSchema = z.record(z.string().regex(/^[a-zA-Z0-9_.]+$/), z.string().max(2000));

/** Tenant file as written on disk (after env interpolation). Contains no secrets. */
const tenantFileSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]{1,64}$/, 'id must be lowercase letters, digits or dashes'),
  name: z.string().min(1).max(200),
  difyBaseUrl: z.url({ protocol: /^https?$/ }).transform((url) => url.replace(/\/+$/, '')),
  difyApiKeyEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  allowedOrigins: z.array(originSchema).min(1),
  // Detailed theme schema arrives in E4 (white-label).
  theme: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  texts: z.strictObject({ ro: textsSchema.optional(), en: textsSchema.optional() }).default({}),
  /** Lifetime of the anonymous visitor cookie, i.e. how long history stays reachable (ADR 005). */
  visitorCookieDays: z.number().int().min(1).max(395).default(30),
  feedback: z
    .strictObject({
      /** How long closing feedback is kept (Redis TTL). */
      retentionDays: z.number().int().min(1).max(730).default(90),
    })
    .default({ retentionDays: 90 }),
  citations: z
    .strictObject({
      /** Friendly titles for source documents: file name → title. */
      documentTitles: z.record(z.string().min(1).max(300), z.string().min(1).max(300)).default({}),
      /** Show document snippets under answers (off by default: they contain technical markers). */
      showSnippets: z.boolean().default(false),
    })
    .default({ documentTitles: {}, showSnippets: false }),
});

export type TenantFile = z.infer<typeof tenantFileSchema>;

/** Runtime tenant: the file plus the resolved Dify key. Never serialize this to a client. */
export interface Tenant extends Omit<TenantFile, 'difyApiKeyEnv'> {
  readonly difyApiKey: string;
}

export type TenantRegistry = ReadonlyMap<string, Tenant>;

/** Replaces `${NAME}` in string values with environment variables. Missing variables fail. */
function interpolate(value: unknown, env: Env, source: string): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (_match, name: string) => {
      const resolved = env[name];
      if (resolved === undefined || resolved === '') {
        throw new TenantConfigError(`${source}: environment variable ${name} is not set`);
      }
      return resolved;
    });
  }
  if (Array.isArray(value)) return value.map((item) => interpolate(item, env, source));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, interpolate(item, env, source)]),
    );
  }
  return value;
}

export function parseTenant(text: string, env: Env, fileName: string): Tenant {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (error) {
    throw new TenantConfigError(`${fileName}: invalid YAML (${String(error)})`);
  }

  const result = tenantFileSchema.safeParse(interpolate(raw, env, fileName));
  if (!result.success) {
    // Only paths and messages, never input values: they could contain secrets.
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new TenantConfigError(`${fileName}: ${issues}`);
  }

  const { difyApiKeyEnv, ...file } = result.data;
  const expectedId = basename(fileName, extname(fileName));
  if (file.id !== expectedId) {
    throw new TenantConfigError(`${fileName}: id "${file.id}" must match the file name`);
  }

  const difyApiKey = env[difyApiKeyEnv];
  if (difyApiKey === undefined || difyApiKey === '') {
    throw new TenantConfigError(`${fileName}: environment variable ${difyApiKeyEnv} is not set`);
  }

  return { ...file, difyApiKey };
}

export async function loadTenants(dir: string, env: Env): Promise<TenantRegistry> {
  const files = (await readdir(dir)).filter((name) => /\.ya?ml$/.test(name)).sort();
  const tenants = new Map<string, Tenant>();
  for (const name of files) {
    const tenant = parseTenant(await readFile(join(dir, name), 'utf8'), env, name);
    if (tenants.has(tenant.id)) {
      throw new TenantConfigError(`${name}: duplicate tenant id "${tenant.id}"`);
    }
    tenants.set(tenant.id, tenant);
  }
  if (tenants.size === 0) {
    throw new TenantConfigError(`No tenant configuration found in ${dir}`);
  }
  return tenants;
}
