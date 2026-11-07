import type { ItemCondition, ReturnEvent, ReturnInput, TrackingType } from '@bms/shared';
import { audit } from '../lib/audit.ts';
import { ApiError } from '../lib/errors.ts';
import { prisma } from '../lib/prisma.ts';

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
