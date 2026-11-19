import { isIP } from 'node:net';
import { z } from 'zod';

const envSchema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  PUBLIC_ORIGIN: z.url({ protocol: /^https?$/ }).transform((value) => new URL(value).origin),
  TENANTS_DIR: z.string().min(1).default('../config/tenants'),
  /** Built widget (loader.js, app/), served under /w/. */
  WIDGET_DIST_DIR: z.string().min(1).default('../widget/dist'),
  /** Built admin interface (admin/, ADR 008), served under /admin/. */
  ADMIN_DIST_DIR: z.string().min(1).default('../admin/dist'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Redis for closing feedback (and rate limiting in E5). Required in production. */
  REDIS_URL: z.url({ protocol: /^rediss?$/ }).optional(),
  /** Where tenant configurations come from (ADR 008): YAML files or Postgres. */
  TENANT_SOURCE: z.enum(['file', 'postgres']).default('file'),
  /** Application role connection (Postgres source, admin interface). */
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
  /** Server-only admin login configuration (ADR 008): issuer → tenant map. Admin is off without it. */
  ADMIN_AUTH_CONFIG: z.string().min(1).optional(),
  /**
   * Admin hosts that belong to one organisation (E4b.1 UX 16): "admin.primaria-x.ro=primaria-x,…".
   * On such a host the sign-in page knows the organisation and hides the code field.
   */
  ADMIN_ORG_HOSTS: z
    .string()
    .optional()
    .transform((value, context) => {
      const hosts = new Map<string, string>();
      for (const pair of (value ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)) {
        const [host, org] = pair.split('=').map((part) => part.trim().toLowerCase());
        if (!host || !org || !/^[a-z0-9.-]+$/.test(host) || !/^[a-z0-9-]{1,64}$/.test(org)) {
          context.addIssue({ code: 'custom', message: `invalid host=org pair "${pair}"` });
          return z.NEVER;
        }
        hosts.set(host, org);
      }
      return hosts;
    }),
  /**
   * Proxies whose `X-Forwarded-For` / `-Host` / `-Proto` are believed (E5 D1): IPs or CIDRs
   * ("172.18.0.0/16,10.0.0.5"), or `loopback` / `linklocal` / `uniquelocal`. Unset: none, and the
   * client address is the connection's own. Production sets the Traefik network.
   */
  TRUSTED_PROXIES: z
    .string()
    .optional()
    .transform((value, context) => {
      const entries = (value ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
      for (const entry of entries) {
        const [address = '', bits] = entry.split('/');
        const named = ['loopback', 'linklocal', 'uniquelocal'].includes(entry);
        const version = isIP(address);
        const maxBits = version === 6 ? 128 : 32;
        const validBits = bits === undefined || (/^\d{1,3}$/.test(bits) && Number(bits) <= maxBits);
        if (!named && (version === 0 || !validBits)) {
          context.addIssue({ code: 'custom', message: `invalid proxy address "${entry}"` });
          return z.NEVER;
        }
      }
      return entries;
    }),
  /** Admin login starts + callbacks per client address per 10 minutes (ADR 008). */
  ADMIN_LOGIN_LIMIT: z.coerce.number().int().positive().default(30),
  VISITOR_COOKIE_SECRET: z.string().min(32, 'must be at least 32 characters'),
  /** Time allowed for Dify to answer with response headers. */
  DIFY_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  /** Maximum silence between two stream chunks (Dify sends `ping` every ~10 s). */
  DIFY_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  /** Upper bound for a whole answer. */
  DIFY_TOTAL_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: Readonly<Record<string, string | undefined>>): AppEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  return result.data;
}
