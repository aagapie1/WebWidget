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
import { diff, editableView, mergeServerFields, originsOf, type ConfigObject } from './editable.js';
import { can } from './identity.js';
import { IMAGE_LIMITS, processImage } from './images.js';
import type { PreviewService } from './preview.js';
import { adminError, authorize, sessionIdOf, sessionOf } from './guard.js';

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
  options: AdminApiOptions & { preview?: PreviewService },
): void {
  const store = new AdminConfigStore(options.db);
  const assets = new PgAssetSource(options.db);

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
    if (!authorize(request, reply, tenant, action)) return undefined;
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
      return conflict(reply, current, published.version);
    }
    const previous = current?.config ?? published.config;
    const config = mergeServerFields(body.data.config, published.config);
    // Allowed origins: widget-admin and super-admin only (spec §5.1).
    if (
      JSON.stringify(originsOf(config)) !== JSON.stringify(originsOf(previous)) &&
      !can(identity, tenant, 'origins')
    ) {
      return adminError(reply, 'forbidden');
    }
    const changes = diff(editableView(previous), editableView(config));
    try {
      const saved = await store.saveDraft(
        tenant,
        config,
        body.data.baseVersion,
        body.data.draftRevision,
        identity,
        changes,
      );
      return { ...saved, errors: await validate(tenant, config) };
    } catch (error) {
      if (!(error instanceof DraftConflictError)) throw error;
      return conflict(reply, await store.draft(tenant), published.version);
    }
  });

  app.delete('/api/tenants/:tenant/config/draft', async (request, reply) => {
    const found = await tenantFor(request, reply, 'edit');
    if (!found) return reply;
    await store.discardDraft(found.tenant, sessionOf(request).identity);
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
    if (!draft) return adminError(reply, 'no_draft');
    if (body.data?.draftRevision !== undefined && body.data.draftRevision !== draft.revision) {
      return conflict(reply, draft, published.version);
    }

    const config: ConfigObject = mergeServerFields(editableView(draft.config), published.config);
    const errors = await validate(tenant, config);
    if (errors.length > 0) return adminError(reply, 'invalid_config', { errors });

    const changes = diff(editableView(published.config), editableView(config));
    try {
      const version = await store.publish(tenant, config, sessionOf(request).identity, {
        ...(body.data?.comment ? { comment: body.data.comment } : {}),
        changes,
        originsChanged: changes.some((change) => change.path === 'allowedOrigins'),
      });
      return { version };
    } catch (error) {
      if (error instanceof PublishConflictError) return adminError(reply, 'conflict');
      throw error;
    }
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
      if (!result.ok) return adminError(reply, result.error);
      const { image } = result;
      await store.saveAsset(found.tenant, image, sessionOf(request).identity);
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
