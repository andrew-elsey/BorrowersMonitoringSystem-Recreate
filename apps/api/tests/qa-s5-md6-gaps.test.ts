import { beforeEach, expect, test } from 'vitest';
import { prisma } from '../src/lib/prisma.ts';
import { borrowerService } from '../src/services/borrowers.ts';
import {
  type Agent,
  auditCount,
  seedWorld,
  signIn,
  type World,
} from './setup/qa-sprint5-fixtures.ts';

// QA gap tests for MD-6 (borrower CSV import, SPEC 6 and 7): value rules row by row, the 5,000-row
// cap with other line endings, and how imported borrowers behave elsewhere (BorrowerService,
// checkout BR 3, strikes BR 10). Fictional school IDs only.

let world: World;
let ana: Agent;

beforeEach(async () => {
  world = await seedWorld();
  ana = await signIn('ana');
});

const HEADER = 'school_id,name,type,department,active';
const upload = (text: string, agent = ana) =>
  agent
    .post('/api/borrowers/import')
    .set('X-Requested-With', 'fetch')
    .attach('file', Buffer.from(text), 'borrowers.csv');
const rows = (count: number) =>
  Array.from({ length: count }, (_, i) => `QA-R${i},Row ${i},STUDENT,IT,`);

test('SPEC 6: type in any case, active blank/TRUE/False are accepted; other values are rejected with a reason', async () => {
  const res = await upload(
    [
      HEADER,
      'QA-1,One,student,IT,',
      'QA-2,Two,Faculty,IT,TRUE',
      'QA-3,Three,EMPLOYEE,IT,False',
      'QA-4,Four,ALUMNI,IT,',
      'QA-5,Five,STUDENT,IT,yes',
      `QA-6,${'n'.repeat(201)},STUDENT,IT,`,
      'QA-7,Seven,STUDENT,,',
      'QA-8,Eight,STUDENT,IT',
    ].join('\n'),
  ).expect(200);
  expect(res.body).toMatchObject({ created: 3, updated: 0, unchanged: 0 });
  expect(res.body.rejected.map((r: { schoolId: string }) => r.schoolId)).toEqual([
    'QA-4',
    'QA-5',
    'QA-6',
    'QA-7',
    'QA-8',
  ]);
  for (const r of res.body.rejected) expect(r.reason).toEqual(expect.any(String));
  const saved = await prisma.borrower.findMany({
    where: { schoolId: { in: ['QA-1', 'QA-2', 'QA-3'] } },
    orderBy: { schoolId: 'asc' },
  });
  expect(saved.map((b) => [b.type, b.active])).toEqual([
    ['STUDENT', true],
    ['FACULTY', true],
    ['EMPLOYEE', false],
  ]);
});

test('SPEC 6: rejected rows report the file line number (header is line 1)', async () => {
  const res = await upload([HEADER, 'QA-1,One,STUDENT,IT,', 'QA-2,Two,NOPE,IT,'].join('\n'));
  expect(res.body.rejected).toEqual([
    { row: 3, schoolId: 'QA-2', reason: expect.stringContaining('NOPE') },
  ]);
});

test('SPEC 6: CRLF line endings import the same as LF', async () => {
  const res = await upload([HEADER, 'QA-1,One,STUDENT,IT,', 'QA-2,Two,STUDENT,IT,'].join('\r\n'));
  expect(res.body).toMatchObject({ created: 2, rejected: [] });
});

// Was a bug (MD-6, SPEC 7 / S21, card Qn9mX1tn): the cap counted "\n" only, but csv-parse also
// accepts a bare "\r", so a CR-only file skipped the cap.
test.each([
  ['CR-only', '\r'],
  ['LF', '\n'],
  ['CRLF', '\r\n'],
])(
  'SPEC 7: a CSV of 5,001 rows with %s line endings is refused with PAYLOAD_TOO_LARGE',
  async (_name, lineBreak) => {
    const res = await upload([HEADER, ...rows(5001)].join(lineBreak));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(await prisma.borrower.count()).toBe(1); // only the seeded borrower
  },
  30_000,
);

test('SPEC 7: exactly 5,000 rows with CRLF endings and a final line break are accepted', async () => {
  const res = await upload([HEADER, ...rows(5000)].join('\r\n') + '\r\n');
  expect(res.status).toBe(200);
  expect(res.body.created).toBe(5000);
}, 30_000);

test('SPEC 7: a header-only file imports nothing and reports zero counts', async () => {
  const res = await upload(`${HEADER}\n`).expect(200);
  expect(res.body).toEqual({ created: 0, updated: 0, unchanged: 0, rejected: [] });
  expect(await auditCount('BORROWER_CREATED')).toBe(0);
});

test('SPEC 7: a file under another field name is VALIDATION_ERROR and nothing is saved', async () => {
  const res = await ana
    .post('/api/borrowers/import')
    .set('X-Requested-With', 'fetch')
    .attach('upload', Buffer.from(`${HEADER}\nQA-1,One,STUDENT,IT,`), 'b.csv');
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('VALIDATION_ERROR');
  expect(await prisma.borrower.count()).toBe(1);
});

test('SPEC 3: a viewer gets 403 on the import and nothing is saved', async () => {
  const res = await upload(`${HEADER}\nQA-1,One,STUDENT,IT,`, await signIn('vic'));
  expect(res.status).toBe(403);
  expect(await prisma.borrower.count()).toBe(1);
});

test('MD-6 -> MD-4: imported borrowers are found through BorrowerService and the checkout lookup', async () => {
  await upload(`${HEADER}\nQA-77,Imported Person,FACULTY,Physics,`).expect(200);
  const found = await borrowerService.list({ q: 'Imported', page: 1, pageSize: 10 });
  expect(found.data.map((b) => b.schoolId)).toEqual(['QA-77']);
  const lookup = await (await signIn('hal')).get('/api/borrowers/lookup?q=QA-77').expect(200);
  expect(lookup.body.data[0]).toMatchObject({ name: 'Imported Person', type: 'FACULTY' });
});

test('MD-6 -> BR 3: a borrower deactivated by import is refused at checkout with BORROWER_INACTIVE', async () => {
  const existing = await prisma.borrower.findUniqueOrThrow({ where: { id: world.borrowerId } });
  const res = await upload(
    `${HEADER}\n${existing.schoolId},${existing.name},STUDENT,${existing.department},false`,
  ).expect(200);
  expect(res.body.updated).toBe(1);

  const checkout = await (
    await signIn('hal')
  )
    .post('/api/transactions')
    .set('X-Requested-With', 'fetch')
    .send({
      borrowerId: world.borrowerId,
      locationId: world.roomId,
      lines: [{ itemId: world.cordId, quantity: 1 }],
    });
  expect(checkout.status).toBe(409);
  expect(checkout.body.error.code).toBe('BORROWER_INACTIVE');
});

test('MD-6 -> BR 10, 15: re-importing a borrower with history keeps the same record, its transactions, and strikes', async () => {
  const existing = await prisma.borrower.findUniqueOrThrow({ where: { id: world.borrowerId } });
  await prisma.transaction.create({
    data: {
      borrowerId: world.borrowerId,
      locationId: world.roomId,
      issuedById: world.halId,
      semesterId: world.currentSemesterId,
      lines: { create: { itemId: world.cordId, quantityBorrowed: 1, flagStatus: 'FLAGGED' } },
    },
  });
  await upload(`${HEADER}\n${existing.schoolId.toLowerCase()},Renamed Person,STUDENT,Math,`).expect(
    200,
  );
  const after = await prisma.borrower.findMany({});
  expect(after.map((b) => [b.id, b.name])).toEqual([[world.borrowerId, 'Renamed Person']]);
  expect(await prisma.transaction.count({ where: { borrowerId: world.borrowerId } })).toBe(1);
  const strikes = await (
    await signIn('hal')
  )
    .get(`/api/borrowers/${world.borrowerId}/strikes`)
    .expect(200);
  expect(strikes.body.strikes).toBe(1);
});
