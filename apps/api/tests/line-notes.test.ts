import request from 'supertest';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../src/app.ts';
import { runFlagging } from '../src/jobs/flagging.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { countStrikes } from '../src/services/strikes.ts';
import { resetDatabase } from './setup/reset-database.ts';

// BRW-6: PATCH /api/lines/:id, the note and expected return date of an open line (BR 7, S4,
// SPEC 3 and 7). Test cases TC-BRW-30, 31, and 32 in TEST_CASES.md. Times are Asia/Manila.

const PASSWORD = 'correct-horse-battery';
let passwordHash: string;
let halId: string;
let borrowerId: string;
let locationId: string;
let semesterId: string;
let itemId: string;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  await resetDatabase();
  await prisma.setting.create({ data: { id: 1 } });
  const users = await prisma.user.createManyAndReturn({
    data: [
      { name: 'Ana Admin', username: 'ana', passwordHash, role: 'ADMIN' },
      { name: 'Hal Handler', username: 'hal', passwordHash, role: 'HANDLER' },
      { name: 'Vic Viewer', username: 'vic', passwordHash, role: 'VIEWER' },
    ],
  });
  halId = users.find((user) => user.username === 'hal')!.id;
  borrowerId = (
    await prisma.borrower.create({
      data: { schoolId: '2026-0007', name: 'James', type: 'STUDENT', department: 'IT' },
    })
  ).id;
  locationId = (await prisma.location.create({ data: { name: 'CL-201', createdById: halId } })).id;
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
  const categoryId = (await prisma.category.create({ data: { name: 'Supplies' } })).id;
  itemId = (
    await prisma.item.create({
      data: {
        name: 'Extension cable',
        categoryId,
        trackingType: 'QUANTITY',
        totalQuantity: 10,
        condition: 'GOOD',
      },
    })
  ).id;
});

afterEach(() => {
  vi.useRealTimers();
});

async function signIn(username: string) {
  const agent = request.agent(createApp());
  await agent
    .post('/api/auth/login')
    .set('X-Requested-With', 'fetch')
    .send({ username, password: PASSWORD })
    .expect(200);
  return agent;
}

// A transaction with one line of 5 cables. Returns the line id.
async function line(returned = 0, issuedAt = new Date()) {
  const transaction = await prisma.transaction.create({
    data: {
      borrowerId,
      locationId,
      issuedById: halId,
      semesterId,
      issuedAt,
      lines: { create: { itemId, quantityBorrowed: 5, quantityReturned: returned } },
    },
    include: { lines: true },
  });
  return transaction.lines[0]!.id;
}
const patch = (agent: Awaited<ReturnType<typeof signIn>>, id: string, body: object) =>
  agent.patch(`/api/lines/${id}`).set('X-Requested-With', 'fetch').send(body);
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
const noteAudits = (id: string) =>
  prisma.auditLog.findMany({
    where: { entityId: id, action: 'LINE_NOTE_UPDATED' },
    orderBy: { createdAt: 'asc' },
  });

test('TC-BRW-30 (BR 7): a handler adds, edits, and clears a note and expected return date, audited', async () => {
  const hal = await signIn('hal');
  const id = await line();

  const added = await patch(hal, id, {
    note: '  returning tomorrow  ',
    expectedReturnDate: '2099-01-02',
  }).expect(200);
  expect(added.body.line).toEqual({
    lineId: id,
    note: 'returning tomorrow',
    expectedReturnDate: '2099-01-02',
  });

  await patch(hal, id, { note: 'back at 9', expectedReturnDate: today() }).expect(200);
  await patch(hal, id, { note: '', expectedReturnDate: null }).expect(200);

  const stored = await prisma.transactionItem.findUniqueOrThrow({ where: { id } });
  expect(stored.note).toBeNull();
  expect(stored.expectedReturnDate).toBeNull();
  expect(stored.flagStatus).toBe('NONE');

  const audits = await noteAudits(id);
  expect(audits.map((entry) => [entry.actorId, entry.entity, entry.before, entry.after])).toEqual([
    [
      halId,
      'transaction_item',
      { note: null, expectedReturnDate: null },
      { note: 'returning tomorrow', expectedReturnDate: '2099-01-02' },
    ],
    [
      halId,
      'transaction_item',
      { note: 'returning tomorrow', expectedReturnDate: '2099-01-02' },
      { note: 'back at 9', expectedReturnDate: today() },
    ],
    [
      halId,
      'transaction_item',
      { note: 'back at 9', expectedReturnDate: today() },
      { note: null, expectedReturnDate: null },
    ],
  ]);
});

test('TC-BRW-30 (SPEC 3): an admin may edit a note; a viewer gets 403 and signed out gets 401', async () => {
  const id = await line();
  await patch(await signIn('ana'), id, { note: 'ok', expectedReturnDate: null }).expect(200);
  await patch(await signIn('vic'), id, { note: 'no', expectedReturnDate: null }).expect(403);
  await request(createApp())
    .patch(`/api/lines/${id}`)
    .set('X-Requested-With', 'fetch')
    .send({ note: 'no', expectedReturnDate: null })
    .expect(401);
  expect((await noteAudits(id)).length).toBe(1);
});

test('TC-BRW-31 (SPEC 7, BR 7): a 501-character note, a past date, a closed line, and an unknown line are refused', async () => {
  const hal = await signIn('hal');
  const id = await line();

  await patch(hal, id, { note: 'a'.repeat(500), expectedReturnDate: null }).expect(200);
  const tooLong = await patch(hal, id, { note: 'a'.repeat(501), expectedReturnDate: null }).expect(
    400,
  );
  expect(tooLong.body.error.code).toBe('VALIDATION_ERROR');
  expect(tooLong.body.error.details.fields.note).toBeDefined();

  const past = await patch(hal, id, { note: '', expectedReturnDate: '2020-01-01' }).expect(400);
  expect(past.body.error.details.fields.expectedReturnDate).toEqual([
    'Choose today or a later date.',
  ]);
  // Both fields are required, so a client cannot clear one by leaving it out.
  expect((await patch(hal, id, { note: 'x' }).expect(400)).body.error.code).toBe(
    'VALIDATION_ERROR',
  );
  expect(
    (
      await hal
        .patch('/api/lines/not-a-uuid')
        .set('X-Requested-With', 'fetch')
        .send({ note: '', expectedReturnDate: null })
        .expect(400)
    ).body.error.code,
  ).toBe('VALIDATION_ERROR');

  const closed = await line(5);
  const refused = await patch(hal, closed, { note: 'late', expectedReturnDate: null }).expect(409);
  expect(refused.body.error).toMatchObject({ code: 'LINE_NOT_OPEN', details: { lineId: closed } });

  const unknown = await patch(hal, '00000000-0000-4000-8000-000000000000', {
    note: 'x',
    expectedReturnDate: null,
  }).expect(404);
  expect(unknown.body.error.code).toBe('NOT_FOUND');

  // Only the one valid edit was saved and audited.
  expect((await noteAudits(id)).length).toBe(1);
  expect(await noteAudits(closed)).toEqual([]);
});

test('TC-BRW-31 (BR 7, owner decision 2026-11-12): a stored date that has passed may be kept unchanged or cleared, not changed to another past date', async () => {
  const hal = await signIn('hal');
  const id = await line();
  await prisma.transactionItem.update({
    where: { id },
    data: { note: 'old', expectedReturnDate: new Date('2020-01-01T00:00:00Z') },
  });

  // Only the note changes; the passed date is sent back as it is.
  const kept = await patch(hal, id, { note: 'still out', expectedReturnDate: '2020-01-01' }).expect(
    200,
  );
  expect(kept.body.line).toEqual({
    lineId: id,
    note: 'still out',
    expectedReturnDate: '2020-01-01',
  });

  // Changing it to another past date is refused, and nothing is saved.
  const moved = await patch(hal, id, { note: 'x', expectedReturnDate: '2020-01-02' }).expect(400);
  expect(moved.body.error.details.fields.expectedReturnDate).toEqual([
    'Choose today or a later date.',
  ]);
  expect((await prisma.transactionItem.findUniqueOrThrow({ where: { id } })).note).toBe(
    'still out',
  );

  // Clearing is always allowed.
  await patch(hal, id, { note: 'still out', expectedReturnDate: null }).expect(200);
  expect((await noteAudits(id)).map((entry) => entry.after)).toEqual([
    { note: 'still out', expectedReturnDate: '2020-01-01' },
    { note: 'still out', expectedReturnDate: null },
  ]);
});

test("TC-BRW-32 (BR 7, S4): a note with tomorrow's date does not prevent the flag or the strike", async () => {
  // 1 Sep 2026, 10:00 Manila: James borrows 5 extension cables.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-01T10:00:00+08:00'));
  const id = await line(0, new Date());
  const hal = await signIn('hal');
  await patch(hal, id, { note: 'returning tomorrow', expectedReturnDate: '2026-09-02' }).expect(
    200,
  );

  // 17:00: the job flags the line anyway, and James has 1 strike.
  await runFlagging(new Date('2026-09-01T17:00:00+08:00'));
  const flagged = await prisma.transactionItem.findUniqueOrThrow({ where: { id } });
  expect(flagged.flagStatus).toBe('FLAGGED');
  expect(flagged.note).toBe('returning tomorrow');
  expect(await countStrikes(borrowerId)).toBe(1);

  // Next day he returns them. The flag and the strike remain (BR 6).
  vi.setSystemTime(new Date('2026-09-02T09:00:00+08:00'));
  await (
    await signIn('hal')
  )
    .post('/api/returns')
    .set('X-Requested-With', 'fetch')
    .send({ lines: [{ lineId: id, quantity: 5, condition: 'GOOD' }] })
    .expect(201);
  expect((await prisma.transactionItem.findUniqueOrThrow({ where: { id } })).flagStatus).toBe(
    'FLAGGED',
  );
  expect(await countStrikes(borrowerId)).toBe(1);
});
