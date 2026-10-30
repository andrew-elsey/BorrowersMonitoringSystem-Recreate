import { defineConfig } from 'vitest/config';

// One `npm test` at the root runs every workspace's tests.
export default defineConfig({
  test: {
    projects: [
      { extends: true, test: { name: 'shared', root: 'packages/shared' } },
      { extends: true, test: { name: 'api', root: 'apps/api' } },
      { extends: true, test: { name: 'web', root: 'apps/web' } },
    ],
  },
  // Tests load @bms/shared from its TypeScript source, so no build is needed first.
  ssr: { resolve: { conditions: ['source', 'node', 'import'] } },
});
