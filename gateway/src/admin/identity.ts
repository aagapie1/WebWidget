import type { AdminAuthConfig } from './auth-config.js';

export type AdminRole = 'widget-editor' | 'widget-admin' | 'super-admin';

/** Who is logged in, derived only from validated ID token claims and the server config. */
export interface AdminIdentity {
  issuer: string;
  subject: string;
  name: string;
  role: AdminRole;
  /** The administered tenant; `*` for super-admin (all tenants). */
  tenant: string;
}

export type IdentityResult =
  | { ok: true; identity: AdminIdentity }
  | { ok: false; reason: 'unknown_issuer' | 'wrong_realm' | 'no_role' };

/**
 * Maps validated claims to an identity (ADR 008, spec §4.1/§4.3):
 * - the tenant comes from the issuer through the fixed server map, never from a claim value;
 * - the login was started for one realm (`org`): a token from any other issuer is rejected;
 * - roles are realm roles in the `roles` claim; `super-admin` only counts in the platform realm.
 */
export function identityFromClaims(
  claims: Readonly<Record<string, unknown>>,
  org: string,
  config: AdminAuthConfig,
): IdentityResult {
  const issuer = typeof claims.iss === 'string' ? claims.iss.replace(/\/+$/, '') : '';
  const realm = config.byIssuer.get(issuer);
  if (!realm) return { ok: false, reason: 'unknown_issuer' };
  if (realm.org !== org) return { ok: false, reason: 'wrong_realm' };

  const roles = Array.isArray(claims.roles)
    ? claims.roles.filter((role): role is string => typeof role === 'string')
    : [];
  let role: AdminRole | undefined;
  if (realm.kind === 'platform') {
    role = roles.includes('super-admin') ? 'super-admin' : undefined;
  } else if (roles.includes('widget-admin')) {
    role = 'widget-admin';
  } else if (roles.includes('widget-editor')) {
    role = 'widget-editor';
  }
  if (!role) return { ok: false, reason: 'no_role' };

  const name =
    (typeof claims.name === 'string' && claims.name) ||
    (typeof claims.preferred_username === 'string' && claims.preferred_username) ||
    String(claims.sub);
  return {
    ok: true,
    identity: {
      issuer,
      subject: String(claims.sub),
      name,
      role,
      tenant: realm.kind === 'platform' ? '*' : (realm.tenant ?? ''),
    },
  };
}

export type AdminAction = 'read' | 'edit' | 'publish' | 'assets' | 'origins';

/** Server-side authorization on every request (spec §4.3). */
export function can(identity: AdminIdentity, tenant: string, action: AdminAction): boolean {
  if (identity.role === 'super-admin') return true;
  if (identity.tenant !== tenant) return false;
  if (action === 'read' || action === 'edit') return true;
  return identity.role === 'widget-admin';
}
