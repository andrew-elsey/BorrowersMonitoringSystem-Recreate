import { defineConfig } from '@playwright/test';

// HRD-2. Runs inside the Playwright container started by run.ts; BASE_URL is the web service.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  // One ordered flow: later steps use the data and the clock of earlier ones.
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: '/tmp/pw-results',
  timeout: 120_000,
  use: { baseURL: process.env.BASE_URL ?? 'http://web:8080' },
});
