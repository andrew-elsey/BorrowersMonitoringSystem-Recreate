import { beforeEach, expect, test } from 'vitest';
import { prisma } from '../src/lib/prisma.ts';
import { type Agent, seedWorld, signIn } from './setup/qa-sprint5-fixtures.ts';

// QA rerun gap tests for the MD-6 row-cap fix (aa91eca, SPEC 7 / S21): the 5,000-row limit with
// every line ending csv-parse accepts, with and without a final line break, and mixed endings.
// Fictional school IDs only.

let ana: Agent;

beforeEach(async () => {
  await seedWorld();
  ana = await signIn('ana');
});

const HEADER = 'school_id,name,type,department,active';
const upload = (text: string) =>
  ana
    .post('/api/borrowers/import')
    .set('X-Requested-With', 'fetch')
    .attach('file', Buffer.from(text), 'borrowers.csv');
const rows = (count: number) =>
  Array.from({ length: count }, (_, i) => `QA-C${i},Row ${i},STUDENT,IT,`);

test.each([
  ['CR-only, no final break', '\r', ''],
  ['CR-only, final break', '\r', '\r'],
  ['LF, no final break', '\n', ''],
  ['LF, final break', '\n', '\n'],
])('SPEC 7: exactly 5,000 rows with %s are imported', async (_name, lineBreak, end) => {
  const res = await upload([HEADER, ...rows(5000)].join(lineBreak) + end);
  expect(res.status).toBe(200);
  expect(res.body.created).toBe(5000);
});

test.each([
  ['CR-only, final break', '\r', '\r'],
  ['LF, final break', '\n', '\n'],
  ['CRLF, final break', '\r\n', '\r\n'],
])(
  'SPEC 7: 5,001 rows with %s are refused with PAYLOAD_TOO_LARGE, nothing saved or audited',
  async (_name, lineBreak, end) => {
    const auditBefore = await prisma.auditLog.count();
    const res = await upload([HEADER, ...rows(5001)].join(lineBreak) + end);
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(await prisma.borrower.count()).toBe(1); // only the seeded borrower
    expect(await prisma.auditLog.count()).toBe(auditBefore);
  },
);

test('SPEC 7: 5,001 rows mixing CR, LF, and CRLF line endings are refused', async () => {
  const breaks = ['\r', '\n', '\r\n'];
  const text = [HEADER, ...rows(5001)].reduce((all, row, i) => all + breaks[i % 3] + row);
  const res = await upload(text);
  expect(res.status).toBe(413);
  expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  expect(await prisma.borrower.count()).toBe(1);
});
