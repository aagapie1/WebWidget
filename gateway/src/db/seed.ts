import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type pg from 'pg';
import { parse as parseYaml } from 'yaml';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

export interface SeedResult {
  seeded: string[];
  skipped: string[];
}

/**
 * Imports the YAML tenant files (and their repository images) as version 1 of each tenant that
 * has no version yet (ADR 008). Idempotent. Runs with the application role: INSERT only.
 */
export async function seedFromYaml(pool: pg.Pool, tenantsDir: string): Promise<SeedResult> {
  const result: SeedResult = { seeded: [], skipped: [] };
  const files = (await readdir(tenantsDir)).filter((name) => /\.ya?ml$/.test(name)).sort();
  for (const file of files) {
    const id = file.replace(/\.ya?ml$/, '');
    const config = parseYaml(await readFile(join(tenantsDir, file), 'utf8')) as unknown;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        'SELECT 1 FROM tenant_config_versions WHERE tenant_id = $1 LIMIT 1',
        [id],
      );
      if (existing.rowCount) {
        await client.query('ROLLBACK');
        result.skipped.push(id);
        continue;
      }
      for (const name of await assetFiles(join(tenantsDir, id, 'assets'))) {
        const bytes = await readFile(join(tenantsDir, id, 'assets', name));
        await client.query(
          `INSERT INTO tenant_assets (tenant_id, name, hash, content_type, bytes, created_by)
           VALUES ($1, $2, $3, $4, $5, 'seed:yaml') ON CONFLICT DO NOTHING`,
          [
            id,
            name,
            createHash('sha256').update(bytes).digest('hex'),
            CONTENT_TYPES[extname(name).toLowerCase()],
            bytes,
          ],
        );
      }
      await client.query(
        `INSERT INTO tenant_config_versions (tenant_id, version, config, created_by, comment)
         VALUES ($1, 1, $2, 'seed:yaml', $3)`,
        [id, JSON.stringify(config), `seed from config/tenants/${file}`],
      );
      await client.query(
        `INSERT INTO audit_log (tenant_id, actor_issuer, actor_subject, actor_name, action, details)
         VALUES ($1, 'system', 'seed', 'seed:yaml', 'seed', $2)`,
        [id, JSON.stringify({ file })],
      );
      await client.query('COMMIT');
      result.seeded.push(id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  return result;
}

async function assetFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((name) => extname(name).toLowerCase() in CONTENT_TYPES);
  } catch {
    return [];
  }
}
