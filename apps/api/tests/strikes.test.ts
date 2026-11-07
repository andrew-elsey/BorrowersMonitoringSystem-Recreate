import type { FlagStatus } from '@bms/shared';
import { beforeEach, expect, test } from 'vitest';
import { prisma } from '../src/lib/prisma.ts';
import { setCurrentSemester } from '../src/services/semesters.ts';
import { countStrikes } from '../src/services/strikes.ts';
import { resetDatabase } from './setup/reset-database.ts';

// FLG-1: strike service (BR 10, 12; S2, S5, S6, S7, S9). Test cases TC-FLG-01 to TC-FLG-05 in
// TEST_CASES.md. Flags are set directly on the lines: the flagging job (FLG-2) and the override
// (FLG-4) come later, and the count only reads flag_status.

let adminId: string;
let borrowerId: string;
let locationId: string;
let semester1Id: string;
let semester2Id: string;
let itemIds: string[];

beforeEach(async () => {
  await resetDatabase();
  adminId = (
    await prisma.user.create({
      data: { name: 'Ada Admin', username: 'ada', passwordHash: 'x', role: 'ADMIN' },
    })
  ).id;
  borrowerId = await newBorrower('2026-0001');
  locationId = (await prisma.location.create({ data: { name: 'CL-201', createdById: adminId } }))
    .id;
  const semesters = await prisma.semester.createManyAndReturn({
    data: [
      {
        name: 'S1',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-12-15'),
        isCurrent: true,
      },
      { name: 'S2', startDate: new Date('2027-01-05'), endDate: new Date('2027-05-31') },
    ],
  });
  semester1Id = semesters.find((semester) => semester.name === 'S1')!.id;
  semester2Id = semesters.find((semester) => semester.name === 'S2')!.id;
  const categoryId = (await prisma.category.create({ data: { name: 'Equipment' } })).id;
  const items = await prisma.item.createManyAndReturn({
    data: ['L-1', 'M-1', 'P-1'].map((assetTag) => ({
      name: assetTag,
      categoryId,
      trackingType: 'UNIT' as const,
      assetTag,
      totalQuantity: 1,
      condition: 'GOOD' as const,
    })),
  });
  itemIds = items.map((item) => item.id);
});

async function newBorrower(schoolId: string) {
  return (
    await prisma.borrower.create({
      data: { schoolId, name: schoolId, type: 'STUDENT', department: 'IT' },
    })
  ).id;
}

// One transaction with one line per flag status given.
function transaction(flags: FlagStatus[], semesterId = semester1Id, borrower = borrowerId) {
  return prisma.transaction.create({
    data: {
      borrowerId: borrower,
      locationId,
      issuedById: adminId,
      semesterId,
      lines: {
        create: flags.map((flagStatus, index) => ({
          itemId: itemIds[index]!,
          quantityBorrowed: 1,
          flagStatus,
          flaggedAt: flagStatus === 'NONE' ? null : new Date(),
        })),
      },
    },
    include: { lines: true },
  });
}

test('BR 10: a new borrower has 0 strikes, and lines not flagged do not count', async () => {
  expect(await countStrikes(borrowerId)).toBe(0);
  await transaction(['NONE', 'NONE']);
  await transaction(['OVERRIDDEN']);
  expect(await countStrikes(borrowerId)).toBe(0);
});

test('TC-FLG-01 (BR 10, S2): one transaction with a flagged line is 1 strike', async () => {
  await transaction(['FLAGGED']);
  expect(await countStrikes(borrowerId)).toBe(1);
});

test('TC-FLG-02 (BR 10, S5): one transaction with three flagged lines is 1 strike, not 3', async () => {
  await transaction(['FLAGGED', 'FLAGGED', 'FLAGGED']);
  expect(await countStrikes(borrowerId)).toBe(1);
});

test('TC-FLG-03 (BR 10, S6): two flagged transactions the same day are 2 strikes', async () => {
  await transaction(['FLAGGED']);
  await transaction(['FLAGGED']);
  expect(await countStrikes(borrowerId)).toBe(2);
});

test("BR 10: only the borrower's own transactions count", async () => {
  const otherId = await newBorrower('2026-0002');
  await transaction(['FLAGGED'], semester1Id, otherId);
  expect(await countStrikes(borrowerId)).toBe(0);
  expect(await countStrikes(otherId)).toBe(1);
});

test('TC-FLG-04 (BR 10, 13, S7): overriding one of two flagged lines leaves 1 strike; both leaves 0', async () => {
  const { lines } = await transaction(['FLAGGED', 'FLAGGED']);
  const override = (id: string) =>
    prisma.transactionItem.update({ where: { id }, data: { flagStatus: 'OVERRIDDEN' } });

  await override(lines[0]!.id);
  expect(await countStrikes(borrowerId)).toBe(1);
  await override(lines[1]!.id);
  expect(await countStrikes(borrowerId)).toBe(0);
});

test('TC-FLG-05 (BR 12, S9): a new current semester starts at 0; switching back brings the strikes back', async () => {
  for (let i = 0; i < 4; i++) await transaction(['FLAGGED']);
  expect(await countStrikes(borrowerId)).toBe(4);

  await setCurrentSemester(adminId, semester2Id);
  expect(await countStrikes(borrowerId)).toBe(0);
  // Semester 1 history keeps its flags: nothing is cleaned up.
  expect(
    await prisma.transactionItem.count({
      where: { flagStatus: 'FLAGGED', transaction: { semesterId: semester1Id } },
    }),
  ).toBe(4);

  await setCurrentSemester(adminId, semester1Id);
  expect(await countStrikes(borrowerId)).toBe(4);
});

test('BR 10: with no current semester nothing counts', async () => {
  await transaction(['FLAGGED']);
  await prisma.semester.updateMany({ data: { isCurrent: false } });
  expect(await countStrikes(borrowerId)).toBe(0);
});
