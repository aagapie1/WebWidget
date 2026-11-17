import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

/** Chat iframe app: served by the gateway at /w/app, assets at /w/assets/ (ADR 004). */
export default defineConfig({
  root: 'src/app',
  base: '/w/',
  plugins: [preact()],
  build: {
    outDir: '../../dist/app',
    emptyOutDir: true,
    assetsDir: 'assets',
    target: 'es2022',
    sourcemap: false,
    // Strict CSP (no inline scripts): keep the module preload polyfill out of the HTML.
    modulePreload: { polyfill: false },
  },
});
