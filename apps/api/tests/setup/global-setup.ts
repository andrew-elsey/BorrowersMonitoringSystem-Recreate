import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertIsTestDatabase, testDatabaseUrl } from './test-database-url.ts';

// Runs once before all api tests: apply any new migrations to the test database.
// The db-test container starts empty (in memory), and each test file empties the tables itself.
export default function setup(): void {
  assertIsTestDatabase(testDatabaseUrl);
  try {
    execSync('npx prisma migrate deploy', {
      // Run from apps/api, where prisma.config.ts lives (Vitest itself runs from the repo root).
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      stdio: 'pipe',
    });
  } catch (error) {
    const output = (error as { stderr?: Buffer }).stderr?.toString() ?? '';
    throw new Error(
      `Could not prepare the test database. Is it running? Start it with: npm run test:db\n${output}`,
      { cause: error },
    );
  }
}
