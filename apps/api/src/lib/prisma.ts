import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';

// The one shared database client. Import `prisma` from here; never create another PrismaClient.

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set. See .env.example.');
}
// pg lets `options` in the URL replace the TimeZone=UTC setting below without any error (FND-6).
if (/[?&]options=/.test(databaseUrl)) {
  throw new Error(
    'DATABASE_URL must not set options; prisma.ts sets TimeZone=UTC (ARCHITECTURE.md 6).',
  );
}

// Pool limits from ARCHITECTURE.md 12.5: at most 10 connections, wait at most 10 seconds for one.
const adapter = new PrismaPg({
  connectionString: databaseUrl,
  max: 10,
  connectionTimeoutMillis: 10_000,
  // Rule 4 (FND-6): every connection uses UTC, whatever the database's own time zone (the db
  // container runs with TZ=Asia/Manila). The adapter sends Date values as UTC digits with no offset
  // and reads timestamptz values as if they were UTC, so any other session time zone stores
  // every timestamp shifted. See ARCHITECTURE.md 6.
  options: '-c TimeZone=UTC',
});

export const prisma = new PrismaClient({
  adapter,
  // Interactive transaction limits from ARCHITECTURE.md 12.5.
  transactionOptions: { maxWait: 5_000, timeout: 10_000 },
});
