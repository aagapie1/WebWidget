import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Dispatcher } from 'undici';
import type { AdminApiOptions } from './admin/api.js';
import type { AdminAuthConfig } from './admin/auth-config.js';
import type { KeyValueStore } from './admin/kv.js';
import type { OidcClient } from './admin/oidc.js';
import { PREVIEW_ID, PreviewService, redactPreview, TenantsWithPreviews } from './admin/preview.js';
import { adminRoutes } from './admin/routes.js';
import { chatRoute } from './chat/route.js';
import type { AppEnv } from './config/env.js';
import type { TenantRegistry } from './config/tenants.js';
import { conversationRoutes } from './conversations/route.js';
import { chatError, replyError } from './errors/index.js';
import { MemoryFeedbackStore, type FeedbackStore } from './feedback/store.js';
import type { ErrorResponse } from './protocol/index.js';
import { tenantAssetRoutes } from './tenant-assets/route.js';
import { widgetConfigRoute } from './widget-config/route.js';
import { widgetRoute } from './widget/route.js';
import { KeycloakEventImport } from './audit/keycloak-import.js';

export interface BuildAppOptions {
  env: AppEnv;
  tenants: TenantRegistry;
  /** Closing feedback storage (Redis in production, ADR 005). Defaults to in-memory. */
  feedbackStore?: FeedbackStore;
  /** Admin interface (ADR 008); omitted when ADMIN_AUTH_CONFIG is not set. */
  admin?: { auth: AdminAuthConfig; store: KeyValueStore; oidc: OidcClient; api?: AdminApiOptions };
  /** Test hook: route Dify requests through a custom undici dispatcher. */
  difyDispatcher?: Dispatcher;
}

const REQUEST_ID = /^[a-zA-Z0-9-]{8,64}$/;

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  // Admin preview (ADR 008): requests with a preview tenant id use the draft configuration.
  const preview = options.admin?.api
    ? new PreviewService(
        options.admin.store,
        options.admin.api.db,
        options.admin.api.tenantEnv,
        options.env.PUBLIC_ORIGIN,
      )
    : undefined;
  const previews = preview ? new TenantsWithPreviews(options.tenants) : undefined;
  const tenants: TenantRegistry = previews ?? options.tenants;
  const app = Fastify({
    logger: {
      level: options.env.LOG_LEVEL,
      // No personal data in logs (CLAUDE.md rule 7): no IP, no cookies, no bodies.
      serializers: {
        req: (req: { method: string; url: string }) => ({
          method: req.method,
          url: redactPreview(req.url),
        }),
      },
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    // Correlation id: reuse a well-formed incoming X-Request-Id, otherwise generate one.
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    },
    bodyLimit: 64 * 1024,
    // Only the configured proxies are believed about the client's address, host and protocol
    // (E5 D1): from anyone else, X-Forwarded-* would let a client pick its own IP and bypass
    // every rate limit. Without a list, the connection's own address is used.
    trustProxy: options.env.TRUSTED_PROXIES.length > 0 ? options.env.TRUSTED_PROXIES : false,
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    // Defence in depth (ADR 005): browsers say where a request comes from. Only the chat iframe,
    // served from this origin, may call the API. Requests without the header are not rejected
    // here; the signed visitor cookie and rate limiting (E5) are the main protections.
    const site = request.headers['sec-fetch-site'];
    // /api/loader-config is read cross-site by loader.js (CORS restricted to allowedOrigins).
    const crossSiteAllowed = request.url.startsWith('/api/loader-config');
    if (
      request.url.startsWith('/api/') &&
      !crossSiteAllowed &&
      site !== undefined &&
      site !== 'same-origin'
    ) {
      return replyError(reply, 'forbidden_origin', 'ro');
    }
  });

  await app.register(cookie, { secret: options.env.VISITOR_COOKIE_SECRET });

  app.setErrorHandler((error, request, reply) => {
    const status =
      typeof error === 'object' && error !== null && 'statusCode' in error ? error.statusCode : 500;
    const isClientError = typeof status === 'number' && status >= 400 && status < 500;
    if (!isClientError) request.log.error({ err: error }, 'unhandled error');
    const body: ErrorResponse = {
      error: chatError(isClientError ? 'invalid_request' : 'internal_error', 'ro'),
    };
    return reply.code(isClientError ? status : 500).send(body);
  });

  // Disabled tenant (E4b §5.6): every API call and the chat page answer `tenant_disabled`; the
  // loader sees it from loader-config and shows no launcher. Checked after body parsing.
  app.addHook('preHandler', async (request, reply) => {
    const isAsset = request.url.startsWith('/w/t/');
    if (!request.url.startsWith('/api/') && !request.url.startsWith('/w/app') && !isAsset) return;
    const fromQuery = (request.query as Record<string, unknown> | undefined)?.tenant;
    const fromBody = (request.body as Record<string, unknown> | undefined)?.tenant;
    const fromPath = (request.params as Record<string, unknown> | undefined)?.tenant;
    const id = typeof fromQuery === 'string' ? fromQuery : isAsset ? fromPath : fromBody;
    if (typeof id !== 'string') return;
    if (preview && previews && PREVIEW_ID.test(id)) {
      previews.remember(id, await preview.resolve(id));
    }
    if (isAsset || tenants.get(id)?.enabled !== false) return;
    const locale =
      (request.query as Record<string, unknown> | undefined)?.locale === 'en' ? 'en' : 'ro';
    if (request.url.startsWith('/w/app')) {
      return reply
        .code(503)
        .type('text/plain; charset=utf-8')
        .header('content-security-policy', "default-src 'none'; frame-ancestors 'none'")
        .send(chatError('tenant_disabled', locale).message);
    }
    // loader.js reads loader-config cross-site: without CORS the browser would hide this answer
    // and the loader would fall back to showing a default launcher.
    const origin = request.headers.origin;
    if (request.url.startsWith('/api/loader-config') && origin !== undefined) {
      const tenant = tenants.get(id);
      if (tenant?.allowedOrigins.includes(origin)) {
        reply.header('access-control-allow-origin', origin).header('vary', 'Origin');
      }
    }
    return replyError(reply, 'tenant_disabled', locale);
  });

  app.get('/healthz', () => ({ status: 'ok' }));

  widgetConfigRoute(app, tenants);
  tenantAssetRoutes(app, tenants, options.admin?.store);
  await widgetRoute(app, { tenants, distDir: options.env.WIDGET_DIST_DIR });

  conversationRoutes(app, {
    env: options.env,
    tenants,
    feedbackStore: options.feedbackStore ?? new MemoryFeedbackStore(),
  });

  chatRoute(app, {
    env: options.env,
    tenants,
    store: options.admin?.store,
    ...(options.difyDispatcher ? { difyDispatcher: options.difyDispatcher } : {}),
  });

  if (options.admin) {
    // The admin interface lives at /admin/.
    app.get('/', (_request, reply) => reply.redirect('/admin/', 302));
    adminRoutes(app, {
      env: options.env,
      tenants: options.tenants,
      ...options.admin,
      ...(preview ? { preview } : {}),
      distDir: resolve(options.env.ADMIN_DIST_DIR),
    });
    // Keycloak events into the audit log (E5 B9, K1), for the realms with a read-only events client.
    const realms = [...options.admin.auth.realms.values()].filter((realm) => realm.audit);
    if (options.admin.api && realms.length > 0 && options.env.AUDIT_IMPORT_INTERVAL_SECONDS > 0) {
      const importer = new KeycloakEventImport(options.admin.api.db, realms, app.log);
      app.addHook('onReady', () => {
        importer.start(options.env.AUDIT_IMPORT_INTERVAL_SECONDS * 1000);
      });
      app.addHook('onClose', () => importer.stop());
    }
  }

  return app;
}
