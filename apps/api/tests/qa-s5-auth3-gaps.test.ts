import { beforeEach, expect, test } from 'vitest';
import { prisma } from '../src/lib/prisma.ts';
import {
  type Agent,
  auditCount,
  login,
  PASSWORD,
  seedWorld,
  signIn,
  type World,
} from './setup/qa-sprint5-fixtures.ts';

// QA gap tests for AUTH-3 (user management): what deactivation, reactivation, role changes, and
// password resets mean for signing in (ARCH 5, BR 15), SPEC 7 bounds, and mass assignment.

let world: World;

beforeEach(async () => {
  world = await seedWorld();
});

const send = (agent: Agent, method: 'post' | 'patch' | 'put', path: string, body: object) =>
  agent[method](path).set('X-Requested-With', 'fetch').send(body);

test('AUTH-3, ARCH 5: a deactivated user cannot sign in; reactivated, they can again; both audited', async () => {
  const ana = await signIn('ana');
  await send(ana, 'patch', `/api/users/${world.halId}`, { active: false }).expect(200);

  const refused = await login('hal', PASSWORD);
  expect(refused.status).toBe(401);
  expect(refused.headers['set-cookie']).toBeUndefined();

  await send(ana, 'patch', `/api/users/${world.halId}`, { active: true }).expect(200);
  await login('hal', PASSWORD).expect(200);

  const entries = await prisma.auditLog.findMany({
    where: { action: 'USER_UPDATED', entityId: world.halId },
    orderBy: { createdAt: 'asc' },
  });
  expect(entries.map((e) => [e.before, e.after])).toEqual([
    [{ active: true }, { active: false }],
    [{ active: false }, { active: true }],
  ]);
});

test('ARCH 5: deactivating one user leaves the admin and other users signed in', async () => {
  const ana = await signIn('ana');
  const vic = await signIn('vic');
  const hal = await signIn('hal');
  await send(ana, 'patch', `/api/users/${world.halId}`, { active: false }).expect(200);

  await hal.get('/api/auth/me').expect(401);
  await ana.get('/api/auth/me').expect(200);
  await vic.get('/api/auth/me').expect(200);
});

test('ARCH 5: after a role change from handler to viewer, the user signs in again and checkout is 403', async () => {
  const ana = await signIn('ana');
  await send(ana, 'patch', `/api/users/${world.halId}`, { role: 'VIEWER' }).expect(200);

  const hal = await signIn('hal');
  expect((await hal.get('/api/auth/me').expect(200)).body.user.role).toBe('VIEWER');
  const checkout = await send(hal, 'post', '/api/transactions', {
    borrowerId: world.borrowerId,
    locationId: world.roomId,
    lines: [{ itemId: world.cordId, quantity: 1 }],
  });
  expect(checkout.status).toBe(403);
  expect(await prisma.transaction.count()).toBe(0);
});

test('AUTH-3: after an admin resets a password, the old one fails and the new one works', async () => {
  const ana = await signIn('ana');
  const fresh = 'brand-new-password-42';
  await send(ana, 'put', `/api/users/${world.halId}/password`, { password: fresh }).expect(204);
  expect((await login('hal', PASSWORD)).status).toBe(401);
  await login('hal', fresh).expect(200);
});

test('AUTH-3: an admin may deactivate another admin', async () => {
  const ana = await signIn('ana');
  const other = await send(ana, 'post', '/api/users', {
    name: 'Second Admin',
    username: 'second',
    role: 'ADMIN',
    password: 'another-long-password',
  }).expect(201);
  const res = await send(ana, 'patch', `/api/users/${other.body.user.id}`, { active: false });
  expect(res.status).toBe(200);
  expect(res.body.user.active).toBe(false);
});

test('BACKLOG AUTH-3: a self-deactivation that also renames is refused whole: nothing saved or audited', async () => {
  const ana = await signIn('ana');
  const res = await send(ana, 'patch', `/api/users/${world.adminId}`, {
    name: 'Renamed Admin',
    active: false,
  });
  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe('CANNOT_DEACTIVATE_SELF');
  const me = await prisma.user.findUniqueOrThrow({ where: { id: world.adminId } });
  expect([me.name, me.active]).toEqual(['Ana Admin', true]);
  expect(await auditCount('USER_UPDATED')).toBe(0);
  await ana.get('/api/auth/me').expect(200);
});

test('mass assignment: an edit cannot set the password hash or the password', async () => {
  const ana = await signIn('ana');
  const before = await prisma.user.findUniqueOrThrow({ where: { id: world.halId } });
  await send(ana, 'patch', `/api/users/${world.halId}`, {
    name: 'Hal Handler',
    passwordHash: 'not-a-hash',
    password: 'sneaky-new-password',
  });
  const after = await prisma.user.findUniqueOrThrow({ where: { id: world.halId } });
  expect(after.passwordHash).toBe(before.passwordHash);
  await login('hal', PASSWORD).expect(200);
});

test('mass assignment: a create cannot make a user inactive or pick their id', async () => {
  const ana = await signIn('ana');
  const id = '11111111-1111-4111-8111-111111111111';
  const res = await send(ana, 'post', '/api/users', {
    id,
    name: 'New Handler',
    username: 'newbie',
    role: 'HANDLER',
    password: 'another-long-password',
    active: false,
  });
  expect(res.status).toBe(201);
  expect(res.body.user.id).not.toBe(id);
  expect(res.body.user.active).toBe(true);
});

test('SPEC 7: a 201-character name, a 201-character password, and a control character in a username are refused', async () => {
  const ana = await signIn('ana');
  const base = { name: 'A User', username: 'auser', role: 'HANDLER', password: 'long-enough-pass' };
  for (const [field, body] of [
    ['name', { ...base, name: 'n'.repeat(201) }],
    ['password', { ...base, password: 'p'.repeat(201) }],
    ['username', { ...base, username: 'a\u0007user' }],
  ] as const) {
    const res = await send(ana, 'post', '/api/users', body);
    expect(res.status, field).toBe(400);
    expect(res.body.error.details.fields[field], field).toBeDefined();
  }
  const reset = await send(ana, 'put', `/api/users/${world.halId}/password`, { password: 'short' });
  expect(reset.status).toBe(400);
  expect(await prisma.user.count()).toBe(3);
  expect(await auditCount('USER_CREATED')).toBe(0);
  expect(await auditCount('USER_PASSWORD_RESET')).toBe(0);
});

test('SPEC 7: the users list refuses page size 101 and accepts 100', async () => {
  const ana = await signIn('ana');
  const over = await ana.get('/api/users?pageSize=101');
  expect(over.status).toBe(400);
  expect(over.body.error.code).toBe('VALIDATION_ERROR');
  await ana.get('/api/users?pageSize=100').expect(200);
});

test('AUTH-3: editing or resetting an unknown user is 404 and audits nothing', async () => {
  const ana = await signIn('ana');
  const unknown = '00000000-0000-4000-8000-000000000000';
  expect((await send(ana, 'patch', `/api/users/${unknown}`, { name: 'X Y' })).status).toBe(404);
  expect(
    (await send(ana, 'put', `/api/users/${unknown}/password`, { password: 'long-enough-pass' }))
      .status,
  ).toBe(404);
  expect(await prisma.auditLog.count()).toBe(0);
});

test('BR 14: an edit that changes nothing writes no audit entry and signs nobody out', async () => {
  const ana = await signIn('ana');
  const hal = await signIn('hal');
  await send(ana, 'patch', `/api/users/${world.halId}`, {
    name: 'Hal Handler',
    role: 'HANDLER',
    active: true,
  }).expect(200);
  expect(await auditCount('USER_UPDATED')).toBe(0);
  await hal.get('/api/auth/me').expect(200);
});
