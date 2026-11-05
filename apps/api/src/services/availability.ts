import type { ItemStatus } from '@bms/shared';
import type { Prisma } from '../generated/prisma/client.ts';
import { prisma } from '../lib/prisma.ts';

// Availability (BRW-1, BR 1) is always calculated from open lines and never stored (SPEC.md 4).
// Checkout (BRW-2) locks the item rows, then calls getAvailability with its transaction client
// so the re-check sees the locked state (BR 4).

// BR 1: a non-ACTIVE item is never available. Otherwise total minus outstanding on open lines.
// A UNIT item always has total 1, so one open line leaves 0.
// Never below 0: MD-2 lets an admin lower a total under what is already out.
export function availableQuantity(
  item: { status: ItemStatus; totalQuantity: number },
  outstanding: number,
): number {
  if (item.status !== 'ACTIVE') return 0;
  return Math.max(0, item.totalQuantity - outstanding);
}

// Available quantity per item id. Ids that match no item are left out of the map.
export async function getAvailability(
  itemIds: string[],
  db: Prisma.TransactionClient = prisma,
): Promise<Map<string, number>> {
  const items = await db.item.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, status: true, totalQuantity: true },
  });
  // Outstanding = borrowed minus returned on open lines only (glossary). This filter matches the
  // partial index transaction_items_open_by_item_idx, so the read stays bounded as history grows.
  const sums = await db.transactionItem.groupBy({
    by: ['itemId'],
    where: {
      itemId: { in: itemIds },
      quantityReturned: { lt: db.transactionItem.fields.quantityBorrowed },
    },
    _sum: { quantityBorrowed: true, quantityReturned: true },
  });
  const outstanding = new Map(
    sums.map((s) => [s.itemId, (s._sum.quantityBorrowed ?? 0) - (s._sum.quantityReturned ?? 0)]),
  );
  return new Map(
    items.map((item) => [item.id, availableQuantity(item, outstanding.get(item.id) ?? 0)]),
  );
}
