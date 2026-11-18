import { z } from 'zod';

const envSchema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  PUBLIC_ORIGIN: z.url({ protocol: /^https?$/ }).transform((value) => new URL(value).origin),
  TENANTS_DIR: z.string().min(1).default('../config/tenants'),
  /** Built widget (loader.js, app/), served under /w/. */
  WIDGET_DIST_DIR: z.string().min(1).default('../widget/dist'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Redis for closing feedback (and rate limiting in E5). Required in production. */
  REDIS_URL: z.url({ protocol: /^rediss?$/ }).optional(),
  /** Where tenant configurations come from (ADR 008): YAML files or Postgres. */
  TENANT_SOURCE: z.enum(['file', 'postgres']).default('file'),
  /** Application role connection (Postgres source, admin interface). */
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
  /** Server-only admin login configuration (ADR 008): issuer → tenant map. Admin is off without it. */
  ADMIN_AUTH_CONFIG: z.string().min(1).optional(),
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
