import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Admin authentication — SERVER configuration (ADR 008, spec §4.1). Never part of a tenant's
 * editable configuration. The tenant of an admin comes only from the token issuer: issuer → tenant.
 */
const realmSchema = z.strictObject({
  issuer: z.url({ protocol: /^https?$/ }).transform((value) => value.replace(/\/+$/, '')),
  clientId: z.string().min(1),
  clientSecretEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  /** Admin session lifetime for this realm (spec §4.3: 8 hours by default). */
  sessionHours: z.number().min(0.25).max(24).default(8),
});

const fileSchema = z.strictObject({
  tenants: z.array(realmSchema.extend({ tenant: z.string().regex(/^[a-z0-9-]{1,64}$/) })).min(1),
  platform: realmSchema.optional(),
});

/** A realm the admin interface can log in with. `org` is `platform` or a tenant id. */
export interface AdminRealm {
  org: string;
  kind: 'tenant' | 'platform';
  /** The tenant this realm's users administer; undefined for the platform realm. */
  tenant: string | undefined;
  issuer: string;
  clientId: string;
  clientSecret: string;
  sessionSeconds: number;
}

export interface AdminAuthConfig {
  realms: ReadonlyMap<string, AdminRealm>;
  /** Fixed issuer → realm map: the only way a tenant is derived. */
  byIssuer: ReadonlyMap<string, AdminRealm>;
}

export function parseAdminAuthConfig(text: string, env: Env): AdminAuthConfig {
  const result = fileSchema.safeParse(parseYaml(text));
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`admin auth configuration: ${issues.join('; ')}`);
  }
  const secret = (name: string): string => {
    const value = env[name];
    if (!value)
      throw new Error(`admin auth configuration: environment variable ${name} is not set`);
    return value;
  };

  const realms = new Map<string, AdminRealm>();
  for (const entry of result.data.tenants) {
    realms.set(entry.tenant, {
      org: entry.tenant,
      kind: 'tenant',
      tenant: entry.tenant,
      issuer: entry.issuer,
      clientId: entry.clientId,
      clientSecret: secret(entry.clientSecretEnv),
      sessionSeconds: Math.round(entry.sessionHours * 3600),
    });
  }
  const platform = result.data.platform;
  if (platform) {
    realms.set('platform', {
      org: 'platform',
      kind: 'platform',
      tenant: undefined,
      issuer: platform.issuer,
      clientId: platform.clientId,
      clientSecret: secret(platform.clientSecretEnv),
      sessionSeconds: Math.round(platform.sessionHours * 3600),
    });
  }

  const byIssuer = new Map<string, AdminRealm>();
  for (const realm of realms.values()) {
    if (byIssuer.has(realm.issuer)) {
      throw new Error(`admin auth configuration: issuer ${realm.issuer} is mapped twice`);
    }
    byIssuer.set(realm.issuer, realm);
  }
  return { realms, byIssuer };
}

export async function loadAdminAuthConfig(path: string, env: Env): Promise<AdminAuthConfig> {
  return parseAdminAuthConfig(await readFile(path, 'utf8'), env);
}
