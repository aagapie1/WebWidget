import { defineConfig } from 'vite';

/** Demo "client site" on its own origin (:5173), embedding the widget from the gateway (:3000). */
export default defineConfig({
  root: 'demo',
  server: { port: 5173, strictPort: true },
});
