import type { ItemStatus } from '@bms/shared';
import request from 'supertest';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { resetDatabase } from './setup/reset-database.ts';

// QA (automated) gap tests for BRW-2 (checkout, BR 1 to 4, 7, 14; S14, S16): an admin as issuer,
// the semester stamped after the current semester changes, concurrent QUANTITY checkouts, the exact
// reply and stored rows, the audit row, atomicity for every kind of later-line failure, and the
// bounds on quantity, note, expected return date, and body size.

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
      data: { schoolId: 'QA-0001', name: 'Test Borrower', type: 'STUDENT', department: 'QA' },
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

const post = (agent: typeof handler, body: unknown) =>
  agent
    .post('/api/transactions')
    .set('X-Requested-With', 'fetch')
    .send(body as object);
const checkout = (agent: typeof handler, lines: unknown[]) =>
  post(agent, { borrowerId, locationId, lines });

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
const supply = (totalQuantity: number, status: ItemStatus = 'ACTIVE') =>
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

const nothingCreated = async () => {
  expect(await prisma.transaction.count()).toBe(0);
  expect(await prisma.transactionItem.count()).toBe(0);
  expect(await prisma.auditLog.count({ where: { action: 'CHECKOUT' } })).toBe(0);
};

test('an admin can check out, and is recorded as the issuing handler (BR 2)', async () => {
  const cords = await supply(5);
  const admin = await signIn('qa-admin');
  const adminId = (await prisma.user.findUniqueOrThrow({ where: { username: 'qa-admin' } })).id;
  const res = await checkout(admin, [{ itemId: cords.id, quantity: 1 }]).expect(201);
  expect(res.body.transaction.issuedById).toBe(adminId);
  const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'CHECKOUT' } });
  expect(entry.actorId).toBe(adminId);
});

test('stamps the semester that is current at checkout time; earlier transactions keep theirs (BR 2)', async () => {
  const cords = await supply(10);
  const first = await checkout(handler, [{ itemId: cords.id, quantity: 1 }]).expect(201);
  await prisma.semester.update({ where: { id: semesterId }, data: { isCurrent: false } });
  const second = await prisma.semester.create({
    data: {
      name: 'QA S2',
      startDate: new Date('2027-01-05'),
      endDate: new Date('2027-05-20'),
      isCurrent: true,
    },
  });
  const res = await checkout(handler, [{ itemId: cords.id, quantity: 1 }]).expect(201);
  expect(res.body.transaction.semesterId).toBe(second.id);
  const stored = await prisma.transaction.findUniqueOrThrow({
    where: { id: first.body.transaction.id },
  });
  expect(stored.semesterId).toBe(semesterId);
});

test('concurrent checkouts on a QUANTITY item cannot together go over its total (BR 4)', async () => {
  const cords = await supply(5);
  const other = await signIn('qa-handler-2');
  const results = await Promise.all([
    checkout(handler, [{ itemId: cords.id, quantity: 3 }]),
    checkout(other, [{ itemId: cords.id, quantity: 3 }]),
  ]);
  expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
  expect(results.find((res) => res.status === 409)!.body.error).toMatchObject({
    code: 'INSUFFICIENT_QUANTITY',
    details: { itemId: cords.id, available: 2 },
  });
  const lines = await prisma.transactionItem.findMany({ where: { itemId: cords.id } });
  expect(lines.reduce((sum, line) => sum + line.quantityBorrowed, 0)).toBe(3);
});

test('five concurrent checkouts of 1 from a total of 3: exactly three succeed (BR 4)', async () => {
  const cords = await supply(3);
  const agents = [handler, await signIn('qa-handler-2'), await signIn('qa-admin')];
  const results = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      checkout(agents[i % agents.length]!, [{ itemId: cords.id, quantity: 1 }]),
    ),
  );
  expect(results.filter((res) => res.status === 201)).toHaveLength(3);
  expect(results.filter((res) => res.status === 409)).toHaveLength(2);
  expect(await prisma.transactionItem.count({ where: { itemId: cords.id } })).toBe(3);
});

test('the 201 reply has exactly the documented fields, and the stored line starts unflagged and unreturned', async () => {
  const laptop = await unit('QA-LT-1');
  const res = await checkout(handler, [{ itemId: laptop.id, quantity: 1 }]).expect(201);
  expect(Object.keys(res.body)).toEqual(['transaction']);
  const { transaction } = res.body;
  expect(Object.keys(transaction).sort()).toEqual(
    ['borrowerId', 'id', 'issuedAt', 'issuedById', 'lines', 'locationId', 'semesterId'].sort(),
  );
  // issuedAt is ISO 8601 in UTC (ARCHITECTURE 7).
  expect(transaction.issuedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(transaction.lines).toEqual([
    {
      id: expect.any(String),
      itemId: laptop.id,
      quantity: 1,
      note: null,
      expectedReturnDate: null,
    },
  ]);
  const line = await prisma.transactionItem.findUniqueOrThrow({
    where: { id: transaction.lines[0].id },
  });
  expect(line).toMatchObject({
    transactionId: transaction.id,
    quantityBorrowed: 1,
    quantityReturned: 0,
    flagStatus: 'NONE',
    flaggedAt: null,
    overrideById: null,
  });
});

test('the CHECKOUT audit row has no before, the reply as after, and is the only audit row written (BR 14)', async () => {
  const cords = await supply(5);
  const auditBefore = await prisma.auditLog.count();
  const res = await checkout(handler, [{ itemId: cords.id, quantity: 2, note: 'QA note' }]).expect(
    201,
  );
  expect(await prisma.auditLog.count()).toBe(auditBefore + 1);
  const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'CHECKOUT' } });
  expect(entry).toMatchObject({
    actorId: handlerId,
    entity: 'transaction',
    entityId: res.body.transaction.id,
    before: null,
    after: res.body.transaction,
  });
});

test.each([
  ['an over-quantity QUANTITY line', 'INSUFFICIENT_QUANTITY', 409],
  ['a unit line with quantity 2', 'VALIDATION_ERROR', 400],
  ['an unknown item', 'NOT_FOUND', 404],
  ['a unit item already out', 'ITEM_UNAVAILABLE', 409],
] as const)(
  'when the last line is %s, nothing is created and earlier lines stay available (BR 4)',
  async (kind, code, status) => {
    const cords = await supply(5);
    const laptop = await unit('QA-LT-1');
    const outLaptop = await unit('QA-LT-2');
    let lastLine: { itemId: string; quantity: number };
    if (kind === 'an over-quantity QUANTITY line') {
      lastLine = { itemId: (await supply(2)).id, quantity: 3 };
    } else if (kind === 'a unit line with quantity 2') {
      lastLine = { itemId: outLaptop.id, quantity: 2 };
    } else if (kind === 'an unknown item') {
      lastLine = { itemId: '00000000-0000-4000-8000-000000000000', quantity: 1 };
    } else {
      await checkout(handler, [{ itemId: outLaptop.id, quantity: 1 }]).expect(201);
      lastLine = { itemId: outLaptop.id, quantity: 1 };
    }
    const txBefore = await prisma.transaction.count();
    const linesBefore = await prisma.transactionItem.count();
    const auditBefore = await prisma.auditLog.count();
    const res = await checkout(handler, [
      { itemId: cords.id, quantity: 5 },
      { itemId: laptop.id, quantity: 1 },
      lastLine,
    ]).expect(status);
    expect(res.body.error.code).toBe(code);
    expect(await prisma.transaction.count()).toBe(txBefore);
    expect(await prisma.transactionItem.count()).toBe(linesBefore);
    expect(await prisma.auditLog.count()).toBe(auditBefore);
    // The earlier lines' items were not taken.
    await checkout(handler, [
      { itemId: cords.id, quantity: 5 },
      { itemId: laptop.id, quantity: 1 },
    ]).expect(201);
  },
);

test('a QUANTITY line for exactly the available amount, at the 10,000 maximum, is accepted (BR 1, SPEC 7)', async () => {
  const cords = await supply(10_000);
  await checkout(handler, [{ itemId: cords.id, quantity: 10_000 }]).expect(201);
  const res = await checkout(handler, [{ itemId: cords.id, quantity: 1 }]).expect(409);
  expect(res.body.error.details).toMatchObject({ available: 0 });
});

test('a QUANTITY item with a total of 0 is INSUFFICIENT_QUANTITY with available 0 (owner decision 4)', async () => {
  const cords = await supply(0);
  const res = await checkout(handler, [{ itemId: cords.id, quantity: 1 }]).expect(409);
  expect(res.body.error).toMatchObject({
    code: 'INSUFFICIENT_QUANTITY',
    details: { itemId: cords.id, available: 0 },
  });
});

test('a non-ACTIVE QUANTITY item is ITEM_UNAVAILABLE even when the quantity is also too high (S14 order)', async () => {
  const cords = await supply(2, 'UNDER_REPAIR');
  const res = await checkout(handler, [{ itemId: cords.id, quantity: 5 }]).expect(409);
  expect(res.body.error.code).toBe('ITEM_UNAVAILABLE');
});

test.each([1.5, -1, '1', null, Number.MAX_SAFE_INTEGER])(
  'a line quantity of %j is VALIDATION_ERROR (SPEC 7)',
  async (quantity) => {
    const cords = await supply(10);
    const res = await checkout(handler, [{ itemId: cords.id, quantity }]).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    await nothingCreated();
  },
);

test('a line without a quantity is VALIDATION_ERROR', async () => {
  const cords = await supply(10);
  const res = await checkout(handler, [{ itemId: cords.id }]).expect(400);
  expect(res.body.error.code).toBe('VALIDATION_ERROR');
});

test('a note of exactly 500 characters is saved (SPEC 7)', async () => {
  const cords = await supply(10);
  const note = 'n'.repeat(500);
  const res = await checkout(handler, [{ itemId: cords.id, quantity: 1, note }]).expect(201);
  expect(res.body.transaction.lines[0].note).toBe(note);
});

test('a note is trimmed, and an empty or blank note is saved as no note (BR 7)', async () => {
  const a = await supply(10);
  const b = await supply(10);
  const c = await supply(10);
  const res = await checkout(handler, [
    { itemId: a.id, quantity: 1, note: '  back at 3pm  ' },
    { itemId: b.id, quantity: 1, note: '' },
    { itemId: c.id, quantity: 1, note: '   ' },
  ]).expect(201);
  const noteFor = (id: string) =>
    res.body.transaction.lines.find((line: { itemId: string }) => line.itemId === id).note;
  expect(noteFor(a.id)).toBe('back at 3pm');
  expect(noteFor(b.id)).toBeNull();
  expect(noteFor(c.id)).toBeNull();
});

test.each(['line one\nline two', 'bell\u0007', 'nul\u0000x', 'tab\tinside', 'del\u007f'])(
  'a note with a control character (%j) is VALIDATION_ERROR (SPEC 7)',
  async (note) => {
    const cords = await supply(10);
    const res = await checkout(handler, [{ itemId: cords.id, quantity: 1, note }]).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    await nothingCreated();
  },
);

test('a non-string note is VALIDATION_ERROR', async () => {
  const cords = await supply(10);
  await checkout(handler, [{ itemId: cords.id, quantity: 1, note: 42 }]).expect(400);
});

test.each([
  '2026-02-30',
  '2027-02-29',
  '2026-13-01',
  '2026-11-5',
  '2026-11-05T00:00:00Z',
  '',
  'tomorrow',
])(
  'an expected return date of %j is VALIDATION_ERROR, never a 500 (SPEC 7)',
  async (expectedReturnDate) => {
    const cords = await supply(10);
    const res = await checkout(handler, [
      { itemId: cords.id, quantity: 1, expectedReturnDate },
    ]).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    await nothingCreated();
  },
);

test('far-future and leap-day expected return dates are saved as sent (BR 7: no upper limit)', async () => {
  const a = await supply(10);
  const b = await supply(10);
  const res = await checkout(handler, [
    { itemId: a.id, quantity: 1, expectedReturnDate: '9999-12-31' },
    { itemId: b.id, quantity: 1, expectedReturnDate: '2028-02-29' },
  ]).expect(201);
  const stored = await prisma.transactionItem.findMany({
    where: { transactionId: res.body.transaction.id },
  });
  expect(stored.map((line) => line.expectedReturnDate?.toISOString().slice(0, 10)).sort()).toEqual([
    '2028-02-29',
    '9999-12-31',
  ]);
});

test('an expected return date in the past on the second line names that line (BR 7)', async () => {
  const a = await supply(10);
  const b = await supply(10);
  const res = await checkout(handler, [
    { itemId: a.id, quantity: 1, expectedReturnDate: '2099-01-01' },
    { itemId: b.id, quantity: 1, expectedReturnDate: '2001-01-01' },
  ]).expect(400);
  expect(Object.keys(res.body.error.details.fields)).toEqual(['lines.1.expectedReturnDate']);
  await nothingCreated();
});

test.each([
  ['borrowerId', { borrowerId: 'not-a-uuid' }],
  ['locationId', { locationId: 42 }],
  ['lines', { lines: 'all of them' }],
])('a malformed %s is VALIDATION_ERROR', async (_field, override) => {
  const cords = await supply(10);
  const res = await post(handler, {
    borrowerId,
    locationId,
    lines: [{ itemId: cords.id, quantity: 1 }],
    ...override,
  }).expect(400);
  expect(res.body.error.code).toBe('VALIDATION_ERROR');
});

test('a body over 100 kB is PAYLOAD_TOO_LARGE in the standard format (SPEC 7, S21)', async () => {
  const cords = await supply(10);
  const res = await post(handler, {
    borrowerId,
    locationId,
    lines: [{ itemId: cords.id, quantity: 1, note: 'x'.repeat(110_000) }],
  }).expect(413);
  expect(res.body.error).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  await nothingCreated();
});

test('a deactivated borrower is refused before any item is locked or checked (BR 3)', async () => {
  // Both the borrower and the item are bad: the borrower refusal is reported.
  const lost = await unit('QA-LT-1', 'LOST');
  await prisma.borrower.update({ where: { id: borrowerId }, data: { active: false } });
  const res = await checkout(handler, [{ itemId: lost.id, quantity: 1 }]).expect(409);
  expect(res.body.error.code).toBe('BORROWER_INACTIVE');
});
