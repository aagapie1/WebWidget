import type pg from 'pg';
import { CONFIG_CHANNEL } from '../db/postgres-source.js';
import type { Change } from './editable.js';
import type { AdminIdentity } from './identity.js';
import type { ProcessedImage } from './images.js';

export interface PublishedVersion {
  version: number;
  config: unknown;
  createdAt: string;
  createdBy: string;
}

export interface Draft {
  config: unknown;
  /** Increases with every save (optimistic concurrency). */
  revision: number;
  baseVersion: number | null;
  updatedAt: string;
  updatedBy: string;
}

export type AuditAction =
  'draft.save' | 'draft.discard' | 'publish' | 'origins.change' | 'asset.upload';

export class PublishConflictError extends Error {}
export class DraftConflictError extends Error {}

/**
 * Admin storage (ADR 008) with the application role: versions are INSERT-only, the audit log is
 * append-only (enforced by Postgres grants), drafts are mutable.
 */
export class AdminConfigStore {
  constructor(private readonly pool: pg.Pool) {}

  async published(tenant: string): Promise<PublishedVersion | undefined> {
    const result = await this.pool.query<{
      version: number;
      config: unknown;
      created_at: Date;
      created_by: string;
    }>(
      `SELECT version, config, created_at, created_by FROM tenant_config_versions
        WHERE tenant_id = $1 ORDER BY version DESC LIMIT 1`,
      [tenant],
    );
    const row = result.rows[0];
    return row
      ? {
          version: row.version,
          config: row.config,
          createdAt: row.created_at.toISOString(),
          createdBy: row.created_by,
        }
      : undefined;
  }

  async draft(tenant: string): Promise<Draft | undefined> {
    const result = await this.pool.query<{
      config: unknown;
      revision: number;
      base_version: number | null;
      updated_at: Date;
      updated_by: string;
    }>(
      'SELECT config, revision, base_version, updated_at, updated_by FROM tenant_config_drafts WHERE tenant_id = $1',
      [tenant],
    );
    const row = result.rows[0];
    return row
      ? {
          config: row.config,
          revision: row.revision,
          baseVersion: row.base_version,
          updatedAt: row.updated_at.toISOString(),
          updatedBy: row.updated_by,
        }
      : undefined;
  }

  /**
   * Saves the draft only if it is still at `expectedRevision` (`null`: no draft yet). Throws
   * DraftConflictError when someone else saved, published or discarded in between.
   */
  async saveDraft(
    tenant: string,
    config: unknown,
    baseVersion: number,
    expectedRevision: number | null,
    actor: AdminIdentity,
    changes: Change[],
  ): Promise<{ savedAt: string; revision: number }> {
    return this.#transaction(async (client) => {
      const result =
        expectedRevision === null
          ? await client.query<{ updated_at: Date; revision: number }>(
              `INSERT INTO tenant_config_drafts (tenant_id, config, base_version, updated_at, updated_by)
               VALUES ($1, $2, $3, now(), $4)
               ON CONFLICT (tenant_id) DO NOTHING
               RETURNING updated_at, revision`,
              [tenant, JSON.stringify(config), baseVersion, actor.name],
            )
          : await client.query<{ updated_at: Date; revision: number }>(
              `UPDATE tenant_config_drafts
                  SET config = $2, base_version = $3, updated_at = now(), updated_by = $4,
                      revision = revision + 1
                WHERE tenant_id = $1 AND revision = $5
                RETURNING updated_at, revision`,
              [tenant, JSON.stringify(config), baseVersion, actor.name, expectedRevision],
            );
      const row = result.rows[0];
      if (!row) throw new DraftConflictError();
      await audit(client, tenant, actor, 'draft.save', {
        baseVersion,
        revision: row.revision,
        changes,
      });
      return { savedAt: row.updated_at.toISOString(), revision: row.revision };
    });
  }

  async discardDraft(tenant: string, actor: AdminIdentity): Promise<boolean> {
    return this.#transaction(async (client) => {
      const result = await client.query('DELETE FROM tenant_config_drafts WHERE tenant_id = $1', [
        tenant,
      ]);
      if (result.rowCount) await audit(client, tenant, actor, 'draft.discard', {});
      return Boolean(result.rowCount);
    });
  }

  /**
   * Publishes a new immutable version (latest + 1), removes the draft, records the audit rows and
   * notifies every gateway replica (LISTEN tenant_config). Concurrent publishes of one tenant are
   * serialised with a transaction-level advisory lock.
   */
  async publish(
    tenant: string,
    config: unknown,
    actor: AdminIdentity,
    details: { comment?: string; changes: Change[]; originsChanged: boolean },
  ): Promise<number> {
    return this.#transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`publish:${tenant}`]);
      const latest = await client.query<{ version: number | null }>(
        'SELECT max(version) AS version FROM tenant_config_versions WHERE tenant_id = $1',
        [tenant],
      );
      const version = (latest.rows[0]?.version ?? 0) + 1;
      try {
        await client.query(
          `INSERT INTO tenant_config_versions (tenant_id, version, config, created_by, comment)
           VALUES ($1, $2, $3, $4, $5)`,
          [tenant, version, JSON.stringify(config), actor.name, details.comment ?? null],
        );
      } catch (error) {
        if ((error as { code?: string }).code === '23505') throw new PublishConflictError();
        throw error;
      }
      await client.query('DELETE FROM tenant_config_drafts WHERE tenant_id = $1', [tenant]);
      await audit(client, tenant, actor, 'publish', {
        version,
        ...(details.comment ? { comment: details.comment } : {}),
        changes: details.changes,
      });
      if (details.originsChanged) {
        await audit(client, tenant, actor, 'origins.change', {
          version,
          changes: details.changes.filter((change) => change.path === 'allowedOrigins'),
        });
      }
      await client.query('SELECT pg_notify($1, $2)', [CONFIG_CHANNEL, tenant]);
      return version;
    });
  }

  /** Stores a re-encoded image; names are content-addressed, so a re-upload is a no-op. */
  async saveAsset(tenant: string, image: ProcessedImage, actor: AdminIdentity): Promise<void> {
    await this.#transaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO tenant_assets (tenant_id, name, hash, content_type, bytes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [tenant, image.name, image.hash, image.contentType, image.bytes, actor.name],
      );
      if (inserted.rowCount) {
        await audit(client, tenant, actor, 'asset.upload', {
          name: image.name,
          contentType: image.contentType,
          bytes: image.bytes.length,
          width: image.width,
          height: image.height,
        });
      }
    });
  }

  async #transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function audit(
  client: pg.PoolClient,
  tenant: string,
  actor: AdminIdentity,
  action: AuditAction,
  details: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log (tenant_id, actor_issuer, actor_subject, actor_name, action, details)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tenant, actor.issuer, actor.subject, actor.name, action, JSON.stringify(details)],
  );
}
