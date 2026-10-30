import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';

// The one shared database client. Import `prisma` from here; never create another PrismaClient.

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set. See .env.example.');
}

// Pool limits from ARCHITECTURE.md 12.5: at most 10 connections, wait at most 10 seconds for one.
const adapter = new PrismaPg({
  connectionString: databaseUrl,
  max: 10,
  connectionTimeoutMillis: 10_000,
});

export const prisma = new PrismaClient({
  adapter,
  // Interactive transaction limits from ARCHITECTURE.md 12.5.
  transactionOptions: { maxWait: 5_000, timeout: 10_000 },
});
