import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { afterAll, beforeEach, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { config } from '../src/lib/config.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { resetDatabase } from './setup/reset-database.ts';
import { testDatabaseUrl } from './setup/test-database-url.ts';

// FND-6: every timestamp the API writes must be stored as the correct UTC instant (CLAUDE.md rule 4,
// ARCHITECTURE.md 6), even though the database's own time zone is Asia/Manila.

const TOLERANCE_MS = 5_000;

// A bare connection without the app's settings: it shows what the database itself defaults to.
const bareClient = new PrismaClient({
  adapter: new PrismaPg({ connectionString: testDatabaseUrl }),
});

afterAll(async () => {
  await bareClient.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
});

// The stored instant as epoch milliseconds, computed by Postgres. Unlike reading the column through
// Prisma, this cannot be shifted back by the adapter, so a wrongly stored value shows up here.
async function storedEpochMs(table: string, column: string, where: string): Promise<number> {
  const [row] = await prisma.$queryRawUnsafe<{ ms: number }[]>(
    `SELECT (extract(epoch FROM ${column}) * 1000)::float8 AS ms FROM ${table} WHERE ${where}`,
  );
  return row!.ms;
}

test('precondition: the database defaults to Asia/Manila, so a UTC mix-up cannot pass by accident', async () => {
  const [row] = await bareClient.$queryRaw<{ TimeZone: string }[]>`SHOW timezone`;
  expect(row!.TimeZone).toBe('Asia/Manila');
});

test('@default(now()) and @updatedAt are stored as the correct UTC instant', async () => {
  const user = await prisma.user.create({
    data: { name: 'Time Check', username: 'time', passwordHash: 'not-a-real-hash', role: 'VIEWER' },
  });

  expect(
    Math.abs((await storedEpochMs('users', 'created_at', `username = 'time'`)) - Date.now()),
  ).toBeLessThan(TOLERANCE_MS);
  expect(
    Math.abs((await storedEpochMs('users', 'updated_at', `username = 'time'`)) - Date.now()),
  ).toBeLessThan(TOLERANCE_MS);
  // Reading through Prisma gives the same instant back.
  expect(Math.abs(user.createdAt.getTime() - Date.now())).toBeLessThan(TOLERANCE_MS);
  const reread = await prisma.user.findUniqueOrThrow({ where: { username: 'time' } });
  expect(Math.abs(reread.createdAt.getTime() - Date.now())).toBeLessThan(TOLERANCE_MS);
});

test('an explicit new Date() is stored as the same instant', async () => {
  const instant = new Date('2026-10-31T03:59:11.000Z');
  await prisma.auditLog.create({
    data: { action: 'TIME_CHECK', entity: 'test', entityId: 'x', createdAt: instant },
  });

  expect(await storedEpochMs('audit_log', 'created_at', `action = 'TIME_CHECK'`)).toBe(
    instant.getTime(),
  );
});

test('session expiry is stored as now plus SESSION_TTL_HOURS', async () => {
  const password = 'correct-horse-battery';
  await prisma.user.create({
    data: {
      name: 'Ana Admin',
      username: 'ana',
      passwordHash: await hashPassword(password),
      role: 'ADMIN',
    },
  });
  const login = await request(createApp())
    .post('/api/auth/login')
    .set('X-Requested-With', 'fetch')
    .send({ username: 'ana', password });
  expect(login.status).toBe(200);

  const expected = Date.now() + config.sessionTtlHours * 60 * 60 * 1000;
  expect(Math.abs((await storedEpochMs('session', 'expires_at', 'true')) - expected)).toBeLessThan(
    TOLERANCE_MS,
  );
});
