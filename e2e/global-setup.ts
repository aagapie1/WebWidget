import { execSync } from 'node:child_process';
import { ADMIN_E2E } from './constants.js';

/** Builds the widget once (the gateway serves widget/dist under /w/), and the admin interface. */
export default function globalSetup(): void {
  execSync('pnpm --filter widget build', { stdio: 'inherit' });
  if (ADMIN_E2E) execSync('pnpm --filter admin build', { stdio: 'inherit' });
}
