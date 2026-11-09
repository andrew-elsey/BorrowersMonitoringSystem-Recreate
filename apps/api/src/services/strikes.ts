import type { Prisma } from '../generated/prisma/client.ts';
import { prisma } from '../lib/prisma.ts';

// Strike service (FLG-1). Counted from transactions and their lines, never stored, and never
// reads the borrowers table (CLAUDE.md rule 1). FLG-3 calls it to warn and block at checkout.

// BR 10: a strike is a transaction in the current semester with at least one FLAGGED line, so a
// transaction counts once however many lines are flagged, and stops counting once every flagged
// line is OVERRIDDEN. BR 12: the current semester is read from the database on every call, so
// switching semesters resets the count and switching back brings it back. With no current
// semester no transaction is in it, so the count is 0.
export function countStrikes(
  borrowerId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<number> {
  return db.transaction.count({
    where: {
      borrowerId,
      semester: { isCurrent: true },
      lines: { some: { flagStatus: 'FLAGGED' } },
    },
  });
}

// FLG-4: strikes for many borrowers in one grouped query (the Flag review list), with the same
// meaning as countStrikes (BR 10, 12) for the given semester. Borrowers with none are not in the map.
export async function countStrikesForBorrowers(
  borrowerIds: string[],
  semesterId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<Map<string, number>> {
  const groups = await db.transaction.groupBy({
    by: ['borrowerId'],
    where: {
      borrowerId: { in: borrowerIds },
      semesterId,
      lines: { some: { flagStatus: 'FLAGGED' } },
    },
    _count: { _all: true },
  });
  return new Map(groups.map((group) => [group.borrowerId, group._count._all]));
}
