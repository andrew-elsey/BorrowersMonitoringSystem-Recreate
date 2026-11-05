import type { ItemStatus } from '@bms/shared';
import { beforeEach, describe, expect, test } from 'vitest';
import { prisma } from '../src/lib/prisma.ts';
import { availableQuantity, getAvailability } from '../src/services/availability.ts';
import { resetDatabase } from './setup/reset-database.ts';

// BR 1 availability (BRW-1). The math is unit tested; getAvailability runs against the real
// test database, including through a transaction client as checkout (BRW-2) will use it.

describe('availableQuantity (unit)', () => {
  const unit = { status: 'ACTIVE' as const, totalQuantity: 1 };

  test('TC-BRW-01: a UNIT item is unavailable with an open line and available without', () => {
    expect(availableQuantity(unit, 1)).toBe(0);
    expect(availableQuantity(unit, 0)).toBe(1);
  });

  test('TC-BRW-02: QUANTITY total 10, open lines 4 and 3 with 1 returned leaves 4', () => {
    expect(availableQuantity({ status: 'ACTIVE', totalQuantity: 10 }, 4 + (3 - 1))).toBe(4);
  });

  test.each(['UNDER_REPAIR', 'LOST', 'RETIRED'] as const)(
    'TC-BRW-03: a %s item is not available',
    (status) => {
      expect(availableQuantity({ status, totalQuantity: 1 }, 0)).toBe(0);
      expect(availableQuantity({ status, totalQuantity: 10 }, 0)).toBe(0);
    },
  );

  test('never below 0 when the total was lowered under what is out (MD-2)', () => {
    expect(availableQuantity({ status: 'ACTIVE', totalQuantity: 2 }, 5)).toBe(0);
  });
});

describe('getAvailability (integration)', () => {
  let adminId: string;
  let categoryId: string;
  let transactionId: string;

  beforeEach(async () => {
    await resetDatabase();
    const admin = await prisma.user.create({
      data: { name: 'Admin', username: 'admin', passwordHash: 'x', role: 'ADMIN' },
    });
    adminId = admin.id;
    categoryId = (await prisma.category.create({ data: { name: 'Equipment' } })).id;
    const borrower = await prisma.borrower.create({
      data: { schoolId: '2026-0001', name: 'Student', type: 'STUDENT', department: 'IT' },
    });
    const location = await prisma.location.create({
      data: { name: 'Lab 1', createdById: adminId },
    });
    const semester = await prisma.semester.create({
      data: { name: 'S1', startDate: new Date('2026-08-01'), endDate: new Date('2026-12-15') },
    });
    transactionId = (
      await prisma.transaction.create({
        data: {
          borrowerId: borrower.id,
          locationId: location.id,
          issuedById: adminId,
          semesterId: semester.id,
        },
      })
    ).id;
  });

  const createUnit = (assetTag: string, status: ItemStatus = 'ACTIVE') =>
    prisma.item.create({
      data: {
        name: 'Laptop',
        categoryId,
        trackingType: 'UNIT',
        assetTag,
        totalQuantity: 1,
        condition: 'GOOD',
        status,
      },
    });

  const lend = (itemId: string, quantityBorrowed: number, quantityReturned = 0) =>
    prisma.transactionItem.create({
      data: { transactionId, itemId, quantityBorrowed, quantityReturned },
    });

  test('TC-BRW-01: UNIT items: out, returned, and never borrowed', async () => {
    const out = await createUnit('LT-001');
    const returned = await createUnit('LT-002');
    const fresh = await createUnit('LT-003');
    await lend(out.id, 1);
    await lend(returned.id, 1, 1);

    const availability = await getAvailability([out.id, returned.id, fresh.id]);
    expect(availability).toEqual(
      new Map([
        [out.id, 0],
        [returned.id, 1],
        [fresh.id, 1],
      ]),
    );
  });

  test('TC-BRW-02: QUANTITY item with a partial return, read through a transaction client', async () => {
    const cords = await prisma.item.create({
      data: {
        name: 'Extension cord',
        categoryId,
        trackingType: 'QUANTITY',
        totalQuantity: 10,
        condition: 'GOOD',
      },
    });
    await lend(cords.id, 4);
    await lend(cords.id, 3, 1);
    await lend(cords.id, 5, 5); // fully returned: no effect

    const availability = await prisma.$transaction((tx) => getAvailability([cords.id], tx));
    expect(availability.get(cords.id)).toBe(4);
  });

  test('TC-BRW-03: non-ACTIVE items are unavailable even with no open line', async () => {
    const items = await Promise.all(
      (['UNDER_REPAIR', 'LOST', 'RETIRED'] as const).map((status, i) =>
        createUnit(`LT-10${i}`, status),
      ),
    );
    const availability = await getAvailability(items.map((item) => item.id));
    expect([...availability.values()]).toEqual([0, 0, 0]);
  });

  test('an unknown id is left out', async () => {
    const availability = await getAvailability(['00000000-0000-0000-0000-000000000000']);
    expect(availability.size).toBe(0);
  });
});
