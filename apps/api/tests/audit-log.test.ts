import request from 'supertest';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { resetDatabase } from './setup/reset-database.ts';

// HRD-1: audit log viewer (BR 14, SPEC 3 and 7). Test cases TC-HRD-01, TC-HRD-02 and
// TC-HRD-12 to TC-HRD-16 in TEST_CASES.md.

const PASSWORD = 'correct-horse-battery';
let passwordHash: string;
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
});

async function login(username: string) {
  const agent = request.agent(createApp());
  await agent
    .post('/api/auth/login')
    .set('X-Requested-With', 'fetch')
    .send({ username, password: PASSWORD })
    .expect(200);
  return agent;
}

const audit = (agent: request.Agent, query: string) =>
  agent.get(`/api/audit?${query}`).set('X-Requested-With', 'fetch');

// One entry written straight in the table, at `at` (an ISO instant).
const entry = (
  at: string,
  fields: { actorId?: string | null; entity?: string; action?: string; entityId?: string } = {},
) =>
  prisma.auditLog.create({
    data: {
      actorId: fields.actorId === undefined ? adminId : fields.actorId,
      action: fields.action ?? 'ITEM_UPDATED',
      entity: fields.entity ?? 'item',
      entityId: fields.entityId ?? 'x',
      before: { condition: 'GOOD' },
      after: { condition: 'FAIR' },
      createdAt: new Date(at),
    },
  });

const ids = (res: request.Response) =>
  res.body.data.map((row: { entityId: string }) => row.entityId);

test('TC-HRD-01: filters by actor, entity, and date, and combines them', async () => {
  await entry('2026-11-02T02:00:00Z', { entityId: 'a', entity: 'item' });
  await entry('2026-11-02T03:00:00Z', { entityId: 'b', entity: 'borrower', actorId: handlerId });
  await entry('2026-11-02T04:00:00Z', { entityId: 'c', entity: 'item', actorId: handlerId });
  await entry('2026-11-05T04:00:00Z', { entityId: 'd', entity: 'item' });
  const ana = await login('ana');

  expect(ids(await audit(ana, 'from=2026-11-02&to=2026-11-02').expect(200))).toEqual([
    'c',
    'b',
    'a',
  ]);
  expect(ids(await audit(ana, 'from=2026-11-02&to=2026-11-05&entity=item').expect(200))).toEqual([
    'd',
    'c',
    'a',
  ]);
  expect(
    ids(await audit(ana, `from=2026-11-02&to=2026-11-05&actor=${handlerId}`).expect(200)),
  ).toEqual(['c', 'b']);
  const both = await audit(ana, `from=2026-11-02&to=2026-11-05&actor=${handlerId}&entity=item`);
  expect(ids(both)).toEqual(['c']);
  expect(both.body).toMatchObject({ page: 1, pageSize: 25, total: 1 });
});

test('TC-HRD-02: a handler and a view-only user get 403, a visitor 401', async () => {
  for (const username of ['hal', 'vic']) {
    const res = await audit(await login(username), 'from=2026-11-02&to=2026-11-02').expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  }
  await request(createApp()).get('/api/audit?from=2026-11-02&to=2026-11-02').expect(401);
});

test('TC-HRD-12: the date range is in Manila days, both ends included', async () => {
  // Manila is UTC+8: 2 Nov runs from 2026-11-01T16:00Z up to, not including, 2026-11-02T16:00Z.
  await entry('2026-11-01T15:59:59.999Z', { entityId: 'before' });
  await entry('2026-11-01T16:00:00.000Z', { entityId: 'first' });
  await entry('2026-11-02T15:59:59.999Z', { entityId: 'last' });
  await entry('2026-11-02T16:00:00.000Z', { entityId: 'after' });
  const res = await audit(await login('ana'), 'from=2026-11-02&to=2026-11-02').expect(200);
  expect(ids(res)).toEqual(['last', 'first']);
});

test('TC-HRD-13: actor=system finds entries with no actor; entries show the actor name, before, and after', async () => {
  await entry('2026-11-02T02:00:00Z', { entityId: 'job', actorId: null, action: 'LINE_FLAGGED' });
  await entry('2026-11-02T03:00:00Z', { entityId: 'staff' });
  const ana = await login('ana');

  const system = await audit(ana, 'from=2026-11-02&to=2026-11-02&actor=system').expect(200);
  expect(ids(system)).toEqual(['job']);
  expect(system.body.data[0]).toMatchObject({ actor: null, action: 'LINE_FLAGGED' });

  const all = await audit(ana, 'from=2026-11-02&to=2026-11-02').expect(200);
  expect(all.body.data[0]).toMatchObject({
    actor: { id: adminId, name: 'Ana Admin' },
    entity: 'item',
    before: { condition: 'GOOD' },
    after: { condition: 'FAIR' },
    createdAt: '2026-11-02T03:00:00.000Z',
  });
  expect(all.body.data[0]).not.toHaveProperty('actorId');
});

test('TC-HRD-14: newest first and paged; a page size over 100 or an unknown filter value is 400', async () => {
  for (let minute = 0; minute < 5; minute++) {
    await entry(`2026-11-02T02:0${minute}:00Z`, { entityId: `e${minute}` });
  }
  const ana = await login('ana');
  const first = await audit(ana, 'from=2026-11-02&to=2026-11-02&pageSize=2').expect(200);
  expect(ids(first)).toEqual(['e4', 'e3']);
  expect(first.body).toMatchObject({ page: 1, pageSize: 2, total: 5 });
  expect(ids(await audit(ana, 'from=2026-11-02&to=2026-11-02&pageSize=2&page=3'))).toEqual(['e0']);

  for (const bad of ['pageSize=101', 'page=0', 'entity=nothing', 'actor=nobody']) {
    const res = await audit(ana, `from=2026-11-02&to=2026-11-02&${bad}`).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  }
  // The fixed entity list includes the flagging run (HRD-1b writes it).
  await audit(ana, 'from=2026-11-02&to=2026-11-02&entity=flagging_run').expect(200);
});

test('TC-HRD-15: a request without a date range, or with more than 366 days, is 400', async () => {
  const ana = await login('ana');
  await audit(ana, '').expect(400);
  await audit(ana, 'from=2026-11-02').expect(400);
  await audit(ana, 'to=2026-11-02').expect(400);
  await audit(ana, 'from=2026-11-03&to=2026-11-02').expect(400);
  await audit(ana, 'from=0000-01-01&to=2026-11-02').expect(400);
  // 2026-01-01 to 2027-01-01 is 366 days (allowed); one more day is not.
  await audit(ana, 'from=2026-01-01&to=2027-01-01').expect(200);
  const long = await audit(ana, 'from=2026-01-01&to=2027-01-02').expect(400);
  expect(long.body.error.code).toBe('VALIDATION_ERROR');
});

test('TC-HRD-16 (ARCH 12.3): the audit log shares the 30 a minute reports limit', async () => {
  const ana = await login('ana');
  for (let i = 0; i < 15; i++) {
    await audit(ana, 'from=2026-11-02&to=2026-11-02').expect(200);
    await ana.get('/api/reports/usage?from=2026-11-02&to=2026-11-02').expect(200);
  }
  const limited = await audit(ana, 'from=2026-11-02&to=2026-11-02').expect(429);
  expect(limited.body.error.code).toBe('RATE_LIMITED');
  // A refused role does not use up the limit: the role check runs first.
  const handler = await login('hal');
  await audit(handler, 'from=2026-11-02&to=2026-11-02').expect(403);
});
