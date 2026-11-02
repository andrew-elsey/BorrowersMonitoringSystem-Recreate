import request from 'supertest';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { resetDatabase } from './setup/reset-database.ts';

// MD-3: rooms and labs. Test cases TC-MD-09 to TC-MD-12 in TEST_CASES.md.

const PASSWORD = 'correct-horse-battery';
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
      { name: 'Ana Admin', username: 'ana', passwordHash, role: 'ADMIN' },
      { name: 'Hal Handler', username: 'hal', passwordHash, role: 'HANDLER' },
      { name: 'Vic Viewer', username: 'vic', passwordHash, role: 'VIEWER' },
    ],
  });
  adminId = users.find((user) => user.role === 'ADMIN')!.id;
  handlerId = users.find((user) => user.role === 'HANDLER')!.id;
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

// Every state-changing request needs the CSRF header (ARCHITECTURE.md 5).
const post = (agent: typeof admin, body: object) =>
  agent.post('/api/rooms').set('X-Requested-With', 'fetch').send(body);
const patch = (agent: typeof admin, id: string, body: object) =>
  agent.patch(`/api/rooms/${id}`).set('X-Requested-With', 'fetch').send(body);
const del = (agent: typeof admin, id: string) =>
  agent.delete(`/api/rooms/${id}`).set('X-Requested-With', 'fetch');

const auditFor = (entityId: string) =>
  prisma.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } });

const room = (name: string) => prisma.location.create({ data: { name, createdById: adminId } });

// A past transaction in this room, so it is part of history (BR 15).
async function useInTransaction(locationId: string) {
  const borrower = await prisma.borrower.create({
    data: { schoolId: '2026-0001', name: 'Student', type: 'STUDENT', department: 'IT' },
  });
  const semester = await prisma.semester.create({
    data: {
      name: 'S1',
      startDate: new Date('2026-08-01'),
      endDate: new Date('2026-12-15'),
      isCurrent: true,
    },
  });
  await prisma.transaction.create({
    data: { borrowerId: borrower.id, locationId, issuedById: adminId, semesterId: semester.id },
  });
}

test('TC-MD-09: admin creates, renames, deactivates, and reactivates a room; each is audited (SPEC 3)', async () => {
  const created = await post(admin, { name: '  CL-201  ' }).expect(201);
  const { id, createdAt } = created.body.room;
  expect(created.body.room).toEqual({
    id,
    name: 'CL-201',
    active: true,
    createdBy: { id: adminId, name: 'Ana Admin' },
    createdAt,
    transactionCount: 0,
  });

  await patch(admin, id, { name: 'CL-202' }).expect(200);
  const deactivated = await patch(admin, id, { active: false }).expect(200);
  expect(deactivated.body.room).toMatchObject({ name: 'CL-202', active: false });
  await patch(admin, id, { active: true }).expect(200);
  // No change: nothing written or audited.
  await patch(admin, id, { name: 'CL-202', active: true }).expect(200);

  expect(await auditFor(id)).toMatchObject([
    { actorId: adminId, action: 'LOCATION_CREATED', entity: 'location', after: { name: 'CL-201' } },
    {
      action: 'LOCATION_UPDATED',
      before: { name: 'CL-201' },
      after: { name: 'CL-202' },
    },
    { action: 'LOCATION_UPDATED', before: { active: true }, after: { active: false } },
    { action: 'LOCATION_UPDATED', before: { active: false }, after: { active: true } },
  ]);
  expect(await auditFor(id)).toHaveLength(4);
});

test('TC-MD-10: a handler quick-adds a room with created_by set, but cannot edit or delete (SPEC 3)', async () => {
  const handler = await signIn('hal');
  const created = await post(handler, { name: 'DL-104' }).expect(201);
  const { id } = created.body.room;
  expect(created.body.room.createdBy).toEqual({ id: handlerId, name: 'Hal Handler' });
  expect(await prisma.location.findUnique({ where: { id } })).toMatchObject({
    createdById: handlerId,
    active: true,
  });
  expect(await auditFor(id)).toMatchObject([{ actorId: handlerId, action: 'LOCATION_CREATED' }]);

  for (const response of [
    await patch(handler, id, { name: 'DL-105' }),
    await patch(handler, id, { active: false }),
    await del(handler, id),
  ]) {
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  }
  expect(await prisma.location.findUnique({ where: { id } })).toMatchObject({
    name: 'DL-104',
    active: true,
  });
});

test('TC-MD-30: a handler lists only active rooms, whatever the query says; admins see all (SPEC 3, 5)', async () => {
  await room('CL-201');
  const inactive = await room('CL-108');
  await prisma.location.update({ where: { id: inactive.id }, data: { active: false } });
  const handler = await signIn('hal');

  for (const path of ['/api/rooms', '/api/rooms?active=false', '/api/rooms?page=1&pageSize=100']) {
    const list = await handler.get(path).expect(200);
    expect(list.body).toMatchObject({ total: 1, data: [{ name: 'CL-201', active: true }] });
  }
  const tooMany = await handler.get('/api/rooms?pageSize=101').expect(400);
  expect(tooMany.body.error.code).toBe('VALIDATION_ERROR');

  const all = await admin.get('/api/rooms').expect(200);
  expect(all.body.data.map((row: { name: string }) => row.name)).toEqual(['CL-108', 'CL-201']);
  expect(all.body.total).toBe(2);
});

test('a viewer cannot use any rooms endpoint; signed out gets 401', async () => {
  const existing = await room('AVR-1');
  const viewer = await signIn('vic');
  for (const response of [
    await viewer.get('/api/rooms'),
    await post(viewer, { name: 'FA-305' }),
    await patch(viewer, existing.id, { active: false }),
    await del(viewer, existing.id),
  ]) {
    expect(response.status).toBe(403);
  }
  const anonymous = request(createApp());
  await anonymous.get('/api/rooms').expect(401);
  await anonymous
    .post('/api/rooms')
    .set('X-Requested-With', 'fetch')
    .send({ name: 'X' })
    .expect(401);
  expect(await prisma.location.count()).toBe(1);
});

test('TC-MD-11: adding "CL-201" when "cl-201" exists gets DUPLICATE_VALUE, on create and rename (SPEC 4)', async () => {
  await room('cl-201');
  const other = await room('CL-202');
  const message = '"cl-201" already exists. Names are compared without regard to case.';

  for (const response of [
    await post(admin, { name: 'CL-201' }),
    await post(await signIn('hal'), { name: 'CL-201' }),
    await patch(admin, other.id, { name: 'Cl-201' }),
  ]) {
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('DUPLICATE_VALUE');
    expect(response.body.error.details.fields.name).toEqual([message]);
  }
  expect(await prisma.auditLog.count()).toBe(0);
});

test('TC-MD-11: a name that matches an inactive room says so; admins are told to reactivate it (owner decision 2026-11-03)', async () => {
  const inactive = await room('cl-201');
  await prisma.location.update({ where: { id: inactive.id }, data: { active: false } });
  const other = await room('CL-202');
  const forHandler =
    '"cl-201" exists but is inactive. Ask an admin to reactivate it, or choose another room.';
  const forAdmin = '"cl-201" exists but is inactive. Reactivate it instead.';

  for (const [response, message] of [
    [await post(await signIn('hal'), { name: 'CL-201' }), forHandler],
    [await post(admin, { name: 'CL-201' }), forAdmin],
    [await patch(admin, other.id, { name: 'Cl-201' }), forAdmin],
  ] as const) {
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('DUPLICATE_VALUE');
    expect(response.body.error.details.fields.name).toEqual([message]);
  }
  // Nothing is reactivated or written.
  expect(await prisma.location.findUnique({ where: { id: inactive.id } })).toMatchObject({
    active: false,
  });
  expect(await prisma.auditLog.count()).toBe(0);
});

test('a room can change the case of its own name', async () => {
  const existing = await room('cl-201');
  await patch(admin, existing.id, { name: 'CL-201' }).expect(200);
  expect(await prisma.location.findUnique({ where: { id: existing.id } })).toMatchObject({
    name: 'CL-201',
  });
});

test('TC-MD-12: a room used in a transaction cannot be deleted, only deactivated; an unused one is deleted (BR 15)', async () => {
  const used = await room('CL-201');
  const unused = await room('CL-108');
  await useInTransaction(used.id);

  const list = await admin.get('/api/rooms').expect(200);
  expect(list.body.data).toMatchObject([
    { name: 'CL-108', transactionCount: 0 },
    { name: 'CL-201', transactionCount: 1 },
  ]);

  const refused = await del(admin, used.id).expect(409);
  expect(refused.body.error.code).toBe('HAS_HISTORY');
  expect(await prisma.location.findUnique({ where: { id: used.id } })).not.toBeNull();
  expect(await prisma.transaction.count({ where: { locationId: used.id } })).toBe(1);
  expect(await auditFor(used.id)).toEqual([]); // the audit entry rolled back with the delete

  await patch(admin, used.id, { active: false }).expect(200);
  expect(await prisma.location.findUnique({ where: { id: used.id } })).toMatchObject({
    active: false,
  });

  await del(admin, unused.id).expect(204);
  expect(await prisma.location.findUnique({ where: { id: unused.id } })).toBeNull();
  expect(await auditFor(unused.id)).toMatchObject([
    { actorId: adminId, action: 'LOCATION_DELETED', before: { name: 'CL-108', active: true } },
  ]);
});

test('the list is sorted by name and paginated; unknown ids get NOT_FOUND', async () => {
  await prisma.location.createMany({
    data: ['FA-305', 'AVR-1', 'DL-104'].map((name) => ({ name, createdById: adminId })),
  });
  const first = await admin.get('/api/rooms?page=1&pageSize=2').expect(200);
  expect(first.body).toMatchObject({ page: 1, pageSize: 2, total: 3 });
  expect(first.body.data.map((row: { name: string }) => row.name)).toEqual(['AVR-1', 'DL-104']);
  expect(first.body.data[0].createdBy).toEqual({ id: adminId, name: 'Ana Admin' });

  const missing = '00000000-0000-4000-8000-000000000000';
  for (const response of [
    await patch(admin, missing, { active: false }),
    await del(admin, missing),
  ]) {
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  }
  const badId = await patch(admin, 'not-a-uuid', { active: false }).expect(400);
  expect(badId.body.error.code).toBe('VALIDATION_ERROR');
});

test('SPEC 7 bounds: page size 100 is allowed and 101 is not; names are 1 to 200 characters', async () => {
  await admin.get('/api/rooms?pageSize=100').expect(200);
  const tooMany = await admin.get('/api/rooms?pageSize=101').expect(400);
  expect(tooMany.body.error.code).toBe('VALIDATION_ERROR');

  await post(admin, { name: 'x'.repeat(200) }).expect(201);
  for (const name of ['', '   ', 'x'.repeat(201), 'Lab\u0000', 'La\nb']) {
    const response = await post(admin, { name }).expect(400);
    expect(response.body.error.details.fields.name).toHaveLength(1);
  }
  const { id } = (await post(admin, { name: 'Lab 1' }).expect(201)).body.room;
  for (const body of [{ name: 'Lab\u0000' }, { active: 'no' }]) {
    const response = await patch(admin, id, body).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  }
});
