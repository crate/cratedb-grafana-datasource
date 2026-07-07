// ESLint 9 flat config using @grafana/eslint-config v10 (natively flat).
import grafanaConfig from '@grafana/eslint-config';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  {
    ignores: ['**/node_modules', '**/dist', '**/coverage', '.config/**', '.yarn/**'],
  },
  ...grafanaConfig,
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
  },
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
