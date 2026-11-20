import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppEnv } from '../config/env.js';
import type { TenantRegistry } from '../config/tenants.js';
import { adminConfigRoutes, type AdminApiOptions } from './api.js';
import type { AdminAuthConfig } from './auth-config.js';
import {
  adminError,
  attachSession,
  auditActorOf,
  auditContextOf,
  auditWhoOf,
  sessionOf,
} from './guard.js';
import { can, identityFromClaims } from './identity.js';
import { PREVIEW_ID, type PreviewService } from './preview.js';
import type { KeyValueStore } from './kv.js';
import { pkce, type OidcClient } from './oidc.js';
import {
  AdminSessions,
  adminCookies,
  LOGIN_TTL_SECONDS,
  randomToken,
  safeEqual,
  withinLimit,
} from './sessions.js';
import { PLATFORM_CHAIN } from '../audit/log.js';
import { AuditRecorder, chainOf } from '../audit/recorder.js';

export interface AdminRouteOptions {
  env: AppEnv;
  auth: AdminAuthConfig;
  store: KeyValueStore;
  oidc: OidcClient;
  tenants: TenantRegistry;
  /** Configuration API (Postgres, ADR 008); only the session endpoints without it. */
  api?: AdminApiOptions;
  /** Draft preview (needs the configuration API). */
  preview?: PreviewService;
  /** Built admin interface (`admin/dist`). */
  distDir: string;
}

const LIMITS = {
  /** Login starts and callbacks per client address (limit: ADMIN_LOGIN_LIMIT). */
  login: { windowSeconds: 600 },
  /** Admin API calls per session. */
  api: { limit: 600, windowSeconds: 60 },
};

const orgQuery = z.object({ org: z.string().max(64).optional() });
const loginQuery = z.object({
  org: z.string().max(64),
  returnTo: z.string().max(512).optional(),
  /** The admin interface's language, passed to the identity provider (ui_locales). */
  locale: z.enum(['ro', 'en']).optional(),
});
const previewQuery = z.object({
  id: z.string().max(110),
  locale: z.enum(['ro', 'en']).default('ro'),
  /** Starting state of the preview (launcher, proactive bubble or open window). */
  show: z.enum(['launcher', 'proactive', 'window']).default('window'),
});

/**
 * The page under the preview: a neutral, sketched site (header, a few grey blocks) labelled
 * "Exemplu de pagină", with the real loader on it. The id is validated (letters, digits, dashes).
 */
function previewPage(
  id: string,
  locale: 'ro' | 'en',
  show: 'launcher' | 'proactive' | 'window',
): string {
  const label = locale === 'en' ? 'Sample page' : 'Exemplu de pagină';
  const title = locale === 'en' ? 'Preview' : 'Previzualizare';
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { margin: 0; min-height: 100vh; background: #fff; color: #1f2328; font: 15px/1.5 system-ui, sans-serif; }
  .label { position: fixed; top: 10px; left: 10px; z-index: 1; font-size: 12px; font-weight: 600; color: #5b6474;
    background: rgb(255 255 255 / 0.92); border: 1px solid #e3e6eb; border-radius: 999px; padding: 2px 10px; }
  .top { height: 56px; display: flex; align-items: center; gap: 16px; padding: 0 24px; background: #f3f4f6; border-bottom: 1px solid #e5e7eb; }
  .b { display: block; background: #e5e7eb; border-radius: 5px; }
  .spacer { flex: 1; }
  main { max-width: 960px; padding: 28px 24px; display: grid; gap: 18px; }
  .hero { height: 160px; border-radius: 10px; background: #eef0f3; }
  .lines { display: grid; gap: 10px; }
  .lines .b { height: 12px; }
  .cols { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .cols .b { height: 110px; border-radius: 8px; }
</style>
</head>
<body>
<span class="label">${label}</span>
<div class="top" aria-hidden="true"><span class="b" style="width:36px;height:26px"></span><span class="b" style="width:140px;height:12px"></span><span class="spacer"></span><span class="b" style="width:60px;height:10px"></span><span class="b" style="width:60px;height:10px"></span><span class="b" style="width:60px;height:10px"></span></div>
<main aria-hidden="true">
<div class="hero"></div>
<div class="lines"><span class="b" style="width:72%"></span><span class="b" style="width:58%"></span></div>
<div class="cols"><span class="b"></span><span class="b"></span><span class="b"></span></div>
<div class="lines"><span class="b" style="width:84%"></span><span class="b" style="width:66%"></span><span class="b" style="width:75%"></span></div>
</main>
<script src="/w/loader.js" data-tenant="${id}" data-locale="${locale}" data-preview="${show}" async></script>
</body>
</html>
`;
}

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
  // The audit log (E5 B9) lives in Postgres: with the admin API only.
  const audit = new AuditRecorder(options.api?.db, app.log);
  const cookies = adminCookies(env.PUBLIC_ORIGIN);
  const secure = { httpOnly: true, secure: cookies.secure } as const;
  const callbackUri = `${env.PUBLIC_ORIGIN}/admin/auth/callback`;

  void app.register(
    (admin, _opts, done) => {
      // Admin answers always use the admin error format.
      admin.setErrorHandler((error: FastifyError, request, reply) => {
        if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return adminError(reply, 'too_large');
        if (error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
          return adminError(reply, 'unsupported_type');
        }
        const status = error.statusCode ?? 500;
        if (status >= 400 && status < 500) return adminError(reply, 'invalid_request');
        request.log.error({ err: error }, 'admin request failed');
        return adminError(reply, 'internal_error');
      });

      // Admin pages and API (ADR 008): never framed, not cached (except the hashed bundles), no
      // referrer (the callback URL carries the authorization code).
      admin.addHook('onSend', async (_request, reply) => {
        reply.header('x-content-type-options', 'nosniff').header('referrer-policy', 'no-referrer');
        if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
        if (!reply.hasHeader('content-security-policy')) {
          reply.header(
            'content-security-policy',
            "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
          );
        }
      });

      // The admin interface (separate bundle from the public widget): hashed assets cached
      // forever, the page itself never cached. Loaded without a session (it shows the login).
      void admin.register(fastifyStatic, {
        root: resolve(options.distDir, 'assets'),
        prefix: '/assets/',
        decorateReply: false,
        immutable: true,
        maxAge: '365d',
        index: false,
      });
      admin.get('/', async (request, reply) => {
        let html: Buffer;
        try {
          html = await readFile(join(options.distDir, 'index.html'));
        } catch {
          request.log.error('admin bundle missing: run `pnpm --filter admin build`');
          return reply
            .code(503)
            .type('text/plain; charset=utf-8')
            .send('Admin interface not built.');
        }
        return reply
          .type('text/html; charset=utf-8')
          .header(
            'content-security-policy',
            "default-src 'self'; img-src 'self' data:; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
          )
          .send(html);
      });

      // Development and test only: the organisations to choose from on the login page. In
      // production this list is not public (it would reveal which clients exist).
      admin.get('/auth/orgs', (_request, reply) => {
        if (env.NODE_ENV === 'production') return adminError(reply, 'not_found');
        return {
          orgs: [...auth.realms.values()].map((realm) => ({
            org: realm.org,
            kind: realm.kind,
            ...(realm.tenant ? { name: options.tenants.get(realm.tenant)?.name ?? realm.org } : {}),
          })),
        };
      });

      // The organisation of the sign-in page (E4b.1 UX 16): the one named in the link (?org=),
      // or the one this host belongs to (ADMIN_ORG_HOSTS). One organisation at a time, with its
      // client name; never the list (production keeps the clients private).
      admin.get('/auth/org', async (request, reply) => {
        if (
          !(await withinLimit(
            store,
            'org',
            request.ip,
            env.ADMIN_LOGIN_LIMIT,
            LIMITS.login.windowSeconds,
          ))
        ) {
          return adminError(reply, 'rate_limited');
        }
        const query = orgQuery.safeParse(request.query);
        if (!query.success) return adminError(reply, 'invalid_request');
        const code = query.data.org ?? env.ADMIN_ORG_HOSTS.get(request.hostname.toLowerCase());
        const realm = code ? auth.realms.get(code) : undefined;
        if (!realm) return adminError(reply, 'not_found');
        return {
          org: realm.org,
          kind: realm.kind,
          ...(realm.tenant ? { name: options.tenants.get(realm.tenant)?.name ?? realm.org } : {}),
        };
      });

      admin.get('/auth/login', async (request, reply) => {
        if (
          !(await withinLimit(
            store,
            'login',
            request.ip,
            env.ADMIN_LOGIN_LIMIT,
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
          locale: query.data.locale,
        });
        // Lax: the identity provider brings the browser back with a top-level GET.
        void reply.setCookie(cookies.login, state, {
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
        /** A refused or failed sign-in, in the organisation's chain (B9). */
        const recordRefusal = async (
          realmOrg: string | undefined,
          reason: string,
          result: 'denied' | 'failed',
          claims?: Readonly<Record<string, unknown>>,
        ) => {
          const realm = realmOrg ? auth.realms.get(realmOrg) : undefined;
          await audit.record({
            chain: realm?.tenant ?? PLATFORM_CHAIN,
            tenant: realm?.tenant ?? '*',
            actor: {
              kind: 'user',
              issuer: typeof claims?.iss === 'string' ? claims.iss : (realm?.issuer ?? 'unknown'),
              subject: typeof claims?.sub === 'string' ? claims.sub : 'unknown',
              ...(typeof claims?.name === 'string' ? { name: claims.name } : {}),
              ...(typeof claims?.email === 'string' ? { email: claims.email } : {}),
              ...(realmOrg ? { org: realmOrg } : {}),
              source:
                typeof claims?.identity_provider === 'string' ? claims.identity_provider : 'local',
            },
            context: auditContextOf(request),
            action: 'auth.login',
            result,
            reason,
          });
        };
        if (
          !(await withinLimit(
            store,
            'login',
            request.ip,
            env.ADMIN_LOGIN_LIMIT,
            LIMITS.login.windowSeconds,
          ))
        ) {
          return adminError(reply, 'rate_limited');
        }
        void reply.clearCookie(cookies.login, { ...secure, sameSite: 'lax', path: '/admin/auth' });
        const query = callbackQuery.safeParse(request.query);
        const bound = request.cookies[cookies.login];
        // The state must belong to this browser (login CSRF) and is single use.
        if (!query.success || !bound || !safeEqual(bound, query.data.state)) {
          return fail('login_state');
        }
        const login = await sessionStore.takeLogin(query.data.state);
        const realm = login ? auth.realms.get(login.org) : undefined;
        if (!login || !realm) {
          await recordRefusal(undefined, 'login_state', 'denied');
          return fail('login_state');
        }

        let exchanged;
        try {
          exchanged = await oidc.exchange(realm, new URL(request.url, env.PUBLIC_ORIGIN), {
            codeVerifier: login.codeVerifier,
            state: query.data.state,
            nonce: login.nonce,
          });
        } catch (error) {
          request.log.warn({ org: realm.org, err: String(error) }, 'admin code exchange failed');
          await recordRefusal(realm.org, 'login_failed', 'failed');
          return fail('login_failed');
        }
        const result = identityFromClaims(exchanged.claims, realm.org, auth);
        if (!result.ok) {
          await recordRefusal(realm.org, result.reason, 'denied', exchanged.claims);
          return fail(result.reason);
        }

        const { id } = await sessionStore.create(
          result.identity,
          realm.org,
          realm.sessionSeconds,
          exchanged.idToken,
        );
        void reply.setCookie(cookies.session, id, {
          ...secure,
          sameSite: 'strict',
          path: '/admin',
          maxAge: realm.sessionSeconds,
        });
        request.log.info({ org: realm.org, role: result.identity.role }, 'admin session started');
        const session = { identity: result.identity, org: realm.org };
        await audit.record({
          chain: chainOf(result.identity.tenant),
          tenant: result.identity.tenant,
          actor: auditActorOf(session),
          context: auditContextOf(request, id),
          action: 'auth.login',
          result: 'success',
          details: { sessionSeconds: realm.sessionSeconds },
        });
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
          const cookie = request.cookies[cookies.session];
          const session = await sessionStore.get(cookie);
          if (!session) {
            // A session that ended by itself: recorded once, with its user (B9).
            const trace = await sessionStore.expired(cookie);
            if (trace) {
              await audit.record({
                chain: chainOf(trace.identity.tenant),
                tenant: trace.identity.tenant,
                actor: auditActorOf(trace),
                context: auditContextOf(request, cookie),
                action: 'auth.session_expired',
                result: 'denied',
                reason: 'session_expired',
              });
            }
            return adminError(reply, 'unauthenticated');
          }
          if (
            !(await withinLimit(
              store,
              'api',
              request.cookies[cookies.session] ?? '',
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
          attachSession(request, session, request.cookies[cookies.session] ?? '');
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
            /** For the integration snippet ("Integrare pe site"). */
            gatewayOrigin: env.PUBLIC_ORIGIN,
          };
        });

        guarded.post('/auth/logout', async (request, reply) => {
          const session = sessionOf(request);
          await audit.record({
            chain: chainOf(session.identity.tenant),
            tenant: session.identity.tenant,
            ...auditWhoOf(request),
            action: 'auth.logout',
            result: 'success',
          });
          await sessionStore.destroy(request.cookies[cookies.session]);
          void reply.clearCookie(cookies.session, {
            ...secure,
            sameSite: 'strict',
            path: '/admin',
          });
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

        if (options.api) {
          adminConfigRoutes(guarded, {
            ...options.api,
            ...(options.preview ? { preview: options.preview } : {}),
            store,
            tenants: options.tenants,
          });
        }

        // Preview page (spec §5.2): a neutral page with the real loader and the preview tenant id.
        // Framed by the admin interface only (same origin).
        guarded.get('/preview', async (request, reply) => {
          const query = previewQuery.safeParse(request.query);
          const match = query.success ? PREVIEW_ID.exec(query.data.id) : null;
          if (!query.success || !match) return adminError(reply, 'not_found');
          const target = match[1] ?? '';
          if (!can(sessionOf(request).identity, target, 'edit')) {
            await audit.recordIn(
              [
                chainOf(sessionOf(request).identity.tenant),
                ...(options.tenants.has(target) ? [target] : []),
              ],
              {
                tenant: target,
                ...auditWhoOf(request),
                action: 'access.denied',
                result: 'denied',
                reason: 'forbidden',
                details: { method: request.method, route: '/admin/preview', needed: 'edit' },
              },
            );
            return adminError(reply, 'forbidden');
          }
          return reply
            .type('text/html; charset=utf-8')
            .header(
              'content-security-policy',
              "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
            )
            .send(previewPage(query.data.id, query.data.locale, query.data.show));
        });

        next();
      });

      done();
    },
    { prefix: '/admin' },
  );
}
