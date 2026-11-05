import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { resetDatabase } from './setup/reset-database.ts';

// QA (automated) gap tests for BRW-3's API additions (owner decisions 2026-11-05):
// GET /api/borrowers/lookup (bounds, field whitelist, literal matching, admin-only routes next to it),
// the `available` count on GET /api/items across pages and statuses (BR 1), and the read-only
// GET /api/closing-time (fresh after a change, no write methods).

const PASSWORD = 'correct-horse-battery';
let passwordHash: string;
let adminId: string;
let categoryId: string;
let admin: ReturnType<typeof request.agent>;
let handler: ReturnType<typeof request.agent>;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  await resetDatabase();
  const users = await prisma.user.createManyAndReturn({
    data: [
      { name: 'QA Admin', username: 'qa-admin', passwordHash, role: 'ADMIN' },
      { name: 'QA Handler', username: 'qa-handler', passwordHash, role: 'HANDLER' },
      { name: 'QA Viewer', username: 'qa-viewer', passwordHash, role: 'VIEWER' },
    ],
  });
  adminId = users.find((user) => user.role === 'ADMIN')!.id;
  categoryId = (await prisma.category.create({ data: { name: 'QA Category' } })).id;
  admin = await signIn('qa-admin');
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

const borrower = (schoolId: string, name: string, active = true) =>
  prisma.borrower.create({
    data: { schoolId, name, type: 'FACULTY', department: 'QA Dept', active },
  });

const expectValidationError = (response: request.Response) => {
  expect(response.status).toBe(400);
  expect(response.body.error.code).toBe('VALIDATION_ERROR');
};

describe('GET /api/borrowers/lookup', () => {
  test('accepts q of exactly 2 and exactly 100 characters (SPEC 7 boundaries)', async () => {
    await borrower('QA-0001', 'Ab Testcase');
    expect((await handler.get('/api/borrowers/lookup?q=ab').expect(200)).body.total).toBe(1);
    await handler.get(`/api/borrowers/lookup?q=${'a'.repeat(100)}`).expect(200);
  });

  test('refuses a q that is only spaces, or 1 character after trimming', async () => {
    for (const q of ['%20%20%20', '%20a%20']) {
      expectValidationError(await handler.get(`/api/borrowers/lookup?q=${q}`));
    }
  });

  test('refuses a repeated q, a control character, page 0, and pageSize 0 without a server error', async () => {
    for (const query of ['q=ab&q=cd', 'q=a%00b', 'q=ab&page=0', 'q=ab&pageSize=0', 'q=ab&page=x']) {
      expectValidationError(await handler.get(`/api/borrowers/lookup?${query}`));
    }
  });

  test('accepts pageSize 100, the largest page', async () => {
    const { body } = await handler.get('/api/borrowers/lookup?q=ab&pageSize=100').expect(200);
    expect(body.pageSize).toBe(100);
  });

  test('matches by school ID and treats % and _ literally', async () => {
    await borrower('QA-1234', 'Rosa Test');
    await borrower('QA-9999', 'Lito Test');
    const bySchoolId = await handler.get('/api/borrowers/lookup?q=qa-12').expect(200);
    expect(bySchoolId.body.data.map((b: { name: string }) => b.name)).toEqual(['Rosa Test']);
    for (const q of ['%25%25', '__']) {
      expect((await handler.get(`/api/borrowers/lookup?q=${q}`).expect(200)).body.total).toBe(0);
    }
  });

  test('a row has only the Borrower fields, for a handler too', async () => {
    await borrower('QA-0002', 'Field Check', false);
    const [row] = (await handler.get('/api/borrowers/lookup?q=field').expect(200)).body.data;
    expect(Object.keys(row).sort()).toEqual(
      ['active', 'department', 'id', 'name', 'schoolId', 'type'].sort(),
    );
  });

  test('the lookup route does not open the admin-only borrower routes to handlers', async () => {
    const { id } = await borrower('QA-0003', 'Guard Check');
    expect((await handler.get('/api/borrowers?q=guard')).status).toBe(403);
    expect((await handler.get(`/api/borrowers/${id}`)).status).toBe(403);
    const patched = await handler
      .patch(`/api/borrowers/${id}`)
      .set('X-Requested-With', 'fetch')
      .send({ active: false });
    expect(patched.status).toBe(403);
    expect((await prisma.borrower.findUniqueOrThrow({ where: { id } })).active).toBe(true);
  });

  test('a lookup writes no audit entry (read only)', async () => {
    await borrower('QA-0004', 'Audit Check');
    const before = await prisma.auditLog.count();
    await handler.get('/api/borrowers/lookup?q=audit').expect(200);
    expect(await prisma.auditLog.count()).toBe(before);
  });
});

describe('available on GET /api/items (BR 1)', () => {
  async function openLine(itemId: string, quantityBorrowed: number, quantityReturned = 0) {
    const b = (await prisma.borrower.findFirst()) ?? (await borrower('QA-0100', 'Line Borrower'));
    const location =
      (await prisma.location.findFirst()) ??
      (await prisma.location.create({ data: { name: 'QA Lab', createdById: adminId } }));
    const semester =
      (await prisma.semester.findFirst()) ??
      (await prisma.semester.create({
        data: {
          name: 'QA S1',
          startDate: new Date('2026-08-01'),
          endDate: new Date('2026-12-15'),
          isCurrent: true,
        },
      }));
    const transaction = await prisma.transaction.create({
      data: {
        borrowerId: b.id,
        locationId: location.id,
        issuedById: adminId,
        semesterId: semester.id,
      },
    });
    await prisma.transactionItem.create({
      data: { transactionId: transaction.id, itemId, quantityBorrowed, quantityReturned },
    });
  }
  const unit = (assetTag: string, status: 'ACTIVE' | 'LOST' | 'RETIRED' = 'ACTIVE') =>
    prisma.item.create({
      data: {
        name: `QA Unit ${assetTag}`,
        categoryId,
        trackingType: 'UNIT',
        assetTag,
        totalQuantity: 1,
        condition: 'GOOD',
        status,
      },
    });
  const supply = (
    name: string,
    totalQuantity: number,
    status: 'ACTIVE' | 'UNDER_REPAIR' = 'ACTIVE',
  ) =>
    prisma.item.create({
      data: {
        name,
        categoryId,
        trackingType: 'QUANTITY',
        totalQuantity,
        condition: 'GOOD',
        status,
      },
    });

  async function allRowsOneByOne(agent: typeof handler) {
    const rows: { id: string; available: number }[] = [];
    for (let page = 1; ; page += 1) {
      const { body } = await agent.get(`/api/items?page=${page}&pageSize=1`).expect(200);
      rows.push(...body.data);
      if (page * body.pageSize >= body.total) return rows;
    }
  }

  test('each page computes the counts of its own rows, matching a single big page', async () => {
    const cords = await supply('QA Cord', 10);
    const split = await supply('QA Split Cord', 6);
    const out = await unit('QA-LT-1');
    const returned = await unit('QA-LT-2');
    await unit('QA-LT-3', 'LOST');
    await unit('QA-LT-4', 'RETIRED');
    const shelved = await supply('QA Repair Cord', 4, 'UNDER_REPAIR');
    // Two open lines on one supply are summed: 10 - (3 - 1) - 4 = 4.
    await openLine(cords.id, 3, 1);
    await openLine(cords.id, 4);
    await openLine(split.id, 6); // all out: 0
    await openLine(out.id, 1);
    await openLine(returned.id, 1, 1);

    const big = (await handler.get('/api/items?pageSize=100').expect(200)).body.data as {
      id: string;
      available: number;
    }[];
    const paged = await allRowsOneByOne(handler);
    expect(paged).toHaveLength(7);
    const counts = (rows: typeof big) => Object.fromEntries(rows.map((r) => [r.id, r.available]));
    expect(counts(paged)).toEqual(counts(big));
    expect(counts(big)).toMatchObject({
      [cords.id]: 4,
      [split.id]: 0,
      [out.id]: 0,
      [returned.id]: 1,
      [shelved.id]: 0,
    });
    // LOST and RETIRED items are never available.
    const zeroes = big.filter((row) => row.available === 0);
    expect(zeroes).toHaveLength(5);
  });

  test('a page past the end is empty, not an error', async () => {
    await supply('QA Cord', 5);
    const { body } = await handler.get('/api/items?page=5&pageSize=10').expect(200);
    expect(body).toMatchObject({ data: [], total: 1, page: 5 });
  });

  test('a viewer sees available counts too, and no row carries borrower or transaction details', async () => {
    const out = await unit('QA-LT-9');
    await openLine(out.id, 1);
    const viewer = await signIn('qa-viewer');
    const [row] = (await viewer.get('/api/items?q=qa-lt-9').expect(200)).body.data;
    expect(row.available).toBe(0);
    expect(JSON.stringify(row)).not.toMatch(/Line Borrower|QA-0100|borrower|transaction/i);
  });
});

describe('GET /api/closing-time', () => {
  // The seed creates the settings row with the SPEC.md 4 defaults.
  beforeEach(() => prisma.setting.create({ data: { id: 1 } }));

  const saveClosing = (closingTime: string) =>
    admin
      .put('/api/settings')
      .set('X-Requested-With', 'fetch')
      .send({ closingTime, warningThreshold: 3, noticeThreshold: 4, blockThreshold: 5 });

  test('shows a new closing time right after an admin changes it', async () => {
    await saveClosing('16:45').expect(200);
    expect((await handler.get('/api/closing-time').expect(200)).body).toEqual({
      closingTime: '16:45',
    });
    await saveClosing('19:05').expect(200);
    expect((await handler.get('/api/closing-time').expect(200)).body).toEqual({
      closingTime: '19:05',
    });
  });

  test('has no write methods, for admins or handlers; the closing time is unchanged', async () => {
    await saveClosing('17:00').expect(200);
    for (const agent of [admin, handler]) {
      for (const method of ['put', 'post', 'patch', 'delete'] as const) {
        const response = await agent[method]('/api/closing-time')
          .set('X-Requested-With', 'fetch')
          .send({ closingTime: '23:59' });
        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe('NOT_FOUND');
      }
    }
    expect((await handler.get('/api/closing-time').expect(200)).body.closingTime).toBe('17:00');
  });
});
