import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type pg from 'pg';
import { canonicalJson } from './chain.js';
import { PLATFORM_CHAIN, recordAudit } from './log.js';

/**
 * Daily anchors of the audit log (E5 B9, K2/K3): the last hash of every chain, written outside the
 * database as a file signed with Ed25519, next to the backup (it leaves the server with restic).
 * Someone with database access could recompute a whole chain after rewriting it; they could not
 * produce anchors that match it: the signing key is not on the database server's disk, and the
 * anchors already copied off-site keep the old heads.
 */
export interface AnchorHead {
  chain: string;
  seq: number;
  hash: string;
  at: string;
}

export interface Anchor {
  version: 1;
  createdAt: string;
  chains: AnchorHead[];
}

export async function chainHeads(pool: pg.Pool): Promise<AnchorHead[]> {
  const rows = await pool.query<{ chain: string; seq: string; hash: string; at: Date }>(
    `SELECT DISTINCT ON (chain) chain, seq, hash, at FROM audit_log
      WHERE seq IS NOT NULL ORDER BY chain, seq DESC`,
  );
  return rows.rows.map((row) => ({
    chain: row.chain,
    seq: Number(row.seq),
    hash: row.hash,
    at: row.at.toISOString(),
  }));
}

/** Writes `audit-anchor-YYYY-MM-DD.json` and its `.sig`; records the anchoring in the platform chain. */
export async function writeAnchor(
  pool: pg.Pool,
  dir: string,
  privateKeyPem: string,
  now: Date = new Date(),
): Promise<{ file: string; anchor: Anchor }> {
  const anchor: Anchor = {
    version: 1,
    createdAt: now.toISOString(),
    chains: await chainHeads(pool),
  };
  const text = canonicalJson(anchor);
  const signature = sign(null, Buffer.from(text), createPrivateKey(privateKeyPem)).toString(
    'base64',
  );
  await mkdir(dir, { recursive: true });
  const file = `audit-anchor-${now.toISOString().slice(0, 10)}.json`;
  await writeFile(join(dir, file), `${text}\n`, { mode: 0o640 });
  await writeFile(join(dir, `${file}.sig`), `${signature}\n`, { mode: 0o640 });
  await recordAudit(pool, {
    chain: PLATFORM_CHAIN,
    tenant: '*',
    actor: { kind: 'system', issuer: 'system', subject: 'audit-anchor' },
    action: 'audit.anchor',
    result: 'success',
    source: 'system',
    details: { file, chains: anchor.chains.length },
  });
  return { file, anchor };
}

export interface AnchorProblem {
  file: string;
  chain?: string;
  seq?: number;
  problem: 'signature' | 'unreadable' | 'missing' | 'mismatch';
}

/**
 * Checks every anchor file against the database: its signature, then, for every chain head it
 * holds, that the record with that sequence number still has that hash. A head older than the
 * chain's last retention purge is fine (deleted on purpose, and recorded).
 */
export async function checkAnchors(
  pool: pg.Pool,
  dir: string,
  publicKeyPem: string,
): Promise<{ files: number; heads: number; problems: AnchorProblem[] }> {
  const key = createPublicKey(publicKeyPem);
  const problems: AnchorProblem[] = [];
  let heads = 0;
  const files = (await readdir(dir)).filter((name) => /^audit-anchor-.*\.json$/.test(name)).sort();
  for (const file of files) {
    let anchor: Anchor;
    try {
      const text = (await readFile(join(dir, file), 'utf8')).trim();
      const signature = Buffer.from(
        (await readFile(join(dir, `${file}.sig`), 'utf8')).trim(),
        'base64',
      );
      if (!verify(null, Buffer.from(text), key, signature)) {
        problems.push({ file, problem: 'signature' });
        continue;
      }
      anchor = JSON.parse(text) as Anchor;
    } catch {
      problems.push({ file, problem: 'unreadable' });
      continue;
    }
    for (const head of anchor.chains) {
      heads += 1;
      const row = (
        await pool.query<{ hash: string }>(
          'SELECT hash FROM audit_log WHERE chain = $1 AND seq = $2',
          [head.chain, head.seq],
        )
      ).rows[0];
      if (row) {
        if (row.hash !== head.hash) {
          problems.push({ file, chain: head.chain, seq: head.seq, problem: 'mismatch' });
        }
        continue;
      }
      const purged = (
        await pool.query<{ last: string | null }>(
          `SELECT max((details->>'lastDeletedSeq')::bigint) AS last FROM audit_log
            WHERE chain = $1 AND action = 'retention.purge'`,
          [head.chain],
        )
      ).rows[0]?.last;
      if (purged === null || purged === undefined || Number(purged) < head.seq) {
        problems.push({ file, chain: head.chain, seq: head.seq, problem: 'missing' });
      }
    }
  }
  return { files: files.length, heads, problems };
}
