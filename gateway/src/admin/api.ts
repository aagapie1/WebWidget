import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { validateTenantObject } from '../config/tenants.js';
import { PgAssetSource } from '../db/postgres-source.js';
import {
  AdminConfigStore,
  DraftConflictError,
  PublishConflictError,
  type Draft,
} from './config-store.js';
import {
  auditSettingsOf,
  diff,
  editableView,
  mergeServerFields,
  nameOf,
  originsOf,
  type ConfigObject,
} from './editable.js';
import { can } from './identity.js';
import { IMAGE_LIMITS, processImage } from './images.js';
import type { PreviewService } from './preview.js';
import type { KeyValueStore } from './kv.js';
import type { TenantRegistry } from '../config/tenants.js';
import { getParameters } from '../dify/client.js';
import { citedDocuments } from '../cited/index.js';
import { installations } from '../installs/index.js';
import { adminError, auditWhoOf, sessionIdOf, sessionOf } from './guard.js';
import { AuditRecorder, chainOf } from '../audit/recorder.js';
import { PLATFORM_CHAIN } from '../audit/log.js';
import {
  auditFilterSchema,
  exportAudit,
  exportHeader,
  hashedView,
  listAudit,
  toCsv,
  type AuditFilters,
} from '../audit/query.js';

/** At most this many records per export (a year of a busy client fits). */
const EXPORT_LIMIT = 100_000;

type Env = Readonly<Record<string, string | undefined>>;

export interface AdminApiOptions {
  db: pg.Pool;
  /** Environment used to validate configurations exactly like the tenant source does. */
  tenantEnv: Env;
}

const tenantParams = z.object({ tenant: z.string().regex(/^[a-z0-9-]{1,64}$/) });
const draftBody = z.object({
  config: z.record(z.string(), z.unknown()),
  /** The published version the editor started from. */
  baseVersion: z.number().int().positive(),
  /** The draft revision the editor started from; `null` when there was no draft. */
  draftRevision: z.number().int().positive().nullable(),
});
const publishBody = z
  .object({
    comment: z.string().trim().max(500).optional(),
    /** The draft revision the publisher reviewed. */
    draftRevision: z.number().int().positive().optional(),
  })
  .optional();
const assetQuery = z.object({ name: z.string().max(200).optional() });
const assetName = z.string().regex(/^[a-z0-9][a-z0-9.-]{0,99}\.(png|jpg|webp|svg)$/);

/**
 * Validation messages for the admin interface. Paths and messages only (never values); the name
 * of the server variable holding the Dify key is not shown either.
 */
function adminMessages(errors: readonly string[]): string[] {
  return errors.map((error) =>
    /environment variable \S+ is not set/.test(error)
      ? 'server: the Dify connection of this tenant is not configured'
      : error,
  );
}

/** 409 with what the editor needs to explain the conflict (who saved, when). */
function conflict(reply: FastifyReply, draft: Draft | undefined, publishedVersion: number) {
  return adminError(reply, 'draft_conflict', {
    publishedVersion,
    draft: draft
      ? { revision: draft.revision, updatedAt: draft.updatedAt, updatedBy: draft.updatedBy }
      : null,
  });
}

export function adminConfigRoutes(
  app: FastifyInstance,
  options: AdminApiOptions & {
    preview?: PreviewService;
    /** Redis: installation records ("Verifică instalarea"). */
    store?: KeyValueStore;
    /** Published tenants (with their Dify connection), for the assistant's own defaults. */
    tenants?: TenantRegistry;
  },
): void {
  const store = new AdminConfigStore(options.db);
  const assets = new PgAssetSource(options.db);
  const audit = new AuditRecorder(options.db, app.log);

  /**
   * A refused request in the audit log (B9): in the client's chain, and in the requester's own
   * chain when it differs (a super-admin's platform, or another client trying to reach this one).
   */
  const denied = (
    request: FastifyRequest,
    tenant: string,
    action: string,
    reason: string,
    extra: { section?: string; sensitive?: boolean; details?: Record<string, unknown> } = {},
  ) =>
    audit.recordIn([tenant, chainOf(sessionOf(request).identity.tenant)], {
      tenant,
      ...auditWhoOf(request),
      action,
      result: 'denied',
      reason,
      ...extra,
    });

  const validate = async (tenant: string, config: unknown): Promise<string[]> => {
    const result = await validateTenantObject(config, {
      env: options.tenantEnv,
      fileName: `${tenant} (draft)`,
      expectedId: tenant,
      assets,
    });
    return adminMessages(result.errors);
  };

  /** Parses `:tenant`, checks the role on the server, and loads the published version. */
  async function tenantFor(
    request: FastifyRequest,
    reply: FastifyReply,
    action: 'read' | 'edit' | 'publish' | 'assets',
  ) {
    const params = tenantParams.safeParse(request.params);
    if (!params.success) {
      void adminError(reply, 'not_found');
      return undefined;
    }
    const { tenant } = params.data;
    if (!can(sessionOf(request).identity, tenant, action)) {
      // Recorded in the requester's chain, and in the target's when that client exists.
      const known = options.tenants?.has(tenant) ?? false;
      await audit.recordIn(
        [chainOf(sessionOf(request).identity.tenant), ...(known ? [tenant] : [])],
        {
          tenant,
          ...auditWhoOf(request),
          action: 'access.denied',
          result: 'denied',
          reason: 'forbidden',
          details: {
            method: request.method,
            route: request.routeOptions.url ?? request.url,
            needed: action,
          },
        },
      );
      void adminError(reply, 'forbidden');
      return undefined;
    }
    const published = await store.published(tenant);
    if (!published) {
      void adminError(reply, 'not_found');
      return undefined;
    }
    return { tenant, published };
  }

  app.get('/api/tenants/:tenant/config', async (request, reply) => {
    const found = await tenantFor(request, reply, 'read');
    if (!found) return reply;
    const { tenant, published } = found;
    const draft = await store.draft(tenant);
    const identity = sessionOf(request).identity;
    return {
      tenant,
      published: {
        version: published.version,
        createdAt: published.createdAt,
        createdBy: published.createdBy,
        config: editableView(published.config),
      },
      draft: draft
        ? {
            revision: draft.revision,
            baseVersion: draft.baseVersion,
            updatedAt: draft.updatedAt,
            updatedBy: draft.updatedBy,
            config: editableView(draft.config),
          }
        : null,
      errors: await validate(tenant, draft?.config ?? published.config),
      permissions: {
        publish: can(identity, tenant, 'publish'),
        assets: can(identity, tenant, 'assets'),
        origins: can(identity, tenant, 'origins'),
        name: can(identity, tenant, 'name'),
        retention: can(identity, tenant, 'retention'),
      },
    };
  });

  // Autosave (spec §5.3): a draft may be invalid; the public widget never sees it.
  app.put('/api/tenants/:tenant/config/draft', async (request, reply) => {
    const found = await tenantFor(request, reply, 'edit');
    if (!found) return reply;
    const body = draftBody.safeParse(request.body);
    if (!body.success) return adminError(reply, 'invalid_request');
    const { tenant, published } = found;
    const identity = sessionOf(request).identity;

    const current = await store.draft(tenant);
    // Never overwrite work saved by someone else in the meantime (optimistic concurrency).
    if (
      body.data.baseVersion !== published.version ||
      (current?.revision ?? null) !== body.data.draftRevision
    ) {
      await denied(request, tenant, 'draft.save', 'draft_conflict');
      return conflict(reply, current, published.version);
    }
    const previous = current?.config ?? published.config;
    const config = mergeServerFields(body.data.config, published.config);
    // Allowed origins: widget-admin and super-admin only (spec §5.1).
    if (
      JSON.stringify(originsOf(config)) !== JSON.stringify(originsOf(previous)) &&
      !can(identity, tenant, 'origins')
    ) {
      await denied(request, tenant, 'draft.save', 'forbidden', {
        section: 'allowedOrigins',
        sensitive: true,
      });
      return adminError(reply, 'forbidden');
    }
    // The client's name: super-admin only.
    // The audit log's retention: super-admin only (a compliance setting).
    if (
      JSON.stringify(auditSettingsOf(config)) !== JSON.stringify(auditSettingsOf(previous)) &&
      !can(identity, tenant, 'retention')
    ) {
      await denied(request, tenant, 'draft.save', 'forbidden', {
        section: 'audit',
        sensitive: true,
      });
      return adminError(reply, 'forbidden');
    }
    if (nameOf(config) !== nameOf(previous) && !can(identity, tenant, 'name')) {
      await denied(request, tenant, 'draft.save', 'forbidden', { section: 'name' });
      return adminError(reply, 'forbidden');
    }
    const changes = diff(editableView(previous), editableView(config));
    try {
      const saved = await store.saveDraft(
        tenant,
        config,
        body.data.baseVersion,
        body.data.draftRevision,
        auditWhoOf(request),
        changes,
      );
      return { ...saved, errors: await validate(tenant, config) };
    } catch (error) {
      if (!(error instanceof DraftConflictError)) throw error;
      await denied(request, tenant, 'draft.save', 'draft_conflict');
      return conflict(reply, await store.draft(tenant), published.version);
    }
  });

  app.delete('/api/tenants/:tenant/config/draft', async (request, reply) => {
    const found = await tenantFor(request, reply, 'edit');
    if (!found) return reply;
    await store.discardDraft(found.tenant, auditWhoOf(request));
    return reply.code(204).send();
  });

  // Publishing (spec §5.3): widget-admin only, and only a fully valid configuration (schema,
  // contrast AA, images present). Every replica reloads through NOTIFY, without a restart.
  app.post('/api/tenants/:tenant/config/publish', async (request, reply) => {
    const found = await tenantFor(request, reply, 'publish');
    if (!found) return reply;
    const body = publishBody.safeParse(request.body);
    if (!body.success) return adminError(reply, 'invalid_request');
    const { tenant, published } = found;
    const draft = await store.draft(tenant);
    if (!draft) {
      await denied(request, tenant, 'publish', 'no_draft');
      return adminError(reply, 'no_draft');
    }
    if (body.data?.draftRevision !== undefined && body.data.draftRevision !== draft.revision) {
      await denied(request, tenant, 'publish', 'draft_conflict');
      return conflict(reply, draft, published.version);
    }

    const config: ConfigObject = mergeServerFields(editableView(draft.config), published.config);
    const errors = await validate(tenant, config);
    if (errors.length > 0) {
      await denied(request, tenant, 'publish', 'invalid', { details: { errors: errors.length } });
      return adminError(reply, 'invalid_config', { errors });
    }

    const changes = diff(editableView(published.config), editableView(config));
    try {
      const version = await store.publish(tenant, config, auditWhoOf(request), {
        ...(body.data?.comment ? { comment: body.data.comment } : {}),
        changes,
        originsChanged: changes.some((change) => change.path === 'allowedOrigins'),
      });
      return { version };
    } catch (error) {
      if (error instanceof PublishConflictError) {
        await denied(request, tenant, 'publish', 'draft_conflict');
        return adminError(reply, 'conflict');
      }
      throw error;
    }
  });

  // The assistant's own welcome message and starter questions (Dify `/parameters`), shown as
  // suggestions when the tenant has not written its own (E4b.1 UX).
  app.get('/api/tenants/:tenant/assistant-defaults', async (request, reply) => {
    const found = await tenantFor(request, reply, 'read');
    if (!found) return reply;
    const runtime = options.tenants?.get(found.tenant);
    const result = runtime ? await getParameters(runtime) : undefined;
    if (!result?.ok) return { welcome: '', suggestedQuestions: [], available: false };
    return {
      welcome: result.value.opening_statement?.trim() ?? '',
      suggestedQuestions: (result.value.suggested_questions ?? [])
        .map((question) => question.trim())
        .filter((question) => question !== '')
        .slice(0, 5),
      available: true,
    };
  });

  // "Verifică instalarea": when loader.js last loaded on each allowed site.
  app.get('/api/tenants/:tenant/installations', async (request, reply) => {
    const found = await tenantFor(request, reply, 'read');
    if (!found) return reply;
    const origins = originsOf(found.published.config);
    const list = Array.isArray(origins)
      ? origins.filter((origin): origin is string => typeof origin === 'string')
      : [];
    return {
      installations: options.store ? await installations(options.store, found.tenant, list) : [],
    };
  });

  // Citations: the file names the assistant cited recently, offered when mapping titles.
  app.get('/api/tenants/:tenant/cited-documents', async (request, reply) => {
    const found = await tenantFor(request, reply, 'read');
    if (!found) return reply;
    return { documents: options.store ? await citedDocuments(options.store, found.tenant) : [] };
  });

  // The audit log (E5 B9): widget-admin sees their organisation, super-admin every client and the
  // platform chain, editors nothing. Reading it and exporting it are recorded too (K7).
  const auditQuery = auditFilterSchema.extend({
    chain: z
      .string()
      .regex(/^[a-z0-9-]{1,64}$/)
      .optional(),
    before: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    opened: z.literal('1').optional(),
    format: z.enum(['csv', 'json']).default('json'),
  });

  async function auditChainFor(
    request: FastifyRequest,
    reply: FastifyReply,
    requested: string | undefined,
  ): Promise<string | undefined> {
    const { identity } = sessionOf(request);
    const own = chainOf(identity.tenant);
    const chain = requested ?? own;
    const allowed =
      identity.role === 'super-admin'
        ? chain === PLATFORM_CHAIN || (options.tenants?.has(chain) ?? false)
        : identity.role === 'widget-admin' && chain === identity.tenant;
    if (allowed) return chain;
    if (identity.role === 'super-admin') {
      void adminError(reply, 'not_found');
      return undefined;
    }
    await audit.recordIn([own, ...(options.tenants?.has(chain) ? [chain] : [])], {
      tenant: chain,
      ...auditWhoOf(request),
      action: 'access.denied',
      section: 'audit',
      result: 'denied',
      reason: 'forbidden',
      details: {
        method: request.method,
        route: request.routeOptions.url ?? request.url,
        needed: 'audit',
      },
    });
    void adminError(reply, 'forbidden');
    return undefined;
  }

  /** Only the filter fields, without the empty ones. */
  const filtersOf = (query: z.infer<typeof auditQuery>): AuditFilters =>
    Object.fromEntries(
      Object.keys(auditFilterSchema.shape)
        .map((key) => [key, query[key as keyof AuditFilters]] as const)
        .filter(([, value]) => value !== undefined && value !== ''),
    );

  app.get('/api/audit', async (request, reply) => {
    const query = auditQuery.safeParse(request.query);
    if (!query.success) return adminError(reply, 'invalid_request');
    const chain = await auditChainFor(request, reply, query.data.chain);
    if (!chain) return reply;
    const filters = filtersOf(query.data);
    if (query.data.opened) {
      // One record per opening of the screen, with its filters (not per filter change).
      await audit.record({
        chain,
        tenant: chain === PLATFORM_CHAIN ? '*' : chain,
        ...auditWhoOf(request),
        action: 'audit.view',
        section: 'audit',
        result: 'success',
        details: { filters },
      });
    }
    const page = await listAudit(options.db, chain, filters, {
      before: query.data.before,
      limit: query.data.limit,
    });
    return { chain, ...page };
  });

  app.get('/api/audit/export', async (request, reply) => {
    const query = auditQuery.safeParse(request.query);
    if (!query.success) return adminError(reply, 'invalid_request');
    const chain = await auditChainFor(request, reply, query.data.chain);
    if (!chain) return reply;
    const filters = filtersOf(query.data);
    const events = await exportAudit(options.db, chain, filters, EXPORT_LIMIT);
    const session = sessionOf(request);
    const header = exportHeader(
      {
        name: session.identity.name,
        email: session.identity.email,
        role: session.identity.role,
        org: session.org,
      },
      chain,
      filters,
      events,
    );
    // The export is recorded before it is sent (an auditor sees who took a copy, and of what).
    await audit.record({
      chain,
      tenant: chain === PLATFORM_CHAIN ? '*' : chain,
      ...auditWhoOf(request),
      action: 'audit.export',
      section: 'audit',
      result: 'success',
      details: {
        format: query.data.format,
        filters,
        count: events.length,
        firstSeq: events[0]?.seq ?? null,
        lastSeq: events.at(-1)?.seq ?? null,
      },
    });
    const stamp = header.generatedAt.slice(0, 19).replace(/[:T]/g, '-');
    const name = `jurnal-audit-${chain}-${stamp}.${query.data.format}`;
    void reply
      .header('content-disposition', `attachment; filename="${name}"`)
      .header('cache-control', 'no-store');
    if (query.data.format === 'csv') {
      return reply.type('text/csv; charset=utf-8').send(toCsv(header, events));
    }
    return reply
      .type('application/json; charset=utf-8')
      .send(JSON.stringify({ header, events: events.map(hashedView) }, null, 2));
  });

  // Preview (spec §5.2): a 10-minute token bound to this admin session and tenant.
  app.post('/api/tenants/:tenant/preview-token', async (request, reply) => {
    const found = await tenantFor(request, reply, 'edit');
    if (!found) return reply;
    if (!options.preview) return adminError(reply, 'not_found');
    const created = await options.preview.create(found.tenant, sessionIdOf(request));
    return { ...created, url: `/admin/preview?id=${created.id}` };
  });

  // Images (spec §5.4): the raw file as the body; the real type is read from the bytes.
  app.addContentTypeParser(
    ['application/octet-stream', 'image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'],
    { parseAs: 'buffer', bodyLimit: IMAGE_LIMITS.maxUploadBytes + 1 },
    (_request, body, done) => {
      done(null, body);
    },
  );
  app.post(
    '/api/tenants/:tenant/assets',
    { bodyLimit: IMAGE_LIMITS.maxUploadBytes + 1 },
    async (request, reply) => {
      const found = await tenantFor(request, reply, 'assets');
      if (!found) return reply;
      const query = assetQuery.safeParse(request.query);
      if (!query.success) return adminError(reply, 'invalid_request');
      // Text and JSON bodies are parsed as such: not an image.
      if (!Buffer.isBuffer(request.body)) return adminError(reply, 'unsupported_type');
      const result = await processImage(request.body, query.data.name);
      if (!result.ok) {
        await denied(request, found.tenant, 'asset.upload', 'invalid', {
          section: 'assets',
          details: { error: result.error },
        });
        return adminError(reply, result.error);
      }
      const { image } = result;
      await store.saveAsset(found.tenant, image, auditWhoOf(request));
      return reply.code(201).send({
        file: image.name,
        url: `/admin/api/tenants/${found.tenant}/assets/${image.name}`,
        width: image.width,
        height: image.height,
        bytes: image.bytes.length,
      });
    },
  );

  // Thumbnails in the admin interface (images of a draft are not public until published).
  app.get('/api/tenants/:tenant/assets/:name', async (request, reply) => {
    const found = await tenantFor(request, reply, 'read');
    if (!found) return reply;
    const name = assetName.safeParse((request.params as { name?: unknown }).name);
    const stored = name.success ? await assets.getWithType(found.tenant, name.data) : undefined;
    if (!stored) return adminError(reply, 'not_found');
    return reply
      .type(stored.contentType)
      .header('content-security-policy', "default-src 'none'; sandbox")
      .send(stored.bytes);
  });
}
