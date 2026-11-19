import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import * as z from 'zod/mini';
import type { Tenant, TenantRegistry } from '../config/tenants.js';
import { textOn } from '../config/contrast.js';
import type { KeyValueStore } from '../admin/kv.js';
import { replyError } from '../errors/index.js';
import { recordInstall } from '../installs/index.js';
import { localeSchema, tenantIdSchema, type LoaderConfig, type Locale } from '../protocol/index.js';
import { WIDGET_TEXT_KEYS, type WidgetTextKey } from '../protocol/texts.js';

const LOADER_TEXT_KEYS: readonly WidgetTextKey[] = [
  'launcher.open',
  'launcher.close',
  'frameTitle',
  'proactive.close',
];

/** Tenant overrides of widget texts for one locale (known keys only). */
export function textOverrides(
  tenant: Tenant,
  locale: Locale,
  keys: readonly WidgetTextKey[] = WIDGET_TEXT_KEYS,
): Record<string, string> {
  const texts = tenant.texts[locale] ?? {};
  const result: Record<string, string> = {};
  for (const key of keys) {
    const value = texts[key];
    if (value) result[key] = value;
  }
  return result;
}

export function assetUrl(tenant: Tenant, name: string | undefined): string | undefined {
  return name && name !== 'none' ? tenant.assets.get(name)?.url : undefined;
}

export function loaderConfig(tenant: Tenant, locale: Locale): LoaderConfig {
  const { proactive } = tenant;
  const text = proactive.text ? (proactive.text[locale] ?? proactive.text.ro) : undefined;
  // Built-in icons are drawn by the loader itself (bundled SVG data); images come from here.
  const icon = tenant.launcher.icon;
  const iconUrl = icon?.type === 'asset' ? assetUrl(tenant, icon.file) : undefined;
  const builtin = icon?.type === 'builtin' && icon.name !== 'chat' ? icon.name : undefined;
  return {
    theme: {
      accent: tenant.theme.accent,
      accentEnd: tenant.theme.accentEnd,
      onAccent: tenant.theme.onAccent,
    },
    launcher: {
      position: tenant.launcher.position,
      offsetX: tenant.launcher.offsetX,
      offsetY: tenant.launcher.offsetY,
      ...(tenant.launcher.color
        ? { color: tenant.launcher.color, onColor: textOn([tenant.launcher.color]) }
        : {}),
      ...(iconUrl ? { iconUrl } : {}),
      ...(builtin ? { icon: builtin } : {}),
    },
    window: {
      width: tenant.window.width,
      height: tenant.window.height,
      position:
        tenant.window.position === 'auto' ? tenant.launcher.position : tenant.window.position,
    },
    proactive:
      proactive.enabled && text
        ? {
            text,
            delaySeconds: proactive.delaySeconds,
            frequency: proactive.frequency,
            showOnMobile: proactive.showOnMobile,
          }
        : null,
    texts: textOverrides(tenant, locale, LOADER_TEXT_KEYS),
  };
}

const loaderQuery = z.object({ tenant: tenantIdSchema, locale: z._default(localeSchema, 'ro') });
const assetParams = z.object({
  tenant: tenantIdSchema,
  file: z.string().check(z.regex(/^([0-9a-f]{10})-([\w.-]+)$/)),
});

/** Tenant images and the loader configuration (ADR 007). */
export function tenantAssetRoutes(
  app: FastifyInstance,
  tenants: TenantRegistry,
  /** Records where the widget is installed ("Verifică instalarea"); optional. */
  installs?: KeyValueStore,
): void {
  /**
   * Read by loader.js on the client's page, i.e. cross-site: CORS only for the tenant's
   * allowedOrigins, short cache with ETag. Public data, no credentials.
   */
  app.get('/api/loader-config', async (request, reply) => {
    const query = loaderQuery.safeParse(request.query);
    if (!query.success) return replyError(reply, 'invalid_request', 'ro');
    const tenant = tenants.get(query.data.tenant);
    if (!tenant) return replyError(reply, 'tenant_not_found', query.data.locale);

    reply.header('vary', 'Origin');
    const origin = request.headers.origin;
    if (origin !== undefined) {
      if (!tenant.allowedOrigins.includes(origin)) {
        return replyError(reply, 'forbidden_origin', query.data.locale);
      }
      reply.header('access-control-allow-origin', origin);
      // The widget is installed on this (allowed) site; previews are the admin's own page.
      if (installs && !tenant.preview) {
        recordInstall(installs, tenant.id, origin).catch((error: unknown) => {
          request.log.warn({ err: String(error) }, 'installation not recorded');
        });
      }
    }

    const body = JSON.stringify(loaderConfig(tenant, query.data.locale));
    const etag = `"${createHash('sha256').update(body).digest('base64url').slice(0, 16)}"`;
    // A preview shows the draft as it is now: never served from a cache (ADR 008).
    reply
      .header('cache-control', tenant.preview ? 'no-store' : 'public, max-age=60')
      .header('etag', etag);
    if (request.headers['if-none-match'] === etag) return reply.code(304).send();
    return reply.type('application/json; charset=utf-8').send(body);
  });

  /**
   * The client's current logo at a stable address (E4b.1 UX 17): the Keycloak sign-in theme reads
   * it from a realm attribute, which cannot follow the content-hashed URL. A short-lived redirect
   * to that URL; 404 without a logo.
   */
  app.get('/w/t/:tenant/logo', (request, reply) => {
    const params = z.object({ tenant: tenantIdSchema }).safeParse(request.params);
    const tenant = params.success ? tenants.get(params.data.tenant) : undefined;
    const url = tenant ? assetUrl(tenant, tenant.identity.logo) : undefined;
    if (!url) return reply.code(404).type('text/plain; charset=utf-8').send('Not found');
    return reply
      .header('cache-control', 'public, max-age=300')
      .header('cross-origin-resource-policy', 'cross-origin')
      .redirect(url, 302);
  });

  /** Content-hashed URLs: cached as immutable; a changed file gets a new URL. */
  app.get('/w/t/:tenant/:file', async (request, reply) => {
    const params = assetParams.safeParse(request.params);
    const tenant = params.success ? tenants.get(params.data.tenant) : undefined;
    const match = params.success ? /^([0-9a-f]{10})-(.+)$/.exec(params.data.file) : null;
    const asset = match && tenant ? tenant.assets.get(match[2] ?? '') : undefined;
    if (!asset || asset.hash !== match?.[1]) {
      return reply.code(404).type('text/plain; charset=utf-8').send('Not found');
    }

    reply
      .type(asset.contentType)
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff')
      // The launcher icon is shown on the client's page (cross-origin image).
      .header('cross-origin-resource-policy', 'cross-origin');
    if (asset.contentType === 'image/svg+xml') {
      // SVG only comes from the repository; even so it can never run code (ADR 007).
      reply.header(
        'content-security-policy',
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      );
    }
    return reply.send(await asset.read());
  });
}
