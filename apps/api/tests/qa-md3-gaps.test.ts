import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { resetDatabase } from './setup/reset-database.ts';

// QA (automated) gap tests for MD-3: created_by taken only from the session, signed-out edits,
// the handler list across pages, duplicates after trimming and in a race, the inactive-duplicate
// rename leaving both rooms alone, SPEC 7 bounds on rename and delete, CSRF and body limits.
// TC-MD-09 to 12 and TC-MD-30 in TEST_CASES.md.

const PASSWORD = 'qa-md3-password-123';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
let passwordHash: string;
let admin: ReturnType<typeof request.agent>;
let adminId: string;
let handlerId: string;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  await resetDatabase();
  const users = await prisma.user.createManyAndReturn({
    data: [
      { name: 'Test Admin', username: 'qa-admin', passwordHash, role: 'ADMIN' },
      { name: 'Test Handler', username: 'qa-handler', passwordHash, role: 'HANDLER' },
      { name: 'Test Viewer', username: 'qa-viewer', passwordHash, role: 'VIEWER' },
    ],
  });
  adminId = users.find((user) => user.role === 'ADMIN')!.id;
  handlerId = users.find((user) => user.role === 'HANDLER')!.id;
  admin = await signIn('qa-admin');
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

type Agent = typeof admin;
const post = (body: unknown, agent: Agent = admin) =>
  agent
    .post('/api/rooms')
    .set('X-Requested-With', 'fetch')
    .send(body as object);
const patch = (id: string, body: unknown, agent: Agent = admin) =>
  agent
    .patch(`/api/rooms/${id}`)
    .set('X-Requested-With', 'fetch')
    .send(body as object);
const del = (id: string, agent: Agent = admin) =>
  agent.delete(`/api/rooms/${id}`).set('X-Requested-With', 'fetch');

const room = (name: string, active = true) =>
  prisma.location.create({ data: { name, active, createdById: adminId } });
const stored = (id: string) => prisma.location.findUniqueOrThrow({ where: { id } });
const auditFor = (entityId: string) => prisma.auditLog.findMany({ where: { entityId } });

describe('created_by comes from the session only', () => {
  test('a handler sending createdById or createdBy for the admin still records the handler', async () => {
    const response = await post(
      { name: 'QA-Lab-1', createdById: adminId, createdBy: { id: adminId, name: 'Test Admin' } },
      await signIn('qa-handler'),
    ).expect(201);
    expect(response.body.room.createdBy.id).toBe(handlerId);
    expect((await stored(response.body.room.id)).createdById).toBe(handlerId);
  });

  test('an admin PATCH with only createdById or transactionCount is refused and changes nothing', async () => {
    const existing = await room('QA-Lab-2');
    await patch(existing.id, { createdById: handlerId, transactionCount: 9 }).expect(400);
    expect((await stored(existing.id)).createdById).toBe(adminId);
    expect(await auditFor(existing.id)).toEqual([]);
  });

  test('an empty PATCH body is refused and writes no audit', async () => {
    const existing = await room('QA-Lab-3');
    await patch(existing.id, {}).expect(400);
    expect(await auditFor(existing.id)).toEqual([]);
  });
});

describe('roles and sign-in', () => {
  test('signed out, PATCH and DELETE get 401 and the room is unchanged', async () => {
    const existing = await room('QA-Lab-4');
    const anonymous = request(createApp());
    for (const response of [
      await anonymous
        .patch(`/api/rooms/${existing.id}`)
        .set('X-Requested-With', 'fetch')
        .send({ active: false }),
      await anonymous.delete(`/api/rooms/${existing.id}`).set('X-Requested-With', 'fetch'),
    ]) {
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
    }
    expect(await stored(existing.id)).toMatchObject({ name: 'QA-Lab-4', active: true });
  });

  test('a handler gets 403 on deleting an unused room, and it stays', async () => {
    const existing = await room('QA-Lab-5');
    const response = await del(existing.id, await signIn('qa-handler'));
    expect(response.status).toBe(403);
    expect(await prisma.location.count()).toBe(1);
  });

  test('POST, PATCH and DELETE without the CSRF header are refused and change nothing', async () => {
    const existing = await room('QA-Lab-6');
    for (const response of [
      await admin.post('/api/rooms').send({ name: 'QA-Lab-7' }),
      await admin.patch(`/api/rooms/${existing.id}`).send({ name: 'Changed' }),
      await admin.delete(`/api/rooms/${existing.id}`),
    ]) {
      expect(response.status).toBe(403);
    }
    expect(await prisma.location.count()).toBe(1);
    expect((await stored(existing.id)).name).toBe('QA-Lab-6');
  });
});

describe('the handler list counts active rooms only (TC-MD-30)', () => {
  test('page 2 of the handler list holds only active rooms and total counts only active ones', async () => {
    for (const name of ['A-1', 'B-1', 'C-1']) await room(name);
    for (const name of ['A-0', 'B-0']) await room(name, false);
    const handler = await signIn('qa-handler');

    const second = await handler.get('/api/rooms?page=2&pageSize=2&active=false').expect(200);
    expect(second.body).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(second.body.data.map((row: { name: string }) => row.name)).toEqual(['C-1']);
  });

  test('a page past the end is empty, not an error', async () => {
    await room('A-1');
    const response = await admin.get('/api/rooms?page=5&pageSize=10').expect(200);
    expect(response.body).toMatchObject({ data: [], total: 1 });
  });

  test('page 0 and a non-number page size are VALIDATION_ERROR', async () => {
    for (const query of ['page=0', 'pageSize=0', 'pageSize=abc']) {
      const response = await admin.get(`/api/rooms?${query}`);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('duplicates ignoring case (TC-MD-11)', () => {
  test('a padded, different-case name is trimmed and then refused as a duplicate', async () => {
    await room('CL-201');
    const response = await post({ name: '   cl-201  ' }, await signIn('qa-handler'));
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('DUPLICATE_VALUE');
    expect(await prisma.location.count()).toBe(1);
  });

  test('a rename to a padded, different-case name of another room is refused', async () => {
    await room('CL-201');
    const other = await room('CL-202');
    const response = await patch(other.id, { name: ' cl-201 ' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('DUPLICATE_VALUE');
    expect((await stored(other.id)).name).toBe('CL-202');
  });

  test('two adds of the same name in different case at once: one 201, one DUPLICATE_VALUE', async () => {
    const handler = await signIn('qa-handler');
    const [a, b] = await Promise.all([post({ name: 'RACE-1' }), post({ name: 'race-1' }, handler)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect([a, b].find((r) => r.status === 409)!.body.error.code).toBe('DUPLICATE_VALUE');
    expect(await prisma.location.count()).toBe(1);
    expect(await prisma.auditLog.count()).toBe(1);
  });

  test('renaming to the name of an inactive room leaves both rooms as they were and writes no audit', async () => {
    const inactive = await room('CL-108', false);
    const other = await room('CL-202');
    const response = await patch(other.id, { name: 'cl-108', active: false });
    expect(response.status).toBe(409);
    expect(response.body.error.message).toBe(
      '"CL-108" exists but is inactive. Reactivate it instead.',
    );
    expect(await stored(inactive.id)).toMatchObject({ name: 'CL-108', active: false });
    expect(await stored(other.id)).toMatchObject({ name: 'CL-202', active: true });
    expect(await prisma.auditLog.count()).toBe(0);
  });

  test('a duplicate of an active room is not worded as inactive for a handler', async () => {
    await room('CL-201');
    const response = await post({ name: 'CL-201' }, await signIn('qa-handler'));
    expect(response.body.error.message).toBe(
      '"CL-201" already exists. Names are compared without regard to case.',
    );
  });
});

describe('history and deletion (TC-MD-12)', () => {
  test('a deactivated room used in a transaction still gets HAS_HISTORY on delete', async () => {
    const used = await room('CL-201', false);
    const borrower = await prisma.borrower.create({
      data: { schoolId: 'QA-0001', name: 'Test Student', type: 'STUDENT', department: 'IT' },
    });
    const semester = await prisma.semester.create({
      data: {
        name: 'QA S1',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-12-15'),
        isCurrent: true,
      },
    });
    await prisma.transaction.create({
      data: {
        borrowerId: borrower.id,
        locationId: used.id,
        issuedById: adminId,
        semesterId: semester.id,
      },
    });
    const response = await del(used.id).expect(409);
    expect(response.body.error).toMatchObject({
      code: 'HAS_HISTORY',
      message: 'This room is used in transactions, so it cannot be deleted. Deactivate it instead.',
    });
    expect(await stored(used.id)).toMatchObject({ active: false });
  });

  test('deleting the same room twice: the second gets NOT_FOUND and only one audit entry exists', async () => {
    const existing = await room('QA-Lab-8');
    await del(existing.id).expect(204);
    const again = await del(existing.id).expect(404);
    expect(again.body.error.code).toBe('NOT_FOUND');
    expect(await auditFor(existing.id)).toHaveLength(1);
  });
});

describe('SPEC 7 bounds on rename, delete and bodies', () => {
  test('a rename to 200 characters works; empty, 201 characters, tab, or DEL is refused', async () => {
    const existing = await room('QA-Lab-9');
    await patch(existing.id, { name: 'y'.repeat(200) }).expect(200);
    for (const name of ['', '   ', 'y'.repeat(201), 'La\tb', 'Lab\u007f']) {
      const response = await patch(existing.id, { name });
      expect(response.status).toBe(400);
      expect(response.body.error.details.fields.name).toHaveLength(1);
    }
    expect((await stored(existing.id)).name).toBe('y'.repeat(200));
  });

  test('a name that is not a string, or missing, is VALIDATION_ERROR on create', async () => {
    for (const body of [{}, { name: 42 }, { name: null }, { name: ['CL-1'] }]) {
      const response = await post(body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(await prisma.location.count()).toBe(0);
  });

  test('DELETE with a bad uuid is VALIDATION_ERROR; with a missing uuid NOT_FOUND', async () => {
    const bad = await del('not-a-uuid');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    const missing = await del(MISSING_ID);
    expect(missing.status).toBe(404);
  });

  test('a body over 100 KB gets PAYLOAD_TOO_LARGE', async () => {
    const response = await post({ name: 'x'.repeat(110_000) });
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});
