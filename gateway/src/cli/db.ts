/**
 * `pnpm db:migrate` — applies gateway/migrations as the schema owner (DATABASE_OWNER_URL).
 * `pnpm db:seed [dir]` — imports YAML tenants as version 1 (DATABASE_URL, application role).
 */
import { resolve } from 'node:path';
import pg from 'pg';
import { migrate } from '../db/migrate.js';
import { seedFromYaml } from '../db/seed.js';

const [command, dir] = process.argv.slice(2);

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
} else {
  console.error('usage: db.ts migrate | seed [tenants dir]');
  process.exit(2);
}
