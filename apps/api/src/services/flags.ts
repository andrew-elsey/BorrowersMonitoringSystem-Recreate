import type {
  FlaggedLine,
  FlaggedLinePage,
  FlagListQuery,
  OverrideInput,
  OverrideResult,
} from '@bms/shared';
import { Prisma } from '../generated/prisma/client.ts';
import { audit } from '../lib/audit.ts';
import { ApiError } from '../lib/errors.ts';
import { prisma } from '../lib/prisma.ts';
import { borrowerService } from './borrowers.ts';
import { getCurrentSemester } from './semesters.ts';
import { getSettings } from './settings.ts';
import { countStrikesForBorrowers } from './strikes.ts';

// Flag review and override (FLG-4, BR 13). The route checks the admin role (PERMISSIONS.overrideFlags).

type FlaggedRow = {
  id: string;
  transaction_id: string;
  borrower_id: string;
  item_id: string;
  item_name: string;
  asset_tag: string | null;
  issued_at: Date;
  flagged_at: Date;
  quantity_borrowed: number;
  quantity_returned: number;
  note: string | null;
  expected_return_date: Date | null;
};

// A borrower search looks through at most this many borrowers with flagged lines (CLAUDE.md rule 12).
export const FLAGGED_BORROWER_CAP = 5000;

// Owner decision 2026-11-10: the list shows only the CURRENT semester's flagged lines, the same
// semester BR 10 and 12 count strikes in. Older flags stay in the database for history and reports.
// With no current semester nothing is in it (BR 10: no carry-over), so the list is empty.
export async function listFlaggedLines(
  { returned, q, page, pageSize }: FlagListQuery,
  cap = FLAGGED_BORROWER_CAP,
): Promise<FlaggedLinePage> {
  const { blockThreshold } = await getSettings();
  const semester = await getCurrentSemester();
  if (!semester) return { data: [], page, pageSize, total: 0, blockThreshold };

  const state =
    returned === 'out'
      ? Prisma.sql`AND ti.quantity_borrowed > ti.quantity_returned`
      : returned === 'returned'
        ? Prisma.sql`AND ti.quantity_borrowed <= ti.quantity_returned`
        : Prisma.empty;
  const where = Prisma.sql`WHERE ti.flag_status = 'FLAGGED' AND t.semester_id = ${semester.id}::uuid ${state}`;
  const join = Prisma.sql`
    FROM transaction_items ti
    JOIN transactions t ON t.id = ti.transaction_id
    JOIN items i ON i.id = ti.item_id`;

  let search = Prisma.empty;
  if (q !== undefined) {
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    // Rule 1: borrowers are found through BorrowerService, never joined here. Search only among
    // borrowers that have a line in this list, so a match is never cut off by the 100-result limit
    // (the same fix as BRW-5's open-lines search).
    const withFlags = await prisma.$queryRaw<{ borrower_id: string }[]>`
      SELECT DISTINCT t.borrower_id ${join} ${where} LIMIT ${cap + 1}`;
    // Never cut the list silently: a borrower past the cap would look like "no flagged lines".
    if (withFlags.length > cap) {
      throw new ApiError(
        422,
        'SEARCH_TOO_BROAD',
        'Too many borrowers have flagged lines; search by item or asset tag.',
      );
    }
    // shortcut: covers at most 100 flagged borrowers that match the text; upgrade if a search ever
    // needs more.
    const found = await borrowerService.search(q, 100, {
      ids: withFlags.map((row) => row.borrower_id),
    });
    search = Prisma.sql`AND (i.name ILIKE ${like} OR i.asset_tag ILIKE ${like}
      OR t.borrower_id = ANY(${found.map((b) => b.id)}::uuid[]))`;
  }
  const from = Prisma.sql`${join} ${where} ${search}`;
  const [rows, [{ total }]] = await Promise.all([
    prisma.$queryRaw<FlaggedRow[]>`
      SELECT ti.id, ti.transaction_id, t.borrower_id, i.id AS item_id, i.name AS item_name,
             i.asset_tag, t.issued_at, ti.flagged_at, ti.quantity_borrowed, ti.quantity_returned,
             ti.note, ti.expected_return_date
      ${from} ORDER BY ti.flagged_at DESC, ti.id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    prisma.$queryRaw<{ total: number }[]>`SELECT COUNT(*)::int AS total ${from}`,
  ]);
  const borrowerIds = [...new Set(rows.map((row) => row.borrower_id))];
  const [found, strikes] = await Promise.all([
    borrowerService.findByIds(borrowerIds),
    countStrikesForBorrowers(borrowerIds, semester.id),
  ]);
  const borrowers = new Map(found.map((b) => [b.id, b]));
  const data: FlaggedLine[] = rows.map((row) => {
    const borrower = borrowers.get(row.borrower_id)!;
    return {
      lineId: row.id,
      transactionId: row.transaction_id,
      borrower: { id: borrower.id, schoolId: borrower.schoolId, name: borrower.name },
      item: { id: row.item_id, name: row.item_name, assetTag: row.asset_tag },
      issuedAt: row.issued_at.toISOString(),
      flaggedAt: row.flagged_at.toISOString(),
      quantityBorrowed: row.quantity_borrowed,
      outstanding: row.quantity_borrowed - row.quantity_returned,
      strikes: strikes.get(row.borrower_id) ?? 0,
      note: row.note,
      expectedReturnDate: row.expected_return_date?.toISOString().slice(0, 10) ?? null,
    };
  });
  return { data, page, pageSize, total, blockThreshold };
}

// BR 13: only a FLAGGED line can be overridden, before or after it is returned. Strikes are counted
// from FLAGGED lines (BR 10), so the line stops counting without any other change. The flagging job
// skips OVERRIDDEN lines (BR 8), so it is never flagged again.
export async function overrideFlag(
  adminId: string,
  lineId: string,
  { reason }: OverrideInput,
): Promise<OverrideResult> {
  return prisma.$transaction(async (tx) => {
    // Lock the line so two overrides at once cannot both pass the status check.
    const [line] = await tx.$queryRaw<{ flag_status: string; borrower_id: string }[]>`
      SELECT ti.flag_status, t.borrower_id
      FROM transaction_items ti JOIN transactions t ON t.id = ti.transaction_id
      WHERE ti.id = ${lineId}::uuid FOR UPDATE OF ti`;
    if (!line) throw new ApiError(404, 'NOT_FOUND', 'Line not found.');
    if (line.flag_status !== 'FLAGGED') {
      throw new ApiError(409, 'LINE_NOT_FLAGGED', 'Only a flagged line can be overridden.', {
        lineId,
        flagStatus: line.flag_status,
      });
    }
    const overrideAt = new Date();
    await tx.transactionItem.update({
      where: { id: lineId },
      data: { flagStatus: 'OVERRIDDEN', overrideById: adminId, overrideAt, overrideReason: reason },
    });
    // Rule 14
    await audit(tx, {
      actorId: adminId,
      action: 'FLAG_OVERRIDDEN',
      entity: 'transaction_item',
      entityId: lineId,
      before: { flagStatus: 'FLAGGED' },
      after: { flagStatus: 'OVERRIDDEN', overrideAt: overrideAt.toISOString(), reason },
    });
    // The borrower's strikes now, in the current semester, for the screen's confirmation.
    const semester = await getCurrentSemester(tx);
    const strikes = semester
      ? ((await countStrikesForBorrowers([line.borrower_id], semester.id, tx)).get(
          line.borrower_id,
        ) ?? 0)
      : 0;
    return {
      lineId,
      flagStatus: 'OVERRIDDEN' as const,
      overrideAt: overrideAt.toISOString(),
      strikes,
    };
  });
}
