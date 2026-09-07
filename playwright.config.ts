import type { PluginOptions } from '@grafana/plugin-e2e';
import { defineConfig, devices } from '@playwright/test';
import { dirname } from 'node:path';

const pluginE2eAuth = `${dirname(require.resolve('@grafana/plugin-e2e'))}/auth`;

/**
 * Browser smoke tests against the docker-compose dev stack (make up).
 * Needs no cloud credentials — safe to run on forks.
 */
export default defineConfig<PluginOptions>({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : 'html',
  use: {
    baseURL: process.env.GRAFANA_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'auth',
      testDir: pluginE2eAuth,
      testMatch: [/.*\.js/],
    },
    {
      name: 'chromium',
      testDir: './tests/smoke',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/admin.json',
      },
      dependencies: ['auth'],
    },
    // Catalog screenshots, run on demand by `make screenshots`. Gated the same
    // way as the QA project: the capture writes into src/img/, which an
    // unqualified `playwright test` has no business doing.
    ...(process.env.SCREENSHOTS === '1'
      ? [
          {
            name: 'screenshots',
            testDir: './tests/screenshots',
            use: {
              ...devices['Desktop Chrome'],
              storageState: 'playwright/.auth/admin.json',
            },
            dependencies: ['auth'],
          },
        ]
      : []),
    // Manual-QA sweep (`make qa`): a long walk over every surface in a real
    // Chrome, writing reviewable screenshots to qa-artifacts/. Gated on QA=1 so
    // an unqualified `playwright test` — what CI runs — never picks it up.
    ...(process.env.QA === '1'
      ? [
          {
            name: 'qa',
            testDir: './tests/qa',
            timeout: 180_000,
            use: {
              ...devices['Desktop Chrome'],
              channel: 'chrome',
              viewport: { width: 1440, height: 900 },
              storageState: 'playwright/.auth/admin.json',
            },
            dependencies: ['auth'],
          },
        ]
      : []),
  ],
});
