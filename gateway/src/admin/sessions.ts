import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { AdminIdentity } from './identity.js';
import type { KeyValueStore } from './kv.js';

/** Admin session cookie (ADR 008): HttpOnly, Secure, SameSite=Strict, Path=/admin. */
export const SESSION_COOKIE = '__Secure-admin';
/** Binds a login in progress to the browser that started it (SameSite=Lax: IdP redirect back). */
export const LOGIN_COOKIE = '__Secure-admin-login';

export interface AdminCookies {
  session: string;
  login: string;
  secure: boolean;
}

/**
 * Cookie names and the Secure flag for the gateway's public origin. Over https (always in
 * production, enforced at startup) the `__Secure-` cookies above. Over http://localhost
 * (development, e2e) plain names without Secure, since some browsers (WebKit) refuse Secure
 * cookies on http://localhost.
 */
export function adminCookies(publicOrigin: string): AdminCookies {
  return publicOrigin.startsWith('https:')
    ? { session: SESSION_COOKIE, login: LOGIN_COOKIE, secure: true }
    : { session: 'admin', login: 'admin-login', secure: false };
}
export const LOGIN_TTL_SECONDS = 600;

const sessionSchema = z.object({
  identity: z.object({
    issuer: z.string(),
    subject: z.string(),
    name: z.string(),
    role: z.enum(['widget-editor', 'widget-admin', 'super-admin']),
    tenant: z.string(),
  }),
  org: z.string(),
  csrf: z.string(),
  idToken: z.string().optional(),
  expiresAt: z.number(),
});
export type AdminSession = z.infer<typeof sessionSchema>;

const loginSchema = z.object({
  org: z.string(),
  codeVerifier: z.string(),
  nonce: z.string(),
  returnTo: z.string(),
});
export type LoginState = z.infer<typeof loginSchema>;

export const randomToken = (): string => randomBytes(32).toString('base64url');

/** Redis holds a hash of the cookie value, so a Redis dump yields no usable session cookie. */
export const sessionKey = (id: string): string =>
  `admin:session:${createHash('sha256').update(id).digest('base64url')}`;
const loginKey = (state: string): string =>
  `admin:login:${createHash('sha256').update(state).digest('base64url')}`;

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export class AdminSessions {
  constructor(
    private readonly store: KeyValueStore,
    private readonly now: () => number = Date.now,
  ) {}

  async create(
    identity: AdminIdentity,
    org: string,
    ttlSeconds: number,
    idToken?: string,
  ): Promise<{ id: string; session: AdminSession }> {
    const id = randomToken();
    const session: AdminSession = {
      identity,
      org,
      csrf: randomToken(),
      ...(idToken ? { idToken } : {}),
      expiresAt: this.now() + ttlSeconds * 1000,
    };
    await this.store.set(sessionKey(id), JSON.stringify(session), ttlSeconds);
    return { id, session };
  }

  async get(id: string | undefined): Promise<AdminSession | undefined> {
    if (!id || id.length > 128) return undefined;
    const raw = await this.store.get(sessionKey(id));
    if (!raw) return undefined;
    const parsed = sessionSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.expiresAt <= this.now()) return undefined;
    return parsed.data;
  }

  async destroy(id: string | undefined): Promise<void> {
    if (id && id.length <= 128) await this.store.del(sessionKey(id));
  }

  async saveLogin(state: string, login: LoginState): Promise<void> {
    await this.store.set(loginKey(state), JSON.stringify(login), LOGIN_TTL_SECONDS);
  }

  /** Single use: a state value can complete at most one login. */
  async takeLogin(state: string): Promise<LoginState | undefined> {
    if (state.length > 128) return undefined;
    const raw = await this.store.take(loginKey(state));
    if (!raw) return undefined;
    const parsed = loginSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  }
}

/** Fixed-window limit in Redis (rule 9: shared by all replicas). True when the call is allowed. */
export async function withinLimit(
  store: KeyValueStore,
  bucket: string,
  subject: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const key = `admin:rl:${bucket}:${createHash('sha256').update(subject).digest('base64url')}`;
  return (await store.incr(key, windowSeconds)) <= limit;
}
