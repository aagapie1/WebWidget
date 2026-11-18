import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppEnv } from '../config/env.js';
import type { TenantRegistry } from '../config/tenants.js';
import type { AdminAuthConfig } from './auth-config.js';
import { can, identityFromClaims, type AdminAction } from './identity.js';
import type { KeyValueStore } from './kv.js';
import { pkce, type OidcClient } from './oidc.js';
import {
  AdminSessions,
  LOGIN_COOKIE,
  LOGIN_TTL_SECONDS,
  SESSION_COOKIE,
  randomToken,
  safeEqual,
  withinLimit,
  type AdminSession,
} from './sessions.js';

export interface AdminRouteOptions {
  env: AppEnv;
  auth: AdminAuthConfig;
  store: KeyValueStore;
  oidc: OidcClient;
  tenants: TenantRegistry;
}

export type AdminErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'forbidden_origin'
  | 'csrf'
  | 'rate_limited'
  | 'not_found'
  | 'invalid_request';

const STATUS: Record<AdminErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  forbidden_origin: 403,
  csrf: 403,
  rate_limited: 429,
  not_found: 404,
  invalid_request: 400,
};

/** Admin API errors: a stable code; the admin interface translates it (ro/en). */
export function adminError(reply: FastifyReply, code: AdminErrorCode): FastifyReply {
  return reply.code(STATUS[code]).send({ error: { code } });
}

const LIMITS = {
  /** Login starts and callbacks per client address. */
  login: { limit: 30, windowSeconds: 600 },
  /** Admin API calls per session. */
  api: { limit: 600, windowSeconds: 60 },
};

const sessions = new WeakMap<FastifyRequest, AdminSession>();

/** The session of an authenticated admin request (set by the guard). */
export function sessionOf(request: FastifyRequest): AdminSession {
  const session = sessions.get(request);
  if (!session) throw new Error('admin route without the session guard');
  return session;
}

/** Server-side authorization for a tenant (spec §4.3). Replies 403 and returns false if denied. */
export function authorize(
  request: FastifyRequest,
  reply: FastifyReply,
  tenant: string,
  action: AdminAction,
): boolean {
  if (can(sessionOf(request).identity, tenant, action)) return true;
  void adminError(reply, 'forbidden');
  return false;
}

const loginQuery = z.object({
  org: z.string().max(64),
  returnTo: z.string().max(512).optional(),
});
const callbackQuery = z.object({ state: z.string().max(128) }).loose();

/** Only paths of the admin interface; never another origin (open redirect). */
function safeReturnTo(value: string | undefined): string {
  if (!value || !value.startsWith('/admin/') || value.startsWith('//') || value.includes('\\')) {
    return '/admin/';
  }
  return value;
}

export function adminRoutes(app: FastifyInstance, options: AdminRouteOptions): void {
  const { env, auth, store, oidc } = options;
  const sessionStore = new AdminSessions(store);
  const secure = { httpOnly: true, secure: true } as const;
  const callbackUri = `${env.PUBLIC_ORIGIN}/admin/auth/callback`;

  void app.register(
    (admin, _opts, done) => {
      // Admin pages and API (ADR 008): never framed, never cached, no referrer (the callback URL
      // carries the authorization code).
      admin.addHook('onSend', async (_request, reply) => {
        reply
          .header('cache-control', 'no-store')
          .header('x-content-type-options', 'nosniff')
          .header('referrer-policy', 'no-referrer');
        if (!reply.hasHeader('content-security-policy')) {
          reply.header(
            'content-security-policy',
            "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
          );
        }
      });

      admin.get('/auth/login', async (request, reply) => {
        if (
          !(await withinLimit(
            store,
            'login',
            request.ip,
            LIMITS.login.limit,
            LIMITS.login.windowSeconds,
          ))
        ) {
          return adminError(reply, 'rate_limited');
        }
        const query = loginQuery.safeParse(request.query);
        const realm = query.success ? auth.realms.get(query.data.org) : undefined;
        if (!query.success || !realm) return adminError(reply, 'not_found');

        const state = randomToken();
        const nonce = randomToken();
        const codeVerifier = pkce.verifier();
        await sessionStore.saveLogin(state, {
          org: realm.org,
          codeVerifier,
          nonce,
          returnTo: safeReturnTo(query.data.returnTo),
        });
        const url = await oidc.authorizationUrl(realm, {
          redirectUri: callbackUri,
          state,
          nonce,
          codeChallenge: await pkce.challenge(codeVerifier),
        });
        // Lax: the identity provider brings the browser back with a top-level GET.
        void reply.setCookie(LOGIN_COOKIE, state, {
          ...secure,
          sameSite: 'lax',
          path: '/admin/auth',
          maxAge: LOGIN_TTL_SECONDS,
        });
        return reply.redirect(url.href, 302);
      });

      admin.get('/auth/callback', async (request, reply) => {
        const fail = (reason: string): FastifyReply => {
          request.log.warn({ reason }, 'admin login rejected');
          return reply.redirect(`/admin/?error=${reason}`, 302);
        };
        if (
          !(await withinLimit(
            store,
            'login',
            request.ip,
            LIMITS.login.limit,
            LIMITS.login.windowSeconds,
          ))
        ) {
          return adminError(reply, 'rate_limited');
        }
        void reply.clearCookie(LOGIN_COOKIE, { ...secure, sameSite: 'lax', path: '/admin/auth' });
        const query = callbackQuery.safeParse(request.query);
        const bound = request.cookies[LOGIN_COOKIE];
        // The state must belong to this browser (login CSRF) and is single use.
        if (!query.success || !bound || !safeEqual(bound, query.data.state)) {
          return fail('login_state');
        }
        const login = await sessionStore.takeLogin(query.data.state);
        const realm = login ? auth.realms.get(login.org) : undefined;
        if (!login || !realm) return fail('login_state');

        let exchanged;
        try {
          exchanged = await oidc.exchange(realm, new URL(request.url, env.PUBLIC_ORIGIN), {
            codeVerifier: login.codeVerifier,
            state: query.data.state,
            nonce: login.nonce,
          });
        } catch (error) {
          request.log.warn({ org: realm.org, err: String(error) }, 'admin code exchange failed');
          return fail('login_failed');
        }
        const result = identityFromClaims(exchanged.claims, realm.org, auth);
        if (!result.ok) return fail(result.reason);

        const { id } = await sessionStore.create(
          result.identity,
          realm.org,
          realm.sessionSeconds,
          exchanged.idToken,
        );
        void reply.setCookie(SESSION_COOKIE, id, {
          ...secure,
          sameSite: 'strict',
          path: '/admin',
          maxAge: realm.sessionSeconds,
        });
        request.log.info({ org: realm.org, role: result.identity.role }, 'admin session started');
        return reply.redirect(login.returnTo, 302);
      });

      // Everything below needs a session.
      void admin.register((guarded, _o, next) => {
        guarded.addHook('onRequest', async (request, reply) => {
          const site = request.headers['sec-fetch-site'];
          if (site !== undefined && site !== 'same-origin') {
            return adminError(reply, 'forbidden_origin');
          }
          // Only the session cookie authenticates: an Authorization header (for example a
          // token from another realm) is never accepted.
          const session = await sessionStore.get(request.cookies[SESSION_COOKIE]);
          if (!session) return adminError(reply, 'unauthenticated');
          if (
            !(await withinLimit(
              store,
              'api',
              request.cookies[SESSION_COOKIE] ?? '',
              LIMITS.api.limit,
              LIMITS.api.windowSeconds,
            ))
          ) {
            return adminError(reply, 'rate_limited');
          }
          if (request.method !== 'GET' && request.method !== 'HEAD') {
            if (request.headers.origin !== env.PUBLIC_ORIGIN) {
              return adminError(reply, 'forbidden_origin');
            }
            const token = request.headers['x-csrf-token'];
            if (typeof token !== 'string' || !safeEqual(token, session.csrf)) {
              return adminError(reply, 'csrf');
            }
          }
          sessions.set(request, session);
        });

        guarded.get('/api/session', (request) => {
          const session = sessionOf(request);
          const { identity } = session;
          const tenants =
            identity.tenant === '*' ? [...options.tenants.keys()].sort() : [identity.tenant];
          return {
            user: { name: identity.name, role: identity.role },
            org: session.org,
            tenants,
            csrfToken: session.csrf,
            expiresAt: new Date(session.expiresAt).toISOString(),
          };
        });

        guarded.post('/auth/logout', async (request, reply) => {
          const session = sessionOf(request);
          await sessionStore.destroy(request.cookies[SESSION_COOKIE]);
          void reply.clearCookie(SESSION_COOKIE, { ...secure, sameSite: 'strict', path: '/admin' });
          const realm = auth.realms.get(session.org);
          let redirect = '/admin/';
          if (realm) {
            try {
              const url = await oidc.endSessionUrl(realm, {
                idToken: session.idToken,
                postLogoutRedirectUri: `${env.PUBLIC_ORIGIN}/admin/`,
              });
              if (url) redirect = url.href;
            } catch (error) {
              request.log.warn({ err: String(error) }, 'end session URL unavailable');
            }
          }
          return { redirect };
        });

        next();
      });

      done();
    },
    { prefix: '/admin' },
  );
}
