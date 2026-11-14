import type { HistoryLine, HistoryPage, HistoryQuery } from '@bms/shared';
import { DateTime } from 'luxon';
import type { Prisma } from '../generated/prisma/client.ts';
import { config } from '../lib/config.ts';
import { ApiError } from '../lib/errors.ts';
import { prisma } from '../lib/prisma.ts';
import { borrowerService } from './borrowers.ts';

// Borrowing history reports (RPT-2 per borrower, RPT-3 per item, BR section 4): read-only, one row per checkout line, paginated,
// issue dates limited to a range of at most 366 days (SPEC.md 7, checked by historyQuerySchema).

const person = { select: { id: true, name: true } } as const;
const lineInclude = {
  transaction: {
    select: { borrowerId: true, issuedAt: true, location: person, issuedBy: person },
  },
  item: { select: { id: true, name: true, assetTag: true } },
  overrideBy: person,
  returns: { include: { receivedBy: person }, orderBy: { returnedAt: 'asc' } },
} as const satisfies Prisma.TransactionItemInclude;

// from and to are calendar days in the app timezone (ARCHITECTURE.md 6): from its first instant
// to the first instant of the day after to.
function issuedBetween(from: string, to: string): Prisma.DateTimeFilter {
  const start = DateTime.fromISO(from, { zone: config.timezone });
  const end = DateTime.fromISO(to, { zone: config.timezone }).plus({ days: 1 });
  return { gte: start.toJSDate(), lt: end.toJSDate() };
}

// One page of lines matching `where`, newest issue first.
async function listHistory(
  where: Prisma.TransactionItemWhereInput,
  { from, to, page, pageSize }: HistoryQuery,
): Promise<HistoryPage> {
  const filter = { AND: [where, { transaction: { issuedAt: issuedBetween(from, to) } }] };
  const [lines, total] = await Promise.all([
    prisma.transactionItem.findMany({
      where: filter,
      include: lineInclude,
      orderBy: [{ transaction: { issuedAt: 'desc' } }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.transactionItem.count({ where: filter }),
  ]);
  // Rule 1: borrower names come from BorrowerService, never from a join on the borrowers table.
  const found = await borrowerService.findByIds([
    ...new Set(lines.map((line) => line.transaction.borrowerId)),
  ]);
  const borrowers = new Map(found.map((b) => [b.id, b]));
  const data: HistoryLine[] = lines.map((line) => {
    const borrower = borrowers.get(line.transaction.borrowerId)!;
    return {
      lineId: line.id,
      transactionId: line.transactionId,
      borrower: { id: borrower.id, schoolId: borrower.schoolId, name: borrower.name },
      item: line.item,
      room: line.transaction.location,
      issuedAt: line.transaction.issuedAt.toISOString(),
      issuedBy: line.transaction.issuedBy,
      quantityBorrowed: line.quantityBorrowed,
      outstanding: line.quantityBorrowed - line.quantityReturned,
      returns: line.returns.map((event) => ({
        id: event.id,
        quantity: event.quantity,
        returnedAt: event.returnedAt.toISOString(),
        condition: event.condition,
        receivedBy: event.receivedBy,
      })),
      flagStatus: line.flagStatus,
      flaggedAt: line.flaggedAt?.toISOString() ?? null,
      override:
        line.overrideBy && line.overrideAt
          ? {
              by: line.overrideBy,
              at: line.overrideAt.toISOString(),
              reason: line.overrideReason ?? '',
            }
          : null,
      note: line.note,
      expectedReturnDate: line.expectedReturnDate?.toISOString().slice(0, 10) ?? null,
    };
  });
  return { data, page, pageSize, total };
}

// RPT-2: every line the borrower borrowed with an issue date in the range.
export async function listBorrowerHistory(
  borrowerId: string,
  query: HistoryQuery,
): Promise<HistoryPage> {
  if (!(await borrowerService.findById(borrowerId))) {
    throw new ApiError(404, 'NOT_FOUND', 'Borrower not found.');
  }
  return listHistory({ transaction: { borrowerId } }, query);
}

// RPT-3: every line of the item with an issue date in the range.
export async function listItemHistory(itemId: string, query: HistoryQuery): Promise<HistoryPage> {
  if (!(await prisma.item.findUnique({ where: { id: itemId }, select: { id: true } }))) {
    throw new ApiError(404, 'NOT_FOUND', 'Item not found.');
  }
  return listHistory({ itemId }, query);
}
