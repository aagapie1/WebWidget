import { execSync } from 'node:child_process';

/** Builds the widget once; the gateway serves widget/dist under /w/. */
export default function globalSetup(): void {
  execSync('pnpm --filter widget build', { stdio: 'inherit' });
}
