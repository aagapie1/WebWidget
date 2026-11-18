// Reports the admin bundle size; it is separate from the widget and never loaded by visitors.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const assets = fileURLToPath(new URL('../dist/assets/', import.meta.url));
const size = readdirSync(assets)
  .filter((name) => /\.(js|css)$/.test(name))
  .reduce((sum, name) => sum + gzipSync(readFileSync(join(assets, name)), { level: 9 }).length, 0);
const budget = 200 * 1024;
console.log(
  `${size <= budget ? 'ok ' : 'FAIL'} admin (js + css): ${(size / 1024).toFixed(1)} KB gzip (budget 200.0 KB)`,
);
if (size > budget) process.exit(1);
