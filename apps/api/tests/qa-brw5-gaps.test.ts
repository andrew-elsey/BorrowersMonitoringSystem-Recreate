import type { FlagStatus, ItemStatus } from '@bms/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { borrowerService } from '../src/services/borrowers.ts';
import { listOpenLines, OPEN_BORROWER_CAP } from '../src/services/returns.ts';
import { resetDatabase } from './setup/reset-database.ts';

// QA (automated) gap tests for BRW-5 (GET /api/returns/open and the return flow behind the Return
// screen; SPEC 5, 7; BR 5, 6, 11; CLAUDE.md rules 1 and 12). Covers: a borrower search only among
// borrowers with open lines, the real 5000 cap through HTTP, FAIR never lowering condition,
// RETIRED and LOST lines, flagged and overridden lines, a partial return then the list, the
// borrower names coming from BorrowerService, and the query bounds per role.

const PASSWORD = 'correct-horse-battery';
let handler: ReturnType<typeof request.agent>;
let handlerId: string;
let locationId: string;
let semesterId: string;
let categoryId: string;

async function signIn(username: string) {
  const agent = request.agent(createApp());
  await agent
    .post('/api/auth/login')
    .set('X-Requested-With', 'fetch')
    .send({ username, password: PASSWORD })
    .expect(200);
  return agent;
}
const open = (agent: typeof handler, query = '') =>
  agent.get(`/api/returns/open${query}`).set('X-Requested-With', 'fetch');
const giveBack = (lineId: string, quantity: number, condition: string) =>
  handler
    .post('/api/returns')
    .set('X-Requested-With', 'fetch')
    .send({ lines: [{ lineId, quantity, condition }] });
const lineIds = (body: { data: { lineId: string }[] }) => body.data.map((line) => line.lineId);

beforeEach(async () => {
  await resetDatabase();
  const passwordHash = await hashPassword(PASSWORD);
  const users = await prisma.user.createManyAndReturn({
    data: [
      { name: 'QA Handler', username: 'qa-handler', passwordHash, role: 'HANDLER' },
      { name: 'QA Admin', username: 'qa-admin', passwordHash, role: 'ADMIN' },
      { name: 'QA Viewer', username: 'qa-viewer', passwordHash, role: 'VIEWER' },
    ],
  });
  handlerId = users.find((user) => user.username === 'qa-handler')!.id;
  locationId = (await prisma.location.create({ data: { name: 'QA Lab', createdById: handlerId } }))
    .id;
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
  categoryId = (await prisma.category.create({ data: { name: 'QA Category' } })).id;
  handler = await signIn('qa-handler');
});

afterEach(() => {
  vi.restoreAllMocks();
});

const borrower = async (schoolId: string, name: string, active = true) =>
  (
    await prisma.borrower.create({
      data: { schoolId, name, type: 'STUDENT', department: 'QA', active },
    })
  ).id;

// One transaction with one line. A unit item when assetTag is given, else a quantity item.
async function issue(
  borrowerId: string,
  item: { name: string; assetTag?: string; quantity?: number; status?: ItemStatus },
  line: { returned?: number; flagStatus?: FlagStatus; issuedAt?: Date } = {},
) {
  const created = await prisma.item.create({
    data: {
      name: item.name,
      categoryId,
      trackingType: item.assetTag ? 'UNIT' : 'QUANTITY',
      assetTag: item.assetTag,
      totalQuantity: item.quantity ?? 1,
      condition: 'GOOD',
      status: item.status,
    },
  });
  const transaction = await prisma.transaction.create({
    data: {
      borrowerId,
      locationId,
      issuedById: handlerId,
      semesterId,
      issuedAt: line.issuedAt,
      lines: {
        create: {
          itemId: created.id,
          quantityBorrowed: item.quantity ?? 1,
          quantityReturned: line.returned ?? 0,
          flagStatus: line.flagStatus,
          flaggedAt: line.flagStatus && line.flagStatus !== 'NONE' ? new Date() : undefined,
          overrideById: line.flagStatus === 'OVERRIDDEN' ? handlerId : undefined,
          overrideAt: line.flagStatus === 'OVERRIDDEN' ? new Date() : undefined,
          overrideReason: line.flagStatus === 'OVERRIDDEN' ? 'QA override' : undefined,
        },
      },
    },
    include: { lines: true },
  });
  return { line: transaction.lines[0]!, itemId: created.id };
}

describe('by=borrower searches only among borrowers with open lines', () => {
  test('a matching borrower whose lines are all returned is not listed', async () => {
    const done = await borrower('QA-0501', 'Ana Returned');
    await issue(done, { name: 'Projector', assetTag: 'QA-PJ-1' }, { returned: 1 });
    const res = await open(handler, '?by=borrower&q=ana').expect(200);
    expect(res.body).toMatchObject({ data: [], total: 0 });
  });

  test('a borrower search with nothing out at all returns an empty page, not an error', async () => {
    await borrower('QA-0502', 'Ben Nothing');
    const res = await open(handler, '?by=borrower&q=ben').expect(200);
    expect(res.body).toMatchObject({ data: [], total: 0, page: 1 });
  });

  test('an inactive borrower with an open line is still found (returns are never blocked, BR 11)', async () => {
    const gone = await borrower('QA-0503', 'Cy Inactive', false);
    const { line } = await issue(gone, { name: 'Laptop', assetTag: 'QA-LT-3' });
    const res = await open(handler, '?by=borrower&q=QA-0503').expect(200);
    expect(lineIds(res.body)).toEqual([line.id]);
  });

  test('a borrower search matches only that borrower, not other borrowers with open lines', async () => {
    const dee = await borrower('QA-0504', 'Dee Match');
    const eli = await borrower('QA-0505', 'Eli Other');
    const { line } = await issue(dee, { name: 'Laptop', assetTag: 'QA-LT-4' });
    await issue(eli, { name: 'Laptop', assetTag: 'QA-LT-5' });
    expect(lineIds((await open(handler, '?by=borrower&q=dee').expect(200)).body)).toEqual([
      line.id,
    ]);
  });

  test.each(['%%', '__', '\\\\'])(
    'the wildcard text %j is literal in a borrower search',
    async (q) => {
      const fay = await borrower('QA-0506', 'Fay Plain');
      await issue(fay, { name: 'Laptop', assetTag: 'QA-LT-6' });
      const res = await open(handler, `?by=borrower&q=${encodeURIComponent(q)}`).expect(200);
      expect(res.body.total).toBe(0);
    },
  );
});

describe('the borrower cap (rule 12)', () => {
  // The real cap, through HTTP: fills exactly OPEN_BORROWER_CAP borrowers with one open line each.
  async function fillBorrowersWithOpenLines(count: number) {
    const itemId = (
      await prisma.item.create({
        data: {
          name: 'QA bulk cord',
          categoryId,
          trackingType: 'QUANTITY',
          totalQuantity: count,
          condition: 'GOOD',
        },
      })
    ).id;
    await prisma.$executeRaw`
      WITH b AS (
        INSERT INTO borrowers (id, school_id, name, type, department, updated_at)
        SELECT gen_random_uuid(), 'QA-BULK-' || n, 'Bulk Borrower ' || n, 'STUDENT', 'QA', now()
        FROM generate_series(1, ${count}::int) AS n RETURNING id
      ), t AS (
        INSERT INTO transactions (id, borrower_id, location_id, issued_by, semester_id, updated_at)
        SELECT gen_random_uuid(), b.id, ${locationId}::uuid, ${handlerId}::uuid, ${semesterId}::uuid, now()
        FROM b RETURNING id
      )
      INSERT INTO transaction_items (id, transaction_id, item_id, quantity_borrowed, updated_at)
      SELECT gen_random_uuid(), t.id, ${itemId}::uuid, 1, now() FROM t`;
  }

  test(
    `at exactly ${OPEN_BORROWER_CAP} borrowers with items out a borrower search works; one more gives 422 SEARCH_TOO_BROAD`,
    { timeout: 60_000 },
    async () => {
      await fillBorrowersWithOpenLines(OPEN_BORROWER_CAP);
      const atCap = await open(handler, '?by=borrower&q=Bulk Borrower 4999').expect(200);
      expect(atCap.body.total).toBe(1);

      const extra = await borrower('QA-0599', 'Zed Over Cap');
      await issue(extra, { name: 'Laptop', assetTag: 'QA-LT-99' });
      const over = await open(handler, '?by=borrower&q=zed').expect(422);
      expect(over.body.error).toMatchObject({
        code: 'SEARCH_TOO_BROAD',
        message: 'Too many borrowers have items out; search by item or asset tag.',
      });
      // Item, asset tag, and the empty search are not affected by the cap.
      await open(handler, '?by=assetTag&q=QA-LT-99').expect(200);
      await open(handler, '?by=item&q=laptop').expect(200);
      expect((await open(handler, '?by=borrower&pageSize=1').expect(200)).body.total).toBe(
        OPEN_BORROWER_CAP + 1,
      );
    },
  );

  test('the cap counts borrowers, not lines: one borrower with three open lines is under a cap of 1', async () => {
    const gil = await borrower('QA-0507', 'Gil Many');
    for (const tag of ['QA-LT-71', 'QA-LT-72', 'QA-LT-73']) {
      await issue(gil, { name: 'Laptop', assetTag: tag });
    }
    const page = await listOpenLines({ by: 'borrower', q: 'gil', page: 1, pageSize: 25 }, 1);
    expect(page.total).toBe(3);
  });

  test('fully returned borrowers do not count toward the cap', async () => {
    const hana = await borrower('QA-0508', 'Hana Out');
    const ivo = await borrower('QA-0509', 'Ivo Back');
    await issue(hana, { name: 'Laptop', assetTag: 'QA-LT-81' });
    await issue(ivo, { name: 'Laptop', assetTag: 'QA-LT-82' }, { returned: 1 });
    const page = await listOpenLines({ by: 'borrower', q: 'hana', page: 1, pageSize: 25 }, 1);
    expect(page.total).toBe(1);
  });
});

describe('conditions on return (owner decision 2026-11-10)', () => {
  test('a FAIR return leaves a GOOD unit item GOOD and writes no item audit entry', async () => {
    const jo = await borrower('QA-0510', 'Jo Fair');
    const { line, itemId } = await issue(jo, { name: 'Laptop', assetTag: 'QA-LT-10' });
    await giveBack(line.id, 1, 'FAIR').expect(201);
    expect((await prisma.item.findUniqueOrThrow({ where: { id: itemId } })).condition).toBe('GOOD');
    expect(await prisma.auditLog.count({ where: { action: 'ITEM_UPDATED' } })).toBe(0);
  });

  test('a GOOD or FAIR return never raises a DAMAGED unit item', async () => {
    const kim = await borrower('QA-0511', 'Kim Damaged');
    const { line, itemId } = await issue(kim, { name: 'Laptop', assetTag: 'QA-LT-11' });
    await prisma.item.update({ where: { id: itemId }, data: { condition: 'DAMAGED' } });
    await giveBack(line.id, 1, 'GOOD').expect(201);
    expect((await prisma.item.findUniqueOrThrow({ where: { id: itemId } })).condition).toBe(
      'DAMAGED',
    );
  });
});

describe('RETIRED and LOST lines (owner decision 2026-11-10)', () => {
  test.each(['RETIRED', 'LOST'] as const)(
    'an open line for a %s item is listed by asset tag and can be returned, then leaves the list',
    async (status) => {
      const lee = await borrower('QA-0512', 'Lee Status');
      const { line } = await issue(lee, { name: 'Old laptop', assetTag: 'QA-LT-12', status });
      expect(lineIds((await open(handler, '?by=assetTag&q=qa-lt-12').expect(200)).body)).toEqual([
        line.id,
      ]);
      await giveBack(line.id, 1, 'GOOD').expect(201);
      expect((await open(handler, '?by=assetTag&q=qa-lt-12').expect(200)).body.total).toBe(0);
    },
  );
});

describe('flag marking in the list (BR 6, 9)', () => {
  test('an overridden line is listed as OVERRIDDEN with its flaggedAt kept', async () => {
    const max = await borrower('QA-0513', 'Max Override');
    const { line } = await issue(
      max,
      { name: 'Laptop', assetTag: 'QA-LT-13' },
      { flagStatus: 'OVERRIDDEN' },
    );
    const [row] = (await open(handler, '?by=borrower&q=max').expect(200)).body.data;
    expect(row).toMatchObject({ lineId: line.id, flagStatus: 'OVERRIDDEN' });
    expect(row.flaggedAt).toEqual(expect.any(String));
  });

  test('a partial return of a flagged line keeps it FLAGGED with the new outstanding count', async () => {
    const nia = await borrower('QA-0514', 'Nia Flagged');
    const { line } = await issue(nia, { name: 'QA cord', quantity: 5 }, { flagStatus: 'FLAGGED' });
    const res = await giveBack(line.id, 2, 'GOOD').expect(201);
    expect(res.body.returns[0].outstanding).toBe(3);
    const [row] = (await open(handler, '?by=item&q=qa cord').expect(200)).body.data;
    expect(row).toMatchObject({
      lineId: line.id,
      quantityBorrowed: 5,
      outstanding: 3,
      flagStatus: 'FLAGGED',
    });
  });
});

describe('partial returns then the list', () => {
  test('two partial returns that add up to the borrowed quantity remove the line from the list', async () => {
    const oli = await borrower('QA-0515', 'Oli Partial');
    const { line } = await issue(oli, { name: 'QA cord', quantity: 4 });
    await giveBack(line.id, 1, 'GOOD').expect(201);
    expect((await open(handler, '?by=borrower&q=oli').expect(200)).body.data[0].outstanding).toBe(
      3,
    );
    await giveBack(line.id, 3, 'FAIR').expect(201);
    expect((await open(handler, '?by=borrower&q=oli').expect(200)).body.total).toBe(0);
  });

  test('lines are listed oldest first across borrowers', async () => {
    const pia = await borrower('QA-0516', 'Pia Late');
    const quin = await borrower('QA-0517', 'Quin Early');
    const late = await issue(
      pia,
      { name: 'Laptop', assetTag: 'QA-LT-16' },
      { issuedAt: new Date('2026-11-10T03:00:00Z') },
    );
    const early = await issue(
      quin,
      { name: 'Laptop', assetTag: 'QA-LT-17' },
      { issuedAt: new Date('2026-11-10T01:00:00Z') },
    );
    expect(lineIds((await open(handler).expect(200)).body)).toEqual([early.line.id, late.line.id]);
  });
});

describe('rule 1: borrower details come only through BorrowerService', () => {
  test('the borrower search and the borrower names on each row go through the service', async () => {
    const rae = await borrower('QA-0518', 'Rae Service');
    await issue(rae, { name: 'Laptop', assetTag: 'QA-LT-18' });
    const search = vi.spyOn(borrowerService, 'search');
    // A replacement service (an external school database) can answer with its own name.
    vi.spyOn(borrowerService, 'findByIds').mockImplementation(async (ids) =>
      ids.map((id) => ({
        id,
        schoolId: 'EXT-1',
        name: 'External Name',
        type: 'STUDENT' as const,
        department: 'QA',
        active: true,
      })),
    );
    const res = await open(handler, '?by=borrower&q=rae').expect(200);
    expect(search).toHaveBeenCalledWith('rae', 100, { ids: [rae] });
    expect(res.body.data[0].borrower).toEqual({
      id: rae,
      schoolId: 'EXT-1',
      name: 'External Name',
    });
  });
});

describe('bounds and roles on GET /api/returns/open (SPEC 3, 7)', () => {
  test('an admin may search', async () => {
    await open(await signIn('qa-admin'), '?by=item&q=ab').expect(200);
  });

  test('a viewer is refused even with no query, and with every search kind', async () => {
    const viewer = await signIn('qa-viewer');
    for (const query of ['', '?by=item&q=ab', '?by=assetTag&q=ab']) {
      const res = await open(viewer, query).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  test('2 and 100 characters and pageSize=100 are accepted', async () => {
    for (const query of ['?q=ab', `?q=${'a'.repeat(100)}`, '?pageSize=100']) {
      await open(handler, query).expect(200);
    }
  });

  test('search text is trimmed before the length check', async () => {
    await open(handler, `?by=item&q=${encodeURIComponent('  a  ')}`).expect(400);
    await open(handler, `?by=item&q=${encodeURIComponent('  ab  ')}`).expect(200);
  });

  test.each([
    'pageSize=0',
    'pageSize=-1',
    'pageSize=1.5',
    'page=abc',
    'page=-1',
    'q=ab&q=cd',
    'by=item&by=assetTag',
    `q=${encodeURIComponent('a\tb')}`,
  ])('%s is a VALIDATION_ERROR, never a server error', async (query) => {
    const res = await open(handler, `?${query}`);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('a page far past the end is an empty page with the total', async () => {
    const sam = await borrower('QA-0519', 'Sam Paged');
    await issue(sam, { name: 'Laptop', assetTag: 'QA-LT-19' });
    const res = await open(handler, '?page=100000').expect(200);
    expect(res.body).toMatchObject({ data: [], page: 100000, total: 1 });
  });

  test.each(['page=1e20', `page=${Number.MAX_SAFE_INTEGER}&pageSize=100`])(
    'a huge %s is refused or empty, never a server error',
    async (query) => {
      const res = await open(handler, `?${query}`);
      expect(res.status, JSON.stringify(res.body)).toBeLessThan(500);
    },
  );
});

describe('RETURN_EXCEEDS_OUTSTANDING wording for asset-tagged items (round 2, BUG-2)', () => {
  test('a unit item with nothing left says it is already fully returned, with its tag', async () => {
    const una = await borrower('QA-0520', 'Una Twice');
    const { line } = await issue(una, { name: 'QA Laptop', assetTag: 'QA-LT-20' });
    await giveBack(line.id, 1, 'GOOD').expect(201);
    const res = await giveBack(line.id, 1, 'GOOD').expect(409);
    expect(res.body.error).toEqual({
      code: 'RETURN_EXCEEDS_OUTSTANDING',
      message: 'QA Laptop QA-LT-20 on this line is already fully returned.',
      details: { lineId: line.id, outstanding: 0 },
    });
    expect(await prisma.return.count()).toBe(1);
  });

  test('more than is out of a unit item names the tag and never says anything was returned', async () => {
    const val = await borrower('QA-0521', 'Val Over');
    const { line } = await issue(val, { name: 'QA Laptop', assetTag: 'QA-LT-21' });
    const res = await giveBack(line.id, 2, 'GOOD').expect(409);
    expect(res.body.error.message).toBe(
      'You entered 2 of QA Laptop QA-LT-21, but the amount still out on this line is 1.',
    );
    expect(res.body.error.message).not.toMatch(/returned|Nothing was recorded/);
  });
});
