import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { resetDatabase } from './setup/reset-database.ts';

// BRW-4: return API (BR 5, 6, 11, 14; S3, S15, S17). Test cases TC-BRW-20 to TC-BRW-26 in
// TEST_CASES.md.

const PASSWORD = 'correct-horse-battery';
let passwordHash: string;
let hal: ReturnType<typeof request.agent>;
let halId: string;
let hanaId: string;
let borrowerId: string;
let locationId: string;
let semesterId: string;
let categoryId: string;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  await resetDatabase();
  const users = await prisma.user.createManyAndReturn({
    data: [
      { name: 'Hal Handler', username: 'hal', passwordHash, role: 'HANDLER' },
      { name: 'Hana Handler', username: 'hana', passwordHash, role: 'HANDLER' },
      { name: 'Vic Viewer', username: 'vic', passwordHash, role: 'VIEWER' },
    ],
  });
  halId = users.find((user) => user.username === 'hal')!.id;
  hanaId = users.find((user) => user.username === 'hana')!.id;
  borrowerId = (
    await prisma.borrower.create({
      data: { schoolId: '2026-0003', name: 'Cara Student', type: 'STUDENT', department: 'IT' },
    })
  ).id;
  locationId = (await prisma.location.create({ data: { name: 'CL-201', createdById: halId } })).id;
  semesterId = (
    await prisma.semester.create({
      data: {
        name: 'S1',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-12-15'),
        isCurrent: true,
      },
    })
  ).id;
  categoryId = (await prisma.category.create({ data: { name: 'Equipment' } })).id;
  hal = await signIn('hal');
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

type Entry = { lineId: string; quantity: number; condition: string };
const giveBack = (agent: typeof hal, lines: Entry[]) =>
  agent.post('/api/returns').set('X-Requested-With', 'fetch').send({ lines });

const laptop = (assetTag = 'LT-001') =>
  prisma.item.create({
    data: {
      name: 'Laptop',
      categoryId,
      trackingType: 'UNIT',
      assetTag,
      totalQuantity: 1,
      condition: 'GOOD',
    },
  });
const cords = () =>
  prisma.item.create({
    data: {
      name: 'Extension cord',
      categoryId,
      trackingType: 'QUANTITY',
      totalQuantity: 10,
      condition: 'GOOD',
    },
  });

// A line issued by Hal, created directly so these tests do not depend on the checkout API.
async function issue(
  itemId: string,
  quantityBorrowed: number,
  flagStatus: 'NONE' | 'FLAGGED' = 'NONE',
) {
  const transaction = await prisma.transaction.create({
    data: {
      borrowerId,
      locationId,
      issuedById: halId,
      semesterId,
      lines: { create: { itemId, quantityBorrowed, flagStatus } },
    },
    include: { lines: true },
  });
  return transaction.lines[0]!;
}

const lineById = (id: string) => prisma.transactionItem.findUniqueOrThrow({ where: { id } });

test('TC-BRW-20: return a line in full; event has quantity, time, condition, handler from the session; audited (BR 5, 14)', async () => {
  const line = await issue((await laptop()).id, 1);
  const before = Date.now();
  const res = await giveBack(hal, [{ lineId: line.id, quantity: 1, condition: 'GOOD' }]).expect(
    201,
  );

  const [event] = res.body.returns;
  expect(event).toMatchObject({
    lineId: line.id,
    quantity: 1,
    condition: 'GOOD',
    receivedById: halId,
    outstanding: 0,
  });
  expect(Date.parse(event.returnedAt)).toBeGreaterThanOrEqual(before - 1000);
  expect(Date.parse(event.returnedAt)).toBeLessThanOrEqual(Date.now() + 1000);
  expect(await prisma.return.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({
    transactionItemId: line.id,
    quantity: 1,
    condition: 'GOOD',
    receivedById: halId,
  });
  expect((await lineById(line.id)).quantityReturned).toBe(1);
  const entries = await prisma.auditLog.findMany({ where: { entityId: event.id } });
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    actorId: halId,
    action: 'RETURN',
    entity: 'return',
    after: event,
  });
});

test('the receiving handler cannot be typed in the body (BR 5)', async () => {
  const line = await issue((await laptop()).id, 1);
  const res = await hal
    .post('/api/returns')
    .set('X-Requested-With', 'fetch')
    .send({ lines: [{ lineId: line.id, quantity: 1, condition: 'GOOD', receivedById: hanaId }] })
    .expect(201);
  expect(res.body.returns[0].receivedById).toBe(halId);
});

test('TC-BRW-21: handler B returns an item issued by handler A (BR 5)', async () => {
  const line = await issue((await laptop()).id, 1);
  const hana = await signIn('hana');
  const res = await giveBack(hana, [{ lineId: line.id, quantity: 1, condition: 'GOOD' }]).expect(
    201,
  );
  expect(res.body.returns[0].receivedById).toBe(hanaId);
  const transaction = await prisma.transaction.findUniqueOrThrow({
    where: { id: line.transactionId },
  });
  expect(transaction.issuedById).toBe(halId);
});

test('TC-BRW-22: Cara borrows 5 cords and returns 3, then the last 2 (BR 5, S3)', async () => {
  const line = await issue((await cords()).id, 5);
  const first = await giveBack(hal, [{ lineId: line.id, quantity: 3, condition: 'GOOD' }]).expect(
    201,
  );
  expect(first.body.returns[0].outstanding).toBe(2);
  expect(await lineById(line.id)).toMatchObject({ quantityReturned: 3, flagStatus: 'NONE' });

  const second = await giveBack(hal, [{ lineId: line.id, quantity: 2, condition: 'FAIR' }]).expect(
    201,
  );
  expect(second.body.returns[0].outstanding).toBe(0);
  expect((await lineById(line.id)).quantityReturned).toBe(5);
  // quantity_returned is the sum of the return events (SPEC 4).
  const events = await prisma.return.findMany({ where: { transactionItemId: line.id } });
  expect(events.map((event) => event.quantity).sort()).toEqual([2, 3]);
});

test('TC-BRW-23: returning a flagged line in full leaves it FLAGGED (BR 6, S3)', async () => {
  const line = await issue((await cords()).id, 5, 'FLAGGED');
  await giveBack(hal, [{ lineId: line.id, quantity: 5, condition: 'GOOD' }]).expect(201);
  expect(await lineById(line.id)).toMatchObject({ quantityReturned: 5, flagStatus: 'FLAGGED' });
});

test('returning an unflagged line never sets a flag (BR 6)', async () => {
  const line = await issue((await cords()).id, 5);
  await giveBack(hal, [{ lineId: line.id, quantity: 2, condition: 'GOOD' }]).expect(201);
  expect(await lineById(line.id)).toMatchObject({ flagStatus: 'NONE', flaggedAt: null });
});

test('TC-BRW-24: returning more than is outstanding fails; nothing is recorded (S15)', async () => {
  const line = await issue((await cords()).id, 5);
  await giveBack(hal, [{ lineId: line.id, quantity: 3, condition: 'GOOD' }]).expect(201);

  const over = await giveBack(hal, [{ lineId: line.id, quantity: 3, condition: 'GOOD' }]).expect(
    409,
  );
  expect(over.body.error).toMatchObject({
    code: 'RETURN_EXCEEDS_OUTSTANDING',
    message:
      'You entered 3 of Extension cord, but the amount still out on this line is 2. Nothing was recorded.',
    details: { lineId: line.id, outstanding: 2 },
  });

  await giveBack(hal, [{ lineId: line.id, quantity: 2, condition: 'GOOD' }]).expect(201);
  const none = await giveBack(hal, [{ lineId: line.id, quantity: 1, condition: 'GOOD' }]).expect(
    409,
  );
  expect(none.body.error).toMatchObject({
    code: 'RETURN_EXCEEDS_OUTSTANDING',
    details: { outstanding: 0 },
  });
  expect(await prisma.return.count()).toBe(2);
  expect((await lineById(line.id)).quantityReturned).toBe(5);
});

test('TC-BRW-25: a DAMAGED unit laptop marks the item DAMAGED, status stays ACTIVE; a quantity item keeps its condition (S17)', async () => {
  const item = await laptop();
  const supply = await cords();
  const unitLine = await issue(item.id, 1);
  const cordLine = await issue(supply.id, 2);
  const res = await giveBack(hal, [
    { lineId: unitLine.id, quantity: 1, condition: 'DAMAGED' },
    { lineId: cordLine.id, quantity: 2, condition: 'DAMAGED' },
  ]).expect(201);

  expect(res.body.returns.map((event: { condition: string }) => event.condition)).toEqual([
    'DAMAGED',
    'DAMAGED',
  ]);
  expect(await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({
    condition: 'DAMAGED',
    status: 'ACTIVE',
  });
  expect((await prisma.item.findUniqueOrThrow({ where: { id: supply.id } })).condition).toBe(
    'GOOD',
  );
  const itemEntries = await prisma.auditLog.findMany({ where: { entityId: item.id } });
  expect(itemEntries).toHaveLength(1);
  expect(itemEntries[0]).toMatchObject({
    actorId: halId,
    action: 'ITEM_UPDATED',
    entity: 'item',
    before: { condition: 'GOOD' },
    after: { condition: 'DAMAGED' },
  });
});

test('returning an already DAMAGED laptop as DAMAGED again writes no second item change (S17)', async () => {
  const item = await laptop();
  const first = await issue(item.id, 1);
  await giveBack(hal, [{ lineId: first.id, quantity: 1, condition: 'DAMAGED' }]).expect(201);
  const second = await issue(item.id, 1);
  await giveBack(hal, [{ lineId: second.id, quantity: 1, condition: 'DAMAGED' }]).expect(201);

  expect((await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).condition).toBe(
    'DAMAGED',
  );
  const itemEntries = await prisma.auditLog.findMany({
    where: { entityId: item.id, action: 'ITEM_UPDATED' },
  });
  expect(itemEntries).toHaveLength(1);
  expect(itemEntries[0]).toMatchObject({ before: { condition: 'GOOD' } });
});

test('a GOOD return does not change the item condition', async () => {
  const item = await laptop();
  await prisma.item.update({ where: { id: item.id }, data: { condition: 'FAIR' } });
  const line = await issue(item.id, 1);
  await giveBack(hal, [{ lineId: line.id, quantity: 1, condition: 'GOOD' }]).expect(201);
  expect((await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).condition).toBe('FAIR');
});

test('TC-BRW-26: a borrower with 5 flagged transactions (and inactive) can still return (BR 11)', async () => {
  // Strikes are counted in FLG-1 and blocking comes in FLG-3. Five transactions with a FLAGGED line
  // are 5 strikes by BR 10; the return service has no borrower check, so this stays true then.
  const supply = await cords();
  const lines = [];
  for (let i = 0; i < 5; i += 1) lines.push(await issue(supply.id, 1, 'FLAGGED'));
  await prisma.borrower.update({ where: { id: borrowerId }, data: { active: false } });
  await giveBack(
    hal,
    lines.map((line) => ({ lineId: line.id, quantity: 1, condition: 'GOOD' })),
  ).expect(201);
  expect(await prisma.return.count()).toBe(5);
});

test('two returns of the same line at once: exactly one passes the outstanding check (BR 5)', async () => {
  const line = await issue((await cords()).id, 5);
  const hana = await signIn('hana');
  const results = await Promise.all([
    giveBack(hal, [{ lineId: line.id, quantity: 3, condition: 'GOOD' }]),
    giveBack(hana, [{ lineId: line.id, quantity: 3, condition: 'GOOD' }]),
  ]);
  expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
  expect(results.find((res) => res.status === 409)!.body.error.code).toBe(
    'RETURN_EXCEEDS_OUTSTANDING',
  );
  expect((await lineById(line.id)).quantityReturned).toBe(3);
  expect(await prisma.return.count()).toBe(1);
});

test('one bad line fails the whole return; nothing is recorded', async () => {
  const good = await issue((await laptop()).id, 1);
  const bad = await issue((await cords()).id, 2);
  await giveBack(hal, [
    { lineId: good.id, quantity: 1, condition: 'DAMAGED' },
    { lineId: bad.id, quantity: 3, condition: 'GOOD' },
  ]).expect(409);
  expect(await prisma.return.count()).toBe(0);
  expect((await lineById(good.id)).quantityReturned).toBe(0);
  expect((await prisma.item.findUniqueOrThrow({ where: { id: good.itemId } })).condition).toBe(
    'GOOD',
  );
  expect(await prisma.auditLog.count()).toBe(0);
});

test('an unknown line is NOT_FOUND; ids in upper case work', async () => {
  const missing = await giveBack(hal, [{ lineId: randomUUID(), quantity: 1, condition: 'GOOD' }]);
  expect(missing.status).toBe(404);
  expect(missing.body.error.code).toBe('NOT_FOUND');
  const line = await issue((await laptop()).id, 1);
  await giveBack(hal, [{ lineId: line.id.toUpperCase(), quantity: 1, condition: 'GOOD' }]).expect(
    201,
  );
});

test('input limits: quantity, condition, line count, repeated lines (SPEC 7)', async () => {
  const line = await issue((await cords()).id, 5);
  const bad = async (body: object) => {
    const res = await hal.post('/api/returns').set('X-Requested-With', 'fetch').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  };
  await bad({ lines: [] });
  await bad({ lines: [{ lineId: line.id, quantity: 0, condition: 'GOOD' }] });
  await bad({ lines: [{ lineId: line.id, quantity: 1.5, condition: 'GOOD' }] });
  await bad({ lines: [{ lineId: line.id, quantity: 10_001, condition: 'GOOD' }] });
  await bad({ lines: [{ lineId: line.id, quantity: 1, condition: 'NEW' }] });
  await bad({ lines: [{ lineId: 'not-a-uuid', quantity: 1, condition: 'GOOD' }] });
  await bad({
    lines: [
      { lineId: line.id, quantity: 1, condition: 'GOOD' },
      { lineId: line.id, quantity: 1, condition: 'GOOD' },
    ],
  });
  await bad({
    lines: Array.from({ length: 51 }, () => ({
      lineId: randomUUID(),
      quantity: 1,
      condition: 'GOOD',
    })),
  });
  expect(await prisma.return.count()).toBe(0);
});

test('viewers cannot return; signed-out users get 401 (SPEC 3)', async () => {
  const line = await issue((await laptop()).id, 1);
  const entry = [{ lineId: line.id, quantity: 1, condition: 'GOOD' }];
  const viewer = await giveBack(await signIn('vic'), entry);
  expect(viewer.status).toBe(403);
  expect(viewer.body.error.code).toBe('FORBIDDEN');
  const anonymous = await giveBack(request.agent(createApp()), entry);
  expect(anonymous.status).toBe(401);
  expect(await prisma.return.count()).toBe(0);
});
