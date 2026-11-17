import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Dispatcher } from 'undici';
import { chatRoute } from './chat/route.js';
import type { AppEnv } from './config/env.js';
import type { TenantRegistry } from './config/tenants.js';
import { chatError } from './errors/index.js';
import type { ErrorResponse } from './protocol/index.js';

export interface BuildAppOptions {
  env: AppEnv;
  tenants: TenantRegistry;
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

  chatRoute(app, {
    env: options.env,
    tenants: options.tenants,
    ...(options.difyDispatcher ? { difyDispatcher: options.difyDispatcher } : {}),
  });

  return app;
}
