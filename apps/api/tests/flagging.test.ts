import request from 'supertest';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../src/app.ts';
import {
  FLAGGING_LOCK_KEY,
  rescheduleFlagging,
  runFlagging,
  startFlagging,
  stopFlagging,
} from '../src/jobs/flagging.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { countStrikes } from '../src/services/strikes.ts';
import { resetDatabase } from './setup/reset-database.ts';

// FLG-2: end-of-day flagging job (BR 8, 9; S1, S2, S3, S10, S11, S12, S13). Test cases TC-FLG-06
// to TC-FLG-16 in TEST_CASES.md. Times are Asia/Manila (+08:00); closing is 17:00.

const PASSWORD = 'correct-horse-battery';
let passwordHash: string;
let adminId: string;
let borrowerId: string;
let locationId: string;
let semesterId: string;
let itemId: string;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  await resetDatabase();
  const users = await prisma.user.createManyAndReturn({
    data: [
      { name: 'Ana Admin', username: 'ana', passwordHash, role: 'ADMIN' },
      { name: 'Hal Handler', username: 'hal', passwordHash, role: 'HANDLER' },
    ],
  });
  adminId = users.find((user) => user.role === 'ADMIN')!.id;
  await prisma.setting.create({ data: { id: 1 } });
  borrowerId = (
    await prisma.borrower.create({
      data: { schoolId: '2026-0001', name: 'Ana', type: 'STUDENT', department: 'IT' },
    })
  ).id;
  locationId = (await prisma.location.create({ data: { name: 'CL-201', createdById: adminId } }))
    .id;
  semesterId = (
    await prisma.semester.create({
      data: {
        name: 'S1',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-12-15'),
        isCurrent: true,
      },
    })
  ).id;
  const categoryId = (await prisma.category.create({ data: { name: 'Equipment' } })).id;
  itemId = (
    await prisma.item.create({
      data: {
        name: 'Cord',
        categoryId,
        trackingType: 'QUANTITY',
        totalQuantity: 10,
        condition: 'GOOD',
      },
    })
  ).id;
});

afterEach(() => {
  stopFlagging();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// A transaction with one line, issued at the given time. Returns the line id.
async function line(issuedAt: string, borrowed = 1, returned = 0) {
  const transaction = await prisma.transaction.create({
    data: {
      borrowerId,
      locationId,
      issuedById: adminId,
      semesterId,
      issuedAt: new Date(issuedAt),
      lines: { create: { itemId, quantityBorrowed: borrowed, quantityReturned: returned } },
    },
    include: { lines: true },
  });
  return transaction.lines[0]!.id;
}
const flagStatus = async (id: string) =>
  (await prisma.transactionItem.findUniqueOrThrow({ where: { id } })).flagStatus;
const at = (time: string) => new Date(`2026-09-01T${time}:00+08:00`);

test('TC-FLG-06 (BR 8, S1): a line returned the same day is not flagged', async () => {
  const id = await line('2026-09-01T10:00:00+08:00', 1, 1);
  expect(await runFlagging(at('17:00'))).toEqual({ flagged: 0, skipped: false });
  expect(await flagStatus(id)).toBe('NONE');
  expect(await countStrikes(borrowerId)).toBe(0);
});

test('TC-FLG-07 (BR 8, 14, S2): an unreturned line is flagged and audited', async () => {
  const id = await line('2026-09-01T10:00:00+08:00');
  expect(await runFlagging(at('17:00'))).toEqual({ flagged: 1, skipped: false });
  const flagged = await prisma.transactionItem.findUniqueOrThrow({ where: { id } });
  expect(flagged.flagStatus).toBe('FLAGGED');
  expect(flagged.flaggedAt).toEqual(at('17:00'));
  const entries = await prisma.auditLog.findMany({ where: { action: 'LINE_FLAGGED' } });
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ entityId: id, actorId: null });
  expect(await countStrikes(borrowerId)).toBe(1);
});

test('TC-FLG-08 (BR 6, 8, S3): a partly returned line is flagged and stays flagged', async () => {
  const id = await line('2026-09-01T09:00:00+08:00', 5, 3);
  await runFlagging(at('17:00'));
  await prisma.transactionItem.update({ where: { id }, data: { quantityReturned: 5 } });
  expect(await flagStatus(id)).toBe('FLAGGED');
  expect(await countStrikes(borrowerId)).toBe(1);
});

test('TC-FLG-09 (BR 8, S10): a line issued after closing is flagged at the next closing', async () => {
  const id = await line('2026-09-01T17:30:00+08:00');
  await runFlagging(at('17:00'));
  await runFlagging(at('19:00'));
  expect(await flagStatus(id)).toBe('NONE');
  await runFlagging(new Date('2026-09-02T17:00:00+08:00'));
  expect(await flagStatus(id)).toBe('FLAGGED');
});

test('TC-FLG-10 (BR 9, S11): catch-up at 18:00 flags lines before 17:00 only', async () => {
  const early = await line('2026-09-01T10:00:00+08:00');
  const late = await line('2026-09-01T18:10:00+08:00');
  await runFlagging(at('18:00'));
  expect(await flagStatus(early)).toBe('FLAGGED');
  expect(await flagStatus(late)).toBe('NONE');
  await runFlagging(new Date('2026-09-02T18:00:00+08:00'));
  expect(await flagStatus(late)).toBe('FLAGGED');
});

test('TC-FLG-11 (BR 8, S12): running twice flags and audits nothing the second time', async () => {
  await line('2026-09-01T10:00:00+08:00');
  expect((await runFlagging(at('17:00'))).flagged).toBe(1);
  expect((await runFlagging(at('17:00'))).flagged).toBe(0);
  expect(await prisma.auditLog.count({ where: { action: 'LINE_FLAGGED' } })).toBe(1);
});

test('TC-FLG-12 (BR 13, S13): an overridden line is not flagged again', async () => {
  const id = await line('2026-09-01T10:00:00+08:00');
  await prisma.transactionItem.update({ where: { id }, data: { flagStatus: 'OVERRIDDEN' } });
  await runFlagging(new Date('2026-09-02T17:00:00+08:00'));
  expect(await flagStatus(id)).toBe('OVERRIDDEN');
});

test('TC-FLG-13 (ARCH 6, rule 3): the next run is at the saved closing time, and moves when it changes', async () => {
  // The injected clock is the now argument; real timers are only observed, never waited for.
  const timeouts = vi.spyOn(globalThis, 'setTimeout');
  const HOUR = 3600 * 1000;
  await startFlagging(at('08:00'));
  expect(timeouts.mock.calls.map(([, delay]) => delay)).toContain(9 * HOUR); // 17:00 today
  await prisma.setting.update({ where: { id: 1 }, data: { closingTime: '18:00' } });
  await rescheduleFlagging(at('08:00'));
  expect(timeouts.mock.calls.map(([, delay]) => delay)).toContain(10 * HOUR); // 18:00 today
  await rescheduleFlagging(at('18:30')); // after closing: tomorrow, in Manila time
  expect(timeouts.mock.calls.map(([, delay]) => delay)).toContain(23.5 * HOUR);
});

test('TC-FLG-14 (ARCH 12.5): a run while the advisory lock is held is skipped', async () => {
  const id = await line('2026-09-01T10:00:00+08:00');
  let skipped: Awaited<ReturnType<typeof runFlagging>> | undefined;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${FLAGGING_LOCK_KEY})::text`;
    skipped = await runFlagging(at('17:00'));
  });
  expect(skipped).toEqual({ flagged: 0, skipped: true });
  expect(await flagStatus(id)).toBe('NONE');
  expect((await runFlagging(at('17:00'))).flagged).toBe(1);
});

test('TC-FLG-15 (SPEC 3, ARCH 12.5): admin may run it once a minute; a handler gets 403', async () => {
  const app = createApp();
  const post = async (username: string) => {
    const agent = request.agent(app);
    await agent
      .post('/api/auth/login')
      .set('X-Requested-With', 'fetch')
      .send({ username, password: PASSWORD })
      .expect(200);
    return agent.post('/api/flagging/run').set('X-Requested-With', 'fetch');
  };
  expect((await post('hal')).status).toBe(403);
  const first = await post('ana');
  expect(first.status).toBe(200);
  expect(first.body.run).toEqual({ flagged: 0, skipped: false });
  const second = await post('ana');
  expect(second.status).toBe(429);
  expect(second.body.error.code).toBe('RATE_LIMITED');
});

test('TC-FLG-16 (BACKLOG FLG-2): each run is logged', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  await line('2026-09-01T10:00:00+08:00');
  await runFlagging(at('17:00'));
  expect(log).toHaveBeenCalledWith(expect.stringContaining('"flagged":1'));
});
