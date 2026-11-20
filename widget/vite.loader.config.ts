import { defineConfig } from 'vite';
import { LOADER_CSS } from './src/loader/styles.js';

/**
 * loader.js: one self-contained IIFE included by the client's page (< 15 KB gzip). Next to it,
 * loader.css: the same CSS text, the fallback for browsers without constructable stylesheets,
 * served by the gateway (ADR 010).
 */
export default defineConfig({
  plugins: [
    {
      name: 'loader-css',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'loader.css', source: LOADER_CSS });
      },
    },
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2020',
    sourcemap: false,
    lib: {
      entry: 'src/loader/index.ts',
      formats: ['iife'],
      name: 'ChatWidgetLoader',
      fileName: () => 'loader.js',
    },
  },
});
