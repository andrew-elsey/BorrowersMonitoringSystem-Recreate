import request from 'supertest';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { resetDatabase } from './setup/reset-database.ts';

// AUTH-3: user management. Test cases TC-AUTH-19 to TC-AUTH-22 in TEST_CASES.md.

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

async function signIn(username: string, password = PASSWORD) {
  const agent = request.agent(createApp());
  await agent
    .post('/api/auth/login')
    .set('X-Requested-With', 'fetch')
    .send({ username, password })
    .expect(200);
  return agent;
}

const login = (username: string, password: string) =>
  request(createApp())
    .post('/api/auth/login')
    .set('X-Requested-With', 'fetch')
    .send({ username, password });

// Every state-changing request needs the CSRF header (ARCHITECTURE.md 5).
const post = (agent: typeof admin, body: object) =>
  agent.post('/api/users').set('X-Requested-With', 'fetch').send(body);
const patch = (agent: typeof admin, id: string, body: object) =>
  agent.patch(`/api/users/${id}`).set('X-Requested-With', 'fetch').send(body);
const reset = (agent: typeof admin, id: string, body: object) =>
  agent.put(`/api/users/${id}/password`).set('X-Requested-With', 'fetch').send(body);

const auditFor = (entityId: string) =>
  prisma.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } });

const NEW_USER = {
  name: 'Bea Navarro',
  username: 'bnavarro',
  role: 'HANDLER',
  password: 'starting-pass-1',
};

test('TC-AUTH-19: admin creates, edits, deactivates a user, and resets a password; each is audited', async () => {
  const created = await post(admin, NEW_USER).expect(201);
  const id = created.body.user.id;
  expect(created.body.user).toEqual({
    id,
    name: 'Bea Navarro',
    username: 'bnavarro',
    role: 'HANDLER',
    active: true,
  });
  // The new user signs in with the starting password the admin typed.
  await signIn('bnavarro', 'starting-pass-1');

  const edited = await patch(admin, id, { name: 'Beatriz Navarro', role: 'VIEWER' }).expect(200);
  expect(edited.body.user).toMatchObject({ name: 'Beatriz Navarro', role: 'VIEWER' });

  await reset(admin, id, { password: 'brand-new-pass-2' }).expect(204);
  expect((await login('bnavarro', 'starting-pass-1')).status).toBe(401);
  await signIn('bnavarro', 'brand-new-pass-2');

  const deactivated = await patch(admin, id, { active: false }).expect(200);
  expect(deactivated.body.user.active).toBe(false);
  // Inactive users cannot sign in, even with the right password.
  expect((await login('bnavarro', 'brand-new-pass-2')).status).toBe(401);

  const entries = await auditFor(id);
  expect(entries.map((entry) => [entry.action, entry.actorId])).toEqual([
    ['USER_CREATED', adminId],
    ['USER_UPDATED', adminId],
    ['USER_PASSWORD_RESET', adminId],
    ['USER_UPDATED', adminId],
  ]);
  expect(entries[0]!.after).toEqual({
    name: 'Bea Navarro',
    username: 'bnavarro',
    role: 'HANDLER',
    active: true,
  });
  expect(entries[1]!.before).toEqual({ name: 'Bea Navarro', role: 'HANDLER' });
  expect(entries[1]!.after).toEqual({ name: 'Beatriz Navarro', role: 'VIEWER' });
  expect(entries[2]!.after).toEqual({ username: 'bnavarro' });
  expect(entries[3]!.before).toEqual({ active: true });
  expect(entries[3]!.after).toEqual({ active: false });
  // No password or hash is ever written to the audit log or returned.
  expect(JSON.stringify(entries)).not.toMatch(/pass|\$argon2/);
  expect(JSON.stringify(created.body)).not.toMatch(/password|\$argon2/i);

  // Reactivating lets them sign in again.
  await patch(admin, id, { active: true }).expect(200);
  await signIn('bnavarro', 'brand-new-pass-2');
});

test('TC-AUTH-19: the list shows every user, sorted by name, without password hashes', async () => {
  const reply = await admin.get('/api/users?page=1&pageSize=2').expect(200);
  expect(reply.body).toEqual({
    data: [
      { id: adminId, name: 'Ana Admin', username: 'ana', role: 'ADMIN', active: true },
      { id: handlerId, name: 'Hal Handler', username: 'hal', role: 'HANDLER', active: true },
    ],
    page: 1,
    pageSize: 2,
    total: 3,
  });
  // SPEC 7: at most 100 a page.
  expect((await admin.get('/api/users?pageSize=101')).body.error.code).toBe('VALIDATION_ERROR');
});

test('TC-AUTH-19: duplicate usernames, short passwords, and bad input are refused', async () => {
  const duplicate = await post(admin, { ...NEW_USER, username: 'hal' }).expect(409);
  expect(duplicate.body.error.code).toBe('DUPLICATE_VALUE');
  expect(duplicate.body.error.details.fields.username).toBeDefined();
  const renamed = await patch(admin, handlerId, { username: 'vic' }).expect(409);
  expect(renamed.body.error.code).toBe('DUPLICATE_VALUE');

  // Password policy (ARCHITECTURE.md 5): at least 10 characters, at most 200 (SPEC 7).
  const short = await post(admin, { ...NEW_USER, password: 'short' }).expect(400);
  expect(short.body.error.details.fields.password).toBeDefined();
  await post(admin, { ...NEW_USER, password: 'x'.repeat(201) }).expect(400);
  await reset(admin, handlerId, { password: 'short' }).expect(400);
  await post(admin, { ...NEW_USER, role: 'OWNER' }).expect(400);
  await post(admin, { ...NEW_USER, name: 'x'.repeat(201) }).expect(400);
  await post(admin, { ...NEW_USER, username: '   ' }).expect(400);
  // The edit body cannot set a password.
  const before = await prisma.user.findUniqueOrThrow({ where: { id: handlerId } });
  await patch(admin, handlerId, { password: 'sneaky-new-pass' }).expect(200);
  const after = await prisma.user.findUniqueOrThrow({ where: { id: handlerId } });
  expect(after.passwordHash).toBe(before.passwordHash);

  const missing = '00000000-0000-4000-8000-000000000000';
  expect((await patch(admin, missing, { name: 'X' })).body.error.code).toBe('NOT_FOUND');
  expect((await reset(admin, missing, { password: 'long-enough-1' })).body.error.code).toBe(
    'NOT_FOUND',
  );
  // Nothing refused was written.
  expect(await prisma.user.count()).toBe(3);
});

test('TC-AUTH-20: a user with transactions can only be deactivated; the record and history stay (BR 15)', async () => {
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
  const location = await prisma.location.create({ data: { name: 'CL-201', createdById: adminId } });
  const transaction = await prisma.transaction.create({
    data: {
      borrowerId: borrower.id,
      locationId: location.id,
      issuedById: handlerId,
      semesterId: semester.id,
    },
  });

  // There is no way to delete a user.
  const refused = await admin.delete(`/api/users/${handlerId}`).set('X-Requested-With', 'fetch');
  expect(refused.status).toBe(404);
  expect(refused.body.error.code).toBe('NOT_FOUND');

  await patch(admin, handlerId, { active: false }).expect(200);
  const kept = await prisma.user.findUniqueOrThrow({ where: { id: handlerId } });
  expect(kept.active).toBe(false);
  const history = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
  expect(history.issuedById).toBe(handlerId);
});

test('TC-AUTH-21: an admin cannot deactivate their own account', async () => {
  for (const id of [adminId, adminId.toUpperCase()]) {
    const refused = await patch(admin, id, { active: false }).expect(409);
    expect(refused.body.error.code).toBe('CANNOT_DEACTIVATE_SELF');
  }
  expect((await prisma.user.findUniqueOrThrow({ where: { id: adminId } })).active).toBe(true);
  expect(await auditFor(adminId)).toEqual([]);
  // Editing their own name is fine, and they stay signed in.
  await patch(admin, adminId, { name: 'Ana A.' }).expect(200);
  await admin.get('/api/auth/me').expect(200);
});

test('TC-AUTH-22: handlers and viewers get 403 on every user endpoint; signed out gets 401', async () => {
  for (const username of ['hal', 'vic']) {
    const agent = await signIn(username);
    expect((await agent.get('/api/users')).status).toBe(403);
    expect((await post(agent, NEW_USER)).status).toBe(403);
    expect((await patch(agent, adminId, { active: false })).status).toBe(403);
    expect((await reset(agent, adminId, { password: 'taken-over-123' })).status).toBe(403);
  }
  const anonymous = request.agent(createApp());
  expect((await anonymous.get('/api/users')).status).toBe(401);
  expect((await post(anonymous, NEW_USER)).status).toBe(401);
  expect(await prisma.user.count()).toBe(3);
});

test('ARCH 5: deactivating a user or changing their role signs them out at once', async () => {
  // GET /api/rooms and /api/items trust the session alone, so a 401 there means it was removed.
  const handler = await signIn('hal');
  await handler.get('/api/rooms').expect(200);
  await patch(admin, handlerId, { role: 'VIEWER' }).expect(200);
  // The old session carried the old role, so it is gone.
  expect((await handler.get('/api/rooms')).status).toBe(401);
  const viewer = await signIn('hal');
  expect((await viewer.get('/api/auth/me')).body.user.role).toBe('VIEWER');
  expect((await viewer.get('/api/rooms')).status).toBe(403);

  await viewer.get('/api/items').expect(200);
  await patch(admin, handlerId, { active: false }).expect(200);
  expect((await viewer.get('/api/items')).status).toBe(401);

  // A name change signs nobody out, and the admin's own session is untouched.
  const vic = await signIn('vic');
  const vicId = (await prisma.user.findUniqueOrThrow({ where: { username: 'vic' } })).id;
  await patch(admin, vicId, { name: 'Victor Viewer' }).expect(200);
  await vic.get('/api/items').expect(200);
  await admin.get('/api/users').expect(200);
});
