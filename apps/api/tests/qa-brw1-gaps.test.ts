import type { ItemStatus } from '@bms/shared';
import { beforeEach, describe, expect, test } from 'vitest';
import { prisma } from '../src/lib/prisma.ts';
import { getAvailability } from '../src/services/availability.ts';
import { resetDatabase } from './setup/reset-database.ts';

// QA (automated) gap tests for BRW-1 (BR 1): many lines per item across transactions, mixed
// tracking types in one call, duplicate and empty id lists, a zero total, non-ACTIVE items with
// open lines, the transaction-client path after SELECT ... FOR UPDATE, and the open-line index.

let adminId: string;
let borrowerId: string;
let locationId: string;
let semesterId: string;
let categoryId: string;

beforeEach(async () => {
  await resetDatabase();
  adminId = (
    await prisma.user.create({
      data: { name: 'QA Admin', username: 'qa-admin', passwordHash: 'x', role: 'ADMIN' },
    })
  ).id;
  categoryId = (await prisma.category.create({ data: { name: 'QA Category' } })).id;
  borrowerId = (
    await prisma.borrower.create({
      data: { schoolId: 'QA-0001', name: 'Test Borrower', type: 'STUDENT', department: 'QA' },
    })
  ).id;
  locationId = (await prisma.location.create({ data: { name: 'QA Lab', createdById: adminId } }))
    .id;
  semesterId = (
    await prisma.semester.create({
      data: { name: 'QA S1', startDate: new Date('2026-08-01'), endDate: new Date('2026-12-15') },
    })
  ).id;
});

const newTransaction = async () =>
  (
    await prisma.transaction.create({
      data: { borrowerId, locationId, issuedById: adminId, semesterId },
    })
  ).id;

const unitItem = (assetTag: string, status: ItemStatus = 'ACTIVE') =>
  prisma.item.create({
    data: {
      name: 'QA Laptop',
      categoryId,
      trackingType: 'UNIT',
      assetTag,
      totalQuantity: 1,
      condition: 'GOOD',
      status,
    },
  });

const quantityItem = (totalQuantity: number, status: ItemStatus = 'ACTIVE') =>
  prisma.item.create({
    data: {
      name: 'QA Cord',
      categoryId,
      trackingType: 'QUANTITY',
      totalQuantity,
      condition: 'GOOD',
      status,
    },
  });

const lend = (transactionId: string, itemId: string, borrowed: number, returned = 0) =>
  prisma.transactionItem.create({
    data: { transactionId, itemId, quantityBorrowed: borrowed, quantityReturned: returned },
  });

describe('outstanding across many lines', () => {
  test('sums every open line on one QUANTITY item across transactions, each partly returned', async () => {
    const cords = await quantityItem(20);
    const t1 = await newTransaction();
    const t2 = await newTransaction();
    await lend(t1, cords.id, 5, 2); // 3 out
    await lend(t2, cords.id, 6, 1); // 5 out
    await lend(t2, cords.id, 4, 4); // closed
    await lend(t1, cords.id, 2); // 2 out

    expect((await getAvailability([cords.id])).get(cords.id)).toBe(20 - 3 - 5 - 2);
  });

  test('a UNIT item with old returned lines and one open line is unavailable', async () => {
    const laptop = await unitItem('QA-LT-001');
    await lend(await newTransaction(), laptop.id, 1, 1);
    await lend(await newTransaction(), laptop.id, 1, 1);
    await lend(await newTransaction(), laptop.id, 1);

    expect((await getAvailability([laptop.id])).get(laptop.id)).toBe(0);
  });

  test('UNIT and QUANTITY items in one call each get their own value', async () => {
    const laptopOut = await unitItem('QA-LT-010');
    const laptopFree = await unitItem('QA-LT-011');
    const cords = await quantityItem(8);
    const markers = await quantityItem(3);
    const t = await newTransaction();
    await lend(t, laptopOut.id, 1);
    await lend(t, cords.id, 5, 2);

    const availability = await getAvailability([laptopOut.id, cords.id, laptopFree.id, markers.id]);
    expect(availability).toEqual(
      new Map([
        [laptopOut.id, 0],
        [cords.id, 5],
        [laptopFree.id, 1],
        [markers.id, 3],
      ]),
    );
  });
});

describe('input edge cases', () => {
  test('an empty id list returns an empty map', async () => {
    await quantityItem(5);
    expect((await getAvailability([])).size).toBe(0);
  });

  test('duplicate ids give one entry and do not double count outstanding', async () => {
    const cords = await quantityItem(10);
    await lend(await newTransaction(), cords.id, 4);

    const availability = await getAvailability([cords.id, cords.id, cords.id]);
    expect(availability).toEqual(new Map([[cords.id, 6]]));
  });

  test('a QUANTITY item with total 0 is unavailable', async () => {
    const empty = await quantityItem(0);
    expect((await getAvailability([empty.id])).get(empty.id)).toBe(0);
  });

  test('items not asked for are left out even when they have open lines', async () => {
    const asked = await quantityItem(5);
    const other = await quantityItem(5);
    await lend(await newTransaction(), other.id, 5);

    expect(await getAvailability([asked.id])).toEqual(new Map([[asked.id, 5]]));
  });
});

describe('non-ACTIVE and clamped items in the database', () => {
  test.each(['UNDER_REPAIR', 'LOST', 'RETIRED'] as const)(
    'a %s QUANTITY item with an open line and spare stock gives 0',
    async (status) => {
      const cords = await quantityItem(10, status);
      await lend(await newTransaction(), cords.id, 2);
      expect((await getAvailability([cords.id])).get(cords.id)).toBe(0);
    },
  );

  test('a QUANTITY total lowered below what is out gives 0, not a negative number', async () => {
    const cords = await quantityItem(10);
    await lend(await newTransaction(), cords.id, 7);
    await prisma.item.update({ where: { id: cords.id }, data: { totalQuantity: 3 } });

    expect((await getAvailability([cords.id])).get(cords.id)).toBe(0);
  });
});

describe('inside a transaction (as BRW-2 will call it)', () => {
  test('after SELECT ... FOR UPDATE it reads the locked rows and sees lines written in the same transaction', async () => {
    const laptop = await unitItem('QA-LT-020');
    const cords = await quantityItem(10);
    const t = await newTransaction();
    await lend(t, cords.id, 3);

    const [before, after] = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM items WHERE id IN (${laptop.id}::uuid, ${cords.id}::uuid) ORDER BY id FOR UPDATE`;
      const first = await getAvailability([laptop.id, cords.id], tx);
      await tx.transactionItem.create({
        data: { transactionId: t, itemId: laptop.id, quantityBorrowed: 1 },
      });
      await tx.transactionItem.create({
        data: { transactionId: t, itemId: cords.id, quantityBorrowed: 4 },
      });
      return [first, await getAvailability([laptop.id, cords.id], tx)];
    });

    expect(before).toEqual(
      new Map([
        [laptop.id, 1],
        [cords.id, 7],
      ]),
    );
    expect(after).toEqual(
      new Map([
        [laptop.id, 0],
        [cords.id, 3],
      ]),
    );
  });
});

describe('open-line index (rule 12)', () => {
  test('the query getAvailability sends can scan transaction_items_open_by_item_idx', async () => {
    const cords = await quantityItem(10);
    await lend(await newTransaction(), cords.id, 2);

    // Checks the SQL Prisma really generates, not a hand-written copy: with seq scans off, the
    // partial index is usable only if the open-line predicate is in the query. The per-transaction
    // scan counter of this backend shows whether the index was used.
    const scans = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      expect((await getAvailability([cords.id], tx)).get(cords.id)).toBe(8);
      const [row] = await tx.$queryRaw<{ scans: bigint }[]>`
        SELECT pg_stat_get_xact_numscans('transaction_items_open_by_item_idx'::regclass) AS scans`;
      return Number(row!.scans);
    });
    expect(scans).toBeGreaterThan(0);
  });
});
