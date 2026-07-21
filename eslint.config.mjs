// Flat config built directly on @grafana/eslint-config v10, which is natively
// flat and ships only a bare entry point. It dropped the `/flat.js` sub-path
// that the create-plugin-managed base (.config/eslint.config.mjs) imports, so
// that base cannot load under v10 and is intentionally not extended here.
import grafanaConfig from '@grafana/eslint-config';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  {
    ignores: ['**/node_modules', '**/dist', '**/coverage', '.config/**', '.yarn/**'],
  },
  ...grafanaConfig,
  // Type-aware deprecation detection (same approach as grafana/redshift-datasource).
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-deprecated': 'error',
    },
  },
]);
