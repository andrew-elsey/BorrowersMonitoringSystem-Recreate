import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

// Integration tests run against the db-test container from docker-compose.dev.yml (start it with
// `npm run test:db`). It has no password and lives in memory, so this URL holds no secret.
// Required, with no default (owner decision 2026-11-08): two suites on one shared database wipe
// each other's rows, so every checkout or worktree names its own. Read from the shell first, then
// from the repo's .env (only this one key, so no other setting leaks into the tests).
function readTestDatabaseUrl(): string {
  const envFile = new URL('../../../../.env', import.meta.url);
  const fromEnvFile = existsSync(envFile)
    ? parseEnv(readFileSync(envFile, 'utf8')).TEST_DATABASE_URL
    : undefined;
  const url = process.env.TEST_DATABASE_URL || fromEnvFile;
  if (!url) {
    throw new Error(
      'Set TEST_DATABASE_URL in .env or the shell, for example ' +
        'postgresql://bms@localhost:5433/bms_test. Each worktree running tests at the same time ' +
        'needs its own database name ending in _test.',
    );
  }
  return url;
}

export const testDatabaseUrl = readTestDatabaseUrl();

// Guard against wiping a real database: tests only ever reset a database whose name ends in _test.
export function assertIsTestDatabase(url: string): void {
  const databaseName = new URL(url).pathname.slice(1);
  if (!databaseName.endsWith('_test')) {
    throw new Error(`Refusing to reset "${databaseName}": test database names must end in _test.`);
  }
}
