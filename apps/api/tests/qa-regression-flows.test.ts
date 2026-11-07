import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { getAvailability } from '../src/services/availability.ts';
import { resetDatabase } from './setup/reset-database.ts';

// QA regression, Sprints 1 to 3: flows where tickets meet for the first time. Every step goes
// through the real HTTP routes: checkout (BRW-2), return (BRW-4), availability as the checkout
// search shows it (BRW-1 via GET /api/items, BRW-3), and master-data edits (MD-2, MD-3, MD-5, MD-7)
// made while a line is still out. Audit atomicity (BR 14) is proved with a temporary trigger that
// makes the audit insert fail.

const PASSWORD = 'correct-horse-battery';
let passwordHash: string;
let admin: Agent;
let handler: Agent;
let borrowerId: string;
let locationId: string;
let categoryId: string;

type Agent = ReturnType<typeof request.agent>;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  await resetDatabase();
  const users = await prisma.user.createManyAndReturn({
    data: [
      { name: 'Reg Admin', username: 'reg-admin', passwordHash, role: 'ADMIN' },
      { name: 'Reg Handler', username: 'reg-handler', passwordHash, role: 'HANDLER' },
    ],
  });
  const handlerId = users.find((u) => u.role === 'HANDLER')!.id;
  borrowerId = (
    await prisma.borrower.create({
      data: { schoolId: 'REG-0001', name: 'Test Borrower', type: 'STUDENT', department: 'QA' },
    })
  ).id;
  locationId = (await prisma.location.create({ data: { name: 'Reg Lab', createdById: handlerId } }))
    .id;
  await prisma.semester.create({
    data: {
      name: 'Reg S1',
      startDate: new Date('2026-08-01'),
      endDate: new Date('2026-12-15'),
      isCurrent: true,
    },
  });
  categoryId = (await prisma.category.create({ data: { name: 'Reg Category' } })).id;
  const app = createApp();
  admin = await signIn(app, 'reg-admin');
  handler = await signIn(app, 'reg-handler');
});

async function signIn(app: ReturnType<typeof createApp>, username: string) {
  const agent = request.agent(app);
  await agent
    .post('/api/auth/login')
    .set('X-Requested-With', 'fetch')
    .send({ username, password: PASSWORD })
    .expect(200);
  return agent;
}

const send = (agent: Agent, method: 'post' | 'patch' | 'put' | 'delete', path: string, body = {}) =>
  agent[method](path).set('X-Requested-With', 'fetch').send(body);

const checkOut = (agent: Agent, lines: { itemId: string; quantity: number }[], room = locationId) =>
  send(agent, 'post', '/api/transactions', { borrowerId, locationId: room, lines });

const giveBack = (
  agent: Agent,
  lines: { lineId: string; quantity: number; condition?: string }[],
) =>
  send(agent, 'post', '/api/returns', {
    lines: lines.map((line) => ({ condition: 'GOOD', ...line })),
  });

// What the checkout item search shows for one item (BRW-3 reads `available` from here).
async function searchedAvailable(agent: Agent, name: string) {
  const res = await agent.get('/api/items').query({ q: name }).expect(200);
  return res.body.data.find((row: { name: string }) => row.name === name)?.available;
}

const createItem = async (body: Record<string, unknown>) =>
  (
    await send(admin, 'post', '/api/items', {
      categoryId,
      condition: 'GOOD',
      status: 'ACTIVE',
      ...body,
    }).expect(201)
  ).body.item;

const laptop = () => createItem({ name: 'Reg Laptop', trackingType: 'UNIT', assetTag: 'REG-LT-1' });
const cords = (totalQuantity = 10) =>
  createItem({ name: 'Reg Cord', trackingType: 'QUANTITY', totalQuantity });

describe('checkout, return, and availability round trips (BRW-1, BRW-2, BRW-4)', () => {
  test('a QUANTITY item goes 10 -> 4 after checkout of 6, 7 after returning 3, 10 after the rest; then 10 can be issued (BR 1, 5)', async () => {
    const item = await cords(10);
    expect(await searchedAvailable(handler, 'Reg Cord')).toBe(10);

    const out = await checkOut(handler, [{ itemId: item.id, quantity: 6 }]).expect(201);
    const lineId = out.body.transaction.lines[0].id;
    expect(await searchedAvailable(handler, 'Reg Cord')).toBe(4);

    // A second checkout asks for more than is left.
    const refused = await checkOut(handler, [{ itemId: item.id, quantity: 5 }]).expect(409);
    expect(refused.body.error).toMatchObject({
      code: 'INSUFFICIENT_QUANTITY',
      details: { itemId: item.id, available: 4 },
    });

    const partial = await giveBack(handler, [{ lineId, quantity: 3 }]).expect(201);
    expect(partial.body.returns[0].outstanding).toBe(3);
    expect(await searchedAvailable(handler, 'Reg Cord')).toBe(7);

    const rest = await giveBack(admin, [{ lineId, quantity: 3 }]).expect(201);
    expect(rest.body.returns[0].outstanding).toBe(0);
    expect(await searchedAvailable(handler, 'Reg Cord')).toBe(10);
    expect((await getAvailability([item.id])).get(item.id)).toBe(10);

    await checkOut(handler, [{ itemId: item.id, quantity: 10 }]).expect(201);
    expect(await searchedAvailable(handler, 'Reg Cord')).toBe(0);
  });

  test('a UNIT item is out after checkout, refused a second time, and issuable again after its return (BR 1, 5, S14)', async () => {
    const item = await laptop();
    const out = await checkOut(handler, [{ itemId: item.id, quantity: 1 }]).expect(201);
    expect(await searchedAvailable(handler, 'Reg Laptop')).toBe(0);

    const again = await checkOut(admin, [{ itemId: item.id, quantity: 1 }]).expect(409);
    expect(again.body.error.code).toBe('ITEM_UNAVAILABLE');

    await giveBack(handler, [{ lineId: out.body.transaction.lines[0].id, quantity: 1 }]).expect(
      201,
    );
    expect(await searchedAvailable(handler, 'Reg Laptop')).toBe(1);
    await checkOut(admin, [{ itemId: item.id, quantity: 1 }]).expect(201);
  });

  test('a laptop returned DAMAGED shows DAMAGED in the item list, stays ACTIVE, and can still be issued (S17, BR 1)', async () => {
    const item = await laptop();
    const out = await checkOut(handler, [{ itemId: item.id, quantity: 1 }]).expect(201);
    const lineId = out.body.transaction.lines[0].id;
    await giveBack(handler, [{ lineId, quantity: 1, condition: 'DAMAGED' }]).expect(201);

    const row = (await admin.get('/api/items').query({ q: 'Reg Laptop' }).expect(200)).body.data[0];
    expect(row).toMatchObject({ condition: 'DAMAGED', status: 'ACTIVE', available: 1 });
    await checkOut(handler, [{ itemId: item.id, quantity: 1 }]).expect(201);
  });

  test('one checkout with a laptop and 4 cords, returned in two requests, leaves both fully available (BR 5)', async () => {
    const unitItem = await laptop();
    const supply = await cords(4);
    const out = await checkOut(handler, [
      { itemId: unitItem.id, quantity: 1 },
      { itemId: supply.id, quantity: 4 },
    ]).expect(201);
    const lineOf = (itemId: string) =>
      out.body.transaction.lines.find((l: { itemId: string }) => l.itemId === itemId).id;

    await giveBack(handler, [
      { lineId: lineOf(unitItem.id), quantity: 1 },
      { lineId: lineOf(supply.id), quantity: 1 },
    ]).expect(201);
    expect(await searchedAvailable(handler, 'Reg Cord')).toBe(1);
    await giveBack(handler, [{ lineId: lineOf(supply.id), quantity: 3 }]).expect(201);

    const availability = await getAvailability([unitItem.id, supply.id]);
    expect(availability.get(unitItem.id)).toBe(1);
    expect(availability.get(supply.id)).toBe(4);
    // A fully returned line refuses a further return (S15).
    const extra = await giveBack(handler, [{ lineId: lineOf(supply.id), quantity: 1 }]).expect(409);
    expect(extra.body.error.code).toBe('RETURN_EXCEEDS_OUTSTANDING');
  });
});

describe('master-data changes while a line is out (MD-2, MD-3, MD-5, MD-7 with BRW-2, BRW-4)', () => {
  test('a borrower deactivated through the Borrowers API can still return, but cannot borrow again (BR 3, BR 11)', async () => {
    const item = await cords(5);
    const out = await checkOut(handler, [{ itemId: item.id, quantity: 2 }]).expect(201);
    await send(admin, 'patch', `/api/borrowers/${borrowerId}`, { active: false }).expect(200);

    // The lookup still finds them, marked inactive (TC-MD-17, TC-BRW-36).
    const lookup = await handler.get('/api/borrowers/lookup').query({ q: 'REG-0001' }).expect(200);
    expect(lookup.body.data).toEqual([expect.objectContaining({ id: borrowerId, active: false })]);

    await giveBack(handler, [{ lineId: out.body.transaction.lines[0].id, quantity: 2 }]).expect(
      201,
    );
    const refused = await checkOut(handler, [{ itemId: item.id, quantity: 1 }]).expect(409);
    expect(refused.body.error.code).toBe('BORROWER_INACTIVE');
  });

  test('a room deactivated through the Rooms API keeps its open lines returnable, refuses new checkouts, and drops out of the handler picker (BR 2, MD-3)', async () => {
    const item = await cords(5);
    const out = await checkOut(handler, [{ itemId: item.id, quantity: 1 }]).expect(201);
    await send(admin, 'patch', `/api/rooms/${locationId}`, { active: false }).expect(200);

    const picker = await handler.get('/api/rooms').expect(200);
    expect(picker.body.data.map((room: { id: string }) => room.id)).not.toContain(locationId);

    await giveBack(handler, [{ lineId: out.body.transaction.lines[0].id, quantity: 1 }]).expect(
      201,
    );
    for (const agent of [handler, admin]) {
      const refused = await checkOut(agent, [{ itemId: item.id, quantity: 1 }]).expect(409);
      expect(refused.body.error.code).toBe('LOCATION_INACTIVE');
    }
  });

  test('a QUANTITY item retired while 3 are out can be returned; it then shows 0 available and cannot be issued (BR 1, 15)', async () => {
    const item = await cords(5);
    const out = await checkOut(handler, [{ itemId: item.id, quantity: 3 }]).expect(201);
    await send(admin, 'patch', `/api/items/${item.id}`, { status: 'RETIRED' }).expect(200);

    await giveBack(handler, [{ lineId: out.body.transaction.lines[0].id, quantity: 3 }]).expect(
      201,
    );
    expect(await searchedAvailable(handler, 'Reg Cord')).toBe(0);
    const refused = await checkOut(handler, [{ itemId: item.id, quantity: 1 }]).expect(409);
    expect(refused.body.error.code).toBe('ITEM_UNAVAILABLE');

    // Back to ACTIVE: the full total is available again.
    await send(admin, 'patch', `/api/items/${item.id}`, { status: 'ACTIVE' }).expect(200);
    expect(await searchedAvailable(handler, 'Reg Cord')).toBe(5);
  });

  test('an item, room, and category used by a checkout made through the API cannot be deleted (BR 15, S19)', async () => {
    const item = await laptop();
    const out = await checkOut(handler, [{ itemId: item.id, quantity: 1 }]).expect(201);
    await giveBack(handler, [{ lineId: out.body.transaction.lines[0].id, quantity: 1 }]).expect(
      201,
    );

    for (const path of [
      `/api/items/${item.id}`,
      `/api/rooms/${locationId}`,
      `/api/categories/${categoryId}`,
    ]) {
      const res = await send(admin, 'delete', path).expect(409);
      expect(res.body.error.code, path).toBe('HAS_HISTORY');
    }
    expect(await prisma.transaction.count()).toBe(1);
    expect(await prisma.return.count()).toBe(1);
  });

  test('switching the current semester between checkout and return keeps the line returnable and its original semester (BR 2, 12, MD-7)', async () => {
    const item = await cords(5);
    const first = (await prisma.semester.findFirstOrThrow({ where: { isCurrent: true } })).id;
    const out = await checkOut(handler, [{ itemId: item.id, quantity: 2 }]).expect(201);
    expect(out.body.transaction.semesterId).toBe(first);

    const next = await send(admin, 'post', '/api/semesters', {
      name: 'Reg S2',
      startDate: '2027-01-05',
      endDate: '2027-05-30',
    }).expect(201);
    await send(admin, 'post', `/api/semesters/${next.body.semester.id}/current`).expect(200);

    await giveBack(handler, [{ lineId: out.body.transaction.lines[0].id, quantity: 2 }]).expect(
      201,
    );
    const stored = await prisma.transaction.findUniqueOrThrow({
      where: { id: out.body.transaction.id },
    });
    expect(stored.semesterId).toBe(first);
    // A new checkout is stamped with the new current semester.
    const later = await checkOut(handler, [{ itemId: item.id, quantity: 1 }]).expect(201);
    expect(later.body.transaction.semesterId).toBe(next.body.semester.id);
  });
});

describe('audit entries share the transaction of the change (BR 14, CLAUDE.md rule 6)', () => {
  // A temporary trigger makes the audit insert for one action fail, as a real failure would.
  // If the change were written outside the audit's database transaction, it would survive.
  async function failAuditFor(action: string) {
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION qa_regression_fail_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = '${action}' THEN RAISE EXCEPTION 'qa regression: audit insert refused'; END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER qa_regression_fail_audit BEFORE INSERT ON audit_log
       FOR EACH ROW EXECUTE FUNCTION qa_regression_fail_audit()`,
    );
  }

  afterEach(async () => {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS qa_regression_fail_audit ON audit_log');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS qa_regression_fail_audit()');
  });

  test('when the CHECKOUT audit insert fails, no transaction or line is left and the item stays available', async () => {
    const item = await cords(5);
    await failAuditFor('CHECKOUT');
    const res = await checkOut(handler, [{ itemId: item.id, quantity: 2 }]).expect(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(await prisma.transaction.count()).toBe(0);
    expect(await prisma.transactionItem.count()).toBe(0);
    expect((await getAvailability([item.id])).get(item.id)).toBe(5);
  });

  test('when the RETURN audit insert fails, no return event is kept and the outstanding quantity is unchanged', async () => {
    const item = await cords(5);
    const out = await checkOut(handler, [{ itemId: item.id, quantity: 4 }]).expect(201);
    const lineId = out.body.transaction.lines[0].id;
    await failAuditFor('RETURN');

    await giveBack(handler, [{ lineId, quantity: 2 }]).expect(500);
    expect(await prisma.return.count()).toBe(0);
    expect(
      (await prisma.transactionItem.findUniqueOrThrow({ where: { id: lineId } })).quantityReturned,
    ).toBe(0);
  });

  test('when the RETURN audit insert fails on a DAMAGED laptop, the item condition change is rolled back too (S17)', async () => {
    const item = await laptop();
    const out = await checkOut(handler, [{ itemId: item.id, quantity: 1 }]).expect(201);
    await failAuditFor('RETURN');

    await giveBack(handler, [
      { lineId: out.body.transaction.lines[0].id, quantity: 1, condition: 'DAMAGED' },
    ]).expect(500);
    expect((await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).condition).toBe(
      'GOOD',
    );
    expect(await prisma.auditLog.count({ where: { action: 'ITEM_UPDATED' } })).toBe(0);
  });

  test('a full flow writes CHECKOUT, ITEM_UPDATED and two RETURN entries with the right actors, and nothing for reads', async () => {
    const [adminId, handlerId] = await Promise.all(
      ['reg-admin', 'reg-handler'].map(
        async (username) => (await prisma.user.findUniqueOrThrow({ where: { username } })).id,
      ),
    );
    const unitItem = await laptop();
    const supply = await cords(5);
    const before = await prisma.auditLog.count();

    const out = await checkOut(handler, [
      { itemId: unitItem.id, quantity: 1 },
      { itemId: supply.id, quantity: 2 },
    ]).expect(201);
    await handler.get('/api/items').query({ q: 'Reg' }).expect(200);
    await handler.get('/api/borrowers/lookup').query({ q: 'REG' }).expect(200);
    const lines = out.body.transaction.lines as { id: string; itemId: string }[];
    await giveBack(admin, [
      {
        lineId: lines.find((l) => l.itemId === unitItem.id)!.id,
        quantity: 1,
        condition: 'DAMAGED',
      },
      { lineId: lines.find((l) => l.itemId === supply.id)!.id, quantity: 2 },
    ]).expect(201);

    const entries = await prisma.auditLog.findMany();
    // Only ITEM_CREATED entries came before; the reads wrote nothing.
    expect(entries.length - before).toBe(4);
    const flow = entries.filter((e) => e.action !== 'ITEM_CREATED');
    expect(flow.map((e) => [e.action, e.actorId]).sort()).toEqual(
      [
        ['CHECKOUT', handlerId],
        ['ITEM_UPDATED', adminId],
        ['RETURN', adminId],
        ['RETURN', adminId],
      ].sort(),
    );
  });
});
