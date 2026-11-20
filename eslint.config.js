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
    files: ['widget/**/*.{ts,tsx}', 'admin/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    // Test doubles implement async interfaces without awaiting anything.
    files: ['**/*.test.{ts,tsx}'],
    rules: { '@typescript-eslint/require-await': 'off' },
  },
  {
    // axe only through e2e/axe.ts: it handles the known Firefox crash the same way everywhere
    // (docs/BACKLOG.md) and its annotations are counted in the CI summary.
    files: ['e2e/**/*.ts'],
    ignores: ['e2e/axe.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@axe-core/playwright',
              message:
                "Use the helper in e2e/axe.ts (serious(), analyze()): it handles Firefox's axe crash and counts it in CI.",
            },
            {
              name: 'axe-core',
              message: 'Use the helper in e2e/axe.ts (serious(), analyze()).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['*.js', '**/scripts/*.mjs', 'e2e/*.mjs'],
    languageOptions: { globals: globals.node },
  },
);
