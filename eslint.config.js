import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['gateway/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['widget/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    // Test doubles implement async interfaces without awaiting anything.
    files: ['**/*.test.{ts,tsx}'],
    rules: { '@typescript-eslint/require-await': 'off' },
  },
  {
    files: ['*.js', '**/scripts/*.mjs', 'e2e/*.mjs'],
    languageOptions: { globals: globals.node },
  },
);
