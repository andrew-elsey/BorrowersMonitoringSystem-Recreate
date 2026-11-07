import type { FlagStatus } from '@bms/shared';
import { randomUUID } from 'node:crypto';
import { beforeEach, expect, test } from 'vitest';
import { prisma } from '../src/lib/prisma.ts';
import { setCurrentSemester } from '../src/services/semesters.ts';
import { countStrikes } from '../src/services/strikes.ts';
import { resetDatabase } from './setup/reset-database.ts';

// QA (automated) gap tests for FLG-1 (strike service, BR 6, 10, 12; S3, S5 to S9): returned
// flagged lines still count, mixed FLAGGED/OVERRIDDEN/NONE lines count once, other semesters do
// not count, unknown and inactive borrowers, no cap at the block threshold, and a call made with
// a Prisma transaction client. Flags and returns are written directly on the rows, as in
// strikes.test.ts: the flagging job (FLG-2) and the return service (BRW-4) are not on this branch.

let adminId: string;
let borrowerId: string;
let locationId: string;
let semester1Id: string;
let semester2Id: string;
let unitItemIds: string[];
let cordsId: string;

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
  const units = await prisma.item.createManyAndReturn({
    data: ['L-1', 'M-1', 'P-1'].map((assetTag) => ({
      name: assetTag,
      categoryId,
      trackingType: 'UNIT' as const,
      assetTag,
      totalQuantity: 1,
      condition: 'GOOD' as const,
    })),
  });
  unitItemIds = units.map((item) => item.id);
  cordsId = (
    await prisma.item.create({
      data: {
        name: 'Extension cord',
        categoryId,
        trackingType: 'QUANTITY',
        totalQuantity: 10,
        condition: 'GOOD',
      },
    })
  ).id;
});

async function newBorrower(schoolId: string, active = true) {
  return (
    await prisma.borrower.create({
      data: { schoolId, name: schoolId, type: 'STUDENT', department: 'IT', active },
    })
  ).id;
}

// One transaction with one unit line per flag status given.
function transaction(
  flags: FlagStatus[],
  {
    semesterId = semester1Id,
    borrower = borrowerId,
    db = prisma as Pick<typeof prisma, 'transaction'>,
  } = {},
) {
  return db.transaction.create({
    data: {
      borrowerId: borrower,
      locationId,
      issuedById: adminId,
      semesterId,
      lines: {
        create: flags.map((flagStatus, index) => ({
          itemId: unitItemIds[index]!,
          quantityBorrowed: 1,
          flagStatus,
          flaggedAt: flagStatus === 'NONE' ? null : new Date(),
        })),
      },
    },
    include: { lines: true },
  });
}

// Records a return of `quantity` on a line, as BRW-4 does: a return event plus the returned total.
async function returnOn(lineId: string, quantity: number) {
  await prisma.return.create({
    data: { transactionItemId: lineId, quantity, receivedById: adminId, condition: 'GOOD' },
  });
  await prisma.transactionItem.update({
    where: { id: lineId },
    data: { quantityReturned: { increment: quantity } },
  });
}

test('BR 6, S3: a flagged quantity line still counts after a partial return', async () => {
  const { lines } = await prisma.transaction.create({
    data: {
      borrowerId,
      locationId,
      issuedById: adminId,
      semesterId: semester1Id,
      lines: {
        create: {
          itemId: cordsId,
          quantityBorrowed: 5,
          quantityReturned: 3,
          flagStatus: 'FLAGGED',
          flaggedAt: new Date(),
        },
      },
    },
    include: { lines: true },
  });
  expect(await countStrikes(borrowerId)).toBe(1);

  // S3: the last 2 come back the next morning; the line stays FLAGGED and the strike remains.
  await returnOn(lines[0]!.id, 2);
  expect(await countStrikes(borrowerId)).toBe(1);
});

test('BR 6: a flagged unit line still counts after it is fully returned', async () => {
  const { lines } = await transaction(['FLAGGED']);
  await returnOn(lines[0]!.id, 1);
  expect(await countStrikes(borrowerId)).toBe(1);
});

test('BR 10: a transaction with FLAGGED, OVERRIDDEN, and NONE lines counts once', async () => {
  await transaction(['FLAGGED', 'OVERRIDDEN', 'NONE']);
  expect(await countStrikes(borrowerId)).toBe(1);
});

test('BR 10, S7: a transaction whose only flagged line is overridden among NONE lines counts 0', async () => {
  await transaction(['OVERRIDDEN', 'NONE', 'NONE']);
  expect(await countStrikes(borrowerId)).toBe(0);
});

test('BR 12: flagged transactions in a semester that is not current do not count', async () => {
  await transaction(['FLAGGED'], { semesterId: semester2Id });
  await transaction(['FLAGGED'], { semesterId: semester2Id });
  await transaction(['FLAGGED']);
  expect(await countStrikes(borrowerId)).toBe(1);
});

test('BR 12, S9: switching semesters and back gives each semester its own count', async () => {
  await transaction(['FLAGGED']);
  await transaction(['FLAGGED', 'FLAGGED']);
  await transaction(['FLAGGED'], { semesterId: semester2Id });

  expect(await countStrikes(borrowerId)).toBe(2);
  await setCurrentSemester(adminId, semester2Id);
  expect(await countStrikes(borrowerId)).toBe(1);
  await setCurrentSemester(adminId, semester1Id);
  expect(await countStrikes(borrowerId)).toBe(2);
});

test('BR 12: a transaction counts by its stamped semester, not by its issue date', async () => {
  // Issued before semester 1's start date, but stamped with semester 1 (the current one).
  const { id } = await transaction(['FLAGGED']);
  await prisma.transaction.update({
    where: { id },
    data: { issuedAt: new Date('2025-01-15T02:00:00Z') },
  });
  expect(await countStrikes(borrowerId)).toBe(1);
});

test('an unknown borrower id has 0 strikes', async () => {
  await transaction(['FLAGGED']);
  expect(await countStrikes(randomUUID())).toBe(0);
});

test('BR 10: an inactive borrower keeps their strikes', async () => {
  const inactiveId = await newBorrower('2026-0099', false);
  await transaction(['FLAGGED'], { borrower: inactiveId });
  expect(await countStrikes(inactiveId)).toBe(1);
});

test('BR 10, 11: the count is not capped at the block threshold', async () => {
  for (let i = 0; i < 6; i++) await transaction(['FLAGGED']);
  expect(await countStrikes(borrowerId)).toBe(6);
});

test('counts inside a Prisma $transaction, seeing rows written earlier in it', async () => {
  const inside = await prisma.$transaction(async (tx) => {
    await transaction(['FLAGGED'], { db: tx });
    return countStrikes(borrowerId, tx);
  });
  expect(inside).toBe(1);
  expect(await countStrikes(borrowerId)).toBe(1);
});

test('a strike written in a rolled-back $transaction does not count', async () => {
  await expect(
    prisma.$transaction(async (tx) => {
      await transaction(['FLAGGED'], { db: tx });
      expect(await countStrikes(borrowerId, tx)).toBe(1);
      throw new Error('roll back');
    }),
  ).rejects.toThrow('roll back');
  expect(await countStrikes(borrowerId)).toBe(0);
});
