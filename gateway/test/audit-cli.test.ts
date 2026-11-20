import { execFile } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordAudit, type AuditEvent } from '../src/audit/log.js';
import { migrate } from '../src/db/migrate.js';

/**
 * The audit commands as the platform team runs them (E5 B9, K2/K3): `audit-anchor` and
 * `audit-verify`, as child processes, after tampering with the database directly.
 */
const appUrl = process.env.TEST_DATABASE_URL;
const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const CHAIN = 'cli-a';

const event = (i: number): AuditEvent => ({
  chain: CHAIN,
  tenant: CHAIN,
  actor: { kind: 'user', issuer: 'http://kc.test/realms/a', subject: 'user-1', name: 'Ana' },
  context: {},
  action: 'draft.save',
  result: 'success',
  details: { i },
});

/** Runs `src/cli/db.ts` like `pnpm db:…`; the exit code and what it printed. */
const cli = (args: string[]): Promise<{ code: number; out: string }> =>
  new Promise((done) => {
    execFile(
      process.execPath,
      ['--import', 'tsx', 'src/cli/db.ts', ...args],
      { env: { ...process.env, DATABASE_URL: appUrl }, cwd: resolve('.') },
      (error, stdout, stderr) => {
        done({ code: error ? Number(error.code ?? 1) : 0, out: `${stdout}${stderr}` });
      },
    );
  });

describe.skipIf(!appUrl || !ownerUrl)('the audit commands (E5 B9, K2/K3)', () => {
  let app: pg.Pool;
  let owner: pg.Pool;
  let dir: string;
  let keyFile: string;
  let publicFile: string;

  beforeAll(async () => {
    await migrate(ownerUrl ?? '', resolve('migrations'), () => undefined);
    app = new pg.Pool({ connectionString: appUrl });
    owner = new pg.Pool({ connectionString: ownerUrl });
    await owner.query('DELETE FROM audit_log WHERE chain = $1', [CHAIN]);
    dir = await mkdtemp(join(tmpdir(), 'audit-cli-'));
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    keyFile = join(dir, 'anchor.key');
    publicFile = join(dir, 'anchor.pub');
    await writeFile(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    await writeFile(publicFile, publicKey.export({ type: 'spki', format: 'pem' }));
  });
  afterAll(async () => {
    await owner.query('DELETE FROM audit_log WHERE chain = $1', [CHAIN]);
    await app.end();
    await owner.end();
    await rm(dir, { recursive: true, force: true });
  });

  const verify = () =>
    cli([
      'audit-verify',
      '--chain',
      CHAIN,
      '--anchors',
      join(dir, 'anchors'),
      '--public-key',
      publicFile,
    ]);

  it('verify passes on an intact chain, then reports a row changed in the database (exit 1)', async () => {
    for (let i = 0; i < 4; i += 1) await recordAudit(app, event(i));
    const anchored = await cli([
      'audit-anchor',
      '--out',
      join(dir, 'anchors'),
      '--private-key',
      keyFile,
    ]);
    expect(anchored.code).toBe(0);
    expect(await readdir(join(dir, 'anchors'))).toHaveLength(2); // the anchor and its signature

    const clean = await verify();
    expect(clean.out).toContain(`${CHAIN}: 4 records, seq 1..4 — ok`);
    expect(clean.out).toMatch(/anchors: 1 files, \d+ heads — ok/);
    expect(clean.code).toBe(0);

    // Someone with database access changes one value: that record's hash no longer matches.
    await owner.query(`UPDATE audit_log SET details = '{"i": 99}' WHERE chain = $1 AND seq = 2`, [
      CHAIN,
    ]);
    const changed = await verify();
    expect(changed.code).toBe(1);
    expect(changed.out).toContain(`${CHAIN}: 4 records, seq 1..4 — PROBLEMS: hash@2`);
  });

  it('a chain rewritten with recomputed hashes passes alone, and fails against the anchor', async () => {
    await owner.query('DELETE FROM audit_log WHERE chain = $1', [CHAIN]);
    for (let i = 0; i < 4; i += 1) await recordAudit(app, event(100 + i));

    const rewritten = await verify();
    expect(rewritten.out).toContain(`${CHAIN}: 4 records, seq 1..4 — ok`);
    expect(rewritten.out).toMatch(new RegExp(`anchors: .* — PROBLEMS: mismatch \\S+ ${CHAIN}@4`));
    expect(rewritten.code).toBe(1);

    // A forged anchor file fails its signature.
    const [file] = (await readdir(join(dir, 'anchors'))).filter((name) => name.endsWith('.json'));
    const path = join(dir, 'anchors', file ?? '');
    await writeFile(path, (await readFile(path, 'utf8')).replace('"version":1', '"version":2'));
    const forged = await verify();
    expect(forged.out).toMatch(/PROBLEMS: signature /);
    expect(forged.code).toBe(1);
  });
});
