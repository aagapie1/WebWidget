/**
 * `pnpm config:check [dir…]`: validates every tenant file (schema, contrast, texts, assets)
 * without secrets. Exits with 1 on any problem, so CI blocks a deploy (ADR 007).
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validateTenant } from '../config/tenants.js';

const dirs = process.argv.slice(2).map((dir) => resolve(dir));
if (dirs.length === 0) {
  console.error('usage: config-check <tenants dir> [more dirs…]');
  process.exit(2);
}

let failures = 0;
let checked = 0;
for (const dir of dirs) {
  const files = (await readdir(dir)).filter((name) => /\.ya?ml$/.test(name)).sort();
  for (const name of files) {
    checked++;
    const result = await validateTenant(await readFile(join(dir, name), 'utf8'), {
      env: process.env,
      fileName: name,
      tenantsDir: dir,
      checkOnly: true,
    });
    if (result.errors.length === 0) {
      console.log(`ok    ${join(dir, name)}`);
    } else {
      failures++;
      console.error(`FAIL  ${join(dir, name)}`);
      for (const error of result.errors) console.error(`      - ${error}`);
    }
  }
}
console.log(`${String(checked)} tenant file(s) checked, ${String(failures)} invalid`);
process.exit(failures > 0 || checked === 0 ? 1 : 0);
