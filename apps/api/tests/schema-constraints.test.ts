import { beforeEach, describe, expect, test } from 'vitest';
import { prisma } from '../src/lib/prisma.ts';
import { resetDatabase } from './setup/reset-database.ts';

// Database constraints from ARCHITECTURE.md section 8. They are the last line of defense:
// services check the same rules first and return friendly errors.

beforeEach(resetDatabase);

function createAdmin() {
  return prisma.user.create({
    data: { name: 'Admin', username: 'admin', passwordHash: 'x', role: 'ADMIN' },
  });
}

function createCategory() {
  return prisma.category.create({ data: { name: 'Equipment' } });
}

describe('items', () => {
  test('a UNIT item needs an asset tag', async () => {
    const category = await createCategory();
    const insert = prisma.item.create({
      data: {
        name: 'Laptop',
        categoryId: category.id,
        trackingType: 'UNIT',
        totalQuantity: 1,
        condition: 'GOOD',
      },
    });
    await expect(insert).rejects.toThrow(/items_unit_or_quantity_check/);
  });

  test('a UNIT item has total quantity 1', async () => {
    const category = await createCategory();
    const insert = prisma.item.create({
      data: {
        name: 'Laptop',
        categoryId: category.id,
        trackingType: 'UNIT',
        assetTag: 'LT-001',
        totalQuantity: 2,
        condition: 'GOOD',
      },
    });
    await expect(insert).rejects.toThrow(/items_unit_or_quantity_check/);
  });

  test('a QUANTITY item has no asset tag', async () => {
    const category = await createCategory();
    const insert = prisma.item.create({
      data: {
        name: 'Extension cord',
        categoryId: category.id,
        trackingType: 'QUANTITY',
        assetTag: 'EC-001',
        totalQuantity: 10,
        condition: 'GOOD',
      },
    });
    await expect(insert).rejects.toThrow(/items_unit_or_quantity_check/);
  });

  test('valid UNIT and QUANTITY items are accepted', async () => {
    const category = await createCategory();
    await prisma.item.createMany({
      data: [
        {
          name: 'Laptop',
          categoryId: category.id,
          trackingType: 'UNIT',
          assetTag: 'LT-001',
          totalQuantity: 1,
          condition: 'GOOD',
        },
        {
          name: 'Extension cord',
          categoryId: category.id,
          trackingType: 'QUANTITY',
          totalQuantity: 0,
          condition: 'GOOD',
        },
      ],
    });
    expect(await prisma.item.count()).toBe(2);
  });
});

describe('semesters', () => {
  const dates = { startDate: new Date('2026-08-01'), endDate: new Date('2026-12-15') };

  test('only one semester can be current', async () => {
    await prisma.semester.create({ data: { name: 'First 2026', isCurrent: true, ...dates } });
    await prisma.semester.create({ data: { name: 'Old', isCurrent: false, ...dates } });

    const second = prisma.semester.create({
      data: { name: 'Second 2026', isCurrent: true, ...dates },
    });
    await expect(second).rejects.toThrow();
    expect(await prisma.semester.count({ where: { isCurrent: true } })).toBe(1);
  });

  test('a semester cannot end before it starts', async () => {
    const insert = prisma.semester.create({
      data: { name: 'Backwards', startDate: dates.endDate, endDate: dates.startDate },
    });
    await expect(insert).rejects.toThrow(/semesters_dates_check/);
  });
});

test('room names are unique regardless of letter case', async () => {
  const admin = await createAdmin();
  await prisma.location.create({ data: { name: 'Lab 1', createdById: admin.id } });
  const duplicate = prisma.location.create({ data: { name: 'LAB 1', createdById: admin.id } });
  await expect(duplicate).rejects.toThrow();
  expect(await prisma.location.count()).toBe(1);
});

describe('settings', () => {
  test('has a single row', async () => {
    await prisma.setting.create({ data: {} });
    await expect(prisma.setting.create({ data: { id: 2 } })).rejects.toThrow(
      /settings_single_row_check/,
    );
  });

  test('defaults match SPEC section 4', async () => {
    const settings = await prisma.setting.create({ data: {} });
    expect(settings).toMatchObject({
      id: 1,
      closingTime: '17:00',
      warningThreshold: 3,
      noticeThreshold: 4,
      blockThreshold: 5,
    });
  });
});

describe('transaction lines and returns', () => {
  // Creates every record a line needs and returns the line and the admin who issued it.
  async function createLine(quantityBorrowed: number) {
    const admin = await createAdmin();
    const category = await createCategory();
    const item = await prisma.item.create({
      data: {
        name: 'Cord',
        categoryId: category.id,
        trackingType: 'QUANTITY',
        totalQuantity: 10,
        condition: 'GOOD',
      },
    });
    const borrower = await prisma.borrower.create({
      data: { schoolId: '2026-0001', name: 'Student', type: 'STUDENT', department: 'IT' },
    });
    const location = await prisma.location.create({
      data: { name: 'Lab 1', createdById: admin.id },
    });
    const semester = await prisma.semester.create({
      data: {
        name: 'S1',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-12-15'),
        isCurrent: true,
      },
    });
    const transaction = await prisma.transaction.create({
      data: {
        borrowerId: borrower.id,
        locationId: location.id,
        issuedById: admin.id,
        semesterId: semester.id,
      },
    });
    const line = await prisma.transactionItem.create({
      data: { transactionId: transaction.id, itemId: item.id, quantityBorrowed },
    });
    return { admin, line };
  }

  test('returned quantity cannot exceed borrowed quantity', async () => {
    const { line } = await createLine(3);
    const update = prisma.transactionItem.update({
      where: { id: line.id },
      data: { quantityReturned: 4 },
    });
    await expect(update).rejects.toThrow(/transaction_items_quantity_check/);
  });

  test('a line borrows at least 1', async () => {
    await expect(createLine(0)).rejects.toThrow(/transaction_items_quantity_check/);
  });

  test('a return event returns at least 1', async () => {
    const { admin, line } = await createLine(3);
    const insert = prisma.return.create({
      data: { transactionItemId: line.id, quantity: 0, receivedById: admin.id, condition: 'GOOD' },
    });
    await expect(insert).rejects.toThrow(/returns_quantity_check/);
  });

  test('a user with transactions cannot be deleted (Rule 15)', async () => {
    const { admin } = await createLine(1);
    await expect(prisma.user.delete({ where: { id: admin.id } })).rejects.toThrow();
    expect(await prisma.user.count()).toBe(1);
  });
});

test('a user named in the audit log cannot be deleted (Rule 15)', async () => {
  const admin = await createAdmin();
  await prisma.auditLog.create({
    data: { actorId: admin.id, action: 'TEST', entity: 'user', entityId: admin.id },
  });
  await expect(prisma.user.delete({ where: { id: admin.id } })).rejects.toThrow();
  expect(await prisma.user.count()).toBe(1);
});
