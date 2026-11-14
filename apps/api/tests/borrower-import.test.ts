import { monitorEventLoopDelay } from 'node:perf_hooks';
import request from 'supertest';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { borrowerService } from '../src/services/borrowers.ts';
import { resetDatabase } from './setup/reset-database.ts';

// MD-6: borrower CSV import. Test cases TC-MD-18 to TC-MD-20 in TEST_CASES.md.

const PASSWORD = 'correct-horse-battery';
const HEADER = 'school_id,name,type,department,active';
let passwordHash: string;
let admin: ReturnType<typeof request.agent>;
let adminId: string;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  await resetDatabase();
  const users = await prisma.user.createManyAndReturn({
    data: [
      { name: 'Ana Admin', username: 'ana', passwordHash, role: 'ADMIN' },
      { name: 'Hal Handler', username: 'hal', passwordHash, role: 'HANDLER' },
    ],
  });
  adminId = users.find((user) => user.role === 'ADMIN')!.id;
  admin = await signIn('ana');
});

async function signIn(username: string, app = createApp()) {
  const agent = request.agent(app);
  await agent
    .post('/api/auth/login')
    .set('X-Requested-With', 'fetch')
    .send({ username, password: PASSWORD })
    .expect(200);
  return agent;
}

const upload = (agent: typeof admin, csv: string | Buffer, name = 'borrowers.csv') =>
  agent
    .post('/api/borrowers/import')
    .set('X-Requested-With', 'fetch')
    .attach('file', Buffer.from(csv), name);

const csv = (...rows: string[]) => [HEADER, ...rows].join('\r\n') + '\r\n';
const manyRows = (count: number) =>
  Array.from({ length: count }, (_, i) => `S-${i},Borrower ${i},STUDENT,Arts,`);

const all = () => prisma.borrower.findMany({ orderBy: { schoolId: 'asc' } });

test('TC-MD-18: new rows are created, existing ones updated by school ID, invalid ones rejected; audited', async () => {
  const carlo = await prisma.borrower.create({
    data: { schoolId: '2020-08812', name: 'Carlo Dizon', type: 'STUDENT', department: 'VC' },
  });
  await prisma.borrower.create({
    data: { schoolId: 'EMP-0142', name: 'Jose Reyes', type: 'FACULTY', department: 'Fine Arts' },
  });

  const response = await upload(
    admin,
    csv(
      // New; type ignores case and a blank active means true.
      '2026-00001, Liza Ramos ,student,Interior Design,',
      // Existing, matched ignoring case: updated and deactivated.
      '2020-08812,Carlo Dizon,Student,Industrial Design,FALSE',
      // Existing with the same values: unchanged.
      'EMP-0142,Jose Reyes,FACULTY,Fine Arts,true',
      '2024-0x881,,STUDENT,Arts,true',
      '2023-21877,Rhea Soriano,ALUMNI,Painting,true',
      '2022-14002,Paolo Garcia,STUDENT,Arts,maybe',
      '2022-14003,Ana Cruz,STUDENT',
      '2026-00001,Liza Again,STUDENT,Arts,true',
      `2022-14004,${'x'.repeat(201)},STUDENT,Arts,true`,
    ),
  ).expect(200);

  expect(response.body).toEqual({
    created: 1,
    updated: 1,
    unchanged: 1,
    rejected: [
      { row: 5, schoolId: '2024-0x881', reason: 'name is empty' },
      {
        row: 6,
        schoolId: '2023-21877',
        reason: 'type "ALUMNI" is not STUDENT, FACULTY, or EMPLOYEE',
      },
      { row: 7, schoolId: '2022-14002', reason: 'active must be true or false' },
      { row: 8, schoolId: '2022-14003', reason: 'expected 5 values, found 3' },
      { row: 9, schoolId: '2026-00001', reason: 'school_id is already on row 2' },
      { row: 10, schoolId: '2022-14004', reason: 'name is longer than 200 characters' },
    ],
  });
  expect(await all()).toMatchObject([
    { schoolId: '2020-08812', department: 'Industrial Design', active: false },
    { schoolId: '2026-00001', name: 'Liza Ramos', type: 'STUDENT', active: true },
    { schoolId: 'EMP-0142', department: 'Fine Arts', active: true },
  ]);

  const entries = await prisma.auditLog.findMany({ orderBy: { action: 'asc' } });
  const liza = (await all()).find((b) => b.schoolId === '2026-00001')!;
  expect(entries).toMatchObject([
    {
      actorId: adminId,
      action: 'BORROWER_CREATED',
      entity: 'borrower',
      entityId: liza.id,
      after: {
        schoolId: '2026-00001',
        name: 'Liza Ramos',
        type: 'STUDENT',
        department: 'Interior Design',
        active: true,
      },
    },
    {
      actorId: adminId,
      action: 'BORROWER_IMPORT',
      entity: 'borrower_import',
      after: { created: 1, updated: 1, unchanged: 1, rejected: 6 },
    },
    {
      actorId: adminId,
      action: 'BORROWER_UPDATED',
      entity: 'borrower',
      entityId: carlo.id,
      // Only what changed, like an edit on the Borrowers screen.
      before: { department: 'VC', active: true },
      after: { department: 'Industrial Design', active: false },
    },
  ]);
  // Still read through BorrowerService like any other borrower (CLAUDE.md rule 1).
  expect(await borrowerService.findById(carlo.id)).toMatchObject({ active: false });
});

test('TC-MD-18: a case-only change to a school ID is saved as typed', async () => {
  await prisma.borrower.create({
    data: { schoolId: '2026-A01', name: 'Mia Lim', type: 'STUDENT', department: 'Arts' },
  });
  const response = await upload(admin, csv('2026-a01,Mia Lim,STUDENT,Arts,true')).expect(200);
  expect(response.body).toMatchObject({ created: 0, updated: 1 });
  expect(await all()).toMatchObject([{ schoolId: '2026-a01' }]);
});

test('TC-MD-18: a file without the header row is refused and nothing is saved', async () => {
  for (const content of ['', 'school_id,name,type,department\nS-1,A,STUDENT,Arts']) {
    const response = await upload(admin, content).expect(400);
    expect(response.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        fields: {
          file: ['The first row must be the header school_id,name,type,department,active.'],
        },
      },
    });
  }
  expect(await all()).toEqual([]);
  expect(await prisma.auditLog.count()).toBe(0);
});

test('TC-MD-18: the header may differ in case and spacing; a BOM is ignored', async () => {
  const content = '﻿ School_ID ,Name,TYPE,department,active\nS-1,Ann,STUDENT,Arts,\n';
  expect((await upload(admin, content).expect(200)).body).toMatchObject({ created: 1 });
});

test('TC-MD-18: broken CSV and a missing file get VALIDATION_ERROR', async () => {
  const broken = await upload(admin, csv('S-1,"Ann,STUDENT,Arts,')).expect(400);
  expect(broken.body.error.code).toBe('VALIDATION_ERROR');
  const missing = await admin
    .post('/api/borrowers/import')
    .set('X-Requested-With', 'fetch')
    .expect(400);
  expect(missing.body.error).toMatchObject({
    code: 'VALIDATION_ERROR',
    details: { fields: { file: ['Choose a CSV file.'] } },
  });
});

test('TC-MD-18: only admins may import; signed out gets 401', async () => {
  const handler = await signIn('hal');
  expect((await upload(handler, csv('S-1,Ann,STUDENT,Arts,'))).status).toBe(403);
  const anonymous = request(createApp());
  expect((await upload(anonymous as typeof admin, csv('S-1,Ann,STUDENT,Arts,'))).status).toBe(401);
  expect(await all()).toEqual([]);
});

test('TC-MD-19: a 2.1 MB file, two files, and 5,001 rows get PAYLOAD_TOO_LARGE before parsing', async () => {
  const big = csv(`S-1,${'x'.repeat(2.1 * 1024 * 1024)},STUDENT,Arts,`);
  const tooBig = await upload(admin, big).expect(413);
  expect(tooBig.body.error.code).toBe('PAYLOAD_TOO_LARGE');

  const two = await admin
    .post('/api/borrowers/import')
    .set('X-Requested-With', 'fetch')
    .attach('file', Buffer.from(csv('S-1,Ann,STUDENT,Arts,')), 'a.csv')
    .attach('file', Buffer.from(csv('S-2,Ben,STUDENT,Arts,')), 'b.csv')
    .expect(413);
  expect(two.body.error.code).toBe('PAYLOAD_TOO_LARGE');

  const tooMany = await upload(admin, csv(...manyRows(5001))).expect(413);
  expect(tooMany.body.error).toMatchObject({
    code: 'PAYLOAD_TOO_LARGE',
    message: 'The file has more than 5000 rows. Split it into smaller files.',
  });
  expect(await all()).toEqual([]);
  expect(await prisma.auditLog.count()).toBe(0);
});

test('TC-MD-20: a 5,000-row import does not block other requests', async () => {
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  let importing = true;
  const imported = upload(admin, csv(...manyRows(5000))).then((response) => {
    importing = false;
    return response;
  });
  // Other requests keep being answered while the import runs.
  let answeredDuringImport = 0;
  while (importing) {
    const response = await admin.get('/api/borrowers?pageSize=1');
    expect(response.status).toBe(200);
    if (importing) answeredDuringImport++;
  }
  delay.disable();

  expect((await imported).body).toMatchObject({ created: 5000, updated: 0, rejected: [] });
  expect(answeredDuringImport).toBeGreaterThan(0);
  // No single piece of work held the event loop for long (nanoseconds).
  expect(delay.max / 1e6).toBeLessThan(250);
  expect(await prisma.borrower.count()).toBe(5000);
}, 30_000);

test('the import is limited to 30 a minute per client address', async () => {
  const app = createApp();
  const agent = await signIn('ana', app);
  const send = (ip: string) =>
    agent.post('/api/borrowers/import').set('X-Requested-With', 'fetch').set('X-Forwarded-For', ip);
  for (let i = 0; i < 30; i++) expect((await send('10.0.2.1')).status).toBe(400);
  const limited = await send('10.0.2.1');
  expect(limited.status).toBe(429);
  expect(limited.body.error.code).toBe('RATE_LIMITED');
  expect((await send('10.0.2.2')).status).toBe(400);
});
