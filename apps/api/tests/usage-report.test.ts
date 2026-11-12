import { USAGE_TOP_ROWS } from '@bms/shared';
import request from 'supertest';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { resetDatabase } from './setup/reset-database.ts';

// RPT-4: usage summary (BR section 4, SPEC 7). Test cases TC-RPT-06 and TC-RPT-07 (usage part).

const PASSWORD = 'correct-horse-battery';
let passwordHash: string;
let adminId: string;
let borrowerId: string;
let semesterId: string;
let rooms: Record<string, string>;
let categories: Record<string, string>;
let items: Record<string, string>;

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
  borrowerId = (
    await prisma.borrower.create({
      data: { schoolId: '2026-0001', name: 'James Cruz', type: 'STUDENT', department: 'IT' },
    })
  ).id;
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
  rooms = {};
  for (const name of ['CL-201', 'FA-305']) {
    rooms[name] = (await prisma.location.create({ data: { name, createdById: adminId } })).id;
  }
  categories = {};
  for (const name of ['Cables', 'Computers']) {
    categories[name] = (await prisma.category.create({ data: { name } })).id;
  }
  items = {};
  items.Cord = (
    await prisma.item.create({
      data: {
        name: 'Extension cord',
        categoryId: categories.Cables,
        trackingType: 'QUANTITY',
        totalQuantity: 20,
        condition: 'GOOD',
      },
    })
  ).id;
  items.Laptop = (
    await prisma.item.create({
      data: {
        name: 'Laptop',
        categoryId: categories.Computers,
        trackingType: 'UNIT',
        assetTag: 'LT-0001',
        totalQuantity: 1,
        condition: 'GOOD',
      },
    })
  ).id;
});

// One checkout at `issuedAt` (an ISO instant) in `room`, with one line per item.
async function borrow(issuedAt: string, room: string, itemIds: string[], quantity = 1) {
  await prisma.transaction.create({
    data: {
      borrowerId,
      locationId: rooms[room],
      issuedById: adminId,
      issuedAt: new Date(issuedAt),
      semesterId,
      lines: { create: itemIds.map((itemId) => ({ itemId, quantityBorrowed: quantity })) },
    },
  });
}

async function login(username: string, app = createApp()) {
  const agent = request.agent(app);
  await agent
    .post('/api/auth/login')
    .set('X-Requested-With', 'fetch')
    .send({ username, password: PASSWORD })
    .expect(200);
  return agent;
}

const usage = (agent: request.Agent, query: string) =>
  agent.get(`/api/reports/usage?${query}`).set('X-Requested-With', 'fetch');

test('TC-RPT-06: most borrowed items with counts by category and by room for the period', async () => {
  // Manila is UTC+8: 2026-11-01 starts at 2026-10-31T16:00Z and 2026-11-02 ends at 2026-11-02T16:00Z.
  await borrow('2026-10-31T15:59:59.999Z', 'CL-201', [items.Cord]); // 31 Oct in Manila: outside
  await borrow('2026-10-31T16:00:00.000Z', 'CL-201', [items.Cord, items.Laptop]); // 1 Nov
  await borrow('2026-11-01T03:00:00.000Z', 'FA-305', [items.Cord], 5); // quantity does not count
  await borrow('2026-11-02T15:59:59.999Z', 'FA-305', [items.Cord]); // last moment of 2 Nov
  await borrow('2026-11-02T16:00:00.000Z', 'FA-305', [items.Laptop]); // 3 Nov: outside

  const res = await usage(await login('ana'), 'from=2026-11-01&to=2026-11-02').expect(200);
  expect(res.body).toEqual({
    from: '2026-11-01',
    to: '2026-11-02',
    items: [
      { id: items.Cord, name: 'Extension cord', assetTag: null, timesBorrowed: 3 },
      { id: items.Laptop, name: 'Laptop', assetTag: 'LT-0001', timesBorrowed: 1 },
    ],
    categories: [
      { id: categories.Cables, name: 'Cables', timesBorrowed: 3 },
      { id: categories.Computers, name: 'Computers', timesBorrowed: 1 },
    ],
    // CL-201 has 2 lines in one checkout, FA-305 2 checkouts: a tie, ordered by name.
    rooms: [
      { id: rooms['CL-201'], name: 'CL-201', timesBorrowed: 2 },
      { id: rooms['FA-305'], name: 'FA-305', timesBorrowed: 2 },
    ],
  });
});

test('TC-RPT-06: a category narrows every list, and an empty period gives empty lists', async () => {
  await borrow('2026-11-01T03:00:00.000Z', 'CL-201', [items.Cord, items.Laptop]);
  const agent = await login('ana');

  const res = await usage(
    agent,
    `from=2026-11-01&to=2026-11-01&categoryId=${categories.Computers}`,
  ).expect(200);
  expect(res.body.items.map((row: { name: string }) => row.name)).toEqual(['Laptop']);
  expect(res.body.categories).toEqual([
    { id: categories.Computers, name: 'Computers', timesBorrowed: 1 },
  ]);
  expect(res.body.rooms).toEqual([{ id: rooms['CL-201'], name: 'CL-201', timesBorrowed: 1 }]);

  const empty = await usage(agent, 'from=2026-12-01&to=2026-12-31').expect(200);
  expect(empty.body).toMatchObject({ items: [], categories: [], rooms: [] });
});

test(`TC-RPT-06: each list has at most ${USAGE_TOP_ROWS} rows, most borrowed first`, async () => {
  const many = await prisma.item.createManyAndReturn({
    data: Array.from({ length: USAGE_TOP_ROWS + 2 }, (_, i) => ({
      name: `Cable ${String(i).padStart(2, '0')}`,
      categoryId: categories.Cables,
      trackingType: 'QUANTITY' as const,
      totalQuantity: 10,
      condition: 'GOOD' as const,
    })),
  });
  await borrow('2026-11-01T03:00:00.000Z', 'CL-201', [
    ...many.map((item) => item.id),
    items.Laptop,
  ]);
  await borrow('2026-11-01T04:00:00.000Z', 'CL-201', [items.Laptop]);

  const res = await usage(await login('ana'), 'from=2026-11-01&to=2026-11-01').expect(200);
  expect(res.body.items).toHaveLength(USAGE_TOP_ROWS);
  expect(res.body.items[0]).toMatchObject({ name: 'Laptop', timesBorrowed: 2 });
  expect(res.body.items[1]).toMatchObject({ name: 'Cable 00', timesBorrowed: 1 });
});

test('TC-RPT-06: the range is capped at 366 days, and the end cannot be before the start', async () => {
  const agent = await login('ana');
  // 2028 is a leap year: 1 Jan to 31 Dec is 366 days.
  await usage(agent, 'from=2028-01-01&to=2028-12-31').expect(200);
  const tooLong = await usage(agent, 'from=2028-01-01&to=2029-01-01').expect(400);
  expect(tooLong.body.error.code).toBe('VALIDATION_ERROR');
  expect(tooLong.body.error.details.fields).toHaveProperty('to');

  const backwards = await usage(agent, 'from=2026-11-02&to=2026-11-01').expect(400);
  expect(backwards.body.error.code).toBe('VALIDATION_ERROR');
  for (const query of [
    'to=2026-11-01',
    'from=2026-11-01',
    'from=nope&to=2026-11-01',
    'from=2026-11-01&to=2026-11-01&categoryId=x',
  ]) {
    expect((await usage(agent, query)).body.error.code).toBe('VALIDATION_ERROR');
  }
});

test('TC-RPT-07: admin, handler, and view-only can load the usage summary; signed out cannot', async () => {
  for (const username of ['ana', 'hal', 'vic']) {
    await usage(await login(username), 'from=2026-11-01&to=2026-11-01').expect(200);
  }
  const signedOut = await request(createApp())
    .get('/api/reports/usage?from=2026-11-01&to=2026-11-01')
    .set('X-Requested-With', 'fetch')
    .expect(401);
  expect(signedOut.body.error.code).toBe('UNAUTHENTICATED');
});

test('TC-SEC-05: the usage summary is limited to 30 a minute per client address', async () => {
  const agent = await login('ana');
  const get = (ip: string) =>
    usage(agent, 'from=2026-11-01&to=2026-11-01').set('X-Forwarded-For', ip);
  for (let i = 0; i < 30; i++) expect((await get('10.0.4.1')).status).toBe(200);
  const limited = await get('10.0.4.1');
  expect(limited.status).toBe(429);
  expect(limited.body.error.code).toBe('RATE_LIMITED');
  expect((await get('10.0.4.2')).status).toBe(200);
});
