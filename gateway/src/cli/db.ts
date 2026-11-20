/**
 * `pnpm db:migrate` — applies gateway/migrations as the schema owner (DATABASE_OWNER_URL).
 * `pnpm db:seed [dir]` — imports YAML tenants as version 1 (DATABASE_URL, application role).
 * `db.ts reset-test` — empties the admin tables of a *_test / *_e2e database (owner role).
 *
 * Audit log (E5 B9):
 * `db.ts audit-verify [--chain id] [--anchors dir --public-key file]` — recomputes the hash chains
 *   (DATABASE_URL) and, with anchors, checks them against the signed daily heads. Exit 1 on problems.
 * `db.ts audit-anchor --out dir --private-key file` — writes today's signed anchor (DATABASE_URL).
 * `db.ts audit-purge [--platform-months 12] [--dry-run]` — deletes records older than each
 *   chain's retention, with the cleanup role (DATABASE_AUDIT_CLEANUP_URL).
 */
import { resolve } from 'node:path';
import pg from 'pg';
import { migrate } from '../db/migrate.js';
import { seedFromYaml } from '../db/seed.js';
import { readFile } from 'node:fs/promises';
import { checkAnchors, writeAnchor } from '../audit/anchor.js';
import { chains as auditChains, verifyChain } from '../audit/log.js';
import { purgeAuditLog } from '../audit/purge.js';

const [command, dir] = process.argv.slice(2);
/** `--name value` from the command line. */
const flag = (name: string): string | undefined => {
  const args = process.argv.slice(3);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

if (command === 'migrate') {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error('DATABASE_OWNER_URL is not set');
  const applied = await migrate(url, resolve('migrations'), (line) => {
    console.log(line);
  });
  console.log(
    applied.length ? `${String(applied.length)} migration(s) applied` : 'database is up to date',
  );
} else if (command === 'seed') {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const pool = new pg.Pool({ connectionString: url });
  try {
    const result = await seedFromYaml(pool, resolve(dir ?? '../config/tenants'));
    console.log(
      `seeded: ${result.seeded.join(', ') || '-'}; already present: ${result.skipped.join(', ') || '-'}`,
    );
  } finally {
    await pool.end();
  }
} else if (command === 'reset-test') {
  // Empties the admin tables of a TEST database (end-to-end runs). Refuses any other database.
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error('DATABASE_OWNER_URL is not set');
  const database = new URL(url).pathname.slice(1);
  if (!/_(test|e2e)$/.test(database)) {
    throw new Error(`reset-test refuses database "${database}" (only *_test or *_e2e)`);
  }
  const pool = new pg.Pool({ connectionString: url });
  try {
    await pool.query(
      'TRUNCATE tenant_config_versions, tenant_config_drafts, tenant_assets, audit_log RESTART IDENTITY',
    );
    console.log(`reset ${database}`);
  } finally {
    await pool.end();
  }
} else if (command === 'audit-verify') {
  const pool = new pg.Pool({ connectionString: required('DATABASE_URL') });
  try {
    const only = flag('chain');
    let failed = false;
    for (const chain of only ? [only] : await auditChains(pool)) {
      const report = await verifyChain(pool, chain);
      failed ||= report.problems.length > 0;
      console.log(
        `${chain}: ${String(report.records)} records, seq ${String(report.from.seq)}..${String(report.lastSeq)}` +
          (report.problems.length
            ? ` — PROBLEMS: ${report.problems.map((p) => `${p.problem}@${String(p.seq)}`).join(', ')}`
            : ' — ok'),
      );
    }
    const anchors = flag('anchors');
    const publicKey = flag('public-key');
    if (anchors && publicKey) {
      const result = await checkAnchors(pool, anchors, await readFile(publicKey, 'utf8'));
      failed ||= result.problems.length > 0;
      console.log(
        `anchors: ${String(result.files)} files, ${String(result.heads)} heads` +
          (result.problems.length
            ? ` — PROBLEMS: ${result.problems.map((p) => `${p.problem} ${p.file} ${p.chain ?? ''}@${String(p.seq ?? '')}`).join(', ')}`
            : ' — ok'),
      );
    }
    if (failed) process.exitCode = 1;
  } finally {
    await pool.end();
  }
} else if (command === 'audit-anchor') {
  const out = flag('out');
  const key = flag('private-key');
  if (!out || !key) throw new Error('usage: db.ts audit-anchor --out dir --private-key file');
  const pool = new pg.Pool({ connectionString: required('DATABASE_URL') });
  try {
    const { file, anchor } = await writeAnchor(pool, out, await readFile(key, 'utf8'));
    console.log(`${file}: ${String(anchor.chains.length)} chains`);
  } finally {
    await pool.end();
  }
} else if (command === 'audit-purge') {
  const pool = new pg.Pool({ connectionString: required('DATABASE_AUDIT_CLEANUP_URL') });
  try {
    const months = flag('platform-months');
    const results = await purgeAuditLog(pool, {
      ...(months ? { platformMonths: Number(months) } : {}),
      dryRun: process.argv.includes('--dry-run'),
    });
    for (const result of results) {
      console.log(
        `${result.chain}: ${String(result.retentionMonths)} months, before ${result.cutoff}: ${String(result.deleted)} deleted`,
      );
    }
  } finally {
    await pool.end();
  }
} else {
  console.error(
    'usage: db.ts migrate | seed [tenants dir] | reset-test | audit-verify | audit-anchor | audit-purge',
  );
  process.exit(2);
}
