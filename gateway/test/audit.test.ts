import { resolve } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { canonicalJson, chainHash } from '../src/audit/chain.js';
import { recordAudit, verifyChain, type AuditEvent } from '../src/audit/log.js';
import { migrate } from '../src/db/migrate.js';

describe('canonical JSON and the chain hash (E5 B9)', () => {
  it('sorts keys, leaves out null and undefined, and is stable across key order', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, null, 'x'], c: null }, e: undefined })).toBe(
      '{"a":{"d":[1,null,"x"]},"b":1}',
    );
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
    expect(canonicalJson({ text: 'Primăria „Ș”' })).toBe('{"text":"Primăria „Ș”"}');
  });

  it('chains: a record changes its hash, and so does its predecessor', () => {
    const first = chainHash('', { action: 'publish' });
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(chainHash('', { action: 'publish' })).toBe(first);
    expect(chainHash('', { action: 'discard' })).not.toBe(first);
    expect(chainHash(first, { action: 'publish' })).not.toBe(chainHash('', { action: 'publish' }));
  });
});

const appUrl = process.env.TEST_DATABASE_URL;
const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const CHAINS = ['audit-a', 'audit-b'];

const event = (chain: string, action: string, extra: Partial<AuditEvent> = {}): AuditEvent => ({
  chain,
  tenant: chain,
  actor: {
    kind: 'user',
    issuer: 'http://kc.test/realms/a',
    subject: 'user-1',
    name: 'Ana Popescu',
    email: 'ana@a.test',
    role: 'widget-admin',
    org: chain,
    source: 'local',
  },
  context: { ip: '198.51.100.7', userAgent: 'Test', sessionHash: 'abc', requestId: 'req-1' },
  action,
  result: 'success',
  ...extra,
});

describe.skipIf(!appUrl || !ownerUrl)('the hash-chained audit log in Postgres (E5 B9)', () => {
  let app: pg.Pool;
  let owner: pg.Pool;

  beforeAll(async () => {
    await migrate(ownerUrl ?? '', resolve('migrations'), () => undefined);
    app = new pg.Pool({ connectionString: appUrl });
    owner = new pg.Pool({ connectionString: ownerUrl });
  });
  afterAll(async () => {
    await app.end();
    await owner.end();
  });
  beforeEach(async () => {
    await owner.query('DELETE FROM audit_log WHERE chain = ANY($1)', [CHAINS]);
  });

  it('numbers each chain on its own, also under concurrent writes, and verifies it', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        recordAudit(app, event(CHAINS[i % 2] ?? 'audit-a', 'draft.save', { details: { i } })),
      ),
    );
    for (const chain of CHAINS) {
      const report = await verifyChain(app, chain);
      expect(report.records).toBe(10);
      expect(report.lastSeq).toBe(10);
      expect(report.problems).toEqual([]);
    }
  });

  it('keeps every field of the event, and the application cannot change or delete it', async () => {
    const stored = await recordAudit(
      app,
      event('audit-a', 'publish', {
        section: 'theme',
        version: 2,
        sensitive: true,
        details: { changes: [{ path: 'theme.accent', before: '#000000', after: '#0b6e4f' }] },
      }),
    );
    const row = (await app.query('SELECT * FROM audit_log WHERE id = $1', [stored.id]))
      .rows[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      chain: 'audit-a',
      seq: '1',
      action: 'publish',
      section: 'theme',
      version: 2,
      sensitive: true,
      result: 'success',
      actor_email: 'ana@a.test',
      actor_source: 'local',
      ip: '198.51.100.7',
      session_hash: 'abc',
      request_id: 'req-1',
      prev_hash: '',
    });
    await expect(
      app.query("UPDATE audit_log SET action = 'x' WHERE id = $1", [stored.id]),
    ).rejects.toThrow(/permission denied/);
    await expect(app.query('DELETE FROM audit_log WHERE id = $1', [stored.id])).rejects.toThrow(
      /permission denied/,
    );
  });

  it('finds a changed, a removed or a rewritten record (tampering with database access)', async () => {
    for (let i = 0; i < 5; i += 1) {
      await recordAudit(app, event('audit-a', 'draft.save', { details: { i } }));
    }
    expect((await verifyChain(app, 'audit-a')).problems).toEqual([]);

    // A changed value: that record's hash no longer matches.
    await owner.query(
      `UPDATE audit_log SET details = '{"i": 99}' WHERE chain = 'audit-a' AND seq = 3`,
    );
    expect((await verifyChain(app, 'audit-a')).problems).toContainEqual({
      chain: 'audit-a',
      seq: 3,
      problem: 'hash',
    });

    // A removed record: a gap, and a broken link.
    await owner.query(`DELETE FROM audit_log WHERE chain = 'audit-a' AND seq = 4`);
    const removed = (await verifyChain(app, 'audit-a')).problems;
    expect(removed).toContainEqual({ chain: 'audit-a', seq: 5, problem: 'gap' });
    expect(removed).toContainEqual({ chain: 'audit-a', seq: 5, problem: 'link' });

    // A record rewritten with a recomputed hash: the next record's link breaks.
    await owner.query('DELETE FROM audit_log WHERE chain = $1', ['audit-a']);
    for (let i = 0; i < 3; i += 1) {
      await recordAudit(app, event('audit-a', 'draft.save', { details: { i } }));
    }
    const second = (
      await owner.query(`SELECT prev_hash FROM audit_log WHERE chain = 'audit-a' AND seq = 2`)
    ).rows[0] as { prev_hash: string };
    const forged = chainHash(second.prev_hash, { forged: true });
    await owner.query(`UPDATE audit_log SET hash = $1 WHERE chain = 'audit-a' AND seq = 2`, [
      forged,
    ]);
    const problems = (await verifyChain(app, 'audit-a')).problems;
    expect(problems).toContainEqual({ chain: 'audit-a', seq: 2, problem: 'hash' });
    expect(problems).toContainEqual({ chain: 'audit-a', seq: 3, problem: 'link' });
  });
});
