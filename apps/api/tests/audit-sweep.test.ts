import request from 'supertest';
import { beforeEach, expect, test } from 'vitest';
import { seed } from '../prisma/seed.ts';
import { createApp } from '../src/app.ts';
import { prisma } from '../src/lib/prisma.ts';
import { runAuditSweep } from '../src/services/audit-sweep.ts';
import { resetDatabase } from './setup/reset-database.ts';

// HRD-1: the audit sweep (BR 14, `npm run audit:sweep`). Test cases TC-HRD-03, TC-HRD-17 and TC-HRD-18.

beforeEach(resetDatabase);

// Only the checks that found something.
async function problems() {
  const found = await runAuditSweep();
  return Object.fromEntries(found.filter((f) => f.count > 0).map((f) => [f.check, f.ids]));
}

// updated_at moved a minute past its audit entry, without a new entry: a change nobody audited.
const touch = (table: string, id: string) =>
  prisma.$executeRawUnsafe(
    `UPDATE ${table} SET updated_at = now() + interval '1 minute' WHERE id = $1::uuid`,
    id,
  );

test('TC-HRD-03: a change with no audit entry is reported', async () => {
  await seed({ adminUsername: 'admin', adminPassword: 'first-password', includeSampleData: true });
  expect(await problems()).toEqual({}); // seed rows count as having entries (null actor)

  const category = await prisma.category.findFirstOrThrow();
  await touch('categories', category.id);
  expect(await problems()).toEqual({
    'categories changed after their last audit entry': [category.id],
  });
});

test('TC-HRD-17: every kind of record with no audit entry is reported', async () => {
  const admin = await prisma.user.create({
    data: { name: 'Ana', username: 'ana', passwordHash: 'x', role: 'ADMIN' },
  });
  const borrower = await prisma.borrower.create({
    data: { schoolId: 'B-1', name: 'Bo Row', type: 'STUDENT', department: 'IT' },
  });
  const category = await prisma.category.create({ data: { name: 'Cables' } });
  const room = await prisma.location.create({ data: { name: 'CL-1', createdById: admin.id } });
  const item = await prisma.item.create({
    data: {
      name: 'Cord',
      categoryId: category.id,
      trackingType: 'QUANTITY',
      totalQuantity: 5,
      condition: 'GOOD',
    },
  });
  const semester = await prisma.semester.create({
    data: { name: 'S1', startDate: new Date('2026-08-01'), endDate: new Date('2026-12-15') },
  });
  await prisma.setting.create({ data: { id: 1 } });
  const transaction = await prisma.transaction.create({
    data: {
      borrowerId: borrower.id,
      locationId: room.id,
      issuedById: admin.id,
      semesterId: semester.id,
      lines: {
        create: [
          { itemId: item.id, quantityBorrowed: 2, flagStatus: 'FLAGGED', flaggedAt: new Date() },
        ],
      },
    },
    include: { lines: true },
  });
  const line = transaction.lines[0]!;
  const overridden = await prisma.transactionItem.create({
    data: {
      transactionId: transaction.id,
      itemId: item.id,
      quantityBorrowed: 1,
      flagStatus: 'OVERRIDDEN',
      overrideAt: new Date(),
      overrideReason: 'ok then',
      overrideById: admin.id,
    },
  });
  const event = await prisma.return.create({
    data: { transactionItemId: line.id, quantity: 1, condition: 'GOOD', receivedById: admin.id },
  });

  expect(await problems()).toEqual({
    'transactions without a CHECKOUT entry': [transaction.id],
    'returns without a RETURN entry': [event.id],
    'transaction_items without a LINE_FLAGGED entry': [line.id, overridden.id].sort(),
    'transaction_items without a FLAG_OVERRIDDEN entry': [overridden.id],
    'users without a USER_CREATED entry': [admin.id],
    'categories without a CATEGORY_CREATED entry': [category.id],
    'locations without a LOCATION_CREATED entry': [room.id],
    'items without a ITEM_CREATED entry': [item.id],
    'semesters without a SEMESTER_CREATED entry': [semester.id],
    'settings without a SETTING_CREATED entry': ['1'],
    'borrowers without a BORROWER_CREATED entry': [borrower.id],
  });
});

test('TC-HRD-17: a row changed after its latest entry is reported; a return or a semester switch counts as its entry', async () => {
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const inAMinute = new Date(Date.now() + 60 * 1000);
  const stale = async (table: string) =>
    (await problems())[`${table} changed after their last audit entry`];
  const admin = await prisma.user.create({
    data: { name: 'Ana', username: 'ana', passwordHash: 'x', role: 'ADMIN' },
  });
  const borrower = await prisma.borrower.create({
    data: { schoolId: 'B-1', name: 'Bo Row', type: 'STUDENT', department: 'IT' },
  });
  const category = await prisma.category.create({ data: { name: 'Cables' } });
  const room = await prisma.location.create({ data: { name: 'CL-1', createdById: admin.id } });
  const item = await prisma.item.create({
    data: {
      name: 'Cord',
      categoryId: category.id,
      trackingType: 'QUANTITY',
      totalQuantity: 5,
      condition: 'GOOD',
    },
  });
  const [s1, s2] = await prisma.semester.createManyAndReturn({
    data: [
      { name: 'S1', startDate: new Date('2026-01-05'), endDate: new Date('2026-05-30') },
      { name: 'S2', startDate: new Date('2026-08-01'), endDate: new Date('2026-12-15') },
    ],
  });
  const transaction = await prisma.transaction.create({
    data: {
      borrowerId: borrower.id,
      locationId: room.id,
      issuedById: admin.id,
      semesterId: s1!.id,
      lines: { create: [{ itemId: item.id, quantityBorrowed: 2 }] },
    },
    include: { lines: true },
  });
  const line = transaction.lines[0]!;
  const event = await prisma.return.create({
    data: { transactionItemId: line.id, quantity: 1, condition: 'GOOD', receivedById: admin.id },
  });
  // Every entry an hour old; every row's updated_at older still, except the ones touched below.
  const old = (entity: string, entityId: string, action: string) =>
    prisma.auditLog.create({ data: { action, entity, entityId, createdAt: hourAgo } });
  await old('borrower', borrower.id, 'BORROWER_CREATED');
  await old('transaction_item', line.id, 'CHECKOUT');
  await old('semester', s1!.id, 'SEMESTER_CREATED');
  await old('semester', s2!.id, 'SEMESTER_CREATED');
  await prisma.$executeRaw`UPDATE borrowers SET updated_at = now() - interval '2 hours'`;
  await prisma.$executeRaw`UPDATE transaction_items SET updated_at = now() - interval '2 hours'`;
  await prisma.$executeRaw`UPDATE semesters SET updated_at = now() - interval '2 hours'`;
  expect(await stale('borrowers')).toBeUndefined();

  // Edited with no new entry: reported.
  await touch('borrowers', borrower.id);
  expect(await stale('borrowers')).toEqual([borrower.id]);

  // A return changes its line, but its entry is under the return: it counts for the line.
  await touch('transaction_items', line.id);
  expect(await stale('transaction_items')).toEqual([line.id]);
  await prisma.auditLog.create({
    data: { action: 'RETURN', entity: 'return', entityId: event.id, createdAt: inAMinute },
  });
  expect(await stale('transaction_items')).toBeUndefined();

  // Setting S2 current clears S1, but the one entry is under S2: it counts for S1 too.
  await touch('semesters', s1!.id);
  expect(await stale('semesters')).toEqual([s1!.id]);
  await prisma.auditLog.create({
    data: {
      action: 'SEMESTER_SET_CURRENT',
      entity: 'semester',
      entityId: s2!.id,
      before: { currentSemester: { id: s1!.id, name: 'S1' } },
      after: { currentSemester: { id: s2!.id, name: 'S2' } },
      createdAt: inAMinute,
    },
  });
  expect(await stale('semesters')).toBeUndefined();
});

test('TC-HRD-18: a normal checkout, return, edit, switch of semester, flag, and override leaves no findings', async () => {
  await seed({ adminUsername: 'admin', adminPassword: 'first-password', includeSampleData: true });
  const admin = request.agent(createApp());
  await admin
    .post('/api/auth/login')
    .set('X-Requested-With', 'fetch')
    .send({ username: 'admin', password: 'first-password' })
    .expect(200);
  const send = (
    method: 'post' | 'patch' | 'put',
    path: string,
    body: Record<string, unknown> = {},
  ) => admin[method](path).set('X-Requested-With', 'fetch').send(body);

  const borrower = await prisma.borrower.findFirstOrThrow({ orderBy: { schoolId: 'asc' } });
  const room = await prisma.location.findFirstOrThrow();
  const cord = await prisma.item.findFirstOrThrow({ where: { name: 'Extension cord' } });
  const laptop = await prisma.item.findFirstOrThrow({ where: { assetTag: 'LAP-001' } });
  const sampleSemester = await prisma.semester.findFirstOrThrow({ where: { isCurrent: true } });

  // New records: a category, a room, a borrower, an item, a user.
  const category = (await send('post', '/api/categories', { name: 'Extras' }).expect(201)).body;
  await send('put', `/api/categories/${category.category.id}`, { name: 'Extras 2' }).expect(200);
  await send('post', '/api/rooms', { name: 'Room 999' }).expect(201);
  await send('post', '/api/borrowers', {
    schoolId: 'NEW-1',
    name: 'New Borrower',
    type: 'STUDENT',
    department: 'IT',
  }).expect(201);
  const created = await send('post', '/api/items', {
    categoryId: category.category.id,
    condition: 'GOOD',
    status: 'ACTIVE',
    name: 'Spare cord',
    trackingType: 'QUANTITY',
    totalQuantity: 4,
  }).expect(201);
  await send('patch', `/api/items/${created.body.item.id}`, { totalQuantity: 6 }).expect(200);
  const user = await send('post', '/api/users', {
    name: 'Hal Handler',
    username: 'hal',
    role: 'HANDLER',
    password: 'correct-horse-battery',
  }).expect(201);
  await send('patch', `/api/users/${user.body.user.id}`, { name: 'Hal H.' }).expect(200);
  await send('patch', `/api/borrowers/${borrower.id}`, { department: 'Registrar' }).expect(200);

  // Checkout, a partial return that damages the laptop, a note edit.
  const out = await send('post', '/api/transactions', {
    borrowerId: borrower.id,
    locationId: room.id,
    lines: [
      { itemId: cord.id, quantity: 3 },
      { itemId: laptop.id, quantity: 1 },
    ],
  }).expect(201);
  const [cordLine, laptopLine] = out.body.transaction.lines as { id: string; itemId: string }[];
  await send('post', '/api/returns', {
    lines: [
      { lineId: cordLine!.id, quantity: 1, condition: 'GOOD' },
      { lineId: laptopLine!.id, quantity: 1, condition: 'DAMAGED' },
    ],
  }).expect(201);
  await send('patch', `/api/lines/${cordLine!.id}`, {
    note: 'Returns tomorrow',
    expectedReturnDate: null,
  }).expect(200);

  // Settings, a new semester, and a switch of the current one.
  await send('put', '/api/settings', {
    closingTime: '16:30',
    warningThreshold: 3,
    noticeThreshold: 4,
    blockThreshold: 5,
  }).expect(200);
  const next = await send('post', '/api/semesters', {
    name: 'Next',
    startDate: '2030-01-05',
    endDate: '2030-05-30',
  }).expect(201);
  await send('put', `/api/semesters/${next.body.semester.id}`, {
    name: 'Next term',
    startDate: '2030-01-05',
    endDate: '2030-05-30',
  }).expect(200);
  await send('post', `/api/semesters/${next.body.semester.id}/current`).expect(200);
  await send('post', `/api/semesters/${sampleSemester.id}/current`).expect(200);

  // The cord line is still open: make it old (raw SQL, no updated_at change), flag it, override it.
  await prisma.$executeRaw`UPDATE transactions SET issued_at = now() - interval '3 days'`;
  const run = await send('post', '/api/flagging/run').expect(200);
  expect(run.body.run.flagged).toBe(1);
  await send('post', `/api/flags/${cordLine!.id}/override`, { reason: 'Class ran late' }).expect(
    200,
  );

  expect(await problems()).toEqual({});
});
