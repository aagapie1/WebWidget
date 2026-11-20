import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';

/**
 * Minimal migration runner (ADR 008): applies `migrations/NNN_*.sql` in order, once each, in a
 * transaction, as the schema owner. No ORM.
 */
export async function migrate(
  ownerUrl: string,
  dir: string,
  log: (line: string) => void,
): Promise<string[]> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    // One migrator at a time: gateway replicas (and parallel test files) starting together would
    // otherwise apply the same file twice. Released when the connection ends.
    await client.query("SELECT pg_advisory_lock(hashtextextended('schema_migrations', 0))");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const applied = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(
        (row) => row.name,
      ),
    );
    const files = (await readdir(dir)).filter((name) => /^\d{3}_[\w-]+\.sql$/.test(name)).sort();
    const done: string[] = [];
    for (const name of files) {
      if (applied.has(name)) continue;
      const sql = await readFile(join(dir, name), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${name} failed: ${String(error)}`, { cause: error });
      }
      log(`applied ${name}`);
      done.push(name);
    }
    return done;
  } finally {
    await client.end();
  }
}
