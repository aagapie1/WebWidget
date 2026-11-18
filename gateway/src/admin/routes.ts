import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppEnv } from '../config/env.js';
import type { TenantRegistry } from '../config/tenants.js';
import { adminConfigRoutes, type AdminApiOptions } from './api.js';
import type { AdminAuthConfig } from './auth-config.js';
import { adminError, attachSession, authorize, sessionOf } from './guard.js';
import { identityFromClaims } from './identity.js';
import { PREVIEW_ID, type PreviewService } from './preview.js';
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
} from './sessions.js';

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

const loginQuery = z.object({
  org: z.string().max(64),
  returnTo: z.string().max(512).optional(),
});
const previewQuery = z.object({
  id: z.string().max(110),
  locale: z.enum(['ro', 'en']).default('ro'),
});

/** The neutral demo page of the preview. The id is validated (letters, digits, dashes). */
function previewPage(id: string, locale: 'ro' | 'en'): string {
  const text =
    locale === 'en'
      ? {
          title: 'Preview',
          heading: 'Sample page',
          body: 'The widget below uses the draft configuration. Visitors do not see it until it is published.',
        }
      : {
          title: 'Previzualizare',
          heading: 'Pagină demonstrativă',
          body: 'Widget-ul de mai jos folosește configurația-ciornă. Vizitatorii nu o văd până la publicare.',
        };
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${text.title}</title>
<style>
  body { margin: 0; min-height: 100vh; background: #f4f5f7; color: #1f2328; font: 16px/1.5 system-ui, sans-serif; }
  main { max-width: 40rem; padding: 2rem 1.5rem; }
  .bar { height: 0.75rem; margin: 0.75rem 0; border-radius: 0.375rem; background: #dfe3e8; }
</style>
</head>
<body>
<main>
<h1>${text.heading}</h1>
<p>${text.body}</p>
<div class="bar" style="width: 90%"></div><div class="bar" style="width: 75%"></div><div class="bar" style="width: 82%"></div>
</main>
<script src="/w/loader.js" data-tenant="${id}" data-locale="${locale}" async></script>
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
  const secure = { httpOnly: true, secure: true } as const;
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
        return { orgs: [...auth.realms.keys()] };
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
            env.ADMIN_LOGIN_LIMIT,
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
          attachSession(request, session);
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

        if (options.api) {
          adminConfigRoutes(guarded, {
            ...options.api,
            ...(options.preview ? { preview: options.preview } : {}),
          });
        }

        // Preview page (spec §5.2): a neutral page with the real loader and the preview tenant id.
        // Framed by the admin interface only (same origin).
        guarded.get('/preview', (request, reply) => {
          const query = previewQuery.safeParse(request.query);
          const match = query.success ? PREVIEW_ID.exec(query.data.id) : null;
          if (!query.success || !match) return adminError(reply, 'not_found');
          if (!authorize(request, reply, match[1] ?? '', 'edit')) return reply;
          return reply
            .type('text/html; charset=utf-8')
            .header(
              'content-security-policy',
              "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
            )
            .send(previewPage(query.data.id, query.data.locale));
        });

        next();
      });

      done();
    },
    { prefix: '/admin' },
  );
}
