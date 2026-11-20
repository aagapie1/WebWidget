import type pg from 'pg';
import { appendAudit, PLATFORM_CHAIN } from './log.js';

/** The shortest retention allowed, whatever a configuration says (D12: 6–60 months). */
export const MIN_RETENTION_MONTHS = 6;
export const DEFAULT_RETENTION_MONTHS = 12;

export interface PurgeResult {
  chain: string;
  retentionMonths: number;
  cutoff: string;
  deleted: number;
  lastDeletedSeq?: number;
}

const monthsBefore = (now: Date, months: number): Date => {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return cutoff;
};

/**
 * Deletes the audit records older than each chain's retention (E5 B9, D12/K3), with the cleanup
 * role (never the application's). Only the oldest part of a chain goes (a prefix by sequence
 * number), and in the same transaction a `retention.purge` event records how many and the hash of
 * the last deleted record: the chain stays verifiable from that anchor. Each client's period is
 * its published `audit.retentionMonths`; the platform chain's is `platformMonths`.
 */
export async function purgeAuditLog(
  pool: pg.Pool,
  options: { now?: Date; platformMonths?: number; dryRun?: boolean } = {},
): Promise<PurgeResult[]> {
  const now = options.now ?? new Date();
  const chains = (
    await pool.query<{ chain: string }>('SELECT DISTINCT chain FROM audit_log ORDER BY chain')
  ).rows.map((row) => row.chain);
  const results: PurgeResult[] = [];
  for (const chain of chains) {
    const configured =
      chain === PLATFORM_CHAIN
        ? (options.platformMonths ?? DEFAULT_RETENTION_MONTHS)
        : Number(
            (
              await pool.query<{ months: string | null }>(
                `SELECT config->'audit'->>'retentionMonths' AS months FROM tenant_config_versions
                  WHERE tenant_id = $1 ORDER BY version DESC LIMIT 1`,
                [chain],
              )
            ).rows[0]?.months ?? DEFAULT_RETENTION_MONTHS,
          );
    const retentionMonths = Math.max(MIN_RETENTION_MONTHS, configured || DEFAULT_RETENTION_MONTHS);
    const cutoff = monthsBefore(now, retentionMonths);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('audit:' || $1, 0))`, [
        chain,
      ]);
      // A prefix: up to the first record that is still within the period. (Imported Keycloak
      // events keep their own time, so times are not always in sequence order.)
      const bounds = (
        await client.query<{ first_kept: string | null; last: string | null }>(
          `SELECT min(seq) FILTER (WHERE at >= $2) AS first_kept, max(seq) AS last
             FROM audit_log WHERE chain = $1 AND seq IS NOT NULL`,
          [chain, cutoff],
        )
      ).rows[0];
      const last = bounds?.last === null || bounds?.last === undefined ? 0 : Number(bounds.last);
      const lastDeleted =
        bounds?.first_kept === null || bounds?.first_kept === undefined
          ? last
          : Number(bounds.first_kept) - 1;
      const doomed = (
        await client.query<{ count: string; first: string | null; hash: string | null }>(
          `SELECT count(*) AS count, min(seq) AS first,
                  (SELECT hash FROM audit_log WHERE chain = $1 AND seq = $2) AS hash
             FROM audit_log WHERE chain = $1 AND seq IS NOT NULL AND seq <= $2`,
          [chain, lastDeleted],
        )
      ).rows[0];
      const deleted = Number(doomed?.count ?? 0);
      // Records from before the chain existed (development databases only) go by date alone.
      const legacy = (
        await client.query<{ count: string }>(
          'SELECT count(*) AS count FROM audit_log WHERE chain = $1 AND seq IS NULL AND at < $2',
          [chain, cutoff],
        )
      ).rows[0];
      const legacyCount = Number(legacy?.count ?? 0);
      if (deleted + legacyCount === 0 || options.dryRun) {
        await client.query('ROLLBACK');
        results.push({
          chain,
          retentionMonths,
          cutoff: cutoff.toISOString(),
          deleted: deleted + legacyCount,
        });
        continue;
      }
      await client.query(
        'DELETE FROM audit_log WHERE chain = $1 AND ((seq IS NOT NULL AND seq <= $2) OR (seq IS NULL AND at < $3))',
        [chain, lastDeleted, cutoff],
      );
      if (deleted > 0) {
        await appendAudit(client, {
          chain,
          tenant: chain === PLATFORM_CHAIN ? '*' : chain,
          actor: { kind: 'system', issuer: 'system', subject: 'audit-retention' },
          action: 'retention.purge',
          result: 'success',
          source: 'system',
          details: {
            retentionMonths,
            cutoff: cutoff.toISOString(),
            deleted,
            firstDeletedSeq: Number(doomed?.first ?? 0),
            lastDeletedSeq: lastDeleted,
            lastDeletedHash: doomed?.hash ?? '',
          },
        });
      }
      await client.query('COMMIT');
      results.push({
        chain,
        retentionMonths,
        cutoff: cutoff.toISOString(),
        deleted: deleted + legacyCount,
        ...(deleted > 0 ? { lastDeletedSeq: lastDeleted } : {}),
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  return results;
}
