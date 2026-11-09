import request from 'supertest';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { borrowerService } from '../src/services/borrowers.ts';
import { countStrikes, countStrikesForBorrowers } from '../src/services/strikes.ts';
import { resetDatabase } from './setup/reset-database.ts';

// FLG-3: strike warnings and blocking (BR 11, 12; S8). Test cases TC-FLG-17 to TC-FLG-20 and
// TC-FLG-50 to TC-FLG-55, 58, and 59 in TEST_CASES.md. Strikes are set directly as FLAGGED lines.

let hal: ReturnType<typeof request.agent>;
let vic: ReturnType<typeof request.agent>;
let halId: string;
let filId: string;
let locationId: string;
let categoryId: string;
let semesterId: string;
let nextTag = 0;

let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashPassword('correct-horse-battery');
});

async function signIn(username: string) {
  const agent = request.agent(createApp());
  await agent
    .post('/api/auth/login')
    .set('X-Requested-With', 'fetch')
    .send({ username, password: 'correct-horse-battery' })
    .expect(200);
  return agent;
}

beforeEach(async () => {
  await resetDatabase();
  await prisma.setting.create({ data: { id: 1 } });
  const users = await prisma.user.createManyAndReturn({
    data: [
      { name: 'Hal Handler', username: 'hal', passwordHash, role: 'HANDLER' },
      { name: 'Vic Viewer', username: 'vic', passwordHash, role: 'VIEWER' },
    ],
  });
  halId = users.find((user) => user.username === 'hal')!.id;
  hal = await signIn('hal');
  vic = await signIn('vic');
  filId = await newBorrower('2026-0001');
  locationId = (await prisma.location.create({ data: { name: 'CL-201', createdById: halId } })).id;
  categoryId = (await prisma.category.create({ data: { name: 'Equipment' } })).id;
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
});

const newBorrower = async (schoolId: string) =>
  (
    await prisma.borrower.create({
      data: { schoolId, name: 'Fil Student', type: 'STUDENT', department: 'IT' },
    })
  ).id;

const newItem = async () =>
  prisma.item.create({
    data: {
      name: 'Laptop',
      categoryId,
      trackingType: 'UNIT',
      assetTag: `LT-${++nextTag}`,
      totalQuantity: 1,
      condition: 'GOOD',
    },
  });

// One transaction with one FLAGGED line = one strike.
async function addStrikes(count: number, borrowerId = filId, semester = semesterId) {
  for (let i = 0; i < count; i++) {
    const item = await newItem();
    await prisma.transaction.create({
      data: {
        borrowerId,
        locationId,
        issuedById: halId,
        semesterId: semester,
        lines: {
          create: [
            { itemId: item.id, quantityBorrowed: 1, flagStatus: 'FLAGGED', flaggedAt: new Date() },
          ],
        },
      },
    });
  }
}

const checkout = async (agent = hal) =>
  agent
    .post('/api/transactions')
    .set('X-Requested-With', 'fetch')
    .send({
      borrowerId: filId,
      locationId,
      lines: [{ itemId: (await newItem()).id, quantity: 1 }],
    });

const strikes = (borrowerId = filId, agent = hal) =>
  agent.get(`/api/borrowers/${borrowerId}/strikes`);

test.each([
  ['TC-FLG-17', 3],
  ['TC-FLG-18', 4],
])(
  '%s (S8): at %i strikes checkout works and the strikes endpoint gives the count',
  async (_id, count) => {
    await addStrikes(count);
    expect((await strikes()).body).toEqual({
      strikes: count,
      warningThreshold: 3,
      noticeThreshold: 4,
      blockThreshold: 5,
      semesterName: 'S1',
    });
    await checkout().then((res) => expect(res.status).toBe(201));
  },
);

test('TC-FLG-19 (S8): at 5 strikes checkout is BORROWER_BLOCKED and nothing is created', async () => {
  await addStrikes(5);
  const before = await prisma.transaction.count();
  const res = await checkout();
  expect(res.status).toBe(409);
  expect(res.body.error).toMatchObject({ code: 'BORROWER_BLOCKED' });
  expect(res.body.error.message).toMatch(/blocked/i);
  expect(await prisma.transaction.count()).toBe(before);
  expect(await prisma.auditLog.count({ where: { action: 'CHECKOUT' } })).toBe(0);
});

test('TC-FLG-20 (rule 3): changing the thresholds to 2, 3, 4 moves the warning, notice, and block', async () => {
  await prisma.setting.update({
    where: { id: 1 },
    data: { warningThreshold: 2, noticeThreshold: 3, blockThreshold: 4 },
  });
  await addStrikes(3);
  expect((await strikes()).body).toMatchObject({
    strikes: 3,
    warningThreshold: 2,
    blockThreshold: 4,
  });
  expect((await checkout()).status).toBe(201); // 3 < 4
  await addStrikes(1);
  expect((await checkout()).body.error.code).toBe('BORROWER_BLOCKED'); // 4 >= 4
});

test('TC-FLG-50 (S8): a blocked borrower can still return', async () => {
  const open = await checkout();
  expect(open.status).toBe(201);
  await addStrikes(5);
  expect((await checkout()).body.error.code).toBe('BORROWER_BLOCKED');
  const lineId = open.body.transaction.lines[0].id;
  await hal
    .post('/api/returns')
    .set('X-Requested-With', 'fetch')
    .send({ lines: [{ lineId, quantity: 1, condition: 'GOOD' }] })
    .expect(201);
});

test('TC-FLG-51 (BR 11, S8): an overridden flag takes Fil from 5 strikes to 4 and borrowing works again', async () => {
  await addStrikes(5);
  expect((await checkout()).status).toBe(409);
  const flagged = await prisma.transactionItem.findFirstOrThrow({
    where: { flagStatus: 'FLAGGED' },
  });
  await prisma.transactionItem.update({
    where: { id: flagged.id },
    data: { flagStatus: 'OVERRIDDEN' },
  });
  expect((await checkout()).status).toBe(201);
});

test('TC-FLG-52 (BR 12): strikes of another semester do not block; the block uses the semester checkout records', async () => {
  const other = await prisma.semester.create({
    data: { name: 'S0', startDate: new Date('2026-01-05'), endDate: new Date('2026-05-31') },
  });
  await addStrikes(5, filId, other.id);
  expect((await checkout()).status).toBe(201);
  // The same semester id given to the service counts that semester, not "current".
  const tx = prisma;
  expect(await borrowerService.isEligible(filId, tx, other.id)).toEqual({
    eligible: false,
    reason: 'BORROWER_BLOCKED',
  });
  expect(await borrowerService.isEligible(filId, tx, semesterId)).toEqual({ eligible: true });
});

test('TC-FLG-53: the strikes endpoint is for staff, 404 for an unknown borrower, 400 for a bad id', async () => {
  expect((await strikes(filId, vic)).status).toBe(403);
  expect((await strikes('00000000-0000-4000-8000-000000000000')).body.error.code).toBe('NOT_FOUND');
  expect((await strikes('not-a-uuid')).status).toBe(400);
  expect((await request(createApp()).get(`/api/borrowers/${filId}/strikes`)).status).toBe(401);
});

test('TC-FLG-54: with no current semester the endpoint gives 0 strikes and no semester name', async () => {
  await addStrikes(5);
  await prisma.semester.update({ where: { id: semesterId }, data: { isCurrent: false } });
  expect((await strikes()).body).toMatchObject({ strikes: 0, semesterName: null });
});

test('TC-FLG-55: isEligible locks the borrower row FOR SHARE, so a deactivation waits for the checkout', async () => {
  // The borrower row is locked FOR SHARE inside the checkout transaction, so an update waits.
  await prisma.$transaction(async (tx) => {
    await borrowerService.isEligible(filId, tx, semesterId);
    const update = prisma.$transaction(async (other) => {
      await other.$executeRaw`SET LOCAL lock_timeout = '200ms'`;
      await other.$executeRaw`UPDATE borrowers SET active = false WHERE id = ${filId}::uuid`;
    });
    await expect(update).rejects.toThrow();
  });
});

test("TC-FLG-58 (BR 10, 11): GET /api/returns/open carries each line's strikes and the thresholds from settings", async () => {
  const gus = await newBorrower('2026-0002');
  await addStrikes(3);
  await prisma.setting.update({ where: { id: 1 }, data: { blockThreshold: 6 } });
  expect((await checkout()).status).toBe(201); // Fil has a line out, with 3 strikes
  const item = await newItem();
  await prisma.transaction.create({
    data: {
      borrowerId: gus,
      locationId,
      issuedById: halId,
      semesterId,
      lines: { create: [{ itemId: item.id, quantityBorrowed: 1 }] },
    },
  });
  const body = (await hal.get('/api/returns/open')).body;
  expect(body).toMatchObject({ warningThreshold: 3, noticeThreshold: 4, blockThreshold: 6 });
  const strikesOf = (id: string) =>
    body.data
      .filter((line: { borrower: { id: string } }) => line.borrower.id === id)
      .map((line: { strikes: number }) => line.strikes);
  expect([...new Set(strikesOf(filId))]).toEqual([3]);
  expect([...new Set(strikesOf(gus))]).toEqual([0]);
});

test('TC-FLG-59 (BR 10, 12): the batched count matches countStrikes; with no current semester every line shows 0', async () => {
  const gus = await newBorrower('2026-0002');
  await addStrikes(2);
  await addStrikes(1, gus);
  const counts = await countStrikesForBorrowers([filId, gus], semesterId);
  expect(counts.get(filId)).toBe(await countStrikes(filId));
  expect(counts.get(gus)).toBe(await countStrikes(gus));
  expect([counts.get(filId), counts.get(gus)]).toEqual([2, 1]);

  const item = await newItem();
  await prisma.transaction.create({
    data: {
      borrowerId: filId,
      locationId,
      issuedById: halId,
      semesterId,
      lines: { create: [{ itemId: item.id, quantityBorrowed: 1 }] },
    },
  });
  await prisma.semester.update({ where: { id: semesterId }, data: { isCurrent: false } });
  const lines = (await hal.get('/api/returns/open')).body.data;
  expect(lines.length).toBeGreaterThan(0);
  expect(lines.every((line: { strikes: number }) => line.strikes === 0)).toBe(true);
});
