import request from 'supertest';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../src/app.ts';
import {
  FLAGGING_LOCK_KEY,
  FLAGGING_RETRY_MS,
  rescheduleFlagging,
  runFlagging,
  startFlagging,
  stopFlagging,
} from '../src/jobs/flagging.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { recordReturn } from '../src/services/returns.ts';
import { countStrikes } from '../src/services/strikes.ts';
import { resetDatabase } from './setup/reset-database.ts';

// QA (automated) gap tests for FLG-2 (end-of-day flagging job, BR 6, 8, 9, 14; S3, S10, S12, S22,
// S23). Covers what flagging.test.ts leaves open: the exact closing boundary in Asia/Manila, a
// partial return through the return service, open lines of a non-current semester, flagged_at
// kept on a second run, closing moved later, the full audit entry, a failed run actually retried,
// and the manual trigger's role, CSRF, body-size, and rate-limit edges. The clock is always the
// injected `now` or Vitest fake timers. Times are Asia/Manila (+08:00); closing is 17:00.

const PASSWORD = 'correct-horse-battery';
let passwordHash: string;
let adminId: string;
let borrowerId: string;
let locationId: string;
let currentSemesterId: string;
let pastSemesterId: string;
let itemId: string;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  await resetDatabase();
  const users = await prisma.user.createManyAndReturn({
    data: [
      { name: 'Ada Admin', username: 'ada', passwordHash, role: 'ADMIN' },
      { name: 'Hal Handler', username: 'hal', passwordHash, role: 'HANDLER' },
      { name: 'Vic Viewer', username: 'vic', passwordHash, role: 'VIEWER' },
    ],
  });
  adminId = users.find((user) => user.role === 'ADMIN')!.id;
  await prisma.setting.create({ data: { id: 1 } });
  borrowerId = (
    await prisma.borrower.create({
      data: { schoolId: 'QA-0001', name: 'Test Borrower', type: 'STUDENT', department: 'IT' },
    })
  ).id;
  locationId = (await prisma.location.create({ data: { name: 'CL-201', createdById: adminId } }))
    .id;
  const semesters = await prisma.semester.createManyAndReturn({
    data: [
      { name: 'S0', startDate: new Date('2026-01-05'), endDate: new Date('2026-05-31') },
      {
        name: 'S1',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-12-15'),
        isCurrent: true,
      },
    ],
  });
  pastSemesterId = semesters.find((semester) => semester.name === 'S0')!.id;
  currentSemesterId = semesters.find((semester) => semester.name === 'S1')!.id;
  const categoryId = (await prisma.category.create({ data: { name: 'Supplies' } })).id;
  itemId = (
    await prisma.item.create({
      data: {
        name: 'Extension cord',
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

// One transaction with one open line, issued at the given instant. Returns the line id.
async function openLine(issuedAt: Date, borrowed = 1, semesterId = currentSemesterId) {
  const transaction = await prisma.transaction.create({
    data: {
      borrowerId,
      locationId,
      issuedById: adminId,
      semesterId,
      issuedAt,
      lines: { create: { itemId, quantityBorrowed: borrowed } },
    },
    include: { lines: true },
  });
  return transaction.lines[0]!.id;
}
const getLine = (id: string) => prisma.transactionItem.findUniqueOrThrow({ where: { id } });
const flagStatus = async (id: string) => (await getLine(id)).flagStatus;
const manila = (date: string, time: string) => new Date(`${date}T${time}+08:00`);
const at = (time: string) => manila('2026-09-01', time);
const DAY_MS = 24 * 3600 * 1000;

async function signIn(username: string) {
  const agent = request.agent(createApp());
  await agent
    .post('/api/auth/login')
    .set('X-Requested-With', 'fetch')
    .send({ username, password: PASSWORD })
    .expect(200);
  return agent;
}

// --- BR 8: the closing boundary ---

test('BR 8: a line issued exactly at closing time is not flagged at that closing', async () => {
  const id = await openLine(at('17:00:00.000'));
  await runFlagging(at('17:00:00.000'));
  expect(await flagStatus(id)).toBe('NONE');
  await runFlagging(manila('2026-09-02', '17:00:00'));
  expect(await flagStatus(id)).toBe('FLAGGED');
});

test('BR 8: a line issued 1 ms before closing is flagged at that closing', async () => {
  const id = await openLine(at('16:59:59.999'));
  await runFlagging(at('17:00:00.000'));
  expect(await flagStatus(id)).toBe('FLAGGED');
});

test('BR 8, ARCH 6: a run 1 ms before closing in Manila does not flag a line issued that morning', async () => {
  // 16:59:59.999 Manila is 08:59:59.999 UTC: the latest closing is still yesterday's.
  const id = await openLine(at('10:00:00'));
  expect(await runFlagging(at('16:59:59.999'))).toEqual({ flagged: 0, skipped: false });
  expect(await flagStatus(id)).toBe('NONE');
});

// --- BR 6, 8, S3: partial return through the return service ---

test('BR 8, S3: a line partly returned before closing through the return service is still flagged', async () => {
  const id = await openLine(at('09:00:00'), 5);
  await recordReturn(adminId, { lines: [{ lineId: id, quantity: 3, condition: 'GOOD' }] });
  await runFlagging(at('17:00:00'));
  expect(await flagStatus(id)).toBe('FLAGGED');
  expect(await countStrikes(borrowerId)).toBe(1);
});

test('BR 6, S3: returning the rest through the return service after the flag keeps the line FLAGGED', async () => {
  const id = await openLine(at('09:00:00'), 5);
  await recordReturn(adminId, { lines: [{ lineId: id, quantity: 3, condition: 'GOOD' }] });
  await runFlagging(at('17:00:00'));
  await recordReturn(adminId, { lines: [{ lineId: id, quantity: 2, condition: 'GOOD' }] });
  const line = await getLine(id);
  expect(line).toMatchObject({ quantityReturned: 5, flagStatus: 'FLAGGED' });
  expect(await countStrikes(borrowerId)).toBe(1);
});

// --- BR 8, 10, 12: semester boundary ---

test('BR 8, 12: an open line from a past semester is flagged but does not add a current-semester strike', async () => {
  const id = await openLine(manila('2026-05-29', '10:00:00'), 1, pastSemesterId);
  await runFlagging(at('17:00:00'));
  expect(await flagStatus(id)).toBe('FLAGGED');
  expect(await countStrikes(borrowerId)).toBe(0);
});

test('BR 8: the job still flags when there is no current semester', async () => {
  const id = await openLine(at('10:00:00'));
  await prisma.semester.updateMany({ data: { isCurrent: false } });
  expect(await runFlagging(at('17:00:00'))).toEqual({ flagged: 1, skipped: false });
  expect(await flagStatus(id)).toBe('FLAGGED');
});

// --- BR 8, S12: idempotent ---

test('BR 8, S12: a later run keeps the original flagged_at of an already flagged line', async () => {
  const id = await openLine(at('10:00:00'));
  await runFlagging(at('17:00:00'));
  await runFlagging(manila('2026-09-02', '17:00:00'));
  expect((await getLine(id)).flaggedAt).toEqual(at('17:00:00'));
});

// --- BR 14: audit entry contents ---

test('BR 14: a scheduled flag writes one full LINE_FLAGGED audit entry per line, with no actor', async () => {
  const transaction = await prisma.transaction.create({
    data: {
      borrowerId,
      locationId,
      issuedById: adminId,
      semesterId: currentSemesterId,
      issuedAt: at('10:00:00'),
      lines: {
        create: [
          { itemId, quantityBorrowed: 1 },
          { itemId, quantityBorrowed: 2 },
        ],
      },
    },
    include: { lines: true },
  });
  await runFlagging(at('17:00:00'));
  const entries = await prisma.auditLog.findMany({ where: { action: 'LINE_FLAGGED' } });
  expect(entries.map((entry) => entry.entityId).sort()).toEqual(
    transaction.lines.map((line) => line.id).sort(),
  );
  for (const entry of entries) {
    expect(entry).toMatchObject({
      actorId: null,
      entity: 'transaction_item',
      before: { flagStatus: 'NONE' },
      after: { flagStatus: 'FLAGGED', flaggedAt: at('17:00:00').toISOString() },
    });
  }
});

test('BR 14: a run that flags nothing writes no audit entry', async () => {
  await runFlagging(at('17:00:00'));
  expect(await prisma.auditLog.count()).toBe(0);
});

// --- BR 9, S22, S23: rescheduling and retry ---

test('BR 9: moving closing later than now does not flag anything at once', async () => {
  const id = await openLine(at('10:00:00'));
  await startFlagging(at('16:00:00'));
  await prisma.setting.update({ where: { id: 1 }, data: { closingTime: '18:00' } });
  await rescheduleFlagging(at('16:00:00'));
  expect(await flagStatus(id)).toBe('NONE');
});

test('BR 9, S22: moving closing earlier to a time still ahead today does not flag at once', async () => {
  const id = await openLine(at('10:00:00'));
  await startFlagging(at('12:00:00'));
  await prisma.setting.update({ where: { id: 1 }, data: { closingTime: '15:00' } });
  await rescheduleFlagging(at('12:00:00'));
  expect(await flagStatus(id)).toBe('NONE');
});

test('BR 9, S23: a run that throws is retried after 60 s and then flags the line', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const id = await openLine(at('10:00:00'));
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(at('17:00:00'));
  vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('db down'));
  await startFlagging();
  expect(await flagStatus(id)).toBe('NONE');
  await vi.advanceTimersByTimeAsync(FLAGGING_RETRY_MS);
  await vi.waitFor(async () => expect(await flagStatus(id)).toBe('FLAGGED'));
});

// --- Manual trigger: POST /api/flagging/run (SPEC 3, ARCH 12.5, SPEC 7) ---

const trigger = (agent: ReturnType<typeof request.agent>) =>
  agent.post('/api/flagging/run').set('X-Requested-With', 'fetch');

test('SPEC 3: a signed-out caller gets 401 UNAUTHENTICATED from the manual trigger', async () => {
  const response = await request(createApp())
    .post('/api/flagging/run')
    .set('X-Requested-With', 'fetch');
  expect(response.status).toBe(401);
  expect(response.body.error.code).toBe('UNAUTHENTICATED');
});

test('SPEC 3: a view-only user gets 403 FORBIDDEN from the manual trigger and flags nothing', async () => {
  const id = await openLine(new Date(Date.now() - 3 * DAY_MS));
  const response = await trigger(await signIn('vic'));
  expect(response.status).toBe(403);
  expect(response.body.error.code).toBe('FORBIDDEN');
  expect(await flagStatus(id)).toBe('NONE');
});

test('ARCH 12.5: refused handler and viewer calls do not use up the admin minute', async () => {
  const app = createApp();
  const signInOn = async (username: string) => {
    const agent = request.agent(app);
    await agent
      .post('/api/auth/login')
      .set('X-Requested-With', 'fetch')
      .send({ username, password: PASSWORD })
      .expect(200);
    return agent;
  };
  expect((await trigger(await signInOn('vic'))).status).toBe(403);
  expect((await trigger(await signInOn('hal'))).status).toBe(403);
  expect((await trigger(await signInOn('ada'))).status).toBe(200);
});

test('ARCH 5: the manual trigger without the X-Requested-With header is refused and flags nothing', async () => {
  const id = await openLine(new Date(Date.now() - 3 * DAY_MS));
  const agent = await signIn('ada');
  const response = await agent.post('/api/flagging/run');
  expect(response.status).toBe(403);
  expect(await flagStatus(id)).toBe('NONE');
});

test('SPEC 7: a manual trigger body over 100 KB gets 413 PAYLOAD_TOO_LARGE and flags nothing', async () => {
  const id = await openLine(new Date(Date.now() - 3 * DAY_MS));
  const agent = await signIn('ada');
  const response = await trigger(agent)
    .set('Content-Type', 'application/json')
    .send(JSON.stringify({ padding: 'x'.repeat(101 * 1024) }));
  expect(response.status).toBe(413);
  expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  expect(await flagStatus(id)).toBe('NONE');
});

test('ARCH 12.5: the second admin call within the minute gets 429 with Retry-After', async () => {
  const agent = await signIn('ada');
  expect((await trigger(agent)).status).toBe(200);
  const second = await trigger(agent);
  expect(second.status).toBe(429);
  expect(Number(second.headers['retry-after'])).toBeGreaterThan(0);
});

test('BR 9, 14: a manual run flags overdue lines and audits them with the admin as actor', async () => {
  const id = await openLine(new Date(Date.now() - 3 * DAY_MS));
  const response = await trigger(await signIn('ada'));
  expect(response.status).toBe(200);
  expect(response.body.run).toEqual({ flagged: 1, skipped: false });
  expect(await flagStatus(id)).toBe('FLAGGED');
  const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'LINE_FLAGGED' } });
  expect(entry).toMatchObject({ entityId: id, actorId: adminId });
});

test('ARCH 12.5: a manual run while the advisory lock is held reports skipped and flags nothing', async () => {
  const id = await openLine(new Date(Date.now() - 3 * DAY_MS));
  const agent = await signIn('ada');
  let response: Awaited<ReturnType<typeof trigger>> | undefined;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${FLAGGING_LOCK_KEY})::text`;
    response = await trigger(agent);
  });
  expect(response!.status).toBe(200);
  expect(response!.body.run).toEqual({ flagged: 0, skipped: true });
  expect(await flagStatus(id)).toBe('NONE');
});
