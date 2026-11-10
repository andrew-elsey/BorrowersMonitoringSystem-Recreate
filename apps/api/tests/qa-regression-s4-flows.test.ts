import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { runFlagging } from '../src/jobs/flagging.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { resetDatabase } from './setup/reset-database.ts';

// QA regression, Sprint 4 (main d2b6531): cross-ticket flows between FLG-2 (flagging job),
// FLG-3 (strike blocking), FLG-4 (flag review and override) and BRW-5 (open lines), and with the
// Sprint 1-3 checkout, return, item, settings and semester endpoints. Existing per-ticket tests
// mostly seed FLAGGED lines directly; these go through the real job and the real endpoints.
// Checkouts are issued at the real time; the job is run at later instants (`later(n)`), so the
// latest closing before each run is always after every issue time, whatever the real clock says.

const PASSWORD = 'correct-horse-battery';
const DAY = 24 * 60 * 60 * 1000;
const FETCH = { 'X-Requested-With': 'fetch' };
type Agent = ReturnType<typeof request.agent>;

let passwordHash: string;
let adminId: string;
let handlerId: string;
let borrowerId: string;
let otherId: string;
let locationId: string;
let categoryId: string;
let semesterId: string;
let admin: Agent;
let handler: Agent;
let nextTag = 0;
const startedAt = Date.now();
const later = (n: number) => new Date(startedAt + n * 2 * DAY);

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

async function signIn(username: string) {
  const agent = request.agent(createApp());
  await agent.post('/api/auth/login').set(FETCH).send({ username, password: PASSWORD }).expect(200);
  return agent;
}

beforeEach(async () => {
  await resetDatabase();
  const users = await prisma.user.createManyAndReturn({
    data: [
      { name: 'Reg4 Admin', username: 'reg4-admin', passwordHash, role: 'ADMIN' },
      { name: 'Reg4 Handler', username: 'reg4-handler', passwordHash, role: 'HANDLER' },
    ],
  });
  adminId = users.find((user) => user.role === 'ADMIN')!.id;
  handlerId = users.find((user) => user.role === 'HANDLER')!.id;
  await prisma.setting.create({ data: { id: 1 } }); // defaults: 17:00, 3 / 4 / 5
  const borrowers = await prisma.borrower.createManyAndReturn({
    data: [
      { schoolId: 'R4-0001', name: 'Fil Testcase', type: 'STUDENT', department: 'QA' },
      { schoolId: 'R4-0002', name: 'Oli Testcase', type: 'STUDENT', department: 'QA' },
    ],
  });
  borrowerId = borrowers.find((b) => b.schoolId === 'R4-0001')!.id;
  otherId = borrowers.find((b) => b.schoolId === 'R4-0002')!.id;
  locationId = (await prisma.location.create({ data: { name: 'Reg4 Lab', createdById: adminId } }))
    .id;
  categoryId = (await prisma.category.create({ data: { name: 'Reg4 Equipment' } })).id;
  semesterId = (
    await prisma.semester.create({
      data: {
        name: 'Reg4 S1',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-12-15'),
        isCurrent: true,
      },
    })
  ).id;
  admin = await signIn('reg4-admin');
  handler = await signIn('reg4-handler');
});

const unitItem = async () =>
  (
    await prisma.item.create({
      data: {
        name: `Reg4 Laptop ${++nextTag}`,
        categoryId,
        trackingType: 'UNIT',
        assetTag: `R4-LT-${nextTag}`,
        totalQuantity: 1,
        condition: 'GOOD',
      },
    })
  ).id;

const cords = async (totalQuantity: number) =>
  (
    await prisma.item.create({
      data: {
        name: 'Reg4 Extension cord',
        categoryId,
        trackingType: 'QUANTITY',
        totalQuantity,
        condition: 'GOOD',
      },
    })
  ).id;

// POST /api/transactions; resolves to the response so refusals can be checked.
const checkout = (
  lines: { itemId: string; quantity: number }[],
  borrower = borrowerId,
  agent = handler,
) => agent.post('/api/transactions').set(FETCH).send({ borrowerId: borrower, locationId, lines });

// One checkout of a new unit item; returns its line id.
async function borrowLaptop(borrower = borrowerId): Promise<string> {
  const res = await checkout([{ itemId: await unitItem(), quantity: 1 }], borrower).expect(201);
  return res.body.transaction.lines[0].id;
}

const giveBack = (lineId: string, quantity = 1, agent = handler) =>
  agent
    .post('/api/returns')
    .set(FETCH)
    .send({ lines: [{ lineId, quantity, condition: 'GOOD' }] });

const override = (lineId: string, reason = 'Approved by the chair') =>
  admin.post(`/api/flags/${lineId}/override`).set(FETCH).send({ reason });

const putSettings = (settings: {
  closingTime?: string;
  warningThreshold?: number;
  noticeThreshold?: number;
  blockThreshold?: number;
}) =>
  admin
    .put('/api/settings')
    .set(FETCH)
    .send({
      closingTime: '17:00',
      warningThreshold: 3,
      noticeThreshold: 4,
      blockThreshold: 5,
      ...settings,
    });

const strikeStatus = async (borrower = borrowerId) =>
  (await handler.get(`/api/borrowers/${borrower}/strikes`).expect(200)).body;

const flagStatus = async (lineId: string) =>
  (await prisma.transactionItem.findUniqueOrThrow({ where: { id: lineId } })).flagStatus;

// What the checkout item search shows (BRW-3 reads `available`).
async function available(itemId: string): Promise<number> {
  const res = await handler.get('/api/items?pageSize=100').expect(200);
  return res.body.data.find((row: { id: string }) => row.id === itemId).available;
}

describe('checkout -> flagging job -> strikes -> thresholds -> block -> override (FLG-2, FLG-3, FLG-4)', () => {
  test('with thresholds 2 / 3 / 4 saved through PUT /api/settings, real flagging runs warn at 2, notice at 3, block at 4, and an override unblocks (BR 8, 10, 11, 13, rule 3)', async () => {
    await putSettings({ warningThreshold: 2, noticeThreshold: 3, blockThreshold: 4 }).expect(200);

    // Two checkouts, still out at closing: the job flags both (BR 8), 2 strikes (BR 10).
    await borrowLaptop();
    await borrowLaptop();
    expect((await runFlagging(later(1))).flagged).toBe(2);
    expect(await strikeStatus()).toMatchObject({
      strikes: 2,
      warningThreshold: 2,
      noticeThreshold: 3,
      blockThreshold: 4,
    });

    // At the warning and the notice thresholds checkout still works (BR 11, S8).
    await borrowLaptop();
    expect((await runFlagging(later(2))).flagged).toBe(1);
    expect((await strikeStatus()).strikes).toBe(3);
    const fourth = await borrowLaptop();
    await runFlagging(later(3));

    // At the saved block threshold (4, not the default 5) checkout is refused and creates nothing.
    expect((await strikeStatus()).strikes).toBe(4);
    const transactionsBefore = await prisma.transaction.count();
    const refused = await checkout([{ itemId: await unitItem(), quantity: 1 }]);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('BORROWER_BLOCKED');
    expect(await prisma.transaction.count()).toBe(transactionsBefore);

    // Returns are never blocked (BR 11), and returning keeps the flag and the strike (BR 6).
    await giveBack(fourth).expect(201);
    expect(await flagStatus(fourth)).toBe('FLAGGED');
    expect((await strikeStatus()).strikes).toBe(4);
    expect((await checkout([{ itemId: await unitItem(), quantity: 1 }])).status).toBe(409);

    // The admin overrides the returned line on Flag review: 3 strikes, borrowing works again.
    const overridden = await override(fourth).expect(200);
    expect(overridden.body.line).toMatchObject({ flagStatus: 'OVERRIDDEN', strikes: 3 });
    expect((await strikeStatus()).strikes).toBe(3);
    await borrowLaptop();
  });

  test('a later flagging run never re-flags the overridden line, but a new unreturned checkout blocks again (BR 8, 13, S13)', async () => {
    const lines: string[] = [];
    for (let n = 0; n < 5; n++) lines.push(await borrowLaptop());
    await runFlagging(later(1));
    expect((await checkout([{ itemId: await unitItem(), quantity: 1 }])).body.error.code).toBe(
      'BORROWER_BLOCKED',
    );

    await override(lines[0]!).expect(200); // still out
    expect((await runFlagging(later(2))).flagged).toBe(0);
    expect(await flagStatus(lines[0]!)).toBe('OVERRIDDEN');
    expect((await strikeStatus()).strikes).toBe(4);

    await borrowLaptop(); // allowed at 4
    expect((await runFlagging(later(3))).flagged).toBe(1);
    expect((await strikeStatus()).strikes).toBe(5);
    expect((await checkout([{ itemId: await unitItem(), quantity: 1 }])).body.error.code).toBe(
      'BORROWER_BLOCKED',
    );
  });

  test("one borrower's flags never block another borrower (BR 10)", async () => {
    for (let n = 0; n < 5; n++) await borrowLaptop();
    await runFlagging(later(1));
    expect((await strikeStatus(otherId)).strikes).toBe(0);
    await borrowLaptop(otherId);
  });
});

describe('thresholds changed mid-semester through PUT /api/settings (BR 11, rule 3)', () => {
  test('lowering the block threshold to 4 blocks a borrower at 4 strikes at once, and every screen reports 4', async () => {
    for (let n = 0; n < 4; n++) await borrowLaptop();
    await runFlagging(later(1));
    await borrowLaptop(); // 4 strikes, default block 5: allowed

    await putSettings({ warningThreshold: 2, noticeThreshold: 3, blockThreshold: 4 }).expect(200);
    expect((await checkout([{ itemId: await unitItem(), quantity: 1 }])).body.error.code).toBe(
      'BORROWER_BLOCKED',
    );
    expect((await strikeStatus()).blockThreshold).toBe(4);
    const open = (await handler.get('/api/returns/open').expect(200)).body;
    expect(open).toMatchObject({ warningThreshold: 2, noticeThreshold: 3, blockThreshold: 4 });
    expect((await admin.get('/api/flags').expect(200)).body.blockThreshold).toBe(4);
  });
});

describe('closing time changed mid-semester through PUT /api/settings (BR 8, rule 3)', () => {
  test('a line issued at 18:00 Manila is not flagged by an 18:30 run under 17:00 closing, and is flagged by a 19:30 run once closing is 19:00', async () => {
    const line = await borrowLaptop();
    // 18:00 Manila on 2026-09-10 (UTC+8). A storage detail, but the only way to set the issue time.
    const issuedAt = new Date('2026-09-10T10:00:00Z');
    await prisma.transaction.updateMany({
      where: { lines: { some: { id: line } } },
      data: { issuedAt },
    });

    expect((await runFlagging(new Date('2026-09-10T10:30:00Z'))).flagged).toBe(0); // 18:30
    await putSettings({ closingTime: '19:00' }).expect(200);
    expect((await runFlagging(new Date('2026-09-10T11:30:00Z'))).flagged).toBe(1); // 19:30
    expect(await flagStatus(line)).toBe('FLAGGED');
  });
});

describe('QUANTITY items across several lines, flags and overrides (BR 1, 5, 6, 13)', () => {
  test('availability follows only the outstanding quantity: flagging and override change nothing, partial returns do', async () => {
    const cordId = await cords(10);
    const first = (await checkout([{ itemId: cordId, quantity: 4 }]).expect(201)).body.transaction
      .lines[0].id;
    const second = (await checkout([{ itemId: cordId, quantity: 3 }], otherId).expect(201)).body
      .transaction.lines[0].id;
    expect(await available(cordId)).toBe(3);

    await giveBack(first, 1).expect(201); // 3 still out on the first line
    await giveBack(second, 3).expect(201); // second line closed before closing
    expect(await available(cordId)).toBe(7);

    expect((await runFlagging(later(1))).flagged).toBe(1);
    expect(await flagStatus(first)).toBe('FLAGGED');
    expect(await flagStatus(second)).toBe('NONE');
    expect(await available(cordId)).toBe(7);

    await override(first).expect(200);
    expect(await available(cordId)).toBe(7);

    // The rest comes back in two returns; the line stays OVERRIDDEN and nothing more can be returned.
    await giveBack(first, 2).expect(201);
    expect(await available(cordId)).toBe(9);
    await giveBack(first, 1).expect(201);
    expect(await available(cordId)).toBe(10);
    expect(await flagStatus(first)).toBe('OVERRIDDEN');
    const tooMany = await giveBack(first, 1);
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.error.code).toBe('RETURN_EXCEEDS_OUTSTANDING');

    // All 10 can be issued again.
    await checkout([{ itemId: cordId, quantity: 10 }], otherId).expect(201);
  });

  test('the Return list and the Flag review filters follow real partial returns of a flagged line (BR 6, BRW-5, FLG-4)', async () => {
    const cordId = await cords(5);
    const line = (await checkout([{ itemId: cordId, quantity: 5 }]).expect(201)).body.transaction
      .lines[0].id;
    await giveBack(line, 3).expect(201);
    await runFlagging(later(1));

    const flagRow = async (returned: string) =>
      (await admin.get(`/api/flags?returned=${returned}`).expect(200)).body.data.find(
        (row: { lineId: string }) => row.lineId === line,
      );
    const openRow = async () =>
      (await handler.get('/api/returns/open').expect(200)).body.data.find(
        (row: { lineId: string }) => row.lineId === line,
      );

    expect(await openRow()).toMatchObject({ outstanding: 2, flagStatus: 'FLAGGED', strikes: 1 });
    expect(await flagRow('out')).toMatchObject({ outstanding: 2, strikes: 1 });
    expect(await flagRow('returned')).toBeUndefined();

    await giveBack(line, 2).expect(201);
    expect(await openRow()).toBeUndefined(); // nothing out, so not on the Return list
    expect(await flagRow('out')).toBeUndefined();
    expect(await flagRow('returned')).toMatchObject({ outstanding: 0, strikes: 1 }); // BR 6

    await override(line).expect(200);
    expect(await flagRow('all')).toBeUndefined(); // an overridden line leaves Flag review
    expect((await strikeStatus()).strikes).toBe(0);
  });
});

describe('semester switch through the API (BR 10, 12, S9)', () => {
  test('a new current semester unblocks and empties Flag review; its own flags count only there; switching back restores the block', async () => {
    for (let n = 0; n < 5; n++) await borrowLaptop();
    await runFlagging(later(1));
    expect((await checkout([{ itemId: await unitItem(), quantity: 1 }])).status).toBe(409);

    const s2 = (
      await admin
        .post('/api/semesters')
        .set(FETCH)
        .send({ name: 'Reg4 S2', startDate: '2027-01-04', endDate: '2027-05-31' })
        .expect(201)
    ).body.semester.id;
    await admin.post(`/api/semesters/${s2}/current`).set(FETCH).expect(200);

    expect(await strikeStatus()).toMatchObject({ strikes: 0, semesterName: 'Reg4 S2' });
    expect((await admin.get('/api/flags').expect(200)).body.data).toEqual([]);
    const openStrikes = (await handler.get('/api/returns/open?pageSize=100').expect(200)).body.data
      .filter((row: { borrower: { id: string } }) => row.borrower.id === borrowerId)
      .map((row: { strikes: number }) => row.strikes);
    expect(new Set(openStrikes)).toEqual(new Set([0]));

    // Borrowing works in semester 2, and that checkout is stamped with semester 2 (BR 2).
    const s2Line = (await checkout([{ itemId: await unitItem(), quantity: 1 }]).expect(201)).body
      .transaction;
    expect(s2Line.semesterId).toBe(s2);
    await runFlagging(later(2));
    expect((await strikeStatus()).strikes).toBe(1);
    expect((await admin.get('/api/flags').expect(200)).body.total).toBe(1);

    // Back to semester 1: its 5 strikes return and the semester 2 flag does not add a sixth.
    await admin.post(`/api/semesters/${semesterId}/current`).set(FETCH).expect(200);
    expect(await strikeStatus()).toMatchObject({ strikes: 5, semesterName: 'Reg4 S1' });
    expect((await admin.get('/api/flags').expect(200)).body.total).toBe(5);
    expect((await checkout([{ itemId: await unitItem(), quantity: 1 }])).body.error.code).toBe(
      'BORROWER_BLOCKED',
    );
    // The semester 2 line is still returnable (returns are never blocked, BR 11).
    await giveBack(s2Line.lines[0].id).expect(201);
  });
});

describe('inactive borrower with flagged lines on LOST and RETIRED items (BR 3, 11, 13; owner decision 2026-11-10)', () => {
  test('the lines stay on the Return list with their flag and strikes, are returnable, and can be overridden', async () => {
    const lost = await borrowLaptop();
    const retired = await borrowLaptop();
    await runFlagging(later(1));
    const itemOf = async (lineId: string) =>
      (await prisma.transactionItem.findUniqueOrThrow({ where: { id: lineId } })).itemId;
    await admin
      .patch(`/api/items/${await itemOf(lost)}`)
      .set(FETCH)
      .send({ status: 'LOST' })
      .expect(200);
    await admin
      .patch(`/api/items/${await itemOf(retired)}`)
      .set(FETCH)
      .send({ status: 'RETIRED' })
      .expect(200);
    await admin
      .patch(`/api/borrowers/${borrowerId}`)
      .set(FETCH)
      .send({ active: false })
      .expect(200);

    const rows = (await handler.get('/api/returns/open?by=borrower&q=R4-0001').expect(200)).body
      .data;
    expect(rows.map((row: { lineId: string }) => row.lineId).sort()).toEqual(
      [lost, retired].sort(),
    );
    for (const row of rows) expect(row).toMatchObject({ flagStatus: 'FLAGGED', strikes: 2 });

    await giveBack(lost).expect(201);
    await giveBack(retired).expect(201);
    expect(await flagStatus(lost)).toBe('FLAGGED'); // BR 6
    expect((await override(retired).expect(200)).body.line.strikes).toBe(1);
    // Still inactive, so still refused, now for being inactive (BR 3).
    expect((await checkout([{ itemId: await unitItem(), quantity: 1 }])).body.error.code).toBe(
      'BORROWER_INACTIVE',
    );
  });
});

describe('audit entries for the Sprint 4 flow (BR 14, CLAUDE.md rule 6)', () => {
  afterEach(async () => {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS qa_reg4_fail_audit ON audit_log');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS qa_reg4_fail_audit()');
  });

  test('checkout, a manual flagging run, a return and an override write one entry each with the right actor; reads write none', async () => {
    const line = await borrowLaptop();
    // The manual trigger runs at the real time, so the line is moved before the latest closing.
    await prisma.transaction.updateMany({
      where: { lines: { some: { id: line } } },
      data: { issuedAt: new Date(Date.now() - 2 * DAY) },
    });
    const run = await admin.post('/api/flagging/run').set(FETCH).expect(200);
    expect(run.body.run).toEqual({ flagged: 1, skipped: false });
    await giveBack(line).expect(201);
    await override(line).expect(200);

    const before = await prisma.auditLog.count();
    await handler.get('/api/returns/open').expect(200);
    await handler.get(`/api/borrowers/${borrowerId}/strikes`).expect(200);
    await admin.get('/api/flags?returned=all').expect(200);
    expect(await prisma.auditLog.count()).toBe(before);

    const entries = await prisma.auditLog.findMany({
      where: { action: { in: ['CHECKOUT', 'LINE_FLAGGED', 'RETURN', 'FLAG_OVERRIDDEN'] } },
      orderBy: { createdAt: 'asc' },
    });
    expect(entries.map((entry) => [entry.action, entry.actorId])).toEqual([
      ['CHECKOUT', handlerId],
      ['LINE_FLAGGED', adminId],
      ['RETURN', handlerId],
      ['FLAG_OVERRIDDEN', adminId],
    ]);
    expect(entries[1]!.entityId).toBe(line);
    expect(entries[3]!.entityId).toBe(line);
  });

  test('when a LINE_FLAGGED audit insert fails, the run rejects and no line is flagged (same transaction)', async () => {
    const first = await borrowLaptop();
    const second = await borrowLaptop();
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION qa_reg4_fail_audit() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'qa regression s4: audit insert refused'; END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER qa_reg4_fail_audit BEFORE INSERT ON audit_log
      FOR EACH ROW WHEN (NEW.action = 'LINE_FLAGGED') EXECUTE FUNCTION qa_reg4_fail_audit()`);

    await expect(runFlagging(later(1))).rejects.toThrow();
    expect(await flagStatus(first)).toBe('NONE');
    expect(await flagStatus(second)).toBe('NONE');
    expect((await strikeStatus()).strikes).toBe(0);
  });
});
