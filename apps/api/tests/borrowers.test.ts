import request from 'supertest';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { borrowerService } from '../src/services/borrowers.ts';
import { resetDatabase } from './setup/reset-database.ts';

// MD-5: borrowers CRUD and search. Test cases TC-MD-15 to TC-MD-17 and TC-MD-27 in TEST_CASES.md.

const PASSWORD = 'correct-horse-battery';
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
      { name: 'Vic Viewer', username: 'vic', passwordHash, role: 'VIEWER' },
    ],
  });
  adminId = users.find((user) => user.role === 'ADMIN')!.id;
  admin = await signIn('ana');
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

const CARLO = { schoolId: '2020-08812', name: 'Carlo Dizon', type: 'STUDENT', department: 'VC' };

// Every state-changing request needs the CSRF header (ARCHITECTURE.md 5).
const post = (agent: typeof admin, body: object) =>
  agent.post('/api/borrowers').set('X-Requested-With', 'fetch').send(body);
const patch = (agent: typeof admin, id: string, body: object) =>
  agent.patch(`/api/borrowers/${id}`).set('X-Requested-With', 'fetch').send(body);

const auditFor = (entityId: string) =>
  prisma.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } });

test('TC-MD-15: admin creates and edits a borrower; both are saved and audited (BR 14)', async () => {
  const created = await post(admin, { ...CARLO, name: '  Carlo Dizon  ' }).expect(201);
  const { id } = created.body.borrower;
  expect(created.body.borrower).toEqual({ id, ...CARLO, active: true });

  const edited = await patch(admin, id, { ...CARLO, department: 'Industrial Design' }).expect(200);
  expect(edited.body.borrower).toEqual({
    id,
    ...CARLO,
    department: 'Industrial Design',
    active: true,
  });

  expect(await auditFor(id)).toMatchObject([
    {
      actorId: adminId,
      action: 'BORROWER_CREATED',
      entity: 'borrower',
      before: null,
      after: { ...CARLO, active: true },
    },
    {
      actorId: adminId,
      action: 'BORROWER_UPDATED',
      entity: 'borrower',
      // Only what changed.
      before: { department: 'VC' },
      after: { department: 'Industrial Design' },
    },
  ]);
});

test('TC-MD-15: a duplicate school ID gets DUPLICATE_VALUE on the field, on create and on edit', async () => {
  await post(admin, CARLO).expect(201);
  const other = await post(admin, { ...CARLO, schoolId: 'EMP-0142' }).expect(201);

  for (const response of [
    await post(admin, CARLO),
    await patch(admin, other.body.borrower.id, { schoolId: CARLO.schoolId }),
  ]) {
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('DUPLICATE_VALUE');
    expect(response.body.error.details.fields.schoolId).toHaveLength(1);
  }
  expect(await prisma.borrower.count()).toBe(2);
  // Nothing failed was audited (the entries roll back with the change).
  expect(await prisma.auditLog.count()).toBe(2);
});

test('TC-MD-27: school IDs are unique regardless of case; a borrower can change its own case (SPEC 4)', async () => {
  const carlo = await post(admin, { ...CARLO, schoolId: '2026-A01' }).expect(201);
  const other = await post(admin, { ...CARLO, schoolId: 'EMP-0142' }).expect(201);

  for (const response of [
    await post(admin, { ...CARLO, schoolId: '2026-a01' }),
    await patch(admin, other.body.borrower.id, { schoolId: '2026-A01'.toLowerCase() }),
  ]) {
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('DUPLICATE_VALUE');
    expect(response.body.error.details.fields.schoolId).toHaveLength(1);
  }

  // Stored as typed.
  const edited = await patch(admin, carlo.body.borrower.id, { schoolId: '2026-a01' }).expect(200);
  expect(edited.body.borrower.schoolId).toBe('2026-a01');
  expect(await auditFor(carlo.body.borrower.id)).toMatchObject([
    { action: 'BORROWER_CREATED' },
    {
      action: 'BORROWER_UPDATED',
      before: { schoolId: '2026-A01' },
      after: { schoolId: '2026-a01' },
    },
  ]);
});

test('TC-MD-17: a deactivated borrower cannot be selected at checkout; reactivating restores it (BR 3)', async () => {
  const { id } = (await post(admin, CARLO).expect(201)).body.borrower;

  const off = await patch(admin, id, { active: false }).expect(200);
  expect(off.body.borrower.active).toBe(false);
  // Checkout looks borrowers up through BorrowerService (BRW-2, BRW-3): the row comes back marked
  // inactive so the screen can disable it, and isEligible refuses it.
  expect(await borrowerService.search('Carlo')).toMatchObject([{ id, active: false }]);
  expect(await borrowerService.isEligible(id)).toEqual({
    eligible: false,
    reason: 'BORROWER_INACTIVE',
  });

  await patch(admin, id, { active: true }).expect(200);
  expect(await borrowerService.isEligible(id)).toEqual({ eligible: true });
  expect(await auditFor(id)).toMatchObject([
    { action: 'BORROWER_CREATED' },
    { action: 'BORROWER_UPDATED', before: { active: true }, after: { active: false } },
    { action: 'BORROWER_UPDATED', before: { active: false }, after: { active: true } },
  ]);
});

test('TC-MD-16: search by name or school ID with 1, 2, and 101 characters; results paginated', async () => {
  await prisma.borrower.createMany({
    data: [
      { schoolId: '2026-0001', name: 'Ana Santos', type: 'STUDENT', department: 'CS' },
      { schoolId: '2026-0002', name: 'Ben Reyes', type: 'FACULTY', department: 'IT' },
      {
        schoolId: '2026-0003',
        name: 'Cora Santos',
        type: 'STUDENT',
        department: 'CS',
        active: false,
      },
    ],
  });
  const names = (body: { data: { name: string }[] }) => body.data.map((row) => row.name);

  const byName = await admin.get('/api/borrowers?q=santos&pageSize=1').expect(200);
  expect(byName.body).toMatchObject({ page: 1, pageSize: 1, total: 2 });
  expect(names(byName.body)).toEqual(['Ana Santos']);
  const secondPage = await admin.get('/api/borrowers?q=santos&page=2&pageSize=1').expect(200);
  // Inactive borrowers are found too, so an admin can reactivate them.
  expect(secondPage.body.data).toMatchObject([{ name: 'Cora Santos', active: false }]);

  expect(names((await admin.get('/api/borrowers?q=0002').expect(200)).body)).toEqual(['Ben Reyes']);
  // No q: everyone, sorted by name.
  const all = await admin.get('/api/borrowers').expect(200);
  expect(all.body).toMatchObject({ page: 1, pageSize: 25, total: 3 });
  expect(names(all.body)).toEqual(['Ana Santos', 'Ben Reyes', 'Cora Santos']);

  await admin.get(`/api/borrowers?q=${'a'.repeat(100)}`).expect(200);
  for (const q of ['a', 'a'.repeat(101), '', 'an%00']) {
    const response = await admin.get(`/api/borrowers?q=${q}`).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details.fields.q).toHaveLength(1);
  }
});

test('SPEC 7 bounds: page size 1 to 100; fields 1 to 200 characters; type from the list', async () => {
  await admin.get('/api/borrowers?pageSize=100').expect(200);
  await admin.get('/api/borrowers?pageSize=101').expect(400);
  await admin.get('/api/borrowers?page=0').expect(400);

  const long = 'x'.repeat(200);
  await post(admin, { schoolId: long, name: long, type: 'FACULTY', department: long }).expect(201);
  for (const [field, value] of [
    ['schoolId', ''],
    ['name', '   '],
    ['department', 'x'.repeat(201)],
    ['type', 'ALUMNI'],
    // A NUL would make PostgreSQL fail with a 500.
    ['name', 'Ana\u0000'],
  ] as const) {
    const response = await post(admin, { ...CARLO, [field]: value }).expect(400);
    expect(response.body.error.details.fields[field]).toHaveLength(1);
  }
  const { id } = (await post(admin, CARLO).expect(201)).body.borrower;
  await patch(admin, id, { active: 'no' }).expect(400);
});

test('saving without changes writes nothing and no audit entry (BR 14)', async () => {
  const { id } = (await post(admin, CARLO).expect(201)).body.borrower;
  await patch(admin, id, { ...CARLO, active: true }).expect(200);
  expect(await auditFor(id)).toHaveLength(1);
});

test('an unknown id gets NOT_FOUND, a malformed id VALIDATION_ERROR; there is no delete (BR 15)', async () => {
  const unknown = await patch(admin, '00000000-0000-4000-8000-000000000000', { active: false });
  expect(unknown.status).toBe(404);
  expect(unknown.body.error.code).toBe('NOT_FOUND');
  await patch(admin, 'abc', { active: false }).expect(400);

  const { id } = (await post(admin, CARLO).expect(201)).body.borrower;
  await admin.delete(`/api/borrowers/${id}`).set('X-Requested-With', 'fetch').expect(404);
  expect(await prisma.borrower.count()).toBe(1);
});

test('a handler or viewer cannot list, create, or edit borrowers; signed out gets 401 (SPEC 3)', async () => {
  const { id } = (await post(admin, CARLO).expect(201)).body.borrower;
  for (const username of ['hal', 'vic']) {
    const agent = await signIn(username);
    for (const response of [
      await agent.get('/api/borrowers'),
      await post(agent, { ...CARLO, schoolId: 'X-1' }),
      await patch(agent, id, { active: false }),
    ]) {
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    }
  }
  expect(await prisma.borrower.findMany()).toMatchObject([
    { schoolId: CARLO.schoolId, active: true },
  ]);
  await request(createApp()).get('/api/borrowers').expect(401);
});
