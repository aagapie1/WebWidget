import { defineConfig } from 'vite';

/** loader.js: one self-contained IIFE included by the client's page (< 15 KB gzip). */
export default defineConfig({
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
