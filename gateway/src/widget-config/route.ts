import type { FastifyInstance } from 'fastify';
import * as z from 'zod/mini';
import type { Tenant, TenantRegistry } from '../config/tenants.js';
import { getParameters } from '../dify/client.js';
import { chatError, HTTP_STATUS } from '../errors/index.js';
import {
  localeSchema,
  tenantIdSchema,
  type ErrorResponse,
  type Locale,
  type WidgetConfig,
} from '../protocol/index.js';

const querySchema = z.object({
  tenant: tenantIdSchema,
  locale: z._default(localeSchema, 'ro'),
});

/** Opening statements change rarely; a short per-replica cache avoids a Dify call per page view. */
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  value: string;
  expiresAt: number;
}

export function widgetConfigRoute(app: FastifyInstance, tenants: TenantRegistry): void {
  const openingStatements = new Map<string, CacheEntry>();

  async function openingStatement(tenant: Tenant): Promise<string> {
    const cached = openingStatements.get(tenant.id);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const result = await getParameters(tenant);
    if (!result.ok) {
      // The welcome message is optional: the chat still works without it. Short retry window.
      app.log.warn({ tenant: tenant.id, code: result.code }, 'Dify parameters unavailable');
      openingStatements.set(tenant.id, { value: '', expiresAt: Date.now() + 30_000 });
      return '';
    }
    const value = result.value.opening_statement?.trim() ?? '';
    openingStatements.set(tenant.id, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }

  // Public, non-secret data. Same-origin GETs from the iframe carry no Origin header, so there
  // is no origin check here; nothing returned is sensitive.
  app.get('/api/widget-config', async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      const body: ErrorResponse = { error: chatError('invalid_request', 'ro') };
      return reply.code(HTTP_STATUS.invalid_request).send(body);
    }
    const { tenant: tenantId, locale } = parsed.data;
    const tenant = tenants.get(tenantId);
    if (!tenant) {
      const body: ErrorResponse = { error: chatError('tenant_not_found', locale) };
      return reply.code(HTTP_STATUS.tenant_not_found).send(body);
    }

    const config: WidgetConfig = {
      tenant: tenant.id,
      locale,
      assistantName: text(tenant, locale, 'assistant.name') ?? tenant.name,
      welcomeMessage: text(tenant, locale, 'welcome') ?? (await openingStatement(tenant)),
    };
    return reply.header('cache-control', 'no-store').send(config);
  });
}

function text(tenant: Tenant, locale: Locale, key: string): string | undefined {
  const value = tenant.texts[locale]?.[key]?.trim();
  return value === '' ? undefined : value;
}
