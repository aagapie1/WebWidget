import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply } from 'fastify';
import * as z from 'zod/mini';
import type { Tenant, TenantRegistry } from '../config/tenants.js';
import { localeSchema, tenantIdSchema } from '../protocol/index.js';

const appQuerySchema = z.object({
  tenant: tenantIdSchema,
  parent: z.string(),
  locale: z._default(localeSchema, 'ro'),
});

/**
 * Content-Security-Policy of the chat iframe. Everything comes from the gateway itself
 * (CLAUDE.md rule 8); only the tenant's sites may embed it (rule 4).
 */
export function appCsp(tenant: Tenant): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${tenant.allowedOrigins.join(' ')}`,
  ].join('; ');
}

export async function widgetRoute(
  app: FastifyInstance,
  options: { tenants: TenantRegistry; distDir: string },
): Promise<void> {
  const { tenants, distDir } = options;

  app.addHook('onSend', async (request, reply) => {
    if (request.url.startsWith('/w/')) {
      reply.header('x-content-type-options', 'nosniff');
      reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    }
  });

  // Hashed bundles: cache forever.
  await app.register(fastifyStatic, {
    root: resolve(distDir, 'app', 'assets'),
    prefix: '/w/assets/',
    decorateReply: false,
    immutable: true,
    maxAge: '365d',
    index: false,
  });

  app.get('/w/loader.js', async (_request, reply) => {
    const file = await readDist(distDir, 'loader.js');
    if (file === undefined) return notBuilt(reply);
    return (
      reply
        .type('text/javascript; charset=utf-8')
        // Not hashed (its URL is in the clients' pages): short cache.
        .header('cache-control', 'public, max-age=300')
        .header('cross-origin-resource-policy', 'cross-origin')
        .send(file)
    );
  });

  // The loader's CSS as a file: the fallback where constructable stylesheets are missing
  // (ADR 010). Same text as in loader.js; its URL carries a version of that text (`?v=`).
  app.get('/w/loader.css', async (_request, reply) => {
    const file = await readDist(distDir, 'loader.css');
    if (file === undefined) return notBuilt(reply);
    return reply
      .type('text/css; charset=utf-8')
      .header('cache-control', 'public, max-age=300')
      .header('cross-origin-resource-policy', 'cross-origin')
      .send(file);
  });

  app.get('/w/app', async (request, reply) => {
    const parsed = appQuerySchema.safeParse(request.query);
    const tenant = parsed.success ? tenants.get(parsed.data.tenant) : undefined;
    // `parent` is where the iframe will post messages; it must be one of the tenant's sites.
    if (!parsed.success || !tenant || !tenant.allowedOrigins.includes(parsed.data.parent)) {
      return reply
        .code(403)
        .type('text/plain; charset=utf-8')
        .header('content-security-policy', "default-src 'none'; frame-ancestors 'none'")
        .send('Asistentul nu este disponibil pe acest site.');
    }

    const html = await readDist(distDir, join('app', 'index.html'));
    if (html === undefined) return notBuilt(reply);
    return reply
      .type('text/html; charset=utf-8')
      .header('content-security-policy', appCsp(tenant))
      .header('cache-control', 'no-store')
      .send(html);
  });
}

async function readDist(distDir: string, file: string): Promise<Buffer | undefined> {
  try {
    return await readFile(join(distDir, file));
  } catch {
    return undefined;
  }
}

function notBuilt(reply: FastifyReply): FastifyReply {
  reply.log.error('widget bundle missing: run `pnpm build` (or `pnpm dev`)');
  return reply.code(503).type('text/plain; charset=utf-8').send('Widget unavailable');
}
