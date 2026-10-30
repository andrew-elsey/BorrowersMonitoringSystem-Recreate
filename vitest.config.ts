import { defineConfig } from 'vitest/config';

// One `npm test` at the root runs every workspace's tests.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
  },
});
