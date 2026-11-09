import type {
  FlagStatus,
  ItemCondition,
  OpenLine,
  OpenLinePage,
  OpenLinesQuery,
  ReturnEvent,
  ReturnInput,
  TrackingType,
} from '@bms/shared';
import { Prisma } from '../generated/prisma/client.ts';
import { audit } from '../lib/audit.ts';
import { ApiError } from '../lib/errors.ts';
import { prisma } from '../lib/prisma.ts';
import { borrowerService } from './borrowers.ts';

// Returns (BRW-4, BR 5 and 6). The route checks the role and passes the signed-in user as the
// receiving handler (BR 5). There is no borrower check at all: returns are never blocked (BR 11).

type LockedLine = {
  id: string;
  item_id: string;
  quantity_borrowed: number;
  quantity_returned: number;
  name: string;
  asset_tag: string | null;
  tracking_type: TrackingType;
};

const label = (line: LockedLine) => (line.asset_tag ? `${line.name} ${line.asset_tag}` : line.name);

export async function recordReturn(
  receivedById: string,
  input: ReturnInput,
): Promise<ReturnEvent[]> {
  return prisma.$transaction(async (tx) => {
    // BR 5: lock the lines before checking outstanding, so two returns of the same line at once
    // cannot both pass. ORDER BY id: two requests listing the same lines never deadlock. Only the
    // line rows are locked here; item rows are locked below in id order, the same as checkout.
    // NO KEY UPDATE (the lock the quantity_returned UPDATE takes anyway) lets foreign-key checks,
    // such as an item delete, take their key-share lock without deadlocking with this return.
    const lineIds = input.lines.map((line) => line.lineId);
    const locked = await tx.$queryRaw<LockedLine[]>`
      SELECT ti.id, ti.item_id, ti.quantity_borrowed, ti.quantity_returned,
             i.name, i.asset_tag, i.tracking_type
      FROM transaction_items ti JOIN items i ON i.id = ti.item_id
      WHERE ti.id = ANY(${lineIds}::uuid[]) ORDER BY ti.id FOR NO KEY UPDATE OF ti`;
    const byId = new Map(locked.map((line) => [line.id, line]));

    for (const { lineId, quantity } of input.lines) {
      const line = byId.get(lineId);
      if (!line) throw new ApiError(404, 'NOT_FOUND', 'Line not found.', { lineId });
      // BR 5, S15: never more than is still out (a line with nothing out fails the same way).
      const outstanding = line.quantity_borrowed - line.quantity_returned;
      if (quantity > outstanding) {
        throw new ApiError(
          409,
          'RETURN_EXCEEDS_OUTSTANDING',
          `Only ${outstanding} of ${label(line)} still out, ${quantity} returned.`,
          { lineId, outstanding },
        );
      }
    }

    // SPEC 4, S17: a DAMAGED return of a UNIT item also marks the item DAMAGED (status unchanged).
    const damagedItemIds = input.lines
      .filter((entry) => entry.condition === 'DAMAGED')
      .map((entry) => byId.get(entry.lineId)!)
      .filter((line) => line.tracking_type === 'UNIT')
      .map((line) => line.item_id);
    const damagedItems = damagedItemIds.length
      ? await tx.$queryRaw<{ id: string; condition: ItemCondition }[]>`
          SELECT id, condition FROM items
          WHERE id = ANY(${damagedItemIds}::uuid[]) ORDER BY id FOR UPDATE`
      : [];
    for (const item of damagedItems.filter((item) => item.condition !== 'DAMAGED')) {
      await tx.item.update({ where: { id: item.id }, data: { condition: 'DAMAGED' } });
      // Rule 14
      await audit(tx, {
        actorId: receivedById,
        action: 'ITEM_UPDATED',
        entity: 'item',
        entityId: item.id,
        before: { condition: item.condition },
        after: { condition: 'DAMAGED' },
      });
    }

    const events: ReturnEvent[] = [];
    for (const { lineId, quantity, condition } of input.lines) {
      // BR 6: only quantity_returned changes; flag_status is never touched.
      const line = await tx.transactionItem.update({
        where: { id: lineId },
        data: { quantityReturned: { increment: quantity } },
      });
      const event = await tx.return.create({
        data: { transactionItemId: lineId, quantity, condition, receivedById },
      });
      const result: ReturnEvent = {
        id: event.id,
        lineId,
        quantity,
        condition,
        receivedById,
        returnedAt: event.returnedAt.toISOString(),
        outstanding: line.quantityBorrowed - line.quantityReturned,
      };
      // Rule 14
      await audit(tx, {
        actorId: receivedById,
        action: 'RETURN',
        entity: 'return',
        entityId: event.id,
        after: result,
      });
      events.push(result);
    }
    return events;
  });
}

type OpenLineRow = {
  id: string;
  transaction_id: string;
  borrower_id: string;
  item_id: string;
  item_name: string;
  asset_tag: string | null;
  tracking_type: TrackingType;
  location_name: string;
  issued_by_name: string;
  issued_at: Date;
  expected_return_date: Date | null;
  note: string | null;
  quantity_borrowed: number;
  quantity_returned: number;
  flag_status: FlagStatus;
  flagged_at: Date | null;
};

// Open lines for the Return screen (BRW-5, SPEC 5): lines with something still out, found by
// borrower, item name, or asset tag. Retired and lost items are listed like any other (owner
// decision 2026-11-10). Read-only, so no audit entry. Bounded: page size at most 100 (SPEC 7).
export async function listOpenLines({
  by,
  q,
  page,
  pageSize,
}: OpenLinesQuery): Promise<OpenLinePage> {
  let search = Prisma.empty;
  if (q !== undefined) {
    // Escaped so % and _ in the text match literally.
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    if (by === 'item') search = Prisma.sql`AND i.name ILIKE ${like}`;
    else if (by === 'assetTag') search = Prisma.sql`AND i.asset_tag ILIKE ${like}`;
    else {
      // Rule 1: borrowers are found through BorrowerService, never joined here.
      // shortcut: a text that matches more than 100 borrowers only finds the first 100; narrow the text.
      const found = await borrowerService.search(q, 100);
      search = Prisma.sql`AND t.borrower_id = ANY(${found.map((b) => b.id)}::uuid[])`;
    }
  }
  const from = Prisma.sql`
    FROM transaction_items ti
    JOIN transactions t ON t.id = ti.transaction_id
    JOIN items i ON i.id = ti.item_id
    JOIN locations l ON l.id = t.location_id
    JOIN users u ON u.id = t.issued_by
    WHERE ti.quantity_borrowed > ti.quantity_returned ${search}`;
  const [rows, [{ total }]] = await Promise.all([
    prisma.$queryRaw<OpenLineRow[]>`
      SELECT ti.id, ti.transaction_id, t.borrower_id, i.id AS item_id, i.name AS item_name,
             i.asset_tag, i.tracking_type, l.name AS location_name, u.name AS issued_by_name,
             t.issued_at, ti.expected_return_date, ti.note, ti.quantity_borrowed,
             ti.quantity_returned, ti.flag_status, ti.flagged_at
      ${from} ORDER BY t.issued_at, ti.id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    prisma.$queryRaw<{ total: number }[]>`SELECT COUNT(*)::int AS total ${from}`,
  ]);
  const borrowers = new Map(
    (await borrowerService.findByIds([...new Set(rows.map((row) => row.borrower_id))])).map((b) => [
      b.id,
      b,
    ]),
  );
  const data: OpenLine[] = rows.map((row) => {
    const borrower = borrowers.get(row.borrower_id)!;
    return {
      lineId: row.id,
      transactionId: row.transaction_id,
      borrower: { id: borrower.id, schoolId: borrower.schoolId, name: borrower.name },
      item: {
        id: row.item_id,
        name: row.item_name,
        assetTag: row.asset_tag,
        trackingType: row.tracking_type,
      },
      location: row.location_name,
      issuedBy: row.issued_by_name,
      issuedAt: row.issued_at.toISOString(),
      expectedReturnDate: row.expected_return_date?.toISOString().slice(0, 10) ?? null,
      note: row.note,
      quantityBorrowed: row.quantity_borrowed,
      outstanding: row.quantity_borrowed - row.quantity_returned,
      flagStatus: row.flag_status,
      flaggedAt: row.flagged_at?.toISOString() ?? null,
    };
  });
  return { data, page, pageSize, total };
}
