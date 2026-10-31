import { defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';
import { testDatabaseUrl } from './apps/api/tests/setup/test-database-url.ts';

// One `npm test` at the root runs every workspace's tests.
export default defineConfig({
  test: {
    projects: [
      { extends: true, test: { name: 'shared', root: 'packages/shared' } },
      {
        extends: true,
        test: {
          name: 'api',
          root: 'apps/api',
          // Integration tests use the real test database (ARCHITECTURE.md 11). Start it with `npm run test:db`.
          // SESSION_SECRET here is a throwaway value for tests only.
          env: { DATABASE_URL: testDatabaseUrl, SESSION_SECRET: 'test-only-session-secret' },
          globalSetup: './tests/setup/global-setup.ts',
          // Test files share one database, so they run one at a time.
          fileParallelism: false,
        },
      },
      {
        extends: true,
        // Component tests run in jsdom and load @bms/shared from source, as the Vite build does.
        resolve: { conditions: ['source', 'module', 'browser', 'development|production'] },
        test: { name: 'web', root: 'apps/web', environment: 'jsdom' },
      },
    ],
  },
  // Tests load @bms/shared from its TypeScript source, so no build is needed first.
  // 'source' is added in front of Vite's defaults; replacing the defaults breaks CommonJS packages like pg.
  ssr: { resolve: { conditions: ['source', ...defaultServerConditions] } },
});
