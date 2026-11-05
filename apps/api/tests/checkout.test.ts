import type { ItemStatus } from '@bms/shared';
import request from 'supertest';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { resetDatabase } from './setup/reset-database.ts';

// BRW-2: checkout API (BR 1 to 4, 14; S14, S16). Test cases TC-BRW-04 to TC-BRW-13 in TEST_CASES.md.

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
      { name: 'Hal Handler', username: 'hal', passwordHash, role: 'HANDLER' },
      { name: 'Hana Handler', username: 'hana', passwordHash, role: 'HANDLER' },
      { name: 'Vic Viewer', username: 'vic', passwordHash, role: 'VIEWER' },
    ],
  });
  handlerId = users.find((user) => user.username === 'hal')!.id;
  borrowerId = (
    await prisma.borrower.create({
      data: { schoolId: '2026-0001', name: 'Ana Student', type: 'STUDENT', department: 'IT' },
    })
  ).id;
  locationId = (await prisma.location.create({ data: { name: 'CL-201', createdById: handlerId } }))
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
  categoryId = (await prisma.category.create({ data: { name: 'Equipment' } })).id;
  handler = await signIn('hal');
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

type Line = { itemId: string; quantity: number; note?: string; expectedReturnDate?: string };
const checkout = (agent: typeof handler, lines: Line[], borrower = borrowerId) =>
  agent
    .post('/api/transactions')
    .set('X-Requested-With', 'fetch')
    .send({ borrowerId: borrower, locationId, lines });

const unit = (assetTag: string, status: ItemStatus = 'ACTIVE') =>
  prisma.item.create({
    data: {
      name: 'Laptop',
      categoryId,
      trackingType: 'UNIT',
      assetTag,
      totalQuantity: 1,
      condition: 'GOOD',
      status,
    },
  });
const supply = (totalQuantity: number, status: ItemStatus = 'ACTIVE') =>
  prisma.item.create({
    data: {
      name: 'Extension cord',
      categoryId,
      trackingType: 'QUANTITY',
      totalQuantity,
      condition: 'GOOD',
      status,
    },
  });

const counts = async () => ({
  transactions: await prisma.transaction.count(),
  lines: await prisma.transactionItem.count(),
});

test('TC-BRW-04: handler checks out two items; handler from the session, semester stamped, audited (BR 2, 14)', async () => {
  const laptop = await unit('LT-001');
  const cords = await supply(10);
  const before = Date.now();
  const res = await checkout(handler, [
    { itemId: laptop.id, quantity: 1 },
    { itemId: cords.id, quantity: 3, note: 'returning at 3pm', expectedReturnDate: '2026-11-06' },
  ]).expect(201);

  const { transaction } = res.body;
  expect(transaction).toMatchObject({ borrowerId, locationId, issuedById: handlerId, semesterId });
  expect(Date.parse(transaction.issuedAt)).toBeGreaterThanOrEqual(before - 1000);
  expect(transaction.lines).toHaveLength(2);
  expect(transaction.lines).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ itemId: laptop.id, quantity: 1, note: null }),
      expect.objectContaining({
        itemId: cords.id,
        quantity: 3,
        note: 'returning at 3pm',
        expectedReturnDate: '2026-11-06',
      }),
    ]),
  );
  expect(await counts()).toEqual({ transactions: 1, lines: 2 });

  const entries = await prisma.auditLog.findMany({ where: { entityId: transaction.id } });
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    actorId: handlerId,
    action: 'CHECKOUT',
    entity: 'transaction',
    after: transaction,
  });
});

test('the issuing handler cannot be typed in the body (BR 2)', async () => {
  const laptop = await unit('LT-001');
  const other = await prisma.user.findUniqueOrThrow({ where: { username: 'hana' } });
  const res = await handler
    .post('/api/transactions')
    .set('X-Requested-With', 'fetch')
    .send({
      borrowerId,
      locationId,
      issuedById: other.id,
      lines: [{ itemId: laptop.id, quantity: 1 }],
    })
    .expect(201);
  expect(res.body.transaction.issuedById).toBe(handlerId);
});

test('TC-BRW-05: issuing a unit item that is already out is ITEM_UNAVAILABLE (S14)', async () => {
  const laptop = await unit('LT-001');
  await checkout(handler, [{ itemId: laptop.id, quantity: 1 }]).expect(201);
  const res = await checkout(handler, [{ itemId: laptop.id, quantity: 1 }]).expect(409);
  expect(res.body.error).toMatchObject({
    code: 'ITEM_UNAVAILABLE',
    message: 'Laptop LT-001 is already borrowed.',
    details: { itemId: laptop.id },
  });
});

test('TC-BRW-06: issuing 4 of a quantity item with 3 available is INSUFFICIENT_QUANTITY (S14)', async () => {
  const cords = await supply(5);
  await checkout(handler, [{ itemId: cords.id, quantity: 2 }]).expect(201);
  const res = await checkout(handler, [{ itemId: cords.id, quantity: 4 }]).expect(409);
  expect(res.body.error).toMatchObject({
    code: 'INSUFFICIENT_QUANTITY',
    details: { itemId: cords.id, available: 3 },
  });
  await checkout(handler, [{ itemId: cords.id, quantity: 3 }]).expect(201);
});

test.each(['UNDER_REPAIR', 'LOST', 'RETIRED'] as const)(
  'TC-BRW-07: issuing a %s item is ITEM_UNAVAILABLE (S14)',
  async (status) => {
    const laptop = await unit('LT-001', status);
    const cords = await supply(10, status);
    for (const item of [laptop, cords]) {
      const res = await checkout(handler, [{ itemId: item.id, quantity: 1 }]).expect(409);
      expect(res.body.error.code).toBe('ITEM_UNAVAILABLE');
    }
  },
);

test('TC-BRW-08: issuing to an inactive borrower is BORROWER_INACTIVE (BR 3, S14)', async () => {
  const laptop = await unit('LT-001');
  await prisma.borrower.update({ where: { id: borrowerId }, data: { active: false } });
  const res = await checkout(handler, [{ itemId: laptop.id, quantity: 1 }]).expect(409);
  expect(res.body.error.code).toBe('BORROWER_INACTIVE');
  expect(await counts()).toEqual({ transactions: 0, lines: 0 });
});

test('TC-BRW-09: with no current semester, checkout is NO_CURRENT_SEMESTER (BR 2, S14)', async () => {
  const laptop = await unit('LT-001');
  await prisma.semester.update({ where: { id: semesterId }, data: { isCurrent: false } });
  const res = await checkout(handler, [{ itemId: laptop.id, quantity: 1 }]).expect(409);
  expect(res.body.error.code).toBe('NO_CURRENT_SEMESTER');
});

test('TC-BRW-10: when the second line fails, no transaction, no lines, and no audit entry are created (BR 4, S14)', async () => {
  const laptop = await unit('LT-001');
  const lost = await unit('LT-002', 'LOST');
  await checkout(handler, [
    { itemId: laptop.id, quantity: 1 },
    { itemId: lost.id, quantity: 1 },
  ]).expect(409);
  expect(await counts()).toEqual({ transactions: 0, lines: 0 });
  expect(await prisma.auditLog.count({ where: { action: 'CHECKOUT' } })).toBe(0);
});

test('TC-BRW-11: two handlers issue the same unit item at once; exactly one succeeds (BR 4, S16)', async () => {
  const laptop = await unit('LT-001');
  const other = await signIn('hana');
  const results = await Promise.all([
    checkout(handler, [{ itemId: laptop.id, quantity: 1 }]),
    checkout(other, [{ itemId: laptop.id, quantity: 1 }]),
  ]);
  expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
  expect(results.find((res) => res.status === 409)!.body.error.code).toBe('ITEM_UNAVAILABLE');
  expect(await counts()).toEqual({ transactions: 1, lines: 1 });
});

test('two checkouts listing the same items in opposite orders both finish (no deadlock, BR 4)', async () => {
  const a = await supply(10);
  const b = await supply(10);
  const other = await signIn('hana');
  const results = await Promise.all([
    checkout(handler, [
      { itemId: a.id, quantity: 1 },
      { itemId: b.id, quantity: 1 },
    ]),
    checkout(other, [
      { itemId: b.id, quantity: 1 },
      { itemId: a.id, quantity: 1 },
    ]),
  ]);
  expect(results.map((res) => res.status)).toEqual([201, 201]);
});

test('TC-BRW-12: 51 lines, quantity 0, or quantity 10,001 is VALIDATION_ERROR (SPEC 7, S21)', async () => {
  const cords = await supply(10);
  const many = Array.from({ length: 51 }, () => ({ itemId: cords.id, quantity: 1 }));
  for (const lines of [
    many,
    [{ itemId: cords.id, quantity: 0 }],
    [{ itemId: cords.id, quantity: 10_001 }],
  ]) {
    const res = await checkout(handler, lines).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  }
  expect(await counts()).toEqual({ transactions: 0, lines: 0 });
});

test('other refused input: no lines, a repeated item, a 501-character note, a unit item with quantity 2', async () => {
  const laptop = await unit('LT-001');
  const cords = await supply(10);
  const bad: Line[][] = [
    [],
    [
      { itemId: cords.id, quantity: 1 },
      { itemId: cords.id, quantity: 1 },
    ],
    [{ itemId: cords.id, quantity: 1, note: 'x'.repeat(501) }],
    [{ itemId: laptop.id, quantity: 2 }],
  ];
  for (const lines of bad) {
    const res = await checkout(handler, lines).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  }
});

test('an unknown item, borrower, or room is NOT_FOUND', async () => {
  const laptop = await unit('LT-001');
  const missing = '00000000-0000-0000-0000-000000000000';
  await checkout(handler, [{ itemId: missing, quantity: 1 }]).expect(404);
  await checkout(handler, [{ itemId: laptop.id, quantity: 1 }], missing).expect(404);
  await handler
    .post('/api/transactions')
    .set('X-Requested-With', 'fetch')
    .send({ borrowerId, locationId: missing, lines: [{ itemId: laptop.id, quantity: 1 }] })
    .expect(404);
  expect(await counts()).toEqual({ transactions: 0, lines: 0 });
});

test('TC-BRW-13: a view-only user gets 403 and a signed-out request 401 (SPEC 3, S18)', async () => {
  const laptop = await unit('LT-001');
  const viewer = await signIn('vic');
  const res = await checkout(viewer, [{ itemId: laptop.id, quantity: 1 }]).expect(403);
  expect(res.body.error.code).toBe('FORBIDDEN');
  await checkout(request.agent(createApp()), [{ itemId: laptop.id, quantity: 1 }]).expect(401);
});
