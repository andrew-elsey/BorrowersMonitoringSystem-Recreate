import type { Role } from '@bms/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { resetDatabase } from './setup/reset-database.ts';

// QA regression, Sprints 1 to 3: every real endpoint (not the probe routes in roles.test.ts)
// against the SPEC.md 3 permission table for each role and for a signed-out visitor, the CSRF
// header (ARCH 5), the standard error format (ARCH 7, CLAUDE.md rule 10), and the SEC-1 limits on
// the BRW-2, BRW-3, and BRW-4 endpoints (ARCH 12.3, SPEC 7). Requests the matrix allows carry a
// body the endpoint refuses or an id that does not exist, so the matrix changes no data.

type App = ReturnType<typeof createApp>;
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
const PASSWORD = 'correct-horse-battery';
const ROLES: Role[] = ['ADMIN', 'HANDLER', 'VIEWER'];
const ALL = ROLES;
const ADMIN_AND_HANDLER: Role[] = ['ADMIN', 'HANDLER'];
const ADMIN_ONLY: Role[] = ['ADMIN'];
const NO_SUCH_ID = randomUUID();

// SPEC.md 3, by endpoint. Copied by hand so the routes are checked against the spec.
const ENDPOINTS: [Method, string, Role[]][] = [
  ['get', '/api/auth/me', ALL],
  ['put', '/api/auth/password', ALL],
  ['get', '/api/categories', ADMIN_ONLY],
  ['post', '/api/categories', ADMIN_ONLY],
  ['put', `/api/categories/${NO_SUCH_ID}`, ADMIN_ONLY],
  ['delete', `/api/categories/${NO_SUCH_ID}`, ADMIN_ONLY],
  ['get', '/api/borrowers/lookup?q=zz', ADMIN_AND_HANDLER],
  ['get', '/api/borrowers', ADMIN_ONLY],
  ['get', '/api/borrowers?q=zz', ADMIN_ONLY],
  ['post', '/api/borrowers', ADMIN_ONLY],
  ['patch', `/api/borrowers/${NO_SUCH_ID}`, ADMIN_ONLY],
  ['get', '/api/items', ALL],
  ['get', '/api/items?q=zz', ALL],
  ['post', '/api/items', ADMIN_ONLY],
  ['patch', `/api/items/${NO_SUCH_ID}`, ADMIN_ONLY],
  ['delete', `/api/items/${NO_SUCH_ID}`, ADMIN_ONLY],
  ['get', '/api/rooms', ADMIN_AND_HANDLER],
  ['post', '/api/rooms', ADMIN_AND_HANDLER],
  ['patch', `/api/rooms/${NO_SUCH_ID}`, ADMIN_ONLY],
  ['delete', `/api/rooms/${NO_SUCH_ID}`, ADMIN_ONLY],
  ['get', '/api/closing-time', ALL],
  ['get', '/api/settings', ADMIN_ONLY],
  ['put', '/api/settings', ADMIN_ONLY],
  ['get', '/api/semesters', ADMIN_ONLY],
  ['post', '/api/semesters', ADMIN_ONLY],
  ['put', `/api/semesters/${NO_SUCH_ID}`, ADMIN_ONLY],
  ['post', `/api/semesters/${NO_SUCH_ID}/current`, ADMIN_ONLY],
  ['post', '/api/transactions', ADMIN_AND_HANDLER],
  ['post', '/api/returns', ADMIN_AND_HANDLER],
];
const STATE_CHANGING = ENDPOINTS.filter(([method]) => method !== 'get');

let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  await resetDatabase();
  await prisma.user.createMany({
    data: ROLES.map((role) => ({
      name: `Reg ${role}`,
      username: `reg-${role}`,
      passwordHash,
      role,
    })),
  });
  // The seed creates the one settings row (defaults); the reset above emptied it.
  await prisma.setting.create({ data: { id: 1 } });
});

async function signIn(app: App, role: Role, ip = '10.9.0.1') {
  const agent = request.agent(app);
  await agent
    .post('/api/auth/login')
    .set('X-Requested-With', 'fetch')
    .set('X-Forwarded-For', ip)
    .send({ username: `reg-${role}`, password: PASSWORD })
    .expect(200);
  return agent;
}

const call = (
  agent: ReturnType<typeof request.agent> | ReturnType<typeof request>,
  method: Method,
  path: string,
) => agent[method](path).set('X-Requested-With', 'fetch').send({});

// ARCH 7: exactly { error: { code, message, details } }, as JSON.
function expectStandardError(res: request.Response, status: number, code: string, label: string) {
  expect(res.status, label).toBe(status);
  expect(res.headers['content-type'], label).toMatch(/^application\/json/);
  expect(Object.keys(res.body), label).toEqual(['error']);
  expect(res.body.error, label).toEqual({
    code,
    message: expect.any(String),
    details: expect.any(Object),
  });
  expect(res.body.error.message.length, label).toBeGreaterThan(0);
}

describe.each(ROLES)('signed in as %s', (role) => {
  test('every endpoint is allowed or refused with 403 FORBIDDEN per SPEC.md 3, never a 500', async () => {
    const app = createApp();
    const agent = await signIn(app, role);
    for (const [method, path, allowed] of ENDPOINTS) {
      const label = `${role} ${method.toUpperCase()} ${path}`;
      const res = await call(agent, method, path);
      if (allowed.includes(role)) {
        expect([401, 403], label).not.toContain(res.status);
        expect(res.status, label).toBeLessThan(500);
        // Every refusal of an allowed call (bad body, unknown id) is in the standard format too.
        if (res.status >= 400) expectStandardError(res, res.status, res.body.error?.code, label);
      } else {
        expectStandardError(res, 403, 'FORBIDDEN', label);
      }
    }
    // The matrix changed nothing.
    expect(await prisma.auditLog.count()).toBe(0);
  });
});

test('every endpoint answers 401 UNAUTHENTICATED in the standard format when signed out', async () => {
  const app = createApp();
  for (const [method, path] of ENDPOINTS) {
    expectStandardError(
      await call(request(app), method, path),
      401,
      'UNAUTHENTICATED',
      `${method} ${path}`,
    );
  }
});

test('every state-changing endpoint refuses an admin request without X-Requested-With: fetch (CSRF, ARCH 5)', async () => {
  const app = createApp();
  const agent = await signIn(app, 'ADMIN');
  for (const [method, path] of STATE_CHANGING) {
    const res = await agent[method](path).send({});
    expectStandardError(res, 403, 'FORBIDDEN', `${method} ${path}`);
  }
});

test.each([
  ['delete', `/api/borrowers/${NO_SUCH_ID}`],
  ['delete', `/api/semesters/${NO_SUCH_ID}`],
  ['put', '/api/closing-time'],
  ['get', '/api/transactions'],
] as const)(
  'an admin calling %s %s, which does not exist (BR 15: never deleted), gets 404 NOT_FOUND in the standard format',
  async (method, path) => {
    const agent = await signIn(createApp(), 'ADMIN');
    expectStandardError(await call(agent, method, path), 404, 'NOT_FOUND', path);
  },
);

test.each([
  ['patch', '/api/items/not-a-uuid'],
  ['patch', '/api/rooms/not-a-uuid'],
  ['patch', '/api/borrowers/not-a-uuid'],
  ['put', '/api/categories/not-a-uuid'],
  ['put', '/api/semesters/not-a-uuid'],
] as const)('%s %s with a bad id is 400 VALIDATION_ERROR, not a 500', async (method, path) => {
  const agent = await signIn(createApp(), 'ADMIN');
  expectStandardError(await call(agent, method, path), 400, 'VALIDATION_ERROR', path);
});

describe('SEC-1 limits on the checkout endpoints (ARCH 12.3, SPEC 7)', () => {
  const SEARCH_LIMIT = 60;
  const GLOBAL_LIMIT = 600;

  test('the checkout borrower lookup is exempt from the search limit: 70 lookups in a minute all succeed (owner decision 2026-11-07)', async () => {
    const handler = await signIn(createApp(), 'HANDLER');
    for (let i = 0; i < SEARCH_LIMIT + 10; i++) {
      const res = await handler
        .get('/api/borrowers/lookup?q=ana')
        .set('X-Forwarded-For', '10.9.0.1');
      expect(res.status, `lookup ${i + 1}`).toBe(200);
    }
  });

  test('lookups do not use up the item search count, and an exhausted item search leaves the lookup working', async () => {
    const handler = await signIn(createApp(), 'HANDLER');
    const get = (path: string) => handler.get(path).set('X-Forwarded-For', '10.9.0.1');
    for (let i = 0; i < SEARCH_LIMIT + 5; i++) await get('/api/borrowers/lookup?q=ana').expect(200);
    for (let i = 0; i < SEARCH_LIMIT; i++) {
      expect((await get('/api/items?q=lap')).status, `item search ${i + 1}`).toBe(200);
    }
    expectStandardError(await get('/api/items?q=lap'), 429, 'RATE_LIMITED', 'item search 61');
    await get('/api/borrowers/lookup?q=ana').expect(200);
  });

  test('the global limit still covers the lookup: request 601 in a minute is 429 RATE_LIMITED with Retry-After', async () => {
    const handler = await signIn(createApp(), 'HANDLER', '10.9.0.2');
    const lookup = () =>
      handler.get('/api/borrowers/lookup?q=ana').set('X-Forwarded-For', '10.9.0.2');
    // The login used one request of the 600. Batches of 5: supertest adds listeners to the agent's
    // server for each request waiting on it, and a batch of 10 or more prints MaxListenersExceededWarning.
    const BATCH = 5;
    let ok = 0;
    for (let sent = 1; sent < GLOBAL_LIMIT; sent += BATCH) {
      const batch = Math.min(BATCH, GLOBAL_LIMIT - sent);
      const replies = await Promise.all(Array.from({ length: batch }, lookup));
      ok += replies.filter((res) => res.status === 200).length;
    }
    expect(ok).toBe(GLOBAL_LIMIT - 1);
    const over = await lookup();
    expectStandardError(over, 429, 'RATE_LIMITED', 'lookup 601');
    expect(over.headers['retry-after']).toMatch(/^\d+$/);
  });

  test.each([
    ['post', '/api/transactions'],
    ['post', '/api/returns'],
    ['post', '/api/rooms'],
    ['get', '/api/borrowers/lookup?q=ana'],
  ] as const)(
    '%s %s with a body over 100 kB is 413 PAYLOAD_TOO_LARGE and nothing is written (SPEC 7, S21)',
    async (method, path) => {
      const handler = await signIn(createApp(), 'HANDLER');
      const res = await handler[method](path)
        .set('X-Requested-With', 'fetch')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ name: 'x'.repeat(101 * 1024) }));
      expectStandardError(res, 413, 'PAYLOAD_TOO_LARGE', path);
      expect(await prisma.auditLog.count()).toBe(0);
    },
  );

  test('a checkout of exactly 50 lines, the SPEC 7 maximum, is accepted and creates 50 lines', async () => {
    const adminId = (await prisma.user.findUniqueOrThrow({ where: { username: 'reg-ADMIN' } })).id;
    const categoryId = (await prisma.category.create({ data: { name: 'Reg Category' } })).id;
    const items = await prisma.item.createManyAndReturn({
      data: Array.from({ length: 50 }, (_, i) => ({
        name: `Reg Cord ${i}`,
        categoryId,
        trackingType: 'QUANTITY' as const,
        totalQuantity: 1,
        condition: 'GOOD' as const,
        status: 'ACTIVE' as const,
      })),
    });
    const borrowerId = (
      await prisma.borrower.create({
        data: { schoolId: 'REG-0050', name: 'Test Borrower', type: 'STUDENT', department: 'QA' },
      })
    ).id;
    const locationId = (
      await prisma.location.create({ data: { name: 'Reg Lab', createdById: adminId } })
    ).id;
    await prisma.semester.create({
      data: {
        name: 'Reg S1',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-12-15'),
        isCurrent: true,
      },
    });
    const handler = await signIn(createApp(), 'HANDLER');
    const res = await handler
      .post('/api/transactions')
      .set('X-Requested-With', 'fetch')
      .send({
        borrowerId,
        locationId,
        lines: items.map((item) => ({ itemId: item.id, quantity: 1 })),
      })
      .expect(201);
    expect(res.body.transaction.lines).toHaveLength(50);
    expect(await prisma.transactionItem.count()).toBe(50);
  });
});
