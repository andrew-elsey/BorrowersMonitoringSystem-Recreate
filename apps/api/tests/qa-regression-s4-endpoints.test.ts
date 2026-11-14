import type { Role } from '@bms/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { resetDatabase } from './setup/reset-database.ts';

// QA regression, Sprint 4: the endpoints added by BRW-5, FLG-2, FLG-3 and FLG-4 against the
// SPEC.md 3 permission table for every role and a signed-out visitor, plus the CSRF header on the
// state-changing ones (ARCH 5) and the standard error format (ARCH 7). The Sprint 1-3 endpoints
// are in qa-regression-endpoints.test.ts. Allowed calls use an unknown id or an empty database,
// so the matrix changes no data.

type Method = 'get' | 'post';
const PASSWORD = 'correct-horse-battery';
const ROLES: Role[] = ['ADMIN', 'HANDLER', 'VIEWER'];
const ADMIN_AND_HANDLER: Role[] = ['ADMIN', 'HANDLER'];
const ADMIN_ONLY: Role[] = ['ADMIN'];
const NO_SUCH_ID = randomUUID();

// SPEC.md 3, copied by hand so the routes are checked against the spec.
const ENDPOINTS: [Method, string, Role[]][] = [
  ['get', '/api/returns/open', ADMIN_AND_HANDLER], // BRW-5
  ['get', `/api/borrowers/${NO_SUCH_ID}/strikes`, ADMIN_AND_HANDLER], // FLG-3
  ['get', '/api/flags', ADMIN_ONLY], // FLG-4
  ['post', `/api/flags/${NO_SUCH_ID}/override`, ADMIN_ONLY], // FLG-4, S18
  ['post', '/api/flagging/run', ADMIN_ONLY], // FLG-2
];

let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  await resetDatabase();
  await prisma.user.createMany({
    data: ROLES.map((role) => ({
      name: `Reg4 ${role}`,
      username: `reg4-${role}`,
      passwordHash,
      role,
    })),
  });
  await prisma.setting.create({ data: { id: 1 } });
});

async function signIn(role: Role) {
  // A new app per sign-in, so the once-a-minute flagging limit starts fresh.
  const agent = request.agent(createApp());
  await agent
    .post('/api/auth/login')
    .set('X-Requested-With', 'fetch')
    .send({ username: `reg4-${role}`, password: PASSWORD })
    .expect(200);
  return agent;
}

function expectStandardError(res: request.Response, status: number, code: string, label: string) {
  expect(res.status, label).toBe(status);
  expect(res.body, label).toEqual({
    error: { code, message: expect.any(String), details: expect.any(Object) },
  });
}

describe.each(ROLES)('signed in as %s', (role) => {
  test('every Sprint 4 endpoint is allowed or refused with 403 FORBIDDEN per SPEC.md 3, never a 500', async () => {
    const agent = await signIn(role);
    for (const [method, path, allowed] of ENDPOINTS) {
      const label = `${role} ${method.toUpperCase()} ${path}`;
      const res = await agent[method](path).set('X-Requested-With', 'fetch').send({});
      if (allowed.includes(role)) {
        expect([401, 403], label).not.toContain(res.status);
        expect(res.status, label).toBeLessThan(500);
        if (res.status >= 400) expectStandardError(res, res.status, res.body.error?.code, label);
      } else {
        expectStandardError(res, 403, 'FORBIDDEN', label);
      }
    }
    expect(await prisma.auditLog.count()).toBe(0);
  });
});

test('every Sprint 4 endpoint answers 401 UNAUTHENTICATED when signed out', async () => {
  const app = createApp();
  for (const [method, path] of ENDPOINTS) {
    const res = await request(app)[method](path).set('X-Requested-With', 'fetch').send({});
    expectStandardError(res, 401, 'UNAUTHENTICATED', `${method} ${path}`);
  }
});

test('the Sprint 4 state-changing endpoints refuse an admin request without X-Requested-With (ARCH 5)', async () => {
  const agent = await signIn('ADMIN');
  for (const [method, path] of ENDPOINTS.filter(([m]) => m === 'post')) {
    expectStandardError(await agent[method](path).send({}), 403, 'FORBIDDEN', path);
  }
});
