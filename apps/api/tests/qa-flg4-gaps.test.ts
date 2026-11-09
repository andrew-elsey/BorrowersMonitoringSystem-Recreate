import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { borrowerService } from '../src/services/borrowers.ts';
import { listFlaggedLines } from '../src/services/flags.ts';
import { countStrikes, countStrikesForBorrowers } from '../src/services/strikes.ts';
import { resetDatabase } from './setup/reset-database.ts';

// QA (automated) gap tests for FLG-4 (GET /api/flags, POST /api/flags/:id/override; BR 10, 13, 14;
// SPEC 7; CLAUDE.md rules 1 and 12). Adds what flag-override.test.ts does not cover: the reason
// is trimmed and stored trimmed, control characters, line breaks; the override and its audit entry
// roll back together; sign-in and CSRF checks; the query bounds; an upper-case id; LIKE wildcards
// in q; asset tag matches over the cap; paging and order; old-semester lines; no current semester;
// two overrides of different lines at once; and borrower data only through BorrowerService.

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
      { name: 'QA Admin', username: 'qa-admin', passwordHash, role: 'ADMIN' },
      { name: 'QA Handler', username: 'qa-handler', passwordHash, role: 'HANDLER' },
      { name: 'QA Viewer', username: 'qa-viewer', passwordHash, role: 'VIEWER' },
    ],
  });
  adminId = users.find((user) => user.role === 'ADMIN')!.id;
  await prisma.setting.create({ data: { id: 1 } });
  borrowerId = await newBorrower('QA-0001', 'Rhea Quality');
  locationId = (await prisma.location.create({ data: { name: 'QA Lab', createdById: adminId } }))
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
  const categoryId = (await prisma.category.create({ data: { name: 'QA Equipment' } })).id;
  itemIds = (
    await prisma.item.createManyAndReturn({
      data: [
        { name: 'QA Cable', assetTag: null },
        { name: 'QA Projector', assetTag: 'QA-PJ-77' },
      ].map(({ name, assetTag }) => ({
        name,
        assetTag,
        categoryId,
        trackingType: assetTag ? ('UNIT' as const) : ('QUANTITY' as const),
        totalQuantity: assetTag ? 1 : 10,
        condition: 'GOOD' as const,
      })),
    })
  ).map((item) => item.id);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function newBorrower(schoolId: string, name: string) {
  return (
    await prisma.borrower.create({ data: { schoolId, name, type: 'STUDENT', department: 'QA' } })
  ).id;
}

// One transaction with one line per entry. `flaggedAt` defaults to 17:00 Manila on 1 Sep 2026.
async function transaction(
  lines: {
    item?: number;
    flag?: 'NONE' | 'FLAGGED' | 'OVERRIDDEN';
    returned?: number;
    flaggedAt?: Date;
  }[],
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
        create: lines.map(({ item = 0, flag = 'FLAGGED', returned = 0, flaggedAt }) => ({
          itemId: itemIds[item]!,
          quantityBorrowed: item === 1 ? 1 : 2, // item 1 is a UNIT item
          quantityReturned: returned,
          flagStatus: flag,
          flaggedAt: flag === 'NONE' ? null : (flaggedAt ?? new Date('2026-09-01T17:00:00+08:00')),
        })),
      },
    },
    include: { lines: { orderBy: { id: 'asc' } } },
  });
  return created.lines;
}

async function signIn(username: string) {
  const agent = request.agent(createApp());
  await agent
    .post('/api/auth/login')
    .set('X-Requested-With', 'fetch')
    .send({ username, password: PASSWORD })
    .expect(200);
  return agent;
}
const override = (agent: request.Agent | ReturnType<typeof request>, id: string, body: unknown) =>
  agent
    .post(`/api/flags/${id}/override`)
    .set('X-Requested-With', 'fetch')
    .send(body as object);
const lineStatus = async (id: string) =>
  (await prisma.transactionItem.findUniqueOrThrow({ where: { id } })).flagStatus;
const overrideAudits = () => prisma.auditLog.count({ where: { action: 'FLAG_OVERRIDDEN' } });

describe('the override reason (BR 13, SPEC 7)', () => {
  test('the reason is trimmed before the length check and stored trimmed', async () => {
    const [line] = await transaction([{}]);
    const admin = await signIn('qa-admin');
    await override(admin, line!.id, { reason: '   abcde   ' }).expect(200);
    const row = await prisma.transactionItem.findUniqueOrThrow({ where: { id: line!.id } });
    expect(row.overrideReason).toBe('abcde');
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'FLAG_OVERRIDDEN' } });
    expect(entry.after).toMatchObject({ reason: 'abcde' });
  });

  test('500 characters with surrounding spaces is accepted, since the spaces are trimmed', async () => {
    const [line] = await transaction([{}]);
    const admin = await signIn('qa-admin');
    await override(admin, line!.id, { reason: `  ${'r'.repeat(500)}  ` }).expect(200);
  });

  test('line breaks and tabs are allowed in a reason', async () => {
    const [line] = await transaction([{}]);
    const admin = await signIn('qa-admin');
    await override(admin, line!.id, { reason: 'Approved\r\nby\tProf. Aquino' }).expect(200);
    expect(
      (await prisma.transactionItem.findUniqueOrThrow({ where: { id: line!.id } })).overrideReason,
    ).toBe('Approved\r\nby\tProf. Aquino');
  });

  test.each([
    ['a NUL character', 'valid\u0000reason'],
    ['a bell character', 'valid\u0007reason'],
    ['an escape character', 'valid\u001breason'],
    ['a DEL character', 'valid\u007freason'],
  ])('a reason with %s is refused with 400 and nothing changes', async (_name, reason) => {
    const [line] = await transaction([{}]);
    const admin = await signIn('qa-admin');
    const res = await override(admin, line!.id, { reason });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await lineStatus(line!.id)).toBe('FLAGGED');
    expect(await overrideAudits()).toBe(0);
  });

  test.each([
    ['a number', { reason: 12345 }],
    ['null', { reason: null }],
    ['an empty body', {}],
    ['an array', { reason: ['abcde'] }],
  ])('a reason that is %s is refused with 400', async (_name, body) => {
    const [line] = await transaction([{}]);
    const admin = await signIn('qa-admin');
    const res = await override(admin, line!.id, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await lineStatus(line!.id)).toBe('FLAGGED');
  });

  test('a body over 100 KB is refused with 413 PAYLOAD_TOO_LARGE', async () => {
    const [line] = await transaction([{}]);
    const admin = await signIn('qa-admin');
    const res = await override(admin, line!.id, { reason: 'x'.repeat(110 * 1024) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(await lineStatus(line!.id)).toBe('FLAGGED');
  });
});

describe('the override record and its audit entry (BR 13, 14)', () => {
  test('the audit entry records the line, actor, before and after, and override_at is now in UTC', async () => {
    const [line] = await transaction([{}]);
    const admin = await signIn('qa-admin');
    const res = await override(admin, line!.id, { reason: 'Approved by Prof. Aquino' }).expect(200);
    const row = await prisma.transactionItem.findUniqueOrThrow({ where: { id: line!.id } });
    // FND-6: the stored instant is the real UTC time, not 8 hours off.
    expect(Math.abs(row.overrideAt!.getTime() - Date.now())).toBeLessThan(60_000);
    expect(res.body.line.overrideAt).toBe(row.overrideAt!.toISOString());
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'FLAG_OVERRIDDEN' } });
    expect(entry).toMatchObject({
      actorId: adminId,
      entity: 'transaction_item',
      entityId: line!.id,
    });
    expect(entry.before).toEqual({ flagStatus: 'FLAGGED' });
    expect(entry.after).toEqual({
      flagStatus: 'OVERRIDDEN',
      overrideAt: row.overrideAt!.toISOString(),
      reason: 'Approved by Prof. Aquino',
    });
  });

  test('if the audit entry cannot be written, the override is rolled back (same transaction)', async () => {
    const [line] = await transaction([{}]);
    const admin = await signIn('qa-admin');
    // A trigger makes the audit insert fail, as a real database error would.
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION qa_flg4_fail_audit() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'qa: audit insert refused'; END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER qa_flg4_fail_audit BEFORE INSERT ON audit_log
      FOR EACH ROW WHEN (NEW.action = 'FLAG_OVERRIDDEN') EXECUTE FUNCTION qa_flg4_fail_audit()`);
    try {
      const res = await override(admin, line!.id, { reason: 'valid reason' });
      expect(res.status).toBe(500);
      const row = await prisma.transactionItem.findUniqueOrThrow({ where: { id: line!.id } });
      expect(row).toMatchObject({
        flagStatus: 'FLAGGED',
        overrideById: null,
        overrideAt: null,
        overrideReason: null,
      });
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS qa_flg4_fail_audit ON audit_log');
      await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS qa_flg4_fail_audit()');
    }
  });

  test('two overrides of different lines of one borrower at once both succeed, with two audit entries', async () => {
    const [a] = await transaction([{}]);
    const [b] = await transaction([{ item: 1 }]);
    const admin = await signIn('qa-admin');
    const results = await Promise.all([
      override(admin, a!.id, { reason: 'race one' }),
      override(admin, b!.id, { reason: 'race two' }),
    ]);
    expect(results.map((res) => res.status)).toEqual([200, 200]);
    expect(await overrideAudits()).toBe(2);
    expect(await countStrikes(borrowerId)).toBe(0);
  });

  test('six overrides of the same line at once (under the 10-listener limit, REG-1): exactly one succeeds', async () => {
    const [line] = await transaction([{}]);
    const admin = await signIn('qa-admin');
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, n) => override(admin, line!.id, { reason: `race ${n}xx` })),
    );
    const statuses = results.map((res) => res.status);
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(5);
    expect(await overrideAudits()).toBe(1);
  });

  test('LINE_NOT_FLAGGED gives the line id and its current status in details', async () => {
    // Lines come back ordered by random id, so pick them by status.
    const lines = await transaction([{ flag: 'NONE' }, { flag: 'OVERRIDDEN' }]);
    const none = lines.find((line) => line.flagStatus === 'NONE');
    const done = lines.find((line) => line.flagStatus === 'OVERRIDDEN');
    const admin = await signIn('qa-admin');
    const first = await override(admin, none!.id, { reason: 'valid reason' }).expect(409);
    expect(first.body.error.details).toEqual({ lineId: none!.id, flagStatus: 'NONE' });
    const second = await override(admin, done!.id, { reason: 'valid reason' }).expect(409);
    expect(second.body.error.details).toEqual({ lineId: done!.id, flagStatus: 'OVERRIDDEN' });
  });

  test('an unknown id gives 404 NOT_FOUND in the standard error format', async () => {
    const admin = await signIn('qa-admin');
    const res = await override(admin, crypto.randomUUID(), { reason: 'valid reason' }).expect(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(typeof res.body.error.message).toBe('string');
  });

  test.each(['not-an-id', '123', `${'0'.repeat(8)}-0000-0000-0000-00000000000g`, "1' OR '1'='1"])(
    'a malformed id %j gives 400 VALIDATION_ERROR',
    async (id) => {
      const admin = await signIn('qa-admin');
      const res = await override(admin, encodeURIComponent(id), { reason: 'valid reason' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    },
  );

  test('an upper-case id finds the line', async () => {
    const [line] = await transaction([{}]);
    const admin = await signIn('qa-admin');
    const res = await override(admin, line!.id.toUpperCase(), { reason: 'valid reason' });
    expect(res.status).toBe(200);
    expect(res.body.line.lineId).toBe(line!.id);
  });

  test('a flagged line in an older semester can be overridden; the reply counts the current semester only', async () => {
    const old = await prisma.semester.create({
      data: { name: 'QA S0', startDate: new Date('2026-01-05'), endDate: new Date('2026-05-31') },
    });
    const [oldLine] = await transaction([{}], { semester: old.id });
    await transaction([{}]);
    const admin = await signIn('qa-admin');
    const res = await override(admin, oldLine!.id, { reason: 'late correction' }).expect(200);
    expect(res.body.line.strikes).toBe(1);
  });

  test('with no current semester an override still works and reports 0 strikes', async () => {
    const [line] = await transaction([{}]);
    await prisma.semester.updateMany({ data: { isCurrent: false } });
    const admin = await signIn('qa-admin');
    const res = await override(admin, line!.id, { reason: 'valid reason' }).expect(200);
    expect(res.body.line.strikes).toBe(0);
    expect(await lineStatus(line!.id)).toBe('OVERRIDDEN');
  });

  test('a partly returned line can be overridden (BR 13: at any time)', async () => {
    const [line] = await transaction([{ returned: 1 }]);
    const admin = await signIn('qa-admin');
    await override(admin, line!.id, { reason: 'valid reason' }).expect(200);
    expect(await lineStatus(line!.id)).toBe('OVERRIDDEN');
  });
});

describe('sign-in, roles and CSRF (SPEC 3, ARCH 5)', () => {
  test('signed out, both endpoints give 401 UNAUTHENTICATED', async () => {
    const [line] = await transaction([{}]);
    const app = createApp();
    const list = await request(app).get('/api/flags');
    expect(list.status).toBe(401);
    expect(list.body.error.code).toBe('UNAUTHENTICATED');
    const post = await override(request(app), line!.id, { reason: 'valid reason' });
    expect(post.status).toBe(401);
    expect(post.body.error.code).toBe('UNAUTHENTICATED');
    expect(await lineStatus(line!.id)).toBe('FLAGGED');
  });

  test('an admin override without the X-Requested-With header is refused with 403', async () => {
    const [line] = await transaction([{}]);
    const admin = await signIn('qa-admin');
    const res = await admin
      .post(`/api/flags/${line!.id}/override`)
      .send({ reason: 'valid reason' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(await lineStatus(line!.id)).toBe('FLAGGED');
  });

  test.each(['qa-handler', 'qa-viewer'])(
    '%s gets 403 FORBIDDEN before validation, even for a bad id or a bad query',
    async (username) => {
      const agent = await signIn(username);
      expect((await agent.get('/api/flags?pageSize=999')).body.error.code).toBe('FORBIDDEN');
      expect((await override(agent, 'not-an-id', { reason: 'x' })).body.error.code).toBe(
        'FORBIDDEN',
      );
      expect(await overrideAudits()).toBe(0);
    },
  );
});

describe('the list query bounds (SPEC 7, rule 12)', () => {
  test.each([
    'page=0',
    'page=-1',
    'page=1.5',
    'page=abc',
    'pageSize=0',
    'pageSize=101',
    'pageSize=-5',
    'pageSize=abc',
    'q=a',
    `q=${'a'.repeat(101)}`,
    `q=${encodeURIComponent('  a  ')}`,
    'returned=bogus',
    'returned=',
  ])('%s is refused with 400 VALIDATION_ERROR', async (query) => {
    const admin = await signIn('qa-admin');
    const res = await admin.get(`/api/flags?${query}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test.each(['pageSize=100', 'pageSize=1', 'q=ab', `q=${'a'.repeat(100)}`, 'returned=all'])(
    '%s is accepted',
    async (query) => {
      const admin = await signIn('qa-admin');
      await admin.get(`/api/flags?${query}`).expect(200);
    },
  );

  test('a page far past the end gives an empty page, not an error', async () => {
    await transaction([{}]);
    const admin = await signIn('qa-admin');
    const res = await admin.get('/api/flags?page=1000000').expect(200);
    expect(res.body).toMatchObject({ data: [], total: 1, page: 1000000 });
  });

  test('pages are ordered newest flag first, and total counts every page', async () => {
    const lines = [];
    for (let day = 1; day <= 3; day += 1) {
      const [line] = await transaction([{ flaggedAt: new Date(`2026-09-0${day}T17:00:00+08:00`) }]);
      lines.push(line!.id);
    }
    const admin = await signIn('qa-admin');
    const first = await admin.get('/api/flags?pageSize=2&page=1').expect(200);
    const second = await admin.get('/api/flags?pageSize=2&page=2').expect(200);
    expect(first.body.total).toBe(3);
    expect(second.body.total).toBe(3);
    expect(
      [...first.body.data, ...second.body.data].map((l: { lineId: string }) => l.lineId),
    ).toEqual([lines[2], lines[1], lines[0]]);
  });

  test('a partly returned line counts as still out in the Returned filter', async () => {
    const [partial] = await transaction([{ returned: 1 }]);
    const admin = await signIn('qa-admin');
    const out = await admin.get('/api/flags?returned=out').expect(200);
    expect(out.body.data.map((l: { lineId: string }) => l.lineId)).toEqual([partial!.id]);
    expect(out.body.data[0].outstanding).toBe(1);
    expect((await admin.get('/api/flags?returned=returned').expect(200)).body.total).toBe(0);
  });

  test('% and _ in the search text are matched literally, not as wildcards', async () => {
    await transaction([{}]);
    const admin = await signIn('qa-admin');
    expect(
      (await admin.get(`/api/flags?q=${encodeURIComponent('%%')}`).expect(200)).body.total,
    ).toBe(0);
    expect((await admin.get('/api/flags?q=QA_Cable').expect(200)).body.total).toBe(0);
    expect((await admin.get('/api/flags?q=qa%20cable').expect(200)).body.total).toBe(1);
  });

  test('the search matches the asset tag, case-insensitively', async () => {
    const [line] = await transaction([{ item: 1 }]);
    await transaction([{ item: 0 }]);
    const admin = await signIn('qa-admin');
    const res = await admin.get('/api/flags?q=qa-pj').expect(200);
    expect(res.body.data.map((l: { lineId: string }) => l.lineId)).toEqual([line!.id]);
    expect(res.body.data[0].item.assetTag).toBe('QA-PJ-77');
  });

  test('the list reply carries ISO UTC times for issuedAt and flaggedAt', async () => {
    await transaction([{}]);
    const admin = await signIn('qa-admin');
    const [line] = (await admin.get('/api/flags').expect(200)).body.data;
    expect(line.issuedAt).toBe('2026-09-01T02:00:00.000Z');
    expect(line.flaggedAt).toBe('2026-09-01T09:00:00.000Z');
    expect(line.note).toBeNull();
    expect(line.expectedReturnDate).toBeNull();
  });
});

describe('over the flagged-borrower cap (SPEC 7, owner decision)', () => {
  test('over the cap an asset tag search still matches, and the name is skipped', async () => {
    const [projector] = await transaction([{ item: 1 }]);
    const other = await newBorrower('QA-0002', 'Rhea Other');
    await transaction([{}], { borrower: other });
    const search = vi.spyOn(borrowerService, 'search');
    const byTag = await listFlaggedLines({ returned: 'all', q: 'QA-PJ', page: 1, pageSize: 25 }, 1);
    expect(byTag).toMatchObject({ total: 1, borrowerSearchSkipped: true });
    expect(byTag.data[0]!.lineId).toBe(projector!.id);
    const byName = await listFlaggedLines({ returned: 'all', q: 'Rhea', page: 1, pageSize: 25 }, 1);
    expect(byName).toMatchObject({ total: 0, borrowerSearchSkipped: true });
    // Over the cap the borrower service is not asked at all.
    expect(search).not.toHaveBeenCalled();
  });

  test('the cap counts distinct borrowers, not lines', async () => {
    // One borrower with three flagged lines is one borrower: a cap of 1 is not exceeded.
    await transaction([{}, { item: 1 }]);
    await transaction([{}]);
    const res = await listFlaggedLines({ returned: 'all', q: 'Rhea', page: 1, pageSize: 25 }, 1);
    expect(res).toMatchObject({ total: 3, borrowerSearchSkipped: false });
  });

  test('borrowers flagged only in an older semester do not count toward the cap', async () => {
    const old = await prisma.semester.create({
      data: { name: 'QA S0', startDate: new Date('2026-01-05'), endDate: new Date('2026-05-31') },
    });
    const other = await newBorrower('QA-0002', 'Rhea Older');
    await transaction([{}], { borrower: other, semester: old.id });
    await transaction([{}]);
    const res = await listFlaggedLines({ returned: 'all', q: 'Rhea', page: 1, pageSize: 25 }, 1);
    expect(res).toMatchObject({ total: 1, borrowerSearchSkipped: false });
  });
});

describe('rule 1: borrower data comes only through BorrowerService', () => {
  test('the name search asks the service only about borrowers with current-semester flagged lines', async () => {
    const old = await prisma.semester.create({
      data: { name: 'QA S0', startDate: new Date('2026-01-05'), endDate: new Date('2026-05-31') },
    });
    const olderOnly = await newBorrower('QA-0002', 'Rhea Older');
    const notFlagged = await newBorrower('QA-0003', 'Rhea Clean');
    const overridden = await newBorrower('QA-0004', 'Rhea Forgiven');
    await transaction([{}], { borrower: olderOnly, semester: old.id });
    await transaction([{ flag: 'NONE' }], { borrower: notFlagged });
    await transaction([{ flag: 'OVERRIDDEN' }], { borrower: overridden });
    await transaction([{}]);
    const search = vi.spyOn(borrowerService, 'search');
    const admin = await signIn('qa-admin');
    const res = await admin.get('/api/flags?q=Rhea').expect(200);
    expect(search).toHaveBeenCalledWith('Rhea', 100, { ids: [borrowerId] });
    expect(res.body.total).toBe(1);
  });

  test('borrower names on each row come from the service (a replacement service is used as is)', async () => {
    await transaction([{}]);
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
    const admin = await signIn('qa-admin');
    const [line] = (await admin.get('/api/flags').expect(200)).body.data;
    expect(line.borrower).toEqual({ id: borrowerId, schoolId: 'EXT-1', name: 'External Name' });
  });

  test('a deactivated borrower with a flagged line is still listed', async () => {
    await transaction([{}]);
    await prisma.borrower.update({ where: { id: borrowerId }, data: { active: false } });
    const admin = await signIn('qa-admin');
    const res = await admin.get('/api/flags').expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].borrower.name).toBe('Rhea Quality');
  });
});

describe('countStrikesForBorrowers matches countStrikes (BR 10, 12)', () => {
  test('mixed lines, overridden-only transactions, and borrowers with no strikes', async () => {
    const clean = await newBorrower('QA-0002', 'Rhea Clean');
    const forgiven = await newBorrower('QA-0003', 'Rhea Forgiven');
    await transaction([{}, { item: 1, flag: 'NONE' }]); // counts once
    await transaction([{ flag: 'OVERRIDDEN' }, {}]); // still has a FLAGGED line
    await transaction([{ flag: 'OVERRIDDEN' }]); // no longer counts
    await transaction([{ flag: 'NONE' }], { borrower: clean });
    await transaction([{ flag: 'OVERRIDDEN' }, { flag: 'OVERRIDDEN' }], { borrower: forgiven });
    const ids = [borrowerId, clean, forgiven];
    const counts = await countStrikesForBorrowers(ids, semesterId);
    for (const id of ids) {
      expect(counts.get(id) ?? 0).toBe(await countStrikes(id));
    }
    expect(counts.get(borrowerId)).toBe(2);
    expect(counts.has(clean)).toBe(false);
    expect(counts.has(forgiven)).toBe(false);
  });

  test('the list strike count follows the current semester when the semester is switched back (BR 12)', async () => {
    const old = await prisma.semester.create({
      data: { name: 'QA S0', startDate: new Date('2026-01-05'), endDate: new Date('2026-05-31') },
    });
    await transaction([{}], { semester: old.id });
    await transaction([{}], { semester: old.id });
    await transaction([{}]);
    const admin = await signIn('qa-admin');
    expect((await admin.get('/api/flags').expect(200)).body.data[0].strikes).toBe(1);
    await prisma.semester.update({ where: { id: semesterId }, data: { isCurrent: false } });
    await prisma.semester.update({ where: { id: old.id }, data: { isCurrent: true } });
    const back = (await admin.get('/api/flags').expect(200)).body;
    expect(back.total).toBe(2);
    expect(back.data.every((line: { strikes: number }) => line.strikes === 2)).toBe(true);
  });
});
