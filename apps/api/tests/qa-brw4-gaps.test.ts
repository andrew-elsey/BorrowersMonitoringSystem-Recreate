import type { ItemStatus } from '@bms/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { getAvailability } from '../src/services/availability.ts';
import { resetDatabase } from './setup/reset-database.ts';

// QA (automated) gap tests for BRW-4 (returns, BR 5, 6, 11, 14; S3, S15, S17): several partial
// returns adding up exactly, a mixed UNIT and QUANTITY return across two transactions, the exact
// audit rows, returnedAt stored in UTC, a return racing a checkout of the same item, returns of
// RETIRED or LOST items and on an inactive room, an admin as receiver, and the SPEC 7 bounds.

const PASSWORD = 'correct-horse-battery';
let passwordHash: string;
let handler: ReturnType<typeof request.agent>;
let handlerId: string;
let borrowerId: string;
let locationId: string;
let semesterId: string;
let categoryId: string;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  await resetDatabase();
  const users = await prisma.user.createManyAndReturn({
    data: [
      { name: 'QA Handler', username: 'qa-handler', passwordHash, role: 'HANDLER' },
      { name: 'QA Handler Two', username: 'qa-handler-2', passwordHash, role: 'HANDLER' },
      { name: 'QA Admin', username: 'qa-admin', passwordHash, role: 'ADMIN' },
    ],
  });
  handlerId = users.find((user) => user.username === 'qa-handler')!.id;
  borrowerId = (
    await prisma.borrower.create({
      data: { schoolId: 'QA-0004', name: 'Test Borrower', type: 'STUDENT', department: 'QA' },
    })
  ).id;
  locationId = (await prisma.location.create({ data: { name: 'QA Lab', createdById: handlerId } }))
    .id;
  semesterId = (
    await prisma.semester.create({
      data: {
        name: 'QA S1',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-12-15'),
        isCurrent: true,
      },
    })
  ).id;
  categoryId = (await prisma.category.create({ data: { name: 'QA Category' } })).id;
  handler = await signIn('qa-handler');
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

type Entry = { lineId: string; quantity: number; condition: string };
const post = (agent: typeof handler, body: unknown) =>
  agent
    .post('/api/returns')
    .set('X-Requested-With', 'fetch')
    .send(body as object);
const giveBack = (agent: typeof handler, lines: Entry[]) => post(agent, { lines });
const good = (lineId: string, quantity = 1): Entry => ({ lineId, quantity, condition: 'GOOD' });

const unit = (assetTag: string, status: ItemStatus = 'ACTIVE') =>
  prisma.item.create({
    data: {
      name: 'QA Laptop',
      categoryId,
      trackingType: 'UNIT',
      assetTag,
      totalQuantity: 1,
      condition: 'GOOD',
      status,
    },
  });
const supply = (totalQuantity = 10, status: ItemStatus = 'ACTIVE') =>
  prisma.item.create({
    data: {
      name: 'QA Cord',
      categoryId,
      trackingType: 'QUANTITY',
      totalQuantity,
      condition: 'GOOD',
      status,
    },
  });

// One transaction issued by the QA handler with the given lines, created directly.
async function issue(...lines: { itemId: string; quantityBorrowed: number }[]) {
  const transaction = await prisma.transaction.create({
    data: { borrowerId, locationId, issuedById: handlerId, semesterId, lines: { create: lines } },
    include: { lines: true },
  });
  // Returned in the order given (rows come back in no fixed order).
  const left = [...transaction.lines];
  return lines.map(
    ({ itemId }) =>
      left.splice(
        left.findIndex((l) => l.itemId === itemId),
        1,
      )[0]!,
  );
}
const issueOne = async (itemId: string, quantityBorrowed: number) =>
  (await issue({ itemId, quantityBorrowed }))[0]!;

const lineById = (id: string) => prisma.transactionItem.findUniqueOrThrow({ where: { id } });
const available = async (itemId: string) => (await getAvailability([itemId])).get(itemId);

test('three partial returns of 1, 1 and 3 complete a 5-cord line exactly; a fourth is refused (BR 5, S15)', async () => {
  const line = await issueOne((await supply()).id, 5);
  const outstanding = [];
  for (const quantity of [1, 1, 3]) {
    const res = await giveBack(handler, [good(line.id, quantity)]).expect(201);
    outstanding.push(res.body.returns[0].outstanding);
  }
  expect(outstanding).toEqual([4, 3, 0]);
  expect((await lineById(line.id)).quantityReturned).toBe(5);
  const extra = await giveBack(handler, [good(line.id)]).expect(409);
  expect(extra.body.error).toMatchObject({
    code: 'RETURN_EXCEEDS_OUTSTANDING',
    details: { lineId: line.id, outstanding: 0 },
  });
  expect(await prisma.return.count({ where: { transactionItemId: line.id } })).toBe(3);
});

test('a UNIT line is refused a quantity of 2 with outstanding 1 (BR 5)', async () => {
  const line = await issueOne((await unit('QA-LT-1')).id, 1);
  const res = await giveBack(handler, [good(line.id, 2)]).expect(409);
  expect(res.body.error).toMatchObject({
    code: 'RETURN_EXCEEDS_OUTSTANDING',
    details: { lineId: line.id, outstanding: 1 },
  });
});

test('one return mixes UNIT and QUANTITY lines from two transactions; the reply follows the request order (BR 5)', async () => {
  const laptop = await unit('QA-LT-1');
  const cords = await supply();
  const [laptopLine, cordLineA] = await issue(
    { itemId: laptop.id, quantityBorrowed: 1 },
    { itemId: cords.id, quantityBorrowed: 4 },
  );
  const cordLineB = await issueOne(cords.id, 3);
  const res = await giveBack(handler, [
    { lineId: cordLineB.id, quantity: 3, condition: 'FAIR' },
    { lineId: laptopLine!.id, quantity: 1, condition: 'GOOD' },
    { lineId: cordLineA!.id, quantity: 1, condition: 'GOOD' },
  ]).expect(201);

  expect(
    res.body.returns.map((event: { lineId: string; outstanding: number }) => [
      event.lineId,
      event.outstanding,
    ]),
  ).toEqual([
    [cordLineB.id, 0],
    [laptopLine!.id, 0],
    [cordLineA!.id, 3],
  ]);
  expect(await available(laptop.id)).toBe(1);
  expect(await available(cords.id)).toBe(7);
});

test('an unknown line next to a valid one fails the whole return with NOT_FOUND; nothing is recorded', async () => {
  const line = await issueOne((await supply()).id, 2);
  const missing = randomUUID();
  const res = await giveBack(handler, [good(line.id), good(missing)]).expect(404);
  expect(res.body.error).toMatchObject({ code: 'NOT_FOUND', details: { lineId: missing } });
  expect(await prisma.return.count()).toBe(0);
  expect((await lineById(line.id)).quantityReturned).toBe(0);
  expect(await prisma.auditLog.count()).toBe(0);
});

test('a 3-line return writes exactly 3 RETURN rows with no before and 1 ITEM_UPDATED row, nothing else (BR 14)', async () => {
  const laptop = await unit('QA-LT-1');
  const cords = await supply();
  const [laptopLine, cordLine] = await issue(
    { itemId: laptop.id, quantityBorrowed: 1 },
    { itemId: cords.id, quantityBorrowed: 2 },
  );
  const otherLine = await issueOne(cords.id, 1);
  const res = await giveBack(handler, [
    { lineId: laptopLine!.id, quantity: 1, condition: 'DAMAGED' },
    { lineId: cordLine!.id, quantity: 2, condition: 'DAMAGED' },
    good(otherLine.id),
  ]).expect(201);

  const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
  expect(rows.map((row) => row.action).sort()).toEqual([
    'ITEM_UPDATED',
    'RETURN',
    'RETURN',
    'RETURN',
  ]);
  const returnRows = rows.filter((row) => row.action === 'RETURN');
  for (const event of res.body.returns) {
    const row = returnRows.find((r) => r.entityId === event.id)!;
    expect(row).toMatchObject({ actorId: handlerId, entity: 'return', before: null, after: event });
  }
  // The QUANTITY item returned DAMAGED keeps its condition and gets no item audit row (S17).
  expect(rows.find((row) => row.action === 'ITEM_UPDATED')!.entityId).toBe(laptop.id);
  expect((await prisma.item.findUniqueOrThrow({ where: { id: cords.id } })).condition).toBe('GOOD');
});

test('returnedAt is stored as the UTC instant the reply reports (ARCHITECTURE time handling)', async () => {
  const line = await issueOne((await supply()).id, 1);
  const before = Date.now();
  const res = await giveBack(handler, [good(line.id)]).expect(201);
  const { id, returnedAt } = res.body.returns[0];
  expect(returnedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const [row] = await prisma.$queryRaw<{ ms: number }[]>`
    SELECT (extract(epoch FROM returned_at) * 1000)::float8 AS ms FROM returns WHERE id = ${id}::uuid`;
  expect(row!.ms).toBe(Date.parse(returnedAt));
  // Within a minute of the test clock: an 8-hour Manila shift cannot pass.
  expect(Math.abs(row!.ms - before)).toBeLessThan(60_000);
});

test('a return and a checkout of the same QUANTITY item at once both succeed, with correct availability after (BR 1, 4, 5)', async () => {
  const cords = await supply(10);
  const line = await issueOne(cords.id, 5);
  const other = await signIn('qa-handler-2');
  // The checkout of 5 fits whether it runs before (5 free) or after (8 free) the return of 3.
  const [returned, checkedOut] = await Promise.all([
    giveBack(handler, [{ lineId: line.id, quantity: 3, condition: 'DAMAGED' }]),
    other
      .post('/api/transactions')
      .set('X-Requested-With', 'fetch')
      .send({ borrowerId, locationId, lines: [{ itemId: cords.id, quantity: 5 }] }),
  ]);
  expect([returned.status, checkedOut.status]).toEqual([201, 201]);
  expect(await available(cords.id)).toBe(10 - 2 - 5);
});

test('a DAMAGED return of a laptop racing a checkout of it never deadlocks or errors (BR 4, 5, S17)', async () => {
  // Return locks the line then the item; checkout locks the item. Repeat to give a deadlock a chance.
  const laptop = await unit('QA-LT-1');
  const other = await signIn('qa-handler-2');
  for (let round = 0; round < 5; round += 1) {
    const open = await prisma.transactionItem.findMany({
      where: { itemId: laptop.id, quantityReturned: 0 },
    });
    const line = open[0] ?? (await issueOne(laptop.id, 1));
    const [returned, checkedOut] = await Promise.all([
      giveBack(handler, [{ lineId: line.id, quantity: 1, condition: 'DAMAGED' }]),
      other
        .post('/api/transactions')
        .set('X-Requested-With', 'fetch')
        .send({ borrowerId, locationId, lines: [{ itemId: laptop.id, quantity: 1 }] }),
    ]);
    expect(returned.status).toBe(201);
    // Before the return the laptop is out (ITEM_UNAVAILABLE); after it, the checkout succeeds.
    expect([201, 409]).toContain(checkedOut.status);
    if (checkedOut.status === 409) expect(checkedOut.body.error.code).toBe('ITEM_UNAVAILABLE');
    const stillOut = checkedOut.status === 201 ? 1 : 0;
    expect(await available(laptop.id)).toBe(1 - stillOut);
  }
  expect((await prisma.item.findUniqueOrThrow({ where: { id: laptop.id } })).status).toBe('ACTIVE');
});

test.each(['RETIRED', 'LOST', 'UNDER_REPAIR'] as const)(
  'a line on an item that is now %s can still be returned; the status is unchanged (BR 5, S17)',
  async (status) => {
    const laptop = await unit('QA-LT-1');
    const cords = await supply();
    const [laptopLine, cordLine] = await issue(
      { itemId: laptop.id, quantityBorrowed: 1 },
      { itemId: cords.id, quantityBorrowed: 2 },
    );
    await prisma.item.updateMany({ where: { categoryId }, data: { status } });
    await giveBack(handler, [
      { lineId: laptopLine!.id, quantity: 1, condition: 'DAMAGED' },
      good(cordLine!.id, 2),
    ]).expect(201);
    const items = await prisma.item.findMany({ where: { categoryId } });
    expect(items.map((item) => item.status)).toEqual([status, status]);
    expect(items.find((item) => item.id === laptop.id)!.condition).toBe('DAMAGED');
  },
);

test('a line in a room that is now inactive can still be returned (BR 5)', async () => {
  const line = await issueOne((await supply()).id, 2);
  await prisma.location.update({ where: { id: locationId }, data: { active: false } });
  const res = await giveBack(handler, [good(line.id, 2)]).expect(201);
  expect(res.body.returns[0].outstanding).toBe(0);
});

test('an admin can record a return and is the receiving handler (SPEC 3, BR 5)', async () => {
  const line = await issueOne((await unit('QA-LT-1')).id, 1);
  const admin = await signIn('qa-admin');
  const adminId = (await prisma.user.findUniqueOrThrow({ where: { username: 'qa-admin' } })).id;
  const res = await giveBack(admin, [good(line.id)]).expect(201);
  expect(res.body.returns[0].receivedById).toBe(adminId);
});

test('exactly 50 lines in one return are accepted (SPEC 7)', async () => {
  const cords = await supply(100);
  const lines = await issue(
    ...Array.from({ length: 50 }, () => ({ itemId: cords.id, quantityBorrowed: 1 })),
  );
  const res = await giveBack(
    handler,
    lines.map((line) => good(line.id)),
  ).expect(201);
  expect(res.body.returns).toHaveLength(50);
  expect(await available(cords.id)).toBe(100);
});

test('a quantity of exactly 10,000 is accepted (SPEC 7)', async () => {
  const line = await issueOne((await supply(10_000)).id, 10_000);
  const res = await giveBack(handler, [good(line.id, 10_000)]).expect(201);
  expect(res.body.returns[0].outstanding).toBe(0);
});

test.each([
  ['no lines field', {}],
  ['lines not an array', { lines: 'all of them' }],
  ['quantity as a string', { lines: [{ lineId: randomUUID(), quantity: '1', condition: 'GOOD' }] }],
  ['negative quantity', { lines: [{ lineId: randomUUID(), quantity: -1, condition: 'GOOD' }] }],
  ['missing quantity', { lines: [{ lineId: randomUUID(), condition: 'GOOD' }] }],
  ['missing condition', { lines: [{ lineId: randomUUID(), quantity: 1 }] }],
  ['lower-case condition', { lines: [{ lineId: randomUUID(), quantity: 1, condition: 'good' }] }],
  ['item condition NEW', { lines: [{ lineId: randomUUID(), quantity: 1, condition: 'NEW' }] }],
  ['missing lineId', { lines: [{ quantity: 1, condition: 'GOOD' }] }],
])('%s is VALIDATION_ERROR (SPEC 7)', async (_case, body) => {
  const res = await post(handler, body).expect(400);
  expect(res.body.error.code).toBe('VALIDATION_ERROR');
});

test('the same line twice in different case is still a repeated line (SPEC 7)', async () => {
  const line = await issueOne((await supply()).id, 5);
  const res = await giveBack(handler, [good(line.id), good(line.id.toUpperCase())]).expect(400);
  expect(res.body.error.code).toBe('VALIDATION_ERROR');
  expect(await prisma.return.count()).toBe(0);
});

test('a body over 100 kB is PAYLOAD_TOO_LARGE in the standard format (SPEC 7, S21)', async () => {
  const line = await issueOne((await supply()).id, 1);
  const res = await post(handler, {
    lines: [good(line.id)],
    padding: 'x'.repeat(110_000),
  }).expect(413);
  expect(res.body.error).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  expect(await prisma.return.count()).toBe(0);
});
