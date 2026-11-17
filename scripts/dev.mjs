// `pnpm dev`: gateway (:3000) + widget builds in watch mode + demo client site (:5173).
// Plain Node, no extra dependency. Ctrl+C stops everything.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = (pkg, name) => join(root, pkg, 'node_modules', '.bin', name);

const processes = [
  {
    name: 'gateway',
    cwd: join(root, 'gateway'),
    cmd: bin('gateway', 'tsx'),
    args: ['watch', '--env-file-if-exists=.env', 'src/index.ts'],
    // The gateway port comes from gateway/.env, not from a PORT set by the caller
    // (Node's --env-file never overrides variables that already exist).
    unsetEnv: ['PORT'],
  },
  {
    name: 'app',
    cwd: join(root, 'widget'),
    cmd: bin('widget', 'vite'),
    args: ['build', '--watch', '--mode', 'development'],
  },
  {
    name: 'loader',
    cwd: join(root, 'widget'),
    cmd: bin('widget', 'vite'),
    args: ['build', '-c', 'vite.loader.config.ts', '--watch', '--mode', 'development'],
  },
  {
    name: 'demo',
    cwd: join(root, 'widget'),
    cmd: bin('widget', 'vite'),
    args: ['-c', 'vite.demo.config.ts'],
  },
];

const children = processes.map(({ name, cwd, cmd, args, unsetEnv = [] }) => {
  const env = { ...process.env, FORCE_COLOR: '0' };
  for (const key of unsetEnv) delete env[key];
  // On Windows `.bin` entries are .cmd shims (need a shell); quote the path, it may contain spaces.
  const child = spawn(process.platform === 'win32' ? `"${cmd}"` : cmd, args, {
    cwd,
    env,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const prefix = (chunk) =>
    chunk
      .toString()
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => `[${name}] ${line}\n`)
      .join('');
  child.stdout.on('data', (chunk) => process.stdout.write(prefix(chunk)));
  child.stderr.on('data', (chunk) => process.stderr.write(prefix(chunk)));
  child.on('exit', (code) => {
    process.stdout.write(`[${name}] exited with code ${String(code)}\n`);
  });
  return child;
});

const stop = () => {
  for (const child of children) child.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
