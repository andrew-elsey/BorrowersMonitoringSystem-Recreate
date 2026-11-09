import request from 'supertest';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { borrowerService } from '../src/services/borrowers.ts';
import { resetDatabase } from './setup/reset-database.ts';

// QA (automated) gap tests for FLG-3 (strike warnings and blocking, BR 3, 6, 10, 11, 12; S8, S9).
// Covers what strike-blocking.test.ts leaves open: thresholds changed through PUT /api/settings at
// their exact edges, "5 or more" above the block, the exact BORROWER_BLOCKED reply for every staff
// role, one strike per transaction (several flagged lines, a partly overridden transaction), a
// returned flagged line still counting, the block following a semester switch and back, isEligible
// called inside the checkout transaction with the recorded semester, FOR SHARE not serialising two
// checkouts, returns by an admin and of a flagged line while blocked, the strikes endpoint for
// admins, inactive borrowers, oversized ids and its error format, and the open-lines reply with no
// current semester. Strikes are set directly as FLAGGED lines, as in strike-blocking.test.ts.

const PASSWORD = 'correct-horse-battery';
const BLOCKED_MESSAGE =
  'This borrower is blocked from borrowing this semester because of too many strikes. An admin can override a flag to unblock them.';
let passwordHash: string;
let ada: ReturnType<typeof request.agent>;
let hal: ReturnType<typeof request.agent>;
let adminId: string;
let borrowerId: string;
let locationId: string;
let categoryId: string;
let semesterId: string;
let nextTag = 0;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
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

beforeEach(async () => {
  await resetDatabase();
  await prisma.setting.create({ data: { id: 1 } });
  const users = await prisma.user.createManyAndReturn({
    data: [
      { name: 'Ada Admin', username: 'ada', passwordHash, role: 'ADMIN' },
      { name: 'Hal Handler', username: 'hal', passwordHash, role: 'HANDLER' },
    ],
  });
  adminId = users.find((user) => user.role === 'ADMIN')!.id;
  ada = await signIn('ada');
  hal = await signIn('hal');
  borrowerId = await newBorrower('QA-0001');
  locationId = (await prisma.location.create({ data: { name: 'QA Lab', createdById: adminId } }))
    .id;
  categoryId = (await prisma.category.create({ data: { name: 'QA Equipment' } })).id;
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

afterEach(() => {
  vi.restoreAllMocks();
});

const newBorrower = async (schoolId: string, active = true) =>
  (
    await prisma.borrower.create({
      data: { schoolId, name: 'Test Borrower', type: 'STUDENT', department: 'IT', active },
    })
  ).id;

const newItem = async () =>
  prisma.item.create({
    data: {
      name: 'QA Laptop',
      categoryId,
      trackingType: 'UNIT',
      assetTag: `QA-LT-${++nextTag}`,
      totalQuantity: 1,
      condition: 'GOOD',
    },
  });

type LineState = { flagStatus: 'NONE' | 'FLAGGED' | 'OVERRIDDEN'; returned?: boolean };

// One transaction per call, with one line per entry in `lines`.
async function addTransaction(lines: LineState[], semester = semesterId, borrower = borrowerId) {
  const items: { id: string }[] = [];
  while (items.length < lines.length) items.push(await newItem());
  return prisma.transaction.create({
    data: {
      borrowerId: borrower,
      locationId,
      issuedById: adminId,
      semesterId: semester,
      lines: {
        create: lines.map((line, i) => ({
          itemId: items[i]!.id,
          quantityBorrowed: 1,
          quantityReturned: line.returned ? 1 : 0,
          flagStatus: line.flagStatus,
          flaggedAt: line.flagStatus === 'NONE' ? null : new Date('2026-11-09T09:00:00.000Z'),
        })),
      },
    },
    include: { lines: true },
  });
}

// One transaction with one FLAGGED line = one strike (BR 10).
async function addStrikes(count: number, semester = semesterId, borrower = borrowerId) {
  for (let i = 0; i < count; i++)
    await addTransaction([{ flagStatus: 'FLAGGED' }], semester, borrower);
}

const checkout = async (agent = hal, borrower = borrowerId) =>
  agent
    .post('/api/transactions')
    .set('X-Requested-With', 'fetch')
    .send({
      borrowerId: borrower,
      locationId,
      lines: [{ itemId: (await newItem()).id, quantity: 1 }],
    });

const putThresholds = (warningThreshold: number, noticeThreshold: number, blockThreshold: number) =>
  ada
    .put('/api/settings')
    .set('X-Requested-With', 'fetch')
    .send({ closingTime: '17:00', warningThreshold, noticeThreshold, blockThreshold })
    .expect(200);

const strikesOf = (agent = hal, id = borrowerId) => agent.get(`/api/borrowers/${id}/strikes`);

// --- Thresholds at their exact edges, changed through the admin Settings API (rule 3) ---

test('blocks at exactly the block threshold saved in Settings and allows one strike below it', async () => {
  await putThresholds(1, 2, 3);
  await addStrikes(2);
  expect((await checkout()).status).toBe(201); // 2 < 3
  await addStrikes(1);
  const res = await checkout();
  expect(res.status).toBe(409); // 3 >= 3
  expect(res.body.error.code).toBe('BORROWER_BLOCKED');
});

test('the strikes endpoint reports the thresholds saved in Settings, not the defaults', async () => {
  await putThresholds(1, 2, 3);
  await addStrikes(1);
  expect((await strikesOf()).body).toEqual({
    strikes: 1,
    warningThreshold: 1,
    noticeThreshold: 2,
    blockThreshold: 3,
    semesterName: 'S1',
  });
});

test('raising the block threshold in Settings unblocks a borrower at 5 strikes on the next checkout', async () => {
  await addStrikes(5);
  expect((await checkout()).body.error.code).toBe('BORROWER_BLOCKED');
  await putThresholds(3, 4, 6);
  expect((await checkout()).status).toBe(201); // 5 < 6, read fresh from settings
});

test('stays blocked above the block threshold (5 or more strikes, BR 11)', async () => {
  await addStrikes(7);
  expect((await checkout()).body.error.code).toBe('BORROWER_BLOCKED');
});

test('allows checkout at the notice threshold with a block threshold of 100', async () => {
  await putThresholds(98, 99, 100);
  await addStrikes(5);
  expect((await checkout()).status).toBe(201);
});

// --- BORROWER_BLOCKED at the API: status, code, message, standard error format ---

test.each(['admin', 'handler'] as const)(
  'refuses a blocked borrower for a %s with 409 BORROWER_BLOCKED and its own message',
  async (role) => {
    await addStrikes(5);
    const res = await checkout(role === 'admin' ? ada : hal);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: { code: 'BORROWER_BLOCKED', message: BLOCKED_MESSAGE, details: {} },
    });
  },
);

test('a refused blocked checkout leaves the item available for someone else', async () => {
  await addStrikes(5);
  const item = await newItem();
  const send = (borrower: string) =>
    hal
      .post('/api/transactions')
      .set('X-Requested-With', 'fetch')
      .send({ borrowerId: borrower, locationId, lines: [{ itemId: item.id, quantity: 1 }] });
  expect((await send(borrowerId)).status).toBe(409);
  const other = await newBorrower('QA-0002');
  expect((await send(other)).status).toBe(201);
});

// --- One strike per transaction (BR 10) ---

test('a transaction with several flagged lines counts as one strike, so 4 such transactions do not block', async () => {
  await addTransaction([
    { flagStatus: 'FLAGGED' },
    { flagStatus: 'FLAGGED' },
    { flagStatus: 'FLAGGED' },
  ]);
  await addStrikes(3);
  expect((await strikesOf()).body.strikes).toBe(4);
  expect((await checkout()).status).toBe(201);
});

test('overriding one of two flagged lines in a transaction keeps the borrower blocked', async () => {
  await addStrikes(4);
  const tx = await addTransaction([{ flagStatus: 'FLAGGED' }, { flagStatus: 'FLAGGED' }]);
  await prisma.transactionItem.update({
    where: { id: tx.lines[0]!.id },
    data: { flagStatus: 'OVERRIDDEN' },
  });
  expect((await checkout()).body.error.code).toBe('BORROWER_BLOCKED');
});

test('overriding every flagged line of a transaction brings a blocked borrower below the block', async () => {
  await addStrikes(4);
  const tx = await addTransaction([{ flagStatus: 'FLAGGED' }, { flagStatus: 'FLAGGED' }]);
  expect((await checkout()).status).toBe(409);
  await prisma.transactionItem.updateMany({
    where: { transactionId: tx.id },
    data: { flagStatus: 'OVERRIDDEN' },
  });
  expect((await strikesOf()).body.strikes).toBe(4);
  expect((await checkout()).status).toBe(201);
});

test('flagged lines that were fully returned still count toward the block (BR 6)', async () => {
  for (let i = 0; i < 5; i++) await addTransaction([{ flagStatus: 'FLAGGED', returned: true }]);
  expect((await checkout()).body.error.code).toBe('BORROWER_BLOCKED');
});

// --- The block counts the semester the checkout records (BR 12, owner decision 2026-11-10) ---

test('switching to a new semester unblocks the borrower, and switching back blocks them again (S9)', async () => {
  await addStrikes(5);
  const s2 = await prisma.semester.create({
    data: { name: 'S2', startDate: new Date('2027-01-05'), endDate: new Date('2027-05-31') },
  });
  const setCurrent = (id: string) =>
    ada.post(`/api/semesters/${id}/current`).set('X-Requested-With', 'fetch').expect(200);

  await setCurrent(s2.id);
  const res = await checkout();
  expect(res.status).toBe(201);
  expect(res.body.transaction.semesterId).toBe(s2.id);

  await setCurrent(semesterId);
  expect((await checkout()).body.error.code).toBe('BORROWER_BLOCKED');
});

test('checkout calls isEligible inside its transaction with the semester it records', async () => {
  const spy = vi.spyOn(borrowerService, 'isEligible');
  const res = await checkout();
  expect(res.status).toBe(201);
  expect(spy).toHaveBeenCalledTimes(1);
  const [id, tx, semester] = spy.mock.calls[0]!;
  expect(id).toBe(borrowerId);
  // The transaction client, not the shared top-level client.
  expect(tx).not.toBe(prisma);
  expect(semester).toBe(res.body.transaction.semesterId);
  expect(semester).toBe(semesterId);
});

// --- FOR SHARE: strict against deactivation, but two checkouts do not wait on each other ---

test('two checkouts for the same borrower can both hold the FOR SHARE lock at once', async () => {
  await prisma.$transaction(async (tx) => {
    await borrowerService.isEligible(borrowerId, tx, semesterId);
    const second = prisma.$transaction(async (other) => {
      await other.$executeRaw`SET LOCAL lock_timeout = '200ms'`;
      return borrowerService.isEligible(borrowerId, other, semesterId);
    });
    await expect(second).resolves.toEqual({ eligible: true });
  });
});

test('the FOR SHARE lock is released when the checkout transaction ends', async () => {
  await prisma.$transaction(async (tx) => {
    await borrowerService.isEligible(borrowerId, tx, semesterId);
  });
  await prisma.$transaction(async (other) => {
    await other.$executeRaw`SET LOCAL lock_timeout = '200ms'`;
    await other.$executeRaw`UPDATE borrowers SET active = false WHERE id = ${borrowerId}::uuid`;
  });
  expect((await checkout()).body.error.code).toBe('BORROWER_INACTIVE');
});

// --- Returns are never blocked (BR 11) ---

test('an admin can record a return for a blocked borrower', async () => {
  const open = await addTransaction([{ flagStatus: 'NONE' }]);
  await addStrikes(5);
  expect((await checkout()).status).toBe(409);
  await ada
    .post('/api/returns')
    .set('X-Requested-With', 'fetch')
    .send({ lines: [{ lineId: open.lines[0]!.id, quantity: 1, condition: 'GOOD' }] })
    .expect(201);
});

test('returning one of the flagged lines that cause the block works, and the borrower stays blocked (BR 6)', async () => {
  await addStrikes(4);
  const flagged = await addTransaction([{ flagStatus: 'FLAGGED' }]);
  await hal
    .post('/api/returns')
    .set('X-Requested-With', 'fetch')
    .send({ lines: [{ lineId: flagged.lines[0]!.id, quantity: 1, condition: 'GOOD' }] })
    .expect(201);
  expect((await checkout()).body.error.code).toBe('BORROWER_BLOCKED');
});

// --- The strikes endpoint: roles, bounds, and errors ---

test('an admin can read a borrower strikes', async () => {
  await addStrikes(2);
  const res = await strikesOf(ada);
  expect(res.status).toBe(200);
  expect(res.body.strikes).toBe(2);
});

test('the strikes endpoint answers for an inactive borrower', async () => {
  const inactive = await newBorrower('QA-0003', false);
  await addStrikes(1, semesterId, inactive);
  const res = await strikesOf(hal, inactive);
  expect(res.status).toBe(200);
  expect(res.body.strikes).toBe(1);
});

test('the strikes endpoint counts only the current semester, once per transaction, and skips overridden lines', async () => {
  const s0 = await prisma.semester.create({
    data: { name: 'S0', startDate: new Date('2026-01-05'), endDate: new Date('2026-05-31') },
  });
  await addStrikes(3, s0.id);
  await addTransaction([{ flagStatus: 'FLAGGED' }, { flagStatus: 'FLAGGED' }]);
  await addTransaction([{ flagStatus: 'OVERRIDDEN' }]);
  await addTransaction([{ flagStatus: 'NONE' }]);
  expect((await strikesOf()).body.strikes).toBe(1);
});

test('an oversized borrower id is a 400 VALIDATION_ERROR in the standard format, not a 500', async () => {
  const res = await strikesOf(hal, 'a'.repeat(5000));
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('VALIDATION_ERROR');
  expect(typeof res.body.error.message).toBe('string');
});

test('an unknown borrower id is 404 NOT_FOUND with a message', async () => {
  const res = await strikesOf(hal, '00000000-0000-4000-8000-000000000000');
  expect(res.status).toBe(404);
  expect(res.body.error).toMatchObject({ code: 'NOT_FOUND', message: 'Borrower not found.' });
});

test('a signed-out strikes request is 401 UNAUTHENTICATED and creates no session (rule 14)', async () => {
  const res = await request(createApp()).get(`/api/borrowers/${borrowerId}/strikes`);
  expect(res.status).toBe(401);
  expect(res.body.error.code).toBe('UNAUTHENTICATED');
  expect(res.headers['set-cookie']).toBeUndefined();
});

// --- The open-lines reply with no current semester ---

test('with no current semester the open-lines reply still carries the thresholds from settings and 0 strikes', async () => {
  await putThresholds(2, 3, 7);
  await addStrikes(5);
  await addTransaction([{ flagStatus: 'NONE' }]);
  await prisma.semester.update({ where: { id: semesterId }, data: { isCurrent: false } });
  const res = await hal.get('/api/returns/open');
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ warningThreshold: 2, noticeThreshold: 3, blockThreshold: 7 });
  expect(res.body.data.length).toBeGreaterThan(0);
  expect(res.body.data.every((line: { strikes: number }) => line.strikes === 0)).toBe(true);
});

test('open lines show the strikes of the current semester only, counted once per transaction', async () => {
  const s0 = await prisma.semester.create({
    data: { name: 'S0', startDate: new Date('2026-01-05'), endDate: new Date('2026-05-31') },
  });
  await addStrikes(4, s0.id);
  // One transaction, two flagged lines, both still out: one strike, shown on both lines.
  await addTransaction([{ flagStatus: 'FLAGGED' }, { flagStatus: 'FLAGGED' }]);
  const lines = (await hal.get('/api/returns/open')).body.data.filter(
    (line: { transactionId: string; borrower: { id: string } }) => line.borrower.id === borrowerId,
  );
  expect(lines.map((line: { strikes: number }) => line.strikes)).toEqual(lines.map(() => 1));
  expect(lines.length).toBeGreaterThanOrEqual(2);
});
