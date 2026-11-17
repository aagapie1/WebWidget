import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Dispatcher } from 'undici';
import { chatRoute } from './chat/route.js';
import type { AppEnv } from './config/env.js';
import type { TenantRegistry } from './config/tenants.js';
import { conversationRoutes } from './conversations/route.js';
import { chatError, replyError } from './errors/index.js';
import { MemoryFeedbackStore, type FeedbackStore } from './feedback/store.js';
import type { ErrorResponse } from './protocol/index.js';
import { widgetConfigRoute } from './widget-config/route.js';
import { widgetRoute } from './widget/route.js';

export interface BuildAppOptions {
  env: AppEnv;
  tenants: TenantRegistry;
  /** Closing feedback storage (Redis in production, ADR 005). Defaults to in-memory. */
  feedbackStore?: FeedbackStore;
  /** Test hook: route Dify requests through a custom undici dispatcher. */
  difyDispatcher?: Dispatcher;
}

const REQUEST_ID = /^[a-zA-Z0-9-]{8,64}$/;

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: options.env.LOG_LEVEL,
      // No personal data in logs (CLAUDE.md rule 7): no IP, no cookies, no bodies.
      serializers: {
        req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url }),
      },
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    // Correlation id: reuse a well-formed incoming X-Request-Id, otherwise generate one.
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    },
    bodyLimit: 64 * 1024,
    trustProxy: true,
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    // Defence in depth (ADR 005): browsers say where a request comes from. Only the chat iframe,
    // served from this origin, may call the API. Requests without the header are not rejected
    // here; the signed visitor cookie and rate limiting (E5) are the main protections.
    const site = request.headers['sec-fetch-site'];
    if (request.url.startsWith('/api/') && site !== undefined && site !== 'same-origin') {
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

  app.get('/healthz', () => ({ status: 'ok' }));

  widgetConfigRoute(app, options.tenants);
  await widgetRoute(app, { tenants: options.tenants, distDir: options.env.WIDGET_DIST_DIR });

  conversationRoutes(app, {
    env: options.env,
    tenants: options.tenants,
    feedbackStore: options.feedbackStore ?? new MemoryFeedbackStore(),
  });

  chatRoute(app, {
    env: options.env,
    tenants: options.tenants,
    ...(options.difyDispatcher ? { difyDispatcher: options.difyDispatcher } : {}),
  });

  return app;
}
