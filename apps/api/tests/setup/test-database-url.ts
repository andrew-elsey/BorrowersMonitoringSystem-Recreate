// Integration tests run against the db-test container from docker-compose.dev.yml (start it with
// `npm run test:db`). It has no password and lives in memory, so this URL holds no secret.
export const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgresql://bms@localhost:5433/bms_test';

// Guard against wiping a real database: tests only ever reset a database whose name ends in _test.
export function assertIsTestDatabase(url: string): void {
  const databaseName = new URL(url).pathname.slice(1);
  if (!databaseName.endsWith('_test')) {
    throw new Error(`Refusing to reset "${databaseName}": test database names must end in _test.`);
  }
}
