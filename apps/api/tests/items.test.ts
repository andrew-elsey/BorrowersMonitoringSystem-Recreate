import request from 'supertest';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { resetDatabase } from './setup/reset-database.ts';

// MD-2: items CRUD. Test cases TC-MD-04 to TC-MD-08 and TC-MD-29 in TEST_CASES.md.

const PASSWORD = 'correct-horse-battery';
let passwordHash: string;
let admin: ReturnType<typeof request.agent>;
let adminId: string;
let laptops: string;
let cables: string;

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
  [laptops, cables] = (
    await prisma.category.createManyAndReturn({
      data: [{ name: 'Laptops' }, { name: 'Cables' }],
    })
  ).map((category) => category.id);
  admin = await signIn('ana');
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

// Every state-changing request needs the CSRF header (ARCHITECTURE.md 5).
const post = (agent: typeof admin, body: object) =>
  agent.post('/api/items').set('X-Requested-With', 'fetch').send(body);
const patch = (agent: typeof admin, id: string, body: object) =>
  agent.patch(`/api/items/${id}`).set('X-Requested-With', 'fetch').send(body);
const del = (agent: typeof admin, id: string) =>
  agent.delete(`/api/items/${id}`).set('X-Requested-With', 'fetch');
const list = (agent: typeof admin, query: string) =>
  agent.get(`/api/items?${query}`).set('X-Requested-With', 'fetch');

const auditFor = (entityId: string) =>
  prisma.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } });

const laptop = (assetTag: string, extra: object = {}) => ({
  trackingType: 'UNIT',
  name: 'Laptop',
  categoryId: laptops,
  assetTag,
  condition: 'GOOD',
  status: 'ACTIVE',
  ...extra,
});
const cord = (extra: object = {}) => ({
  trackingType: 'QUANTITY',
  name: 'Extension cord',
  categoryId: cables,
  totalQuantity: 20,
  condition: 'GOOD',
  status: 'ACTIVE',
  ...extra,
});

function expectFieldError(response: request.Response, status: number, code: string, field: string) {
  expect(response.status).toBe(status);
  expect(response.body.error.code).toBe(code);
  expect(response.body.error.details.fields[field]).toHaveLength(1);
}

// One transaction line for the item, so it has history. Fully returned unless told otherwise.
async function borrowOnce(
  itemId: string,
  quantityBorrowed = 1,
  quantityReturned = quantityBorrowed,
) {
  const borrower = await prisma.borrower.create({
    data: { schoolId: '2026-0001', name: 'Student', type: 'STUDENT', department: 'IT' },
  });
  const location = await prisma.location.create({ data: { name: 'Lab 1', createdById: adminId } });
  const semester = await prisma.semester.create({
    data: {
      name: 'S1',
      startDate: new Date('2026-08-01'),
      endDate: new Date('2026-12-15'),
      isCurrent: true,
    },
  });
  const transaction = await prisma.transaction.create({
    data: {
      borrowerId: borrower.id,
      locationId: location.id,
      issuedById: adminId,
      semesterId: semester.id,
    },
  });
  await prisma.transactionItem.create({
    data: { transactionId: transaction.id, itemId, quantityBorrowed, quantityReturned },
  });
}

test('TC-BRW-37: the item list gives each item its available count, with no borrower details (BR 1)', async () => {
  const out = (await post(admin, laptop('LT-001')).expect(201)).body.item;
  const free = (await post(admin, laptop('LT-002')).expect(201)).body.item;
  const repair = (await post(admin, laptop('LT-003', { status: 'UNDER_REPAIR' })).expect(201)).body
    .item;
  const cords = (await post(admin, cord()).expect(201)).body.item;
  await borrowOnce(out.id, 1, 0);
  await prisma.transactionItem.create({
    data: {
      transactionId: (await prisma.transaction.findFirstOrThrow()).id,
      itemId: cords.id,
      quantityBorrowed: 5,
      quantityReturned: 2,
    },
  });

  const { body } = await list(await signIn('hal'), 'pageSize=10').expect(200);
  const available = Object.fromEntries(
    body.data.map((item: { id: string; available: number }) => [item.id, item.available]),
  );
  // Unit out: 0; unit free: 1; not ACTIVE: 0; quantity: 20 - (5 - 2) = 17.
  expect(available).toEqual({ [out.id]: 0, [free.id]: 1, [repair.id]: 0, [cords.id]: 17 });
  expect(Object.keys(body.data[0]).sort()).toEqual(
    [
      'assetTag',
      'available',
      'category',
      'condition',
      'description',
      'id',
      'name',
      'status',
      'totalQuantity',
      'trackingType',
    ].sort(),
  );
});

test('TC-MD-04: a UNIT item needs a unique asset tag and a total quantity of 1 (SPEC 4)', async () => {
  const created = await post(admin, laptop('LT-001')).expect(201);
  expect(created.body.item).toMatchObject({
    trackingType: 'UNIT',
    assetTag: 'LT-001',
    totalQuantity: 1,
    category: { id: laptops, name: 'Laptops' },
  });

  expectFieldError(
    await post(admin, { ...laptop(''), assetTag: undefined }),
    400,
    'VALIDATION_ERROR',
    'assetTag',
  );
  expectFieldError(await post(admin, laptop('LT-001')), 409, 'DUPLICATE_VALUE', 'assetTag');
  expectFieldError(
    await post(admin, laptop('LT-002', { totalQuantity: 2 })),
    400,
    'VALIDATION_ERROR',
    'totalQuantity',
  );
  // On edit too: a UNIT item stays one piece.
  expectFieldError(
    await patch(admin, created.body.item.id, { totalQuantity: 3 }),
    400,
    'VALIDATION_ERROR',
    'totalQuantity',
  );
  expect(await prisma.item.count()).toBe(1);
});

test('TC-MD-05: a QUANTITY item has no asset tag and a total of 0 to 10,000 (SPEC 4, 7)', async () => {
  expectFieldError(
    await post(admin, cord({ assetTag: 'EC-001' })),
    400,
    'VALIDATION_ERROR',
    'assetTag',
  );
  for (const totalQuantity of [-1, 10_001, 2.5, '5', undefined]) {
    expectFieldError(
      await post(admin, cord({ totalQuantity })),
      400,
      'VALIDATION_ERROR',
      'totalQuantity',
    );
  }
  expect(await prisma.item.count()).toBe(0);

  const zero = await post(admin, cord({ totalQuantity: 0 })).expect(201);
  expect(zero.body.item).toMatchObject({ assetTag: null, totalQuantity: 0 });
  await post(admin, cord({ totalQuantity: 10_000 })).expect(201);
  // On edit too: no asset tag can be added.
  expectFieldError(
    await patch(admin, zero.body.item.id, { assetTag: 'EC-001' }),
    400,
    'VALIDATION_ERROR',
    'assetTag',
  );
});

test('TC-MD-06: search and filter by name, category, status, and tracking type, paginated (SPEC 7)', async () => {
  await post(admin, laptop('LT-001')).expect(201);
  await post(admin, laptop('LT-002', { status: 'RETIRED' })).expect(201);
  await post(admin, laptop('PRJ-100', { name: 'Projector 100%' })).expect(201);
  await post(admin, cord()).expect(201);

  const names = async (query: string) =>
    (await list(admin, query).expect(200)).body.data.map(
      (item: { name: string; assetTag: string | null }) => item.assetTag ?? item.name,
    );
  expect(await names('')).toEqual(['Extension cord', 'LT-001', 'LT-002', 'PRJ-100']);
  expect(await names('q=LAPTOP')).toEqual(['LT-001', 'LT-002']);
  // Asset tags match too, and % is plain text, not a wildcard.
  expect(await names('q=prj')).toEqual(['PRJ-100']);
  expect(await names('q=0%25')).toEqual(['PRJ-100']);
  expect(await names(`categoryId=${cables}`)).toEqual(['Extension cord']);
  expect(await names('status=RETIRED')).toEqual(['LT-002']);
  expect(await names('trackingType=QUANTITY')).toEqual(['Extension cord']);
  expect(await names(`trackingType=UNIT&status=ACTIVE&categoryId=${laptops}&q=lap`)).toEqual([
    'LT-001',
  ]);

  const page2 = (await list(admin, 'page=2&pageSize=3').expect(200)).body;
  expect(page2).toMatchObject({ page: 2, pageSize: 3, total: 4 });
  expect(page2.data).toHaveLength(1);
  await list(admin, 'pageSize=100').expect(200);

  for (const bad of [
    'pageSize=101',
    'q=a',
    `q=${'a'.repeat(101)}`,
    'q=ab%00',
    'status=GONE',
    'trackingType=BOX',
    'categoryId=nope',
  ]) {
    const response = await list(admin, bad);
    expect(response.status, bad).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  }
});

test('TC-MD-07: an item with history cannot be deleted and is told to retire; one without is deleted (BR 15, S19)', async () => {
  const used = (await post(admin, laptop('LT-001')).expect(201)).body.item;
  const unused = (await post(admin, laptop('LT-002')).expect(201)).body.item;
  await borrowOnce(used.id);

  const refused = await del(admin, used.id).expect(409);
  expect(refused.body.error.code).toBe('HAS_HISTORY');
  expect(refused.body.error.message).toMatch(/Retired instead/);
  expect(await prisma.item.findUnique({ where: { id: used.id } })).not.toBeNull();
  expect(await auditFor(used.id)).toHaveLength(1);

  await del(admin, unused.id).expect(204);
  expect(await prisma.item.findUnique({ where: { id: unused.id } })).toBeNull();
  expect(await auditFor(unused.id)).toMatchObject([
    { action: 'ITEM_CREATED' },
    { action: 'ITEM_DELETED', actorId: adminId, before: { assetTag: 'LT-002' } },
  ]);
  expect((await del(admin, unused.id)).body.error.code).toBe('NOT_FOUND');
});

test('TC-MD-08: create, edit, and retire are each audited (BR 14)', async () => {
  const created = await post(admin, cord({ description: '  5 m, orange  ' })).expect(201);
  const { id } = created.body.item;
  expect(created.body.item.description).toBe('5 m, orange');

  const edited = await patch(admin, id, {
    name: 'Extension cord, 5 m',
    totalQuantity: 25,
    description: '',
    categoryId: cables,
  }).expect(200);
  expect(edited.body.item).toMatchObject({
    name: 'Extension cord, 5 m',
    totalQuantity: 25,
    description: null,
  });

  // Retiring is setting the status (BR 15).
  const retired = await patch(admin, id, { status: 'RETIRED' }).expect(200);
  expect(retired.body.item.status).toBe('RETIRED');
  // Saving the same values changes nothing and writes nothing.
  await patch(admin, id, { status: 'RETIRED' }).expect(200);

  expect(await auditFor(id)).toMatchObject([
    {
      actorId: adminId,
      action: 'ITEM_CREATED',
      entity: 'item',
      after: { name: 'Extension cord', trackingType: 'QUANTITY', totalQuantity: 20 },
    },
    {
      action: 'ITEM_UPDATED',
      // categoryId did not change, so it is not in the entry.
      before: { name: 'Extension cord', totalQuantity: 20, description: '5 m, orange' },
      after: { name: 'Extension cord, 5 m', totalQuantity: 25, description: null },
    },
    { action: 'ITEM_UPDATED', before: { status: 'ACTIVE' }, after: { status: 'RETIRED' } },
  ]);
  expect((await auditFor(id))[1]!.before).not.toHaveProperty('categoryId');
});

test('TC-MD-29: asset tags are unique regardless of case; an item can change its own case (SPEC 4)', async () => {
  const lt = (await post(admin, laptop('LT-001')).expect(201)).body.item;
  const other = (await post(admin, laptop('PRJ-001')).expect(201)).body.item;

  expectFieldError(await post(admin, laptop('lt-001')), 409, 'DUPLICATE_VALUE', 'assetTag');
  expectFieldError(
    await patch(admin, other.id, { assetTag: 'Lt-001' }),
    409,
    'DUPLICATE_VALUE',
    'assetTag',
  );

  // Stored as typed.
  const edited = await patch(admin, lt.id, { assetTag: 'lt-001' }).expect(200);
  expect(edited.body.item.assetTag).toBe('lt-001');
  expect(await auditFor(lt.id)).toMatchObject([
    { action: 'ITEM_CREATED' },
    { action: 'ITEM_UPDATED', before: { assetTag: 'LT-001' }, after: { assetTag: 'lt-001' } },
  ]);
});

test('the tracking type cannot be changed after creation (owner decision 2026-11-03)', async () => {
  const { id } = (await post(admin, laptop('LT-001')).expect(201)).body.item;
  expectFieldError(
    await patch(admin, id, { trackingType: 'QUANTITY', totalQuantity: 5 }),
    400,
    'VALIDATION_ERROR',
    'trackingType',
  );
  expect(await prisma.item.findUnique({ where: { id } })).toMatchObject({ trackingType: 'UNIT' });
});

test('fields are checked: category must exist, text limits, no control characters (SPEC 7)', async () => {
  const missingCategory = laptop('LT-001', { categoryId: '00000000-0000-0000-0000-000000000000' });
  expectFieldError(await post(admin, missingCategory), 400, 'VALIDATION_ERROR', 'categoryId');
  expectFieldError(
    await post(admin, laptop('LT-001', { name: 'x'.repeat(201) })),
    400,
    'VALIDATION_ERROR',
    'name',
  );
  expectFieldError(
    await post(admin, laptop('LT-001', { name: 'Lap\u0000top' })),
    400,
    'VALIDATION_ERROR',
    'name',
  );
  expectFieldError(
    await post(admin, cord({ description: 'x'.repeat(1001) })),
    400,
    'VALIDATION_ERROR',
    'description',
  );
  expectFieldError(
    await post(admin, cord({ description: 'a\u0000b' })),
    400,
    'VALIDATION_ERROR',
    'description',
  );
  // Line breaks are fine in a description.
  await post(admin, cord({ description: 'Two lines\nof text' })).expect(201);

  const { id } = (await post(admin, laptop('LT-001')).expect(201)).body.item;
  expectFieldError(
    await patch(admin, id, { categoryId: '00000000-0000-0000-0000-000000000000' }),
    400,
    'VALIDATION_ERROR',
    'categoryId',
  );
  expect(
    (await patch(admin, '00000000-0000-0000-0000-000000000000', { name: 'X' })).body.error.code,
  ).toBe('NOT_FOUND');
  expect((await patch(admin, 'not-a-uuid', { name: 'X' })).status).toBe(400);
});

test('all staff can list items; only admins can change them (SPEC 3)', async () => {
  const { id } = (await post(admin, laptop('LT-001')).expect(201)).body.item;
  for (const username of ['hal', 'vic']) {
    const staff = await signIn(username);
    expect((await list(staff, '').expect(200)).body.total).toBe(1);
    expect((await post(staff, laptop('LT-002'))).status).toBe(403);
    expect((await patch(staff, id, { status: 'RETIRED' })).status).toBe(403);
    expect((await del(staff, id)).status).toBe(403);
  }
  expect(
    (await request(createApp()).get('/api/items').set('X-Requested-With', 'fetch')).status,
  ).toBe(401);
});
