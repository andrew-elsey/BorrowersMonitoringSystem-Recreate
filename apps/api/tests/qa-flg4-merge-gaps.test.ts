import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { runFlagging } from '../src/jobs/flagging.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { countStrikes, countStrikesForBorrowers } from '../src/services/strikes.ts';
import { resetDatabase } from './setup/reset-database.ts';

// QA (automated) merge gap tests for FLG-4 after main (FLG-3) was merged in (11c02ac). Cross-ticket
// checks: TC-FLG-51 through the real override API (block at 5, override, checkout again), the
// strike count agreeing across GET /api/borrowers/:id/strikes, GET /api/returns/open and
// GET /api/flags, and countStrikes(id, db, semesterId) delegating to countStrikesForBorrowers
// with the same result as the current-semester path (BR 10, 11, 12, 13; S7, S8).

const PASSWORD = 'correct-horse-battery';
const DAY = 24 * 60 * 60 * 1000;
let passwordHash: string;
let adminId: string;
let handlerId: string;
let borrowerId: string;
let otherId: string;
let locationId: string;
let categoryId: string;
let semesterId: string;
let oldSemesterId: string;
let admin: ReturnType<typeof request.agent>;
let handler: ReturnType<typeof request.agent>;
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
  const users = await prisma.user.createManyAndReturn({
    data: [
      { name: 'QA Admin', username: 'qa-admin', passwordHash, role: 'ADMIN' },
      { name: 'QA Handler', username: 'qa-handler', passwordHash, role: 'HANDLER' },
    ],
  });
  adminId = users.find((user) => user.role === 'ADMIN')!.id;
  handlerId = users.find((user) => user.role === 'HANDLER')!.id;
  await prisma.setting.create({ data: { id: 1 } }); // defaults 3 / 4 / 5
  const borrowers = await prisma.borrower.createManyAndReturn({
    data: [
      { schoolId: 'QA-0001', name: 'Rhea Quality', type: 'STUDENT', department: 'QA' },
      { schoolId: 'QA-0002', name: 'Otto Other', type: 'STUDENT', department: 'QA' },
    ],
  });
  borrowerId = borrowers.find((b) => b.schoolId === 'QA-0001')!.id;
  otherId = borrowers.find((b) => b.schoolId === 'QA-0002')!.id;
  locationId = (await prisma.location.create({ data: { name: 'QA Lab', createdById: adminId } }))
    .id;
  categoryId = (await prisma.category.create({ data: { name: 'QA Equipment' } })).id;
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
  oldSemesterId = (
    await prisma.semester.create({
      data: { name: 'QA S0', startDate: new Date('2026-01-05'), endDate: new Date('2026-05-31') },
    })
  ).id;
  admin = await signIn('qa-admin');
  handler = await signIn('qa-handler');
});

const newItemId = async () =>
  (
    await prisma.item.create({
      data: {
        name: `QA Laptop ${++nextTag}`,
        categoryId,
        trackingType: 'UNIT',
        assetTag: `QA-LT-${nextTag}`,
        totalQuantity: 1,
        condition: 'GOOD',
      },
    })
  ).id;

// One transaction, still out, with one line per entry of `flags`. Returns its line ids in the
// order given (line ids are random, so they are matched back by item).
async function transaction(
  flags: ('NONE' | 'FLAGGED' | 'OVERRIDDEN')[],
  who: { borrower?: string; semester?: string } = {},
) {
  const itemIds: string[] = [];
  while (itemIds.length < flags.length) itemIds.push(await newItemId());
  const created = await prisma.transaction.create({
    data: {
      borrowerId: who.borrower ?? borrowerId,
      locationId,
      issuedById: handlerId,
      semesterId: who.semester ?? semesterId,
      lines: {
        create: flags.map((flagStatus, n) => ({
          itemId: itemIds[n]!,
          quantityBorrowed: 1,
          flagStatus,
          flaggedAt: flagStatus === 'NONE' ? null : new Date('2026-09-01T09:00:00Z'),
        })),
      },
    },
    include: { lines: true },
  });
  return itemIds.map((itemId) => created.lines.find((line) => line.itemId === itemId)!.id);
}

const checkout = async (borrower = borrowerId) =>
  handler
    .post('/api/transactions')
    .set('X-Requested-With', 'fetch')
    .send({
      borrowerId: borrower,
      locationId,
      lines: [{ itemId: await newItemId(), quantity: 1 }],
    });
const override = (lineId: string, reason = 'Approved by the chair') =>
  admin.post(`/api/flags/${lineId}/override`).set('X-Requested-With', 'fetch').send({ reason });

// The borrower's strikes as each of the three endpoints reports them.
async function strikesEverywhere(borrower: string) {
  const status = (await handler.get(`/api/borrowers/${borrower}/strikes`).expect(200)).body;
  const open = (await handler.get('/api/returns/open?pageSize=100').expect(200)).body;
  const flags = (await admin.get('/api/flags?pageSize=100').expect(200)).body;
  const of = (rows: { borrower: { id: string }; strikes: number }[]) => [
    ...new Set(rows.filter((row) => row.borrower.id === borrower).map((row) => row.strikes)),
  ];
  return { endpoint: status.strikes, openLines: of(open.data), flagReview: of(flags.data) };
}

describe('TC-FLG-51 through the real override API (BR 11, 13, S8)', () => {
  test('a borrower blocked at 5 strikes can borrow again after one line is overridden on Flag review', async () => {
    const lines = [];
    for (let n = 0; n < 5; n += 1) lines.push((await transaction(['FLAGGED']))[0]!);

    const blocked = await checkout();
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('BORROWER_BLOCKED');

    const list = (await admin.get('/api/flags').expect(200)).body;
    expect(list.total).toBe(5);
    expect(list.blockThreshold).toBe(5);
    expect(list.data.every((line: { strikes: number }) => line.strikes === 5)).toBe(true);

    const res = await override(lines[0]!).expect(200);
    expect(res.body.line.strikes).toBe(4);
    expect(await prisma.auditLog.count({ where: { action: 'FLAG_OVERRIDDEN' } })).toBe(1);

    expect(
      (await handler.get(`/api/borrowers/${borrowerId}/strikes`).expect(200)).body.strikes,
    ).toBe(4);
    expect((await checkout()).status).toBe(201);
  });

  test('S7 across tickets: a transaction with two flagged lines keeps the block until both are overridden', async () => {
    for (let n = 0; n < 4; n += 1) await transaction(['FLAGGED']);
    const [first, second] = await transaction(['FLAGGED', 'FLAGGED']);
    expect((await checkout()).body.error.code).toBe('BORROWER_BLOCKED');
    expect((await override(first!).expect(200)).body.line.strikes).toBe(5);
    expect((await checkout()).body.error.code).toBe('BORROWER_BLOCKED');
    expect((await override(second!).expect(200)).body.line.strikes).toBe(4);
    expect((await checkout()).status).toBe(201);
  });

  test('after the override, a new flag from the end-of-day job blocks the borrower again', async () => {
    const lines = [];
    for (let n = 0; n < 5; n += 1) lines.push((await transaction(['FLAGGED']))[0]!);
    await override(lines[0]!).expect(200);
    expect((await checkout()).status).toBe(201); // now 4 strikes, and this checkout is still out
    // A fixed clock two days ahead: the new line was issued before that closing time (BR 8).
    await runFlagging(new Date(Date.now() + 2 * DAY));
    expect(await countStrikes(borrowerId)).toBe(5);
    expect((await checkout()).body.error.code).toBe('BORROWER_BLOCKED');
    // The overridden line stayed overridden (BR 13, S13).
    expect(
      (await prisma.transactionItem.findUniqueOrThrow({ where: { id: lines[0]! } })).flagStatus,
    ).toBe('OVERRIDDEN');
  });

  test('flags from an earlier semester do not block, and overriding one changes nothing now', async () => {
    const old = [];
    for (let n = 0; n < 5; n += 1) {
      old.push((await transaction(['FLAGGED'], { semester: oldSemesterId }))[0]!);
    }
    expect((await checkout()).status).toBe(201);
    expect((await override(old[0]!).expect(200)).body.line.strikes).toBe(0);
  });
});

describe('the strike count agrees across Checkout, Return and Flag review (BR 10)', () => {
  test('the three endpoints give the same count, before and after overrides', async () => {
    const [single] = await transaction(['FLAGGED']);
    const [pairA, pairB] = await transaction(['FLAGGED', 'FLAGGED']);
    await transaction(['FLAGGED', 'NONE']);
    await transaction(['OVERRIDDEN']); // no longer counts
    await transaction(['NONE']); // not flagged
    await transaction(['FLAGGED'], { semester: oldSemesterId }); // another semester
    await transaction(['FLAGGED'], { borrower: otherId });

    expect(await strikesEverywhere(borrowerId)).toEqual({
      endpoint: 3,
      openLines: [3],
      flagReview: [3],
    });
    expect(await strikesEverywhere(otherId)).toEqual({
      endpoint: 1,
      openLines: [1],
      flagReview: [1],
    });

    // One line of the two-line transaction: still 3 (S7).
    expect((await override(pairA!).expect(200)).body.line.strikes).toBe(3);
    expect(await strikesEverywhere(borrowerId)).toEqual({
      endpoint: 3,
      openLines: [3],
      flagReview: [3],
    });

    await override(pairB!).expect(200);
    expect((await override(single!).expect(200)).body.line.strikes).toBe(1);
    expect(await strikesEverywhere(borrowerId)).toEqual({
      endpoint: 1,
      openLines: [1],
      flagReview: [1],
    });
    // The other borrower is untouched.
    expect((await strikesEverywhere(otherId)).endpoint).toBe(1);
  });

  test('with no current semester every endpoint gives 0 (BR 10)', async () => {
    await transaction(['FLAGGED']);
    await prisma.semester.updateMany({ data: { isCurrent: false } });
    const status = (await handler.get(`/api/borrowers/${borrowerId}/strikes`).expect(200)).body;
    const open = (await handler.get('/api/returns/open').expect(200)).body;
    const flags = (await admin.get('/api/flags').expect(200)).body;
    expect(status.strikes).toBe(0);
    expect(open.data.map((row: { strikes: number }) => row.strikes)).toEqual([0]);
    expect(flags).toMatchObject({ data: [], hasCurrentSemester: false });
  });

  test('the Return and Flag review replies carry the same block threshold as the strikes endpoint', async () => {
    await prisma.setting.update({
      where: { id: 1 },
      data: { warningThreshold: 2, noticeThreshold: 4, blockThreshold: 6 },
    });
    await transaction(['FLAGGED']);
    const status = (await handler.get(`/api/borrowers/${borrowerId}/strikes`).expect(200)).body;
    const open = (await handler.get('/api/returns/open').expect(200)).body;
    const flags = (await admin.get('/api/flags').expect(200)).body;
    expect([status.blockThreshold, open.blockThreshold, flags.blockThreshold]).toEqual([6, 6, 6]);
  });
});

describe('countStrikes with a semester id delegates to countStrikesForBorrowers (BR 10, 12)', () => {
  async function mixedData() {
    await transaction(['FLAGGED']);
    await transaction(['FLAGGED', 'FLAGGED']);
    await transaction(['OVERRIDDEN', 'FLAGGED']);
    await transaction(['OVERRIDDEN', 'OVERRIDDEN']);
    await transaction(['NONE']);
    await transaction(['FLAGGED'], { semester: oldSemesterId });
    await transaction(['FLAGGED'], { semester: oldSemesterId });
    await transaction(['FLAGGED'], { borrower: otherId });
  }

  test('given the current semester id, it equals the current-semester path and the batched count', async () => {
    await mixedData();
    for (const id of [borrowerId, otherId]) {
      const current = await countStrikes(id);
      expect(await countStrikes(id, prisma, semesterId)).toBe(current);
      expect((await countStrikesForBorrowers([id], semesterId)).get(id) ?? 0).toBe(current);
    }
    expect(await countStrikes(borrowerId)).toBe(3);
  });

  test('inside a database transaction it gives the same result', async () => {
    await mixedData();
    const inTx = await prisma.$transaction((tx) => countStrikes(borrowerId, tx, semesterId));
    expect(inTx).toBe(await countStrikes(borrowerId));
  });

  test('given another semester id, it counts that semester, not the current one', async () => {
    await mixedData();
    expect(await countStrikes(borrowerId, prisma, oldSemesterId)).toBe(2);
    expect(await countStrikes(otherId, prisma, oldSemesterId)).toBe(0);
  });

  test('a borrower with no strikes, or an unknown id, gives 0 on both paths', async () => {
    await transaction(['NONE']);
    const unknown = crypto.randomUUID();
    for (const id of [borrowerId, unknown]) {
      expect(await countStrikes(id)).toBe(0);
      expect(await countStrikes(id, prisma, semesterId)).toBe(0);
    }
  });

  test('after semesters switch, the current-semester path follows the new current one, matching the id path', async () => {
    await mixedData();
    await prisma.semester.update({ where: { id: semesterId }, data: { isCurrent: false } });
    await prisma.semester.update({ where: { id: oldSemesterId }, data: { isCurrent: true } });
    expect(await countStrikes(borrowerId)).toBe(2);
    expect(await countStrikes(borrowerId, prisma, oldSemesterId)).toBe(2);
  });
});
