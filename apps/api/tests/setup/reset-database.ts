import { prisma } from '../../src/lib/prisma.ts';
import { assertIsTestDatabase, testDatabaseUrl } from './test-database-url.ts';

// Each test file calls this first so it starts from empty tables (ARCHITECTURE.md 11).
export async function resetDatabase(): Promise<void> {
  assertIsTestDatabase(testDatabaseUrl);
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const tableList = tables.map((table) => `"${table.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${tableList} CASCADE`);
}
