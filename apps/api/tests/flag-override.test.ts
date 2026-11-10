import request from 'supertest';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { runFlagging } from '../src/jobs/flagging.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { listFlaggedLines } from '../src/services/flags.ts';
import { countStrikes, countStrikesForBorrowers } from '../src/services/strikes.ts';
import { resetDatabase } from './setup/reset-database.ts';

// FLG-4: flag review and override (BR 13, S4, S7, S18). Test cases TC-FLG-22 to TC-FLG-25 and
// TC-FLG-31 to TC-FLG-33 in TEST_CASES.md.

const PASSWORD = 'correct-horse-battery';
let passwordHash: string;
let adminId: string;
let borrowerId: string;
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
  await prisma.setting.create({ data: { id: 1 } });
  borrowerId = (
    await prisma.borrower.create({
      data: { schoolId: '2026-0001', name: 'James Cruz', type: 'STUDENT', department: 'IT' },
    })
  ).id;
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
  itemIds = (
    await prisma.item.createManyAndReturn({
      data: ['Cable', 'Mouse'].map((name) => ({
        name,
        categoryId,
        trackingType: 'QUANTITY' as const,
        totalQuantity: 10,
        condition: 'GOOD' as const,
      })),
    })
  ).map((item) => item.id);
});

// One transaction with a line per entry of `lines` (item index, flag status, returned or not).
async function transaction(
  lines: { item: number; flag?: 'NONE' | 'FLAGGED' | 'OVERRIDDEN'; returned?: boolean }[],
  extra: { note?: string; expectedReturnDate?: Date } = {},
  who: { borrower?: string; semester?: string } = {},
) {
  const created = await prisma.transaction.create({
    data: {
      borrowerId: who.borrower ?? borrowerId,
      locationId,
      issuedById: adminId,
      semesterId: who.semester ?? semesterId,
      issuedAt: new Date('2026-09-01T10:00:00+08:00'),
      lines: {
        create: lines.map(({ item, flag = 'FLAGGED', returned = false }) => ({
          itemId: itemIds[item]!,
          quantityBorrowed: 2,
          quantityReturned: returned ? 2 : 0,
          flagStatus: flag,
          flaggedAt: flag === 'NONE' ? null : new Date('2026-09-01T17:00:00+08:00'),
          ...extra,
        })),
      },
    },
    include: { lines: { orderBy: { id: 'asc' } } },
  });
  return created.lines;
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
const override = (agent: request.Agent, id: string, reason: unknown) =>
  agent.post(`/api/flags/${id}/override`).set('X-Requested-With', 'fetch').send({ reason });

test('TC-FLG-22 (SPEC 5): the list shows borrower, item, note, and expected return date, FLAGGED only', async () => {
  const flagged = (
    await transaction([{ item: 0 }, { item: 1, flag: 'OVERRIDDEN' }], {
      note: 'Back tomorrow',
      expectedReturnDate: new Date('2026-09-02'),
    })
  ).find((line) => line.flagStatus === 'FLAGGED')!;
  const admin = await login('ana');
  const res = await admin.get('/api/flags').expect(200);
  expect(res.body.total).toBe(1);
  expect(res.body.data[0]).toMatchObject({
    lineId: flagged!.id,
    borrower: { schoolId: '2026-0001', name: 'James Cruz' },
    item: { name: 'Cable' },
    note: 'Back tomorrow',
    expectedReturnDate: '2026-09-02',
    outstanding: 2,
  });
});

test('TC-FLG-22: the Returned filter and the search narrow the list', async () => {
  await transaction([{ item: 0, returned: true }, { item: 1 }]);
  const admin = await login('ana');
  const names = async (query: string) =>
    (await admin.get(`/api/flags?${query}`).expect(200)).body.data.map(
      (line: { item: { name: string } }) => line.item.name,
    );
  expect(await names('returned=out')).toEqual(['Mouse']);
  expect(await names('returned=returned')).toEqual(['Cable']);
  expect(await names('q=Mouse')).toEqual(['Mouse']);
  expect((await names('q=James')).sort()).toEqual(['Cable', 'Mouse']);
  expect(await names('q=Nobody')).toEqual([]);
  await admin.get('/api/flags?pageSize=101').expect(400);
});

test('TC-FLG-23 (BR 13, SPEC 7): a reason must be 5 to 500 characters', async () => {
  const [a, b, c] = await transaction([{ item: 0 }, { item: 0 }, { item: 0 }]);
  const admin = await login('ana');
  for (const reason of ['abcd', '  ab  ', 'a'.repeat(501), undefined]) {
    const res = await override(admin, a!.id, reason);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  }
  await override(admin, b!.id, 'abcde').expect(200);
  await override(admin, c!.id, 'a'.repeat(500)).expect(200);
  expect(
    (await prisma.transactionItem.findUniqueOrThrow({ where: { id: a!.id } })).flagStatus,
  ).toBe('FLAGGED');
});

test('TC-FLG-24 (BR 13, 14, S4): overriding works before and after the return, and is audited', async () => {
  const [out, back] = await transaction([{ item: 0 }, { item: 1, returned: true }]);
  const admin = await login('ana');
  for (const line of [out!, back!]) {
    const res = await override(admin, line.id, 'Approved by Prof. Aquino').expect(200);
    expect(res.body.line.flagStatus).toBe('OVERRIDDEN');
    const row = await prisma.transactionItem.findUniqueOrThrow({ where: { id: line.id } });
    expect(row).toMatchObject({
      flagStatus: 'OVERRIDDEN',
      overrideById: adminId,
      overrideReason: 'Approved by Prof. Aquino',
    });
    expect(row.overrideAt).not.toBeNull();
    expect(row.flaggedAt).not.toBeNull(); // history is kept (rule 7)
  }
  const entries = await prisma.auditLog.findMany({ where: { action: 'FLAG_OVERRIDDEN' } });
  expect(entries).toHaveLength(2);
  expect(entries[0]).toMatchObject({ actorId: adminId, entity: 'transaction_item' });
  expect(entries[0]!.after).toMatchObject({ reason: 'Approved by Prof. Aquino' });
  expect(await countStrikes(borrowerId)).toBe(0);
});

test('TC-FLG-04 / S7 through the API: one override leaves 1 strike, the second leaves 0', async () => {
  const [one, two] = await transaction([{ item: 0 }, { item: 1 }]);
  const admin = await login('ana');
  await override(admin, one!.id, 'first one').expect(200);
  expect(await countStrikes(borrowerId)).toBe(1);
  await override(admin, two!.id, 'second one').expect(200);
  expect(await countStrikes(borrowerId)).toBe(0);
});

test('TC-FLG-31 (BR 8, 13, S13): an overridden line that is still out is not flagged again', async () => {
  const [line] = await transaction([{ item: 0 }]);
  const admin = await login('ana');
  await override(admin, line!.id, 'still needed').expect(200);
  await runFlagging(new Date('2026-09-02T17:00:00+08:00'));
  expect(
    (await prisma.transactionItem.findUniqueOrThrow({ where: { id: line!.id } })).flagStatus,
  ).toBe('OVERRIDDEN');
});

test('TC-FLG-32 (BR 13): a line that is not flagged, already overridden, or unknown is refused', async () => {
  const [none, done] = await transaction([
    { item: 0, flag: 'NONE' },
    { item: 1, flag: 'OVERRIDDEN' },
  ]);
  const admin = await login('ana');
  for (const line of [none!, done!]) {
    const res = await override(admin, line.id, 'valid reason');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LINE_NOT_FLAGGED');
  }
  expect((await override(admin, crypto.randomUUID(), 'valid reason')).status).toBe(404);
  expect((await override(admin, 'not-an-id', 'valid reason')).status).toBe(400);
  expect(await prisma.auditLog.count({ where: { action: 'FLAG_OVERRIDDEN' } })).toBe(0);
});

test('TC-FLG-33 (BR 14): two overrides at once succeed once and write one audit entry', async () => {
  const [line] = await transaction([{ item: 0 }]);
  const admin = await login('ana');
  const results = await Promise.all([
    override(admin, line!.id, 'race one'),
    override(admin, line!.id, 'race two'),
  ]);
  expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
  expect(await prisma.auditLog.count({ where: { action: 'FLAG_OVERRIDDEN' } })).toBe(1);
});

test('TC-FLG-25 (S18): handlers and view-only users get 403 on the list and the override', async () => {
  const [line] = await transaction([{ item: 0 }]);
  for (const username of ['hal', 'vic']) {
    const agent = await login(username);
    expect((await agent.get('/api/flags')).status).toBe(403);
    expect((await override(agent, line!.id, 'valid reason')).status).toBe(403);
  }
  expect(
    (await prisma.transactionItem.findUniqueOrThrow({ where: { id: line!.id } })).flagStatus,
  ).toBe('FLAGGED');
});

test('TC-FLG-34 (owner decision, BR 10, 12): only the current semester is listed', async () => {
  const old = await prisma.semester.create({
    data: { name: 'S0', startDate: new Date('2026-01-05'), endDate: new Date('2026-05-31') },
  });
  await transaction([{ item: 0 }], {}, { semester: old.id });
  const [current] = await transaction([{ item: 1 }]);
  const admin = await login('ana');
  const res = await admin.get('/api/flags').expect(200);
  expect(res.body.data.map((line: { lineId: string }) => line.lineId)).toEqual([current!.id]);
  // The old flag is kept (rule 7), and with no current semester nothing is listed.
  await prisma.semester.updateMany({ data: { isCurrent: false } });
  const none = await admin.get('/api/flags').expect(200);
  expect(none.body).toMatchObject({ data: [], total: 0, hasCurrentSemester: false });
  expect(res.body.hasCurrentSemester).toBe(true);
  expect(await prisma.transactionItem.count({ where: { flagStatus: 'FLAGGED' } })).toBe(2);
});

test('TC-FLG-35 (rule 12): a borrower search is not cut off by 100 other name matches', async () => {
  // 101 borrowers match "Smith" and sort before the flagged one, who has the last name.
  await prisma.borrower.createMany({
    data: Array.from({ length: 101 }, (_, n) => ({
      schoolId: `S-${n}`,
      name: `Smith A${String(n).padStart(3, '0')}`,
      type: 'STUDENT' as const,
      department: 'IT',
    })),
  });
  const last = await prisma.borrower.create({
    data: { schoolId: 'S-LAST', name: 'Smith Zzz', type: 'STUDENT', department: 'IT' },
  });
  const [line] = await transaction([{ item: 0 }], {}, { borrower: last.id });
  const admin = await login('ana');
  const res = await admin.get('/api/flags?q=Smith').expect(200);
  expect(res.body.data.map((row: { lineId: string }) => row.lineId)).toEqual([line!.id]);
});

test('TC-FLG-36 (rule 12): over the borrower cap the name search is skipped, item matches still work', async () => {
  await transaction([{ item: 0 }]);
  const other = await prisma.borrower.create({
    data: { schoolId: '2026-0002', name: 'Other', type: 'STUDENT', department: 'IT' },
  });
  await transaction([{ item: 1 }], {}, { borrower: other.id });
  const search = (q: string, cap: number) =>
    listFlaggedLines({ returned: 'all', q, page: 1, pageSize: 25 }, cap);
  // Two flagged borrowers and a cap of 1: the name is not searched, the item name still is.
  expect(await search('Cruz', 1)).toMatchObject({ total: 0, borrowerSearchSkipped: true });
  expect(await search('Cable', 1)).toMatchObject({ total: 1, borrowerSearchSkipped: true });
  // Exactly at the cap the name is searched.
  expect(await search('Cruz', 2)).toMatchObject({ total: 1, borrowerSearchSkipped: false });
  // No search text, no skipping.
  expect(
    (await listFlaggedLines({ returned: 'all', page: 1, pageSize: 25 }, 1)).borrowerSearchSkipped,
  ).toBe(false);
});

test('TC-FLG-37 (BR 10, 11): the list shows strikes and the block threshold; the override reports the new count', async () => {
  const [a, b] = await transaction([{ item: 0 }, { item: 1 }]);
  const [c] = await transaction([{ item: 0 }]);
  const admin = await login('ana');
  const list = await admin.get('/api/flags').expect(200);
  expect(list.body.blockThreshold).toBe(5);
  expect(list.body.data.every((line: { strikes: number }) => line.strikes === 2)).toBe(true);
  // One of the first transaction's two lines: that transaction still counts (S7).
  expect((await override(admin, a!.id, 'first one').expect(200)).body.line.strikes).toBe(2);
  expect((await override(admin, b!.id, 'second one').expect(200)).body.line.strikes).toBe(1);
  expect((await override(admin, c!.id, 'third one').expect(200)).body.line.strikes).toBe(0);
});

test('TC-FLG-38: the batched strike count matches countStrikes', async () => {
  const other = await prisma.borrower.create({
    data: { schoolId: '2026-0002', name: 'Other', type: 'STUDENT', department: 'IT' },
  });
  await transaction([{ item: 0 }, { item: 1 }]);
  await transaction([{ item: 0 }]);
  await transaction([{ item: 0, flag: 'OVERRIDDEN' }]);
  await transaction([{ item: 1 }], {}, { borrower: other.id });
  // A flagged transaction in an older semester does not count in the current one.
  const old = await prisma.semester.create({
    data: { name: 'S0', startDate: new Date('2026-01-05'), endDate: new Date('2026-05-31') },
  });
  await transaction([{ item: 0 }], {}, { semester: old.id });
  const counts = await countStrikesForBorrowers([borrowerId, other.id], semesterId);
  expect(counts.get(borrowerId)).toBe(await countStrikes(borrowerId));
  expect(counts.get(other.id)).toBe(await countStrikes(other.id));
  expect([counts.get(borrowerId), counts.get(other.id)]).toEqual([2, 1]);
  expect(await countStrikesForBorrowers([], semesterId)).toEqual(new Map());
});
