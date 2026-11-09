import type { FlaggedLine, FlaggedLinePage, FlagListQuery, OverrideInput } from '@bms/shared';
import { Prisma } from '../generated/prisma/client.ts';
import { audit } from '../lib/audit.ts';
import { ApiError } from '../lib/errors.ts';
import { prisma } from '../lib/prisma.ts';
import { borrowerService } from './borrowers.ts';

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

export async function listFlaggedLines({
  returned,
  q,
  page,
  pageSize,
}: FlagListQuery): Promise<FlaggedLinePage> {
  let search = Prisma.empty;
  if (q !== undefined) {
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    // Rule 1: borrowers are found through BorrowerService, never joined here.
    // shortcut: covers at most 100 matching borrowers; upgrade if a search ever needs more.
    const found = await borrowerService.search(q, 100);
    search = Prisma.sql`AND (i.name ILIKE ${like} OR i.asset_tag ILIKE ${like}
      OR t.borrower_id = ANY(${found.map((b) => b.id)}::uuid[]))`;
  }
  const state =
    returned === 'out'
      ? Prisma.sql`AND ti.quantity_borrowed > ti.quantity_returned`
      : returned === 'returned'
        ? Prisma.sql`AND ti.quantity_borrowed <= ti.quantity_returned`
        : Prisma.empty;
  const from = Prisma.sql`
    FROM transaction_items ti
    JOIN transactions t ON t.id = ti.transaction_id
    JOIN items i ON i.id = ti.item_id
    WHERE ti.flag_status = 'FLAGGED' ${state} ${search}`;
  const [rows, [{ total }]] = await Promise.all([
    prisma.$queryRaw<FlaggedRow[]>`
      SELECT ti.id, ti.transaction_id, t.borrower_id, i.id AS item_id, i.name AS item_name,
             i.asset_tag, t.issued_at, ti.flagged_at, ti.quantity_borrowed, ti.quantity_returned,
             ti.note, ti.expected_return_date
      ${from} ORDER BY ti.flagged_at DESC, ti.id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    prisma.$queryRaw<{ total: number }[]>`SELECT COUNT(*)::int AS total ${from}`,
  ]);
  const borrowers = new Map(
    (await borrowerService.findByIds([...new Set(rows.map((row) => row.borrower_id))])).map((b) => [
      b.id,
      b,
    ]),
  );
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
      note: row.note,
      expectedReturnDate: row.expected_return_date?.toISOString().slice(0, 10) ?? null,
    };
  });
  return { data, page, pageSize, total };
}

// BR 13: only a FLAGGED line can be overridden, before or after it is returned. Strikes are counted
// from FLAGGED lines (BR 10), so the line stops counting without any other change. The flagging job
// skips OVERRIDDEN lines (BR 8), so it is never flagged again.
export async function overrideFlag(
  adminId: string,
  lineId: string,
  { reason }: OverrideInput,
): Promise<{ lineId: string; flagStatus: 'OVERRIDDEN'; overrideAt: string }> {
  return prisma.$transaction(async (tx) => {
    // Lock the line so two overrides at once cannot both pass the status check.
    const [line] = await tx.$queryRaw<{ flag_status: string }[]>`
      SELECT flag_status FROM transaction_items WHERE id = ${lineId}::uuid FOR UPDATE`;
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
    return { lineId, flagStatus: 'OVERRIDDEN' as const, overrideAt: overrideAt.toISOString() };
  });
}
