import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { checkAnchors, writeAnchor } from '../src/audit/anchor.js';
import { recordAudit, verifyChain, type AuditEvent } from '../src/audit/log.js';
import { purgeAuditLog } from '../src/audit/purge.js';
import { migrate } from '../src/db/migrate.js';

const appUrl = process.env.TEST_DATABASE_URL;
const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
// The retention job's own role (E5 B9): never the application's.
const cleanupUrl =
  process.env.TEST_DATABASE_CLEANUP_URL ??
  (ownerUrl
    ? ownerUrl.replace(/\/\/[^@]+@/, '//widget_audit_cleanup:dev-widget-audit-cleanup@')
    : undefined);
const CHAINS = ['anchor-a', 'purge-a', 'purge-b'];

const event = (chain: string, at: Date, i: number): AuditEvent => ({
  chain,
  tenant: chain,
  actor: { kind: 'user', issuer: 'http://kc.test/realms/x', subject: 'u-1', name: 'Ana' },
  action: 'draft.save',
  result: 'success',
  details: { i },
  at,
});

describe.skipIf(!appUrl || !ownerUrl)('audit anchors and retention (E5 B9, K2/K3, D12)', () => {
  let app: pg.Pool;
  let owner: pg.Pool;
  let cleanup: pg.Pool;
  let dir: string;
  const NOW = new Date('2026-11-20T10:00:00.000Z');
  const monthsAgo = (months: number) => {
    const date = new Date(NOW);
    date.setUTCMonth(date.getUTCMonth() - months);
    return date;
  };

  beforeAll(async () => {
    await migrate(ownerUrl ?? '', resolve('migrations'), () => undefined);
    app = new pg.Pool({ connectionString: appUrl });
    owner = new pg.Pool({ connectionString: ownerUrl });
    cleanup = new pg.Pool({ connectionString: cleanupUrl });
  });
  afterAll(async () => {
    await app.end();
    await owner.end();
    await cleanup.end();
  });
  beforeEach(async () => {
    await owner.query('DELETE FROM audit_log WHERE chain = ANY($1)', [CHAINS]);
    await owner.query('DELETE FROM tenant_config_versions WHERE tenant_id = ANY($1)', [CHAINS]);
    dir = await mkdtemp(join(tmpdir(), 'anchors-'));
    return () => rm(dir, { recursive: true, force: true });
  });

  it('a signed daily anchor catches a chain rewritten from scratch with recomputed hashes', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    for (let i = 0; i < 3; i += 1) await recordAudit(app, event('anchor-a', NOW, i));
    const { file, anchor } = await writeAnchor(app, dir, privatePem, NOW);
    expect(file).toBe('audit-anchor-2026-11-20.json');
    expect(anchor.chains).toContainEqual(
      expect.objectContaining({ chain: 'anchor-a', seq: 3 }) as unknown,
    );
    // Other test files rewrite their own chains in parallel: only this chain is looked at.
    const own = async () =>
      (await checkAnchors(app, dir, publicPem)).problems.filter(
        (problem) => problem.chain === undefined || problem.chain === 'anchor-a',
      );
    expect(await own()).toEqual([]);

    // Someone with database access replaces the whole chain, hashes recomputed: the chain alone
    // looks perfect, the anchor does not match it.
    await owner.query("DELETE FROM audit_log WHERE chain = 'anchor-a'");
    for (let i = 0; i < 3; i += 1) await recordAudit(app, event('anchor-a', NOW, 100 + i));
    expect((await verifyChain(app, 'anchor-a')).problems).toEqual([]);
    expect(await own()).toContainEqual({
      file,
      chain: 'anchor-a',
      seq: 3,
      problem: 'mismatch',
    });

    // A forged anchor file fails its signature.
    const path = join(dir, file);
    await writeFile(path, (await readFile(path, 'utf8')).replace('"version":1', '"version":2'));
    expect(await own()).toContainEqual({
      file,
      problem: 'signature',
    });
  });

  it.skipIf(!cleanupUrl)(
    'deletes only what is older than the retention, records it, and the chain stays verifiable',
    async () => {
      // purge-a: the default 12 months. purge-b: its published configuration keeps 24 months.
      await app.query(
        `INSERT INTO tenant_config_versions (tenant_id, version, config, created_by)
         VALUES ('purge-b', 1, '{"audit":{"retentionMonths":24}}', 'test')`,
      );
      for (const chain of ['purge-a', 'purge-b']) {
        for (const [i, months] of [14, 14, 13, 2, 1].entries()) {
          await recordAudit(app, event(chain, monthsAgo(months), i));
        }
      }
      const results = await purgeAuditLog(cleanup, { now: NOW });
      expect(results.find((result) => result.chain === 'purge-a')).toMatchObject({
        retentionMonths: 12,
        deleted: 3,
        lastDeletedSeq: 3,
      });
      expect(results.find((result) => result.chain === 'purge-b')).toMatchObject({
        retentionMonths: 24,
        deleted: 0,
      });
      const remaining = (
        await app.query<{ seq: string; action: string; details: Record<string, unknown> }>(
          "SELECT seq, action, details FROM audit_log WHERE chain = 'purge-a' ORDER BY seq",
        )
      ).rows;
      expect(remaining.map((row) => [Number(row.seq), row.action])).toEqual([
        [4, 'draft.save'],
        [5, 'draft.save'],
        [6, 'retention.purge'],
      ]);
      expect(remaining[2]?.details).toMatchObject({
        deleted: 3,
        firstDeletedSeq: 1,
        lastDeletedSeq: 3,
        lastDeletedHash: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
      });
      const report = await verifyChain(app, 'purge-a');
      expect(report.from.seq).toBe(4);
      expect(report.problems).toEqual([]);
      // The application role cannot purge: only the cleanup role can delete.
      await expect(
        app.query("DELETE FROM audit_log WHERE chain = 'purge-a' AND seq = 4"),
      ).rejects.toThrow(/permission denied/);
    },
  );

  it.skipIf(!cleanupUrl)(
    'never keeps less than 6 months, whatever a configuration says',
    async () => {
      await owner.query(
        `INSERT INTO tenant_config_versions (tenant_id, version, config, created_by)
       VALUES ('purge-a', 1, '{"audit":{"retentionMonths":1}}', 'test')`,
      );
      for (const [i, months] of [7, 3].entries()) {
        await recordAudit(app, event('purge-a', monthsAgo(months), i));
      }
      const result = (await purgeAuditLog(cleanup, { now: NOW })).find(
        (item) => item.chain === 'purge-a',
      );
      expect(result).toMatchObject({ retentionMonths: 6, deleted: 1 });
    },
  );
});
