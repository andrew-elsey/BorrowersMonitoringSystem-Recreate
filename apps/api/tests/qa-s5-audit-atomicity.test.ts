import { afterEach, beforeEach, expect, test } from 'vitest';
import { prisma } from '../src/lib/prisma.ts';
import {
  type Agent,
  failAuditFor,
  lend,
  login,
  PASSWORD,
  seedWorld,
  signIn,
  stopFailingAudit,
  type World,
} from './setup/qa-sprint5-fixtures.ts';

// BR 14 for the Sprint 5 state changes: the audit entry is written in the same database
// transaction as the change. A trigger makes the audit insert fail (real PostgreSQL, no mocks);
// the change, and anything done with it such as signing a user out, must roll back too.

let world: World;
let ana: Agent;

beforeEach(async () => {
  world = await seedWorld();
  ana = await signIn('ana');
});

afterEach(async () => {
  await stopFailingAudit();
});

const send = (method: 'post' | 'patch' | 'put', path: string, body: object) =>
  ana[method](path).set('X-Requested-With', 'fetch').send(body);

test('BR 14, BRW-6: a note edit whose audit fails is not saved', async () => {
  const [id] = await lend(world, [{ itemId: world.cordId }]);
  await failAuditFor('LINE_NOTE_UPDATED');
  const res = await send('patch', `/api/lines/${id}`, { note: 'x', expectedReturnDate: null });
  expect(res.status).toBe(500);
  expect(res.body.error.code).toBe('INTERNAL_ERROR');
  expect((await prisma.transactionItem.findUniqueOrThrow({ where: { id: id! } })).note).toBeNull();
});

test('BR 14, AUTH-3: a user create whose audit fails creates no user', async () => {
  await failAuditFor('USER_CREATED');
  const res = await send('post', '/api/users', {
    name: 'New Person',
    username: 'newperson',
    role: 'HANDLER',
    password: 'long-enough-pass',
  });
  expect(res.status).toBe(500);
  expect(await prisma.user.count({ where: { username: 'newperson' } })).toBe(0);
});

test('BR 14, AUTH-3: a deactivation whose audit fails leaves the user active and signed in', async () => {
  const hal = await signIn('hal');
  await failAuditFor('USER_UPDATED');
  expect((await send('patch', `/api/users/${world.halId}`, { active: false })).status).toBe(500);
  expect((await prisma.user.findUniqueOrThrow({ where: { id: world.halId } })).active).toBe(true);
  await hal.get('/api/auth/me').expect(200);
});

test('BR 14, AUTH-3: a password reset whose audit fails keeps the old password and the sessions', async () => {
  const hal = await signIn('hal');
  await failAuditFor('USER_PASSWORD_RESET');
  const res = await send('put', `/api/users/${world.halId}/password`, {
    password: 'brand-new-password-42',
  });
  expect(res.status).toBe(500);
  await login('hal', PASSWORD).expect(200);
  await hal.get('/api/auth/me').expect(200);
});

test('BR 14, MD-6: an import whose summary audit fails saves no borrower', async () => {
  await failAuditFor('BORROWER_IMPORT');
  const res = await ana
    .post('/api/borrowers/import')
    .set('X-Requested-With', 'fetch')
    .attach(
      'file',
      Buffer.from(
        'school_id,name,type,department,active\nQA-1,One,STUDENT,IT,\nQA-2,Two,STUDENT,IT,',
      ),
      'b.csv',
    );
  expect(res.status).toBe(500);
  expect(await prisma.borrower.count()).toBe(1); // only the seeded borrower
  expect(await prisma.auditLog.count({ where: { action: 'BORROWER_CREATED' } })).toBe(0);
});
