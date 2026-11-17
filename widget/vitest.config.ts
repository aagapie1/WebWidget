import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [preact()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    // jsdom: the DOM DOMPurify officially supports.
    environment: 'jsdom',
  },
});
