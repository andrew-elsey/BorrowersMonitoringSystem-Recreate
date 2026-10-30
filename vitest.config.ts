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
          env: { DATABASE_URL: testDatabaseUrl },
          globalSetup: './tests/setup/global-setup.ts',
          // Test files share one database, so they run one at a time.
          fileParallelism: false,
        },
      },
      { extends: true, test: { name: 'web', root: 'apps/web' } },
    ],
  },
  // Tests load @bms/shared from its TypeScript source, so no build is needed first.
  // 'source' is added in front of Vite's defaults; replacing the defaults breaks CommonJS packages like pg.
  ssr: { resolve: { conditions: ['source', ...defaultServerConditions] } },
});
