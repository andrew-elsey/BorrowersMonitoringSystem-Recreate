import request from 'supertest';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { resetDatabase } from './setup/reset-database.ts';

// RPT-2 and RPT-3: borrowing history per borrower and per item (BR section 4, SPEC 7). Test cases
// TC-RPT-03, TC-RPT-04, TC-RPT-05, and the history part of TC-RPT-07 in TEST_CASES.md.

const PASSWORD = 'correct-horse-battery';
let passwordHash: string;
let adminId: string;
let handlerId: string;
let borrowerId: string;
let otherBorrowerId: string;
let locationId: string;
let semesterId: string;
let itemIds: string[];

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  await resetDatabase();
  const users = await prisma.user.createManyAndReturn({
    data: [
      { name: 'Ana Admin', username: 'ana', passwordHash, role: 'ADMIN' },
      { name: 'Hal Handler', username: 'hal', passwordHash, role: 'HANDLER' },
      { name: 'Vic Viewer', username: 'vic', passwordHash, role: 'VIEWER' },
    ],
  });
  adminId = users.find((user) => user.role === 'ADMIN')!.id;
  handlerId = users.find((user) => user.role === 'HANDLER')!.id;
  await prisma.setting.create({ data: { id: 1 } });
  const borrowers = await prisma.borrower.createManyAndReturn({
    data: [
      { schoolId: '2026-0001', name: 'James Cruz', type: 'STUDENT', department: 'IT' },
      { schoolId: '2026-0002', name: 'Liza Ramos', type: 'STUDENT', department: 'IT' },
    ],
  });
  borrowerId = borrowers.find((b) => b.name === 'James Cruz')!.id;
  otherBorrowerId = borrowers.find((b) => b.name === 'Liza Ramos')!.id;
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
  const items = await prisma.item.createManyAndReturn({
    data: [
      {
        name: 'Laptop',
        categoryId,
        trackingType: 'UNIT' as const,
        assetTag: 'LT-0012',
        totalQuantity: 1,
        condition: 'GOOD' as const,
      },
      {
        name: 'Cable',
        categoryId,
        trackingType: 'QUANTITY' as const,
        totalQuantity: 10,
        condition: 'GOOD' as const,
      },
    ],
  });
  itemIds = ['Laptop', 'Cable'].map((name) => items.find((item) => item.name === name)!.id);
});

// One transaction with one line, issued at `issuedAt` by the admin.
async function line(
  issuedAt: string,
  data: {
    item?: number;
    borrower?: string;
    quantity?: number;
    flagStatus?: 'NONE' | 'FLAGGED' | 'OVERRIDDEN';
    note?: string;
  } = {},
) {
  const created = await prisma.transaction.create({
    data: {
      borrowerId: data.borrower ?? borrowerId,
      locationId,
      issuedById: adminId,
      semesterId,
      issuedAt: new Date(issuedAt),
      lines: {
        create: {
          itemId: itemIds[data.item ?? 1]!,
          quantityBorrowed: data.quantity ?? 1,
          flagStatus: data.flagStatus ?? 'NONE',
          note: data.note,
          ...(data.flagStatus === 'OVERRIDDEN' && {
            flaggedAt: new Date('2026-09-01T17:00:00+08:00'),
            overrideById: adminId,
            overrideAt: new Date('2026-09-02T09:00:00+08:00'),
            overrideReason: 'Returned late with permission',
          }),
          ...(data.flagStatus === 'FLAGGED' && {
            flaggedAt: new Date('2026-09-01T17:00:00+08:00'),
          }),
        },
      },
    },
    include: { lines: true },
  });
  return created.lines[0]!;
}

async function login(username: string) {
  const agent = request.agent(createApp());
  await agent
    .post('/api/auth/login')
    .set('X-Requested-With', 'fetch')
    .send({ username, password: PASSWORD })
    .expect(200);
  return agent;
}

const history = (agent: request.Agent, query: string, id = borrowerId) =>
  agent.get(`/api/reports/borrowers/${id}/history?${query}`);

test('TC-RPT-03: history shows room, issuing and receiving handlers, return details, and flag status', async () => {
  const cable = await line('2026-09-01T10:00:00+08:00', {
    quantity: 3,
    flagStatus: 'FLAGGED',
    note: 'Back tomorrow',
  });
  // A partial return by the handler, then the rest by the admin (BR 5).
  await prisma.return.createMany({
    data: [
      {
        transactionItemId: cable.id,
        quantity: 1,
        returnedAt: new Date('2026-09-01T16:00:00+08:00'),
        receivedById: handlerId,
        condition: 'GOOD',
      },
      {
        transactionItemId: cable.id,
        quantity: 2,
        returnedAt: new Date('2026-09-02T08:00:00+08:00'),
        receivedById: adminId,
        condition: 'DAMAGED',
      },
    ],
  });
  await prisma.transactionItem.update({ where: { id: cable.id }, data: { quantityReturned: 3 } });
  await line('2026-09-03T10:00:00+08:00', { item: 0, flagStatus: 'OVERRIDDEN' });
  await line('2026-09-02T10:00:00+08:00', { borrower: otherBorrowerId }); // someone else's

  const admin = await login('ana');
  const res = await history(admin, 'from=2026-09-01&to=2026-09-30').expect(200);
  expect(res.body).toMatchObject({ page: 1, pageSize: 25, total: 2 });
  // Newest issue first.
  const [laptop, cableLine] = res.body.data;
  expect(laptop).toMatchObject({
    item: { name: 'Laptop', assetTag: 'LT-0012' },
    flagStatus: 'OVERRIDDEN',
    override: { by: { name: 'Ana Admin' }, reason: 'Returned late with permission' },
    outstanding: 1,
    returns: [],
  });
  expect(cableLine).toMatchObject({
    lineId: cable.id,
    borrower: { id: borrowerId, schoolId: '2026-0001', name: 'James Cruz' },
    item: { name: 'Cable', assetTag: null },
    room: { id: locationId, name: 'CL-201' },
    issuedAt: '2026-09-01T02:00:00.000Z',
    issuedBy: { id: adminId, name: 'Ana Admin' },
    quantityBorrowed: 3,
    outstanding: 0,
    flagStatus: 'FLAGGED',
    flaggedAt: '2026-09-01T09:00:00.000Z',
    override: null,
    note: 'Back tomorrow',
    expectedReturnDate: null,
    returns: [
      { quantity: 1, condition: 'GOOD', receivedBy: { name: 'Hal Handler' } },
      { quantity: 2, condition: 'DAMAGED', receivedBy: { name: 'Ana Admin' } },
    ],
  });
});

test('TC-RPT-03: the range is whole days in Asia/Manila, both ends included', async () => {
  await line('2026-08-31T23:59:00+08:00'); // the day before
  const first = await line('2026-09-01T00:00:00+08:00'); // 2026-08-31 16:00 UTC
  const last = await line('2026-09-02T23:59:00+08:00');
  await line('2026-09-03T00:00:00+08:00'); // the day after
  const admin = await login('ana');
  const res = await history(admin, 'from=2026-09-01&to=2026-09-02').expect(200);
  expect(res.body.data.map((row: { lineId: string }) => row.lineId)).toEqual([last.id, first.id]);
});

test('TC-RPT-03: the history is paginated', async () => {
  for (let day = 1; day <= 5; day++) {
    await line(`2026-09-0${day}T10:00:00+08:00`);
  }
  const admin = await login('ana');
  const page2 = await history(admin, 'from=2026-09-01&to=2026-09-30&page=2&pageSize=2').expect(200);
  expect(page2.body).toMatchObject({ page: 2, pageSize: 2, total: 5 });
  expect(page2.body.data.map((row: { issuedAt: string }) => row.issuedAt)).toEqual([
    '2026-09-03T02:00:00.000Z',
    '2026-09-02T02:00:00.000Z',
  ]);
  const tooBig = await history(admin, 'from=2026-09-01&to=2026-09-30&pageSize=101').expect(400);
  expect(tooBig.body.error.code).toBe('VALIDATION_ERROR');
});

test('TC-RPT-04 (S21): a 366-day range is accepted, 367 days is VALIDATION_ERROR', async () => {
  const admin = await login('ana');
  // 2026-01-01 to 2027-01-01 is 366 days with both ends included.
  await history(admin, 'from=2026-01-01&to=2027-01-01').expect(200);
  const tooLong = await history(admin, 'from=2026-01-01&to=2027-01-02').expect(400);
  expect(tooLong.body.error.code).toBe('VALIDATION_ERROR');
  expect(tooLong.body.error.details.fields).toEqual({
    to: ['The date range can be at most 366 days.'],
  });
});

test('RPT-2: a missing, reversed, or invalid range and an unknown borrower are refused', async () => {
  const admin = await login('ana');
  for (const query of ['', 'from=2026-09-01', 'from=2026-09-02&to=2026-09-01', 'from=x&to=y']) {
    const res = await history(admin, query).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  }
  const unknown = await history(
    admin,
    'from=2026-09-01&to=2026-09-30',
    '00000000-0000-4000-8000-000000000000',
  ).expect(404);
  expect(unknown.body.error.code).toBe('NOT_FOUND');
  await history(admin, 'from=2026-09-01&to=2026-09-30', 'not-a-uuid').expect(400);
});

test('TC-RPT-07 (S18): view-only users and handlers read the history and pick the borrower', async () => {
  await line('2026-09-01T10:00:00+08:00');
  for (const username of ['vic', 'hal']) {
    const agent = await login(username);
    const found = await agent.get('/api/reports/borrowers?q=Cruz').expect(200);
    expect(found.body.data.map((b: { id: string }) => b.id)).toEqual([borrowerId]);
    const res = await history(agent, 'from=2026-09-01&to=2026-09-30').expect(200);
    expect(res.body.total).toBe(1);
  }
  // The borrower picker has the search bounds (SPEC 7).
  const vic = await login('vic');
  await vic.get('/api/reports/borrowers?q=C').expect(400);
  await vic.get('/api/reports/borrowers').expect(400);
  await request(createApp()).get('/api/reports/borrowers?q=Cruz').expect(401);
});

test('RPT-2 (ARCH 12.3): history is limited to 30 report requests a minute per IP', async () => {
  const admin = await login('ana');
  for (let i = 0; i < 30; i++) {
    await history(admin, 'from=2026-09-01&to=2026-09-30').expect(200);
  }
  const limited = await history(admin, 'from=2026-09-01&to=2026-09-30').expect(429);
  expect(limited.body.error.code).toBe('RATE_LIMITED');
  expect(limited.headers['retry-after']).toBeDefined();
  // The item history shares the same report count.
  await itemHistory(admin, 'from=2026-09-01&to=2026-09-30', itemIds[0]!).expect(429);
});

const itemHistory = (agent: request.Agent, query: string, id: string) =>
  agent.get(`/api/reports/items/${id}/history?${query}`);

test('TC-RPT-05: item history found by item name and by asset tag, same detail, every borrower', async () => {
  const mine = await line('2026-09-01T10:00:00+08:00', { item: 0 });
  await prisma.return.create({
    data: {
      transactionItemId: mine.id,
      quantity: 1,
      returnedAt: new Date('2026-09-01T15:00:00+08:00'),
      receivedById: handlerId,
      condition: 'FAIR',
    },
  });
  await prisma.transactionItem.update({ where: { id: mine.id }, data: { quantityReturned: 1 } });
  const theirs = await line('2026-09-02T10:00:00+08:00', {
    item: 0,
    borrower: otherBorrowerId,
    flagStatus: 'FLAGGED',
  });
  await line('2026-09-03T10:00:00+08:00', { item: 1 }); // another item

  const vic = await login('vic');
  for (const q of ['Laptop', 'lt-0012']) {
    const found = await vic.get(`/api/items?q=${q}`).expect(200);
    expect(found.body.data.map((item: { id: string }) => item.id)).toEqual([itemIds[0]]);
  }
  const res = await itemHistory(vic, 'from=2026-09-01&to=2026-09-30', itemIds[0]!).expect(200);
  expect(res.body).toMatchObject({ page: 1, pageSize: 25, total: 2 });
  expect(res.body.data[0]).toMatchObject({
    lineId: theirs.id,
    borrower: { id: otherBorrowerId, schoolId: '2026-0002', name: 'Liza Ramos' },
    flagStatus: 'FLAGGED',
    outstanding: 1,
  });
  expect(res.body.data[1]).toMatchObject({
    lineId: mine.id,
    borrower: { name: 'James Cruz' },
    item: { name: 'Laptop', assetTag: 'LT-0012' },
    room: { name: 'CL-201' },
    issuedBy: { name: 'Ana Admin' },
    outstanding: 0,
    returns: [{ quantity: 1, condition: 'FAIR', receivedBy: { name: 'Hal Handler' } }],
    flagStatus: 'NONE',
  });

  const page2 = await itemHistory(
    vic,
    'from=2026-09-01&to=2026-09-30&page=2&pageSize=1',
    itemIds[0]!,
  ).expect(200);
  expect(page2.body).toMatchObject({ page: 2, total: 2 });
  expect(page2.body.data.map((row: { lineId: string }) => row.lineId)).toEqual([mine.id]);
});

test('TC-RPT-05: item history has the same range limit; an unknown item is NOT_FOUND', async () => {
  const admin = await login('ana');
  await itemHistory(admin, 'from=2026-01-01&to=2027-01-01', itemIds[0]!).expect(200);
  const tooLong = await itemHistory(admin, 'from=2026-01-01&to=2027-01-02', itemIds[0]!).expect(
    400,
  );
  expect(tooLong.body.error.code).toBe('VALIDATION_ERROR');
  const unknown = await itemHistory(
    admin,
    'from=2026-09-01&to=2026-09-30',
    '00000000-0000-4000-8000-000000000000',
  ).expect(404);
  expect(unknown.body.error.code).toBe('NOT_FOUND');
  await request(createApp())
    .get(`/api/reports/items/${itemIds[0]}/history?from=2026-09-01&to=2026-09-30`)
    .expect(401);
});
