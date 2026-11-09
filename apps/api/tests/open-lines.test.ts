import request from 'supertest';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { resetDatabase } from './setup/reset-database.ts';

// BRW-5: GET /api/returns/open, the Return screen's search (SPEC 5, 7; BR 5, 6). Test cases
// TC-BRW-42, 43, and 46 in TEST_CASES.md.

const PASSWORD = 'correct-horse-battery';
let hal: ReturnType<typeof request.agent>;
let halId: string;
let locationId: string;
let semesterId: string;
let categoryId: string;
let cara: string;
let dan: string;

async function signIn(username: string) {
  const agent = request.agent(createApp());
  await agent
    .post('/api/auth/login')
    .set('X-Requested-With', 'fetch')
    .send({ username, password: PASSWORD })
    .expect(200);
  return agent;
}
const open = (agent: typeof hal, query: string) =>
  agent.get(`/api/returns/open${query}`).set('X-Requested-With', 'fetch');

beforeAll(async () => {
  await resetDatabase();
});

beforeEach(async () => {
  await resetDatabase();
  const passwordHash = await hashPassword(PASSWORD);
  const users = await prisma.user.createManyAndReturn({
    data: [
      { name: 'Hal Handler', username: 'hal', passwordHash, role: 'HANDLER' },
      { name: 'Vic Viewer', username: 'vic', passwordHash, role: 'VIEWER' },
    ],
  });
  halId = users.find((user) => user.username === 'hal')!.id;
  const borrowers = await prisma.borrower.createManyAndReturn({
    data: [
      { schoolId: '2026-0003', name: 'Cara Student', type: 'STUDENT', department: 'IT' },
      { schoolId: '2026-0004', name: 'Dan Faculty', type: 'FACULTY', department: 'IT' },
    ],
  });
  cara = borrowers.find((b) => b.name === 'Cara Student')!.id;
  dan = borrowers.find((b) => b.name === 'Dan Faculty')!.id;
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
  categoryId = (await prisma.category.create({ data: { name: 'Equipment' } })).id;
  hal = await signIn('hal');
});

async function issue(
  borrowerId: string,
  item: { name: string; assetTag?: string; quantity?: number },
  extra: { returned?: number; flagStatus?: 'FLAGGED'; status?: 'RETIRED' } = {},
) {
  const created = await prisma.item.create({
    data: {
      name: item.name,
      categoryId,
      trackingType: item.assetTag ? 'UNIT' : 'QUANTITY',
      assetTag: item.assetTag,
      totalQuantity: item.quantity ?? 1,
      condition: 'GOOD',
      status: extra.status,
    },
  });
  const transaction = await prisma.transaction.create({
    data: {
      borrowerId,
      locationId,
      issuedById: halId,
      semesterId,
      lines: {
        create: {
          itemId: created.id,
          quantityBorrowed: item.quantity ?? 1,
          quantityReturned: extra.returned ?? 0,
          flagStatus: extra.flagStatus,
          flaggedAt: extra.flagStatus ? new Date() : undefined,
        },
      },
    },
    include: { lines: true },
  });
  return transaction.lines[0]!;
}

test('TC-BRW-42: finds open lines by borrower, item, and asset tag; closed lines are left out', async () => {
  const laptop = await issue(cara, { name: 'Laptop Dell', assetTag: 'LT-0012' });
  const flagged = await issue(
    dan,
    { name: 'Extension cord', quantity: 5 },
    { returned: 3, flagStatus: 'FLAGGED' },
  );
  await issue(cara, { name: 'Projector', assetTag: 'PJ-1' }, { returned: 1 }); // fully returned

  const byBorrower = await open(hal, '?by=borrower&q=cara').expect(200);
  expect(byBorrower.body.total).toBe(1);
  expect(byBorrower.body.data[0]).toMatchObject({
    lineId: laptop.id,
    borrower: { name: 'Cara Student', schoolId: '2026-0003' },
    item: { name: 'Laptop Dell', assetTag: 'LT-0012', trackingType: 'UNIT' },
    location: 'CL-201',
    issuedBy: 'Hal Handler',
    quantityBorrowed: 1,
    outstanding: 1,
    flagStatus: 'NONE',
  });
  // The school ID finds the borrower too; borrower is the default search.
  expect((await open(hal, '?q=2026-0004').expect(200)).body.data[0].lineId).toBe(flagged.id);

  const byItem = await open(hal, '?by=item&q=CORD').expect(200);
  expect(byItem.body.data).toHaveLength(1);
  // BR 6, 8: the flag shows, and a part-returned line shows what is left.
  expect(byItem.body.data[0]).toMatchObject({ outstanding: 2, flagStatus: 'FLAGGED' });
  expect(byItem.body.data[0].flaggedAt).toEqual(expect.any(String));

  const byTag = await open(hal, '?by=assetTag&q=lt-00').expect(200);
  expect(byTag.body.data.map((line: { lineId: string }) => line.lineId)).toEqual([laptop.id]);

  // No q: every open line (two), oldest first, paginated.
  const all = await open(hal, '?pageSize=1&page=2').expect(200);
  expect(all.body).toMatchObject({ page: 2, pageSize: 1, total: 2 });
  expect(all.body.data).toHaveLength(1);
});

test('TC-BRW-42: % in the search text is literal; a retired item is listed (owner decision 2026-11-10)', async () => {
  await issue(cara, { name: 'Old laptop', assetTag: 'LT-9' }, { status: 'RETIRED' });
  expect((await open(hal, '?by=item&q=%25%25').expect(200)).body.total).toBe(0);
  expect((await open(hal, '?by=item&q=old').expect(200)).body.total).toBe(1);
});

test('TC-BRW-43: admin and handler may search; viewer 403, signed out 401; bad bounds are VALIDATION_ERROR', async () => {
  await open(await signIn('vic'), '?q=ca').expect(403);
  await request(createApp()).get('/api/returns/open').set('X-Requested-With', 'fetch').expect(401);
  for (const query of ['?q=a', `?q=${'a'.repeat(101)}`, '?pageSize=101', '?by=nope', '?page=0']) {
    const res = await open(hal, query).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  }
  // A NUL would make PostgreSQL fail; it is refused as input.
  await open(hal, '?by=item&q=ab%00').expect(400);
});

test('TC-BRW-46: a borrower with an open line is found even when 100+ borrowers match and they sort last', async () => {
  await prisma.borrower.createMany({
    data: Array.from({ length: 105 }, (_, i) => ({
      schoolId: `2026-9${String(i).padStart(3, '0')}`,
      name: `Alex ${String(i).padStart(3, '0')}`,
      type: 'STUDENT' as const,
      department: 'IT',
    })),
  });
  const last = await prisma.borrower.create({
    data: { schoolId: '2026-8000', name: 'Alex Zulu', type: 'STUDENT', department: 'IT' },
  });
  const line = await issue(last.id, { name: 'Laptop Dell', assetTag: 'LT-77' });

  const res = await open(hal, '?by=borrower&q=alex').expect(200);
  expect(res.body.data.map((row: { lineId: string }) => row.lineId)).toEqual([line.id]);
});
