import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { resetDatabase } from './setup/reset-database.ts';

// QA (automated) gap tests for MD-2: asset tag case and whitespace, quantity boundaries, PATCH
// edge cases, races on the case-insensitive asset tag index, search and page bounds, role and
// CSRF checks, and the standard error format. TC-MD-04 to 08 and TC-MD-29 in TEST_CASES.md.

const PASSWORD = 'qa-md2-password-123';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
let passwordHash: string;
let admin: ReturnType<typeof request.agent>;
let adminId: string;
let categoryId: string;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  await resetDatabase();
  const users = await prisma.user.createManyAndReturn({
    data: [
      { name: 'Test Admin', username: 'qa-admin', passwordHash, role: 'ADMIN' },
      { name: 'Test Handler', username: 'qa-handler', passwordHash, role: 'HANDLER' },
      { name: 'Test Viewer', username: 'qa-viewer', passwordHash, role: 'VIEWER' },
    ],
  });
  adminId = users.find((user) => user.role === 'ADMIN')!.id;
  categoryId = (await prisma.category.create({ data: { name: 'QA Category' } })).id;
  admin = await signIn('qa-admin');
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

type Agent = typeof admin;
const post = (body: unknown, agent: Agent = admin) =>
  agent
    .post('/api/items')
    .set('X-Requested-With', 'fetch')
    .send(body as object);
const patch = (id: string, body: unknown, agent: Agent = admin) =>
  agent
    .patch(`/api/items/${id}`)
    .set('X-Requested-With', 'fetch')
    .send(body as object);
const del = (id: string, agent: Agent = admin) =>
  agent.delete(`/api/items/${id}`).set('X-Requested-With', 'fetch');
const list = (query: string, agent: Agent = admin) => agent.get(`/api/items?${query}`);

const unit = (assetTag: string, extra: object = {}) => ({
  trackingType: 'UNIT',
  name: 'QA Laptop',
  categoryId,
  assetTag,
  condition: 'GOOD',
  status: 'ACTIVE',
  ...extra,
});
const supply = (extra: object = {}) => ({
  trackingType: 'QUANTITY',
  name: 'QA Cord',
  categoryId,
  totalQuantity: 5,
  condition: 'GOOD',
  status: 'ACTIVE',
  ...extra,
});
const create = async (body: object) => (await post(body).expect(201)).body.item as { id: string };
const auditFor = (entityId: string) =>
  prisma.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } });
const stored = (id: string) => prisma.item.findUniqueOrThrow({ where: { id } });

// The standard error format (ARCHITECTURE.md 7) with a field error on `field`.
function expectFieldError(response: request.Response, status: number, code: string, field: string) {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(response.body).toEqual({
    error: { code, message: expect.any(String), details: { fields: expect.any(Object) } },
  });
  expect(response.body.error.details.fields[field]?.length).toBeGreaterThan(0);
}

// A transaction line for the item. Open (not returned) unless `returned` is true.
async function lineFor(itemId: string, returned = false) {
  const borrower = await prisma.borrower.create({
    data: {
      schoolId: `QA-${itemId.slice(0, 8)}`,
      name: 'Test Borrower',
      type: 'STUDENT',
      department: 'QA',
    },
  });
  const location = await prisma.location.create({
    data: { name: `QA Room ${itemId.slice(0, 8)}`, createdById: adminId },
  });
  const semester =
    (await prisma.semester.findFirst()) ??
    (await prisma.semester.create({
      data: {
        name: 'QA Sem',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-12-15'),
        isCurrent: true,
      },
    }));
  const transaction = await prisma.transaction.create({
    data: {
      borrowerId: borrower.id,
      locationId: location.id,
      issuedById: adminId,
      semesterId: semester.id,
    },
  });
  await prisma.transactionItem.create({
    data: {
      transactionId: transaction.id,
      itemId,
      quantityBorrowed: 1,
      quantityReturned: returned ? 1 : 0,
    },
  });
}

describe('asset tags: case, whitespace, length', () => {
  test('an asset tag is trimmed before it is stored and before the duplicate check', async () => {
    const { id } = await create(unit('  QA-001  '));
    expect((await stored(id)).assetTag).toBe('QA-001');
    expectFieldError(await post(unit(' qa-001 ')), 409, 'DUPLICATE_VALUE', 'assetTag');
    expect(await prisma.item.count()).toBe(1);
  });

  test('an asset tag of only spaces is missing for a UNIT item', async () => {
    expectFieldError(await post(unit('   ')), 400, 'VALIDATION_ERROR', 'assetTag');
  });

  test('an asset tag of 200 characters is accepted and 201 is refused', async () => {
    await create(unit('A'.repeat(200)));
    expectFieldError(await post(unit('B'.repeat(201))), 400, 'VALIDATION_ERROR', 'assetTag');
  });

  test('an asset tag with a control character is refused', async () => {
    expectFieldError(await post(unit('QA\t001')), 400, 'VALIDATION_ERROR', 'assetTag');
    expectFieldError(await post(unit('QA\u0000001')), 400, 'VALIDATION_ERROR', 'assetTag');
  });

  test('asset tags that differ only in non-ASCII case are duplicates too', async () => {
    await create(unit('ÄRZT-1'));
    expectFieldError(await post(unit('ärzt-1')), 409, 'DUPLICATE_VALUE', 'assetTag');
  });

  test('a null asset tag on a UNIT item is a validation error, not a server error', async () => {
    expectFieldError(
      await post(unit('x', { assetTag: null })),
      400,
      'VALIDATION_ERROR',
      'assetTag',
    );
  });

  // HRD-5a: a blank tag means "no tag", which a QUANTITY item accepts.
  test('an empty asset tag on a QUANTITY item is accepted as no tag', async () => {
    const response = await post(supply({ assetTag: '' })).expect(201);
    expect(response.body.item.assetTag).toBeNull();
  });

  test('two creates with the same tag in different case at once: one 201, one DUPLICATE_VALUE', async () => {
    const [a, b] = await Promise.all([post(unit('RACE-1')), post(unit('race-1'))]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const refused = a.status === 409 ? a : b;
    expectFieldError(refused, 409, 'DUPLICATE_VALUE', 'assetTag');
    expect(await prisma.item.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'ITEM_CREATED' } })).toBe(1);
  });

  test('two items edited to the same tag at once: one saved, one DUPLICATE_VALUE, no 500', async () => {
    const first = await create(unit('E-1'));
    const second = await create(unit('E-2'));
    const [a, b] = await Promise.all([
      patch(first.id, { assetTag: 'SAME-1' }),
      patch(second.id, { assetTag: 'same-1' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await prisma.auditLog.count({ where: { action: 'ITEM_UPDATED' } })).toBe(1);
  });
});

describe('total quantity bounds', () => {
  // The total written as raw JSON text, so 1e309 (Infinity once parsed) and 10000.0 reach the server as typed.
  const postRawTotal = (jsonNumber: string) =>
    admin
      .post('/api/items')
      .set('X-Requested-With', 'fetch')
      .set('Content-Type', 'application/json')
      .send(
        JSON.stringify(supply({ totalQuantity: 0 })).replace(
          '"totalQuantity":0',
          `"totalQuantity":${jsonNumber}`,
        ),
      );

  test.each(['-1', '10001', '0.5', '1e309', '"10"', 'null', 'true'])(
    'a QUANTITY total of %s is refused on create',
    async (jsonNumber) => {
      expectFieldError(await postRawTotal(jsonNumber), 400, 'VALIDATION_ERROR', 'totalQuantity');
    },
  );

  test('a QUANTITY total of 0 and of 10,000 are accepted (10000.0 too)', async () => {
    await create(supply({ totalQuantity: 0 }));
    await create(supply({ totalQuantity: 10_000 }));
    const response = await postRawTotal('10000.0').expect(201);
    expect(response.body.item.totalQuantity).toBe(10_000);
  });

  test('editing a QUANTITY total: 0 and 10,000 saved; -1, 10,001 and 2.5 refused', async () => {
    const { id } = await create(supply());
    await patch(id, { totalQuantity: 0 }).expect(200);
    await patch(id, { totalQuantity: 10_000 }).expect(200);
    for (const totalQuantity of [-1, 10_001, 2.5]) {
      expectFieldError(
        await patch(id, { totalQuantity }),
        400,
        'VALIDATION_ERROR',
        'totalQuantity',
      );
    }
    expect((await stored(id)).totalQuantity).toBe(10_000);
  });

  test('a UNIT item accepts an explicit total of 1 and refuses 0', async () => {
    const created = (await post(unit('Q-1', { totalQuantity: 1 })).expect(201)).body.item;
    expect(created.totalQuantity).toBe(1);
    expectFieldError(
      await post(unit('Q-2', { totalQuantity: 0 })),
      400,
      'VALIDATION_ERROR',
      'totalQuantity',
    );
  });
});

describe('category and id checks', () => {
  test.each([
    ['missing', undefined],
    ['not a uuid', 'not-a-uuid'],
    ['empty', ''],
    ['a number', 7],
  ])('a categoryId that is %s is a field error', async (_label, value) => {
    expectFieldError(
      await post(unit('C-1', { categoryId: value })),
      400,
      'VALIDATION_ERROR',
      'categoryId',
    );
  });

  test('a non-uuid id on PATCH and DELETE is VALIDATION_ERROR, not a server error', async () => {
    for (const response of [await patch('123', { name: 'X' }), await del('123')]) {
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  test('an unknown id on PATCH and DELETE is NOT_FOUND and writes no audit entry', async () => {
    for (const response of [await patch(MISSING_ID, { name: 'X' }), await del(MISSING_ID)]) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: { code: 'NOT_FOUND', message: expect.any(String), details: {} },
      });
    }
    expect(await prisma.auditLog.count()).toBe(0);
  });

  test('an id in upper case finds the item', async () => {
    const { id } = await create(unit('U-1'));
    await patch(id.toUpperCase(), { name: 'QA Laptop 2' }).expect(200);
  });
});

describe('PATCH edge cases', () => {
  // HRD-5a: an empty body is "Nothing to update." (400), still changing nothing.
  test('an empty PATCH body is refused, changes nothing and writes no audit entry', async () => {
    const { id } = await create(unit('P-1'));
    const before = await stored(id);
    await patch(id, {}).expect(400);
    expect(await stored(id)).toEqual(before);
    expect(await auditFor(id)).toHaveLength(1);
  });

  test('saving every field with its current values writes no audit entry', async () => {
    const { id } = await create(supply({ description: 'Orange' }));
    // Everything but the tracking type, which PATCH refuses.
    await patch(id, { ...supply({ description: 'Orange' }), trackingType: undefined }).expect(200);
    expect(await auditFor(id)).toHaveLength(1);
  });

  test('a blank description on an item with none writes no audit entry', async () => {
    const { id } = await create(supply());
    await patch(id, { description: '   ' }).expect(200);
    expect(await auditFor(id)).toHaveLength(1);
  });

  test('sending the same tracking type on PATCH is still refused', async () => {
    const { id } = await create(unit('P-2'));
    expectFieldError(
      await patch(id, { trackingType: 'UNIT' }),
      400,
      'VALIDATION_ERROR',
      'trackingType',
    );
    expect(await auditFor(id)).toHaveLength(1);
  });

  test('a PATCH body of only unknown keys is refused and never written', async () => {
    const { id } = await create(unit('P-3'));
    const before = await stored(id);
    await patch(id, { id: MISSING_ID, createdAt: '2000-01-01T00:00:00Z', foo: 'bar' }).expect(400);
    expect(await stored(id)).toEqual(before);
  });

  test('a refused PATCH writes nothing (VALIDATION_ERROR leaves the stored row and audit alone)', async () => {
    const { id } = await create(unit('P-4'));
    const before = await stored(id);
    expectFieldError(
      await patch(id, { name: 'Renamed', totalQuantity: 2 }),
      400,
      'VALIDATION_ERROR',
      'totalQuantity',
    );
    expect(await stored(id)).toEqual(before);
    expect(await auditFor(id)).toHaveLength(1);
  });

  test('changing the category is audited with the old and new categoryId', async () => {
    const { id } = await create(unit('P-5'));
    const other = (await prisma.category.create({ data: { name: 'QA Other' } })).id;
    const response = await patch(id, { categoryId: other }).expect(200);
    expect(response.body.item.category).toEqual({ id: other, name: 'QA Other' });
    const entries = await auditFor(id);
    expect(entries[1]).toMatchObject({
      action: 'ITEM_UPDATED',
      before: { categoryId },
      after: { categoryId: other },
    });
  });

  test('two edits at once both save and their audit entries chain (each before is the previous after)', async () => {
    const { id } = await create(unit('P-6'));
    const [a, b] = await Promise.all([
      patch(id, { name: 'Name A' }),
      patch(id, { name: 'Name B' }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const updates = (await auditFor(id)).filter((entry) => entry.action === 'ITEM_UPDATED');
    expect(updates).toHaveLength(2);
    expect(updates[0]!.before).toEqual({ name: 'QA Laptop' });
    expect(updates[1]!.before).toEqual(updates[0]!.after);
    expect((await stored(id)).name).toBe((updates[1]!.after as { name: string }).name);
  });

  test('an edit racing a delete gets NOT_FOUND or saves before the delete, never a 500', async () => {
    const { id } = await create(unit('P-7'));
    const [edited, deleted] = await Promise.all([patch(id, { name: 'Late' }), del(id)]);
    expect(deleted.status).toBe(204);
    expect([200, 404]).toContain(edited.status);
    expect(await prisma.item.count()).toBe(0);
  });
});

describe('retire and delete (BR 15, S19)', () => {
  test('an item with an open (unreturned) line cannot be deleted either', async () => {
    const { id } = await create(unit('H-1'));
    await lineFor(id, false);
    const response = await del(id);
    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: {
        code: 'HAS_HISTORY',
        message: expect.stringMatching(/Retired instead/),
        details: {},
      },
    });
    expect(await auditFor(id)).toHaveLength(1);
  });

  test('an item with history can be retired, and is still refused deletion afterwards', async () => {
    const { id } = await create(supply());
    await lineFor(id, true);
    const retired = await patch(id, { status: 'RETIRED' }).expect(200);
    expect(retired.body.item.status).toBe('RETIRED');
    expect((await del(id)).body.error.code).toBe('HAS_HISTORY');
    expect((await auditFor(id)).map((entry) => entry.action)).toEqual([
      'ITEM_CREATED',
      'ITEM_UPDATED',
    ]);
  });

  test('a retired item with no history can still be deleted', async () => {
    const { id } = await create(unit('H-2', { status: 'RETIRED' }));
    await del(id).expect(204);
  });

  test('retired items still appear in the list and match the RETIRED filter only', async () => {
    const { id } = await create(unit('H-3'));
    await patch(id, { status: 'RETIRED' }).expect(200);
    expect((await list('status=RETIRED').expect(200)).body.total).toBe(1);
    expect((await list('status=ACTIVE').expect(200)).body.total).toBe(0);
    expect((await list('').expect(200)).body.total).toBe(1);
  });

  test('a deleted item frees its asset tag for a new item', async () => {
    const { id } = await create(unit('H-4'));
    await del(id).expect(204);
    await create(unit('h-4'));
  });
});

describe('search, filters, and page bounds (SPEC 7)', () => {
  beforeEach(async () => {
    await create(unit('LT-001', { name: 'Laptop' }));
    await create(unit('AB_9', { name: 'Back\\slash' }));
    await create(supply({ name: 'Power cord' }));
  });
  const tags = async (query: string) =>
    (await list(query).expect(200)).body.data.map(
      (item: { assetTag: string | null; name: string }) => item.assetTag ?? item.name,
    );

  test('search text of 2 and 100 characters is accepted; 1 and 101 are refused', async () => {
    await list('q=ab').expect(200);
    await list(`q=${'a'.repeat(100)}`).expect(200);
    for (const q of ['a', 'a'.repeat(101)]) {
      expect((await list(`q=${q}`)).body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  test('search text is trimmed before its length is checked', async () => {
    expect((await list(`q=${encodeURIComponent('  a  ')}`)).status).toBe(400);
    expect(await tags(`q=${encodeURIComponent('  lt-0  ')}`)).toEqual(['LT-001']);
  });

  test('an empty q is treated as no search, or refused, but never a 500', async () => {
    expect([200, 400]).toContain((await list('q=')).status);
  });

  test('search matches asset tags case-insensitively', async () => {
    expect(await tags('q=lt-001')).toEqual(['LT-001']);
  });

  test('_ and \\ in search text are literal, not wildcards', async () => {
    // "T_0" as a LIKE pattern would match "LT-001".
    expect(await tags('q=T_0')).toEqual([]);
    expect(await tags('q=B_9')).toEqual(['AB_9']);
    expect(await tags(`q=${encodeURIComponent('k\\s')}`)).toEqual(['AB_9']);
    expect(await tags('q=%25%25')).toEqual([]);
  });

  test.each(['a%09b', 'a%0Ab', 'ab%7F', 'a%1Bb'])(
    'search text with a control character (%s) is refused',
    async (q) => {
      expect((await list(`q=${q}`)).body.error.code).toBe('VALIDATION_ERROR');
    },
  );

  test('pageSize 100 is accepted and 101 refused', async () => {
    expect((await list('pageSize=100').expect(200)).body.pageSize).toBe(100);
    expect((await list('pageSize=101')).body.error.code).toBe('VALIDATION_ERROR');
  });

  test.each(['page=0', 'page=-1', 'page=1.5', 'page=abc', 'pageSize=0', 'pageSize=abc'])(
    '%s is refused with VALIDATION_ERROR',
    async (query) => {
      expect((await list(query)).body.error.code).toBe('VALIDATION_ERROR');
    },
  );

  test('a page far past the end returns an empty page, not a server error', async () => {
    const response = await list('page=100000');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ data: [], page: 100000, total: 3 });
  });

  test('a huge page number is refused or empty, never a server error', async () => {
    const response = await list('page=1e20');
    expect(response.status, JSON.stringify(response.body)).not.toBe(500);
  });

  test('repeated filter parameters are refused, not a server error', async () => {
    for (const query of [
      'status=ACTIVE&status=LOST',
      'q=ab&q=cd',
      `categoryId=${categoryId}&categoryId=${categoryId}`,
    ]) {
      const response = await list(query);
      expect(response.status, query).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  test('a filter on a category that does not exist returns nothing', async () => {
    expect((await list(`categoryId=${MISSING_ID}`).expect(200)).body.total).toBe(0);
  });

  // BRW-3 added `available` to list rows (owner decision 2026-11-05).
  test('a list row has exactly the shared Item fields and nothing internal', async () => {
    const [row] = (await list('q=lt-001').expect(200)).body.data;
    expect(Object.keys(row).sort()).toEqual([
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
    ]);
  });
});

describe('roles, sign-in, CSRF, and body limits', () => {
  test('signed out: GET, POST, PATCH and DELETE are all 401 UNAUTHENTICATED in the standard format', async () => {
    const anonymous = request(createApp());
    const responses = [
      await anonymous.get('/api/items'),
      await anonymous.post('/api/items').set('X-Requested-With', 'fetch').send(unit('A-1')),
      await anonymous.patch(`/api/items/${MISSING_ID}`).set('X-Requested-With', 'fetch').send({}),
      await anonymous.delete(`/api/items/${MISSING_ID}`).set('X-Requested-With', 'fetch'),
    ];
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.body.error).toMatchObject({
        code: expect.any(String),
        message: expect.any(String),
      });
    }
    expect(await prisma.item.count()).toBe(0);
  });

  test('handler and viewer get 403 on writes, write nothing, and see filtered lists', async () => {
    const { id } = await create(unit('R-1'));
    for (const username of ['qa-handler', 'qa-viewer']) {
      const staff = await signIn(username);
      expect((await list('q=r-1', staff).expect(200)).body.total).toBe(1);
      for (const response of [
        await post(unit('R-2'), staff),
        await patch(id, { status: 'RETIRED' }, staff),
        await del(id, staff),
      ]) {
        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('FORBIDDEN');
      }
    }
    expect(await prisma.item.count()).toBe(1);
    expect((await stored(id)).status).toBe('ACTIVE');
    expect(await auditFor(id)).toHaveLength(1);
  });

  test('POST, PATCH and DELETE without the CSRF header are refused and change nothing', async () => {
    const { id } = await create(unit('X-1'));
    const responses = [
      await admin.post('/api/items').send(unit('X-2')),
      await admin.patch(`/api/items/${id}`).send({ name: 'Changed' }),
      await admin.delete(`/api/items/${id}`),
    ];
    for (const response of responses) expect(response.status).toBe(403);
    expect(await prisma.item.count()).toBe(1);
    expect((await stored(id)).name).toBe('QA Laptop');
  });

  test('a body over 100 KB gets PAYLOAD_TOO_LARGE', async () => {
    const response = await post(supply({ description: 'x'.repeat(110_000) }));
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  test('a body that is a JSON array or not JSON is VALIDATION_ERROR', async () => {
    expect((await post([unit('J-1')])).body.error.code).toBe('VALIDATION_ERROR');
    const broken = await admin
      .post('/api/items')
      .set('X-Requested-With', 'fetch')
      .set('Content-Type', 'application/json')
      .send('{"name":');
    expect(broken.status).toBe(400);
    expect(broken.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('audit contents (BR 14)', () => {
  test('ITEM_CREATED records the stored values, with the trimmed asset tag as typed', async () => {
    const { id } = await create(unit('  Lt-Mixed  ', { description: '' }));
    const [entry] = await auditFor(id);
    expect(entry).toMatchObject({ actorId: adminId, action: 'ITEM_CREATED', entity: 'item' });
    expect(entry!.after).toMatchObject({
      assetTag: 'Lt-Mixed',
      totalQuantity: 1,
      description: null,
      categoryId,
    });
  });

  test('ITEM_DELETED records the whole item as before', async () => {
    const { id } = await create(supply({ description: 'Gone soon' }));
    await del(id).expect(204);
    const entries = await auditFor(id);
    expect(entries[1]).toMatchObject({
      action: 'ITEM_DELETED',
      actorId: adminId,
      before: {
        name: 'QA Cord',
        totalQuantity: 5,
        description: 'Gone soon',
        trackingType: 'QUANTITY',
      },
    });
  });
});
