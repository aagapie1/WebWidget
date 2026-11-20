import type pg from 'pg';
import { CONFIG_CHANNEL } from '../db/postgres-source.js';
import type { Change } from './editable.js';
import { appendAudit, type AuditActor, type AuditContext } from '../audit/log.js';
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
  'draft.save' | 'draft.discard' | 'publish' | 'origins.change' | 'asset.upload' | 'asset.delete';

/** An uploaded image and where it is used (E5 K6: only an unused image may be deleted). */
export interface StoredAsset {
  name: string;
  contentType: string;
  bytes: number;
  createdAt: string;
  createdBy: string;
  /** Published versions whose configuration names the image (newest first). */
  versions: number[];
  /** The current draft names it. */
  draft: boolean;
}

export type DeleteAssetResult =
  | { kind: 'deleted' }
  | { kind: 'not_found' }
  | { kind: 'in_use'; versions: number[]; draft: boolean };

const USAGE = `
  ARRAY(SELECT v.version FROM tenant_config_versions v
         WHERE v.tenant_id = a.tenant_id AND v.config::text LIKE '%"' || a.name || '"%'
         ORDER BY v.version DESC) AS versions,
  EXISTS(SELECT 1 FROM tenant_config_drafts d
          WHERE d.tenant_id = a.tenant_id AND d.config::text LIKE '%"' || a.name || '"%') AS draft`;

interface AssetRow {
  name: string;
  content_type: string;
  size: number;
  created_at: Date;
  created_by: string;
  versions: number[];
  draft: boolean;
}

/** Who changes the configuration, and from where (E5 B9): written to the audit chain. */
export interface AuditWho {
  actor: AuditActor;
  context: AuditContext;
}

const nameOf = (who: AuditWho): string => who.actor.name ?? who.actor.subject;

/** The sections a set of changes touches ("theme, launcher"), for the audit log's filters. */
export function sectionsOf(changes: readonly Change[]): string | undefined {
  const sections = [...new Set(changes.map((change) => change.path.split('.')[0] ?? change.path))];
  return sections.length > 0 ? sections.sort().join(', ') : undefined;
}

const touchesOrigins = (changes: readonly Change[]): boolean =>
  changes.some(
    (change) => change.path === 'allowedOrigins' || change.path.startsWith('allowedOrigins.'),
  );

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
    who: AuditWho,
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
              [tenant, JSON.stringify(config), baseVersion, nameOf(who)],
            )
          : await client.query<{ updated_at: Date; revision: number }>(
              `UPDATE tenant_config_drafts
                  SET config = $2, base_version = $3, updated_at = now(), updated_by = $4,
                      revision = revision + 1
                WHERE tenant_id = $1 AND revision = $5
                RETURNING updated_at, revision`,
              [tenant, JSON.stringify(config), baseVersion, nameOf(who), expectedRevision],
            );
      const row = result.rows[0];
      if (!row) throw new DraftConflictError();
      await audit(client, tenant, who, 'draft.save', {
        section: sectionsOf(changes),
        sensitive: touchesOrigins(changes),
        details: { baseVersion, revision: row.revision, changes },
      });
      return { savedAt: row.updated_at.toISOString(), revision: row.revision };
    });
  }

  async discardDraft(tenant: string, who: AuditWho): Promise<boolean> {
    return this.#transaction(async (client) => {
      const result = await client.query('DELETE FROM tenant_config_drafts WHERE tenant_id = $1', [
        tenant,
      ]);
      if (result.rowCount) await audit(client, tenant, who, 'draft.discard', {});
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
    who: AuditWho,
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
          [tenant, version, JSON.stringify(config), nameOf(who), details.comment ?? null],
        );
      } catch (error) {
        if ((error as { code?: string }).code === '23505') throw new PublishConflictError();
        throw error;
      }
      await client.query('DELETE FROM tenant_config_drafts WHERE tenant_id = $1', [tenant]);
      await audit(client, tenant, who, 'publish', {
        section: sectionsOf(details.changes),
        version,
        sensitive: details.originsChanged,
        details: {
          ...(details.comment ? { comment: details.comment } : {}),
          changes: details.changes,
        },
      });
      if (details.originsChanged) {
        // Allowed domains decide where the assistant runs: their own, sensitive record.
        await audit(client, tenant, who, 'origins.change', {
          section: 'allowedOrigins',
          version,
          sensitive: true,
          details: {
            changes: details.changes.filter(
              (change) =>
                change.path === 'allowedOrigins' || change.path.startsWith('allowedOrigins.'),
            ),
          },
        });
      }
      await client.query('SELECT pg_notify($1, $2)', [CONFIG_CHANNEL, tenant]);
      return version;
    });
  }

  /** Stores a re-encoded image; names are content-addressed, so a re-upload is a no-op. */
  async saveAsset(tenant: string, image: ProcessedImage, who: AuditWho): Promise<void> {
    await this.#transaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO tenant_assets (tenant_id, name, hash, content_type, bytes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [tenant, image.name, image.hash, image.contentType, image.bytes, nameOf(who)],
      );
      if (inserted.rowCount) {
        await audit(client, tenant, who, 'asset.upload', {
          section: 'assets',
          details: {
            name: image.name,
            contentType: image.contentType,
            bytes: image.bytes.length,
            width: image.width,
            height: image.height,
          },
        });
      }
    });
  }

  async listAssets(tenant: string): Promise<StoredAsset[]> {
    const rows = await this.pool.query<AssetRow>(
      `SELECT a.name, a.content_type, octet_length(a.bytes) AS size, a.created_at, a.created_by,${USAGE}
         FROM tenant_assets a WHERE a.tenant_id = $1 ORDER BY a.created_at DESC, a.name`,
      [tenant],
    );
    return rows.rows.map((row) => ({
      name: row.name,
      contentType: row.content_type,
      bytes: row.size,
      createdAt: row.created_at.toISOString(),
      createdBy: row.created_by,
      versions: row.versions,
      draft: row.draft,
    }));
  }

  /**
   * Deletes an image no published version and no draft uses (E5 K6), recorded in the same
   * transaction, under the publish lock. An editor still showing the image may save it into a
   * draft afterwards: publishing then refuses the draft (validation reports the missing image).
   */
  async deleteAsset(tenant: string, name: string, who: AuditWho): Promise<DeleteAssetResult> {
    return this.#transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`publish:${tenant}`]);
      await client.query('SELECT 1 FROM tenant_config_drafts WHERE tenant_id = $1 FOR UPDATE', [
        tenant,
      ]);
      const found = await client.query<AssetRow & { hash: string }>(
        `SELECT a.name, a.hash, a.content_type, octet_length(a.bytes) AS size, a.created_at,
                a.created_by,${USAGE}
           FROM tenant_assets a WHERE a.tenant_id = $1 AND a.name = $2 FOR UPDATE`,
        [tenant, name],
      );
      const row = found.rows[0];
      if (!row) return { kind: 'not_found' };
      if (row.versions.length > 0 || row.draft) {
        return { kind: 'in_use', versions: row.versions, draft: row.draft };
      }
      await client.query('DELETE FROM tenant_assets WHERE tenant_id = $1 AND name = $2', [
        tenant,
        name,
      ]);
      await audit(client, tenant, who, 'asset.delete', {
        section: 'assets',
        details: {
          name,
          hash: row.hash,
          contentType: row.content_type,
          bytes: row.size,
          uploadedAt: row.created_at.toISOString(),
          uploadedBy: row.created_by,
        },
      });
      return { kind: 'deleted' };
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

/** A successful configuration change, in the client's chain, in the same transaction (B9). */
async function audit(
  client: pg.PoolClient,
  tenant: string,
  who: AuditWho,
  action: AuditAction,
  event: {
    section?: string | undefined;
    version?: number | undefined;
    sensitive?: boolean | undefined;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await appendAudit(client, {
    chain: tenant,
    tenant,
    actor: who.actor,
    context: who.context,
    action,
    result: 'success',
    ...event,
  });
}
