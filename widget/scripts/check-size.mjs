// Fails the build when a bundle exceeds its gzip budget (CLAUDE.md, SPEC §6).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const gz = (file) => gzipSync(readFileSync(file), { level: 9 }).length;
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

const loader = gz(join(dist, 'loader.js'));
const assets = join(dist, 'app', 'assets');
const app = readdirSync(assets)
  .filter((name) => /\.(js|css)$/.test(name))
  .reduce((sum, name) => sum + gz(join(assets, name)), 0);

const budgets = [
  ['loader.js', loader, 15 * 1024],
  ['app (js + css)', app, 120 * 1024],
];
let failed = false;
for (const [name, size, budget] of budgets) {
  const ok = size <= budget;
  failed ||= !ok;
  console.log(`${ok ? 'ok ' : 'FAIL'} ${name}: ${kb(size)} gzip (budget ${kb(budget)})`);
}
if (failed) process.exit(1);
