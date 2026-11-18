import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

/** Admin interface (ADR 008): a bundle separate from the public widget, served at /admin/. */
export default defineConfig({
  root: 'src',
  base: '/admin/',
  plugins: [preact()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    assetsDir: 'assets',
    target: 'es2022',
    sourcemap: false,
    // Strict CSP (no inline scripts): keep the module preload polyfill out of the HTML.
    modulePreload: { polyfill: false },
  },
});
