import { randomUUID } from 'node:crypto';
import type { ItemStatus } from '@bms/shared';
import request from 'supertest';
import { beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { resetDatabase } from './setup/reset-database.ts';

// BRW-2: checkout API (BR 1 to 4, 14; S14, S16). Test cases TC-BRW-04 to TC-BRW-13, TC-BRW-34, and
// TC-BRW-35 in TEST_CASES.md.

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
  // FLG-3: checkout reads the strike thresholds from the settings row.
  await prisma.setting.create({ data: { id: 1 } });
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
    { itemId: cords.id, quantity: 3, note: 'returning at 3pm', expectedReturnDate: '2099-12-31' },
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
        expectedReturnDate: '2099-12-31',
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

test('a quantity item with none left is INSUFFICIENT_QUANTITY with available 0 (BR 1)', async () => {
  const cords = await supply(2);
  await checkout(handler, [{ itemId: cords.id, quantity: 2 }]).expect(201);
  const res = await checkout(handler, [{ itemId: cords.id, quantity: 1 }]).expect(409);
  expect(res.body.error).toMatchObject({
    code: 'INSUFFICIENT_QUANTITY',
    details: { itemId: cords.id, available: 0 },
  });
});

test('ids in capitals work, and the same item in two cases is a repeated item', async () => {
  const laptop = await unit('LT-001');
  const cords = await supply(10);
  const upper = cords.id.toUpperCase();
  await checkout(handler, [
    { itemId: cords.id, quantity: 1 },
    { itemId: upper, quantity: 1 },
  ]).expect(400);
  const res = await handler
    .post('/api/transactions')
    .set('X-Requested-With', 'fetch')
    .send({
      borrowerId: borrowerId.toUpperCase(),
      locationId: locationId.toUpperCase(),
      lines: [
        { itemId: laptop.id.toUpperCase(), quantity: 1 },
        { itemId: upper, quantity: 1 },
      ],
    })
    .expect(201);
  expect(res.body.transaction).toMatchObject({ borrowerId, locationId });
});

test('TC-BRW-35: an expected return date before today in Asia/Manila is VALIDATION_ERROR (BR 7)', async () => {
  const cords = await supply(10);
  let agent = handler;
  const withDate = (expectedReturnDate: string) =>
    checkout(agent, [{ itemId: cords.id, quantity: 1, expectedReturnDate }]);
  // Only Date is faked, so timers in supertest and pg keep working.
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    // 23:59:59 on 5 Nov in Manila (UTC+8): today is 5 Nov there, though 4 Nov is long gone in UTC.
    vi.setSystemTime(new Date('2026-11-05T15:59:59Z'));
    // Sign in at the faked time, so the session is not idle-expired.
    agent = await signIn('hal');
    const res = await withDate('2026-11-04').expect(400);
    expect(res.body.error.details.fields['lines.0.expectedReturnDate']).toEqual([
      'Choose today or a later date.',
    ]);
    await withDate('2026-11-05').expect(201);
    // 00:00 on 6 Nov in Manila, still 5 Nov in UTC: 5 Nov is now in the past.
    vi.setSystemTime(new Date('2026-11-05T16:00:00Z'));
    await withDate('2026-11-05').expect(400);
    await withDate('2026-11-06').expect(201);
  } finally {
    vi.useRealTimers();
  }
});

test('TC-BRW-34: checkout in an inactive room is LOCATION_INACTIVE, for admins too (BR 2)', async () => {
  const cords = await supply(10);
  await prisma.location.update({ where: { id: locationId }, data: { active: false } });
  await prisma.user.create({
    data: { name: 'Ana Admin', username: 'ana', passwordHash, role: 'ADMIN' },
  });
  for (const agent of [handler, await signIn('ana')]) {
    const res = await checkout(agent, [{ itemId: cords.id, quantity: 1 }]).expect(409);
    expect(res.body.error).toMatchObject({
      code: 'LOCATION_INACTIVE',
      message: 'This room is no longer in use. Ask an admin to reactivate it.',
    });
  }
  expect(await counts()).toEqual({ transactions: 0, lines: 0 });
});

test('an expected return date in year 0 is VALIDATION_ERROR, not a 500', async () => {
  const cords = await supply(10);
  const res = await checkout(handler, [
    { itemId: cords.id, quantity: 1, expectedReturnDate: '0000-01-01' },
  ]).expect(400);
  expect(res.body.error.details.fields.lines).toEqual(['Enter a real date.']);
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
  // 51 different ids, so only the line limit can refuse it.
  const many = Array.from({ length: 51 }, () => ({ itemId: randomUUID(), quantity: 1 }));
  const tooMany = await checkout(handler, many).expect(400);
  expect(tooMany.body.error.details.fields.lines).toEqual(['At most 50 items per checkout.']);
  // Exactly 50 pass the schema; the unknown ids are then NOT_FOUND.
  const fifty = await checkout(handler, many.slice(0, 50)).expect(404);
  expect(fifty.body.error.code).toBe('NOT_FOUND');
  for (const lines of [
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
