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
import type { TextKey } from '../protocol/texts.js';

const querySchema = z.object({
  tenant: tenantIdSchema,
  locale: z._default(localeSchema, 'ro'),
});

/** Opening statements change rarely; a short per-replica cache avoids a Dify call per page view. */
const CACHE_TTL_MS = 5 * 60 * 1000;

interface DifyDefaults {
  welcome: string;
  suggestedQuestions: string[];
}

interface CacheEntry {
  value: DifyDefaults;
  expiresAt: number;
}

const EMPTY: DifyDefaults = { welcome: '', suggestedQuestions: [] };

export function widgetConfigRoute(app: FastifyInstance, tenants: TenantRegistry): void {
  const cache = new Map<string, CacheEntry>();

  async function difyDefaults(tenant: Tenant): Promise<DifyDefaults> {
    const cached = cache.get(tenant.id);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const result = await getParameters(tenant);
    if (!result.ok) {
      // Welcome and suggestions are optional: the chat still works without them. Short retry.
      app.log.warn({ tenant: tenant.id, code: result.code }, 'Dify parameters unavailable');
      cache.set(tenant.id, { value: EMPTY, expiresAt: Date.now() + 30_000 });
      return EMPTY;
    }
    const value: DifyDefaults = {
      welcome: result.value.opening_statement?.trim() ?? '',
      suggestedQuestions: (result.value.suggested_questions ?? [])
        .map((question) => question.trim())
        .filter((question) => question !== '')
        .slice(0, 5),
    };
    cache.set(tenant.id, { value, expiresAt: Date.now() + CACHE_TTL_MS });
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

    const defaults = await difyDefaults(tenant);
    const config: WidgetConfig = {
      tenant: tenant.id,
      locale,
      assistantName: tenant.identity.assistantName ?? tenant.name,
      welcomeMessage: text(tenant, locale, 'welcome') ?? defaults.welcome,
      suggestedQuestions: defaults.suggestedQuestions,
    };
    return reply.header('cache-control', 'no-store').send(config);
  });
}

function text(tenant: Tenant, locale: Locale, key: TextKey): string | undefined {
  const value = tenant.texts[locale]?.[key]?.trim();
  return value === '' ? undefined : value;
}
