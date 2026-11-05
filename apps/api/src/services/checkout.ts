import type { Checkout, CheckoutInput, ItemStatus, TrackingType } from '@bms/shared';
import { audit } from '../lib/audit.ts';
import { ApiError } from '../lib/errors.ts';
import { prisma } from '../lib/prisma.ts';
import { getAvailability } from './availability.ts';
import { borrowerService } from './borrowers.ts';
import { requireCurrentSemester } from './semesters.ts';

// Checkout (BRW-2, BR 1 to 4). The route checks the role and passes the signed-in user as the
// issuing handler (BR 2). The strike-based block (BORROWER_BLOCKED, BR 11) comes in FLG-3, through
// borrowerService.isEligible.

type LockedItem = {
  id: string;
  name: string;
  asset_tag: string | null;
  tracking_type: TrackingType;
  status: ItemStatus;
};

const label = (item: LockedItem) => (item.asset_tag ? `${item.name} ${item.asset_tag}` : item.name);
const toDate = (date: string) => new Date(`${date}T00:00:00Z`);

// The first problem with a line, checked in the order of S14, or null when it can be issued.
function lineError(item: LockedItem, quantity: number, available: number): ApiError | null {
  const details = { itemId: item.id };
  // BR 1: only ACTIVE items can be issued.
  if (item.status !== 'ACTIVE') {
    return new ApiError(
      409,
      'ITEM_UNAVAILABLE',
      `${label(item)} cannot be issued: it is ${item.status.toLowerCase().replace('_', ' ')}.`,
      details,
    );
  }
  if (item.tracking_type === 'UNIT') {
    // Glossary: a unit item line always has quantity 1.
    if (quantity !== 1) {
      const message = `${label(item)} is a unit item, so its quantity must be 1.`;
      return new ApiError(400, 'VALIDATION_ERROR', message, { fields: { lines: [message] } });
    }
    // BR 1: a unit item with an open line is out.
    if (available < 1) {
      return new ApiError(409, 'ITEM_UNAVAILABLE', `${label(item)} is already borrowed.`, details);
    }
    return null;
  }
  // BR 1: a quantity item up to total minus outstanding.
  if (quantity > available) {
    return new ApiError(
      409,
      'INSUFFICIENT_QUANTITY',
      `Only ${available} of ${label(item)} available, ${quantity} requested.`,
      { ...details, available },
    );
  }
  return null;
}

export async function checkout(issuedById: string, input: CheckoutInput): Promise<Checkout> {
  // BR 3: inactive (and, from FLG-3, blocked) borrowers cannot borrow.
  const eligibility = await borrowerService.isEligible(input.borrowerId);
  if (!eligibility.eligible) {
    if (eligibility.reason === 'NOT_FOUND') {
      throw new ApiError(404, 'NOT_FOUND', 'Borrower not found.');
    }
    throw new ApiError(409, eligibility.reason!, 'This borrower is inactive and cannot borrow.');
  }

  // BR 4: everything below commits together or not at all.
  return prisma.$transaction(async (tx) => {
    // BR 2: no current semester, no checkout.
    const semester = await requireCurrentSemester(tx);
    const location = await tx.location.findUnique({ where: { id: input.locationId } });
    if (!location) throw new ApiError(404, 'NOT_FOUND', 'Room or lab not found.');

    // BR 4: lock the item rows before re-checking availability, so a second checkout of the same
    // items waits until this one commits. ORDER BY id: two checkouts listing the same items in
    // different orders take the locks in the same order and cannot deadlock.
    const itemIds = input.lines.map((line) => line.itemId);
    const items = await tx.$queryRaw<LockedItem[]>`
      SELECT id, name, asset_tag, tracking_type, status FROM items
      WHERE id = ANY(${itemIds}::uuid[]) ORDER BY id FOR UPDATE`;
    const byId = new Map(items.map((item) => [item.id, item]));
    const available = await getAvailability(itemIds, tx);

    for (const line of input.lines) {
      const item = byId.get(line.itemId);
      if (!item) {
        throw new ApiError(404, 'NOT_FOUND', 'Item not found.', { itemId: line.itemId });
      }
      const error = lineError(item, line.quantity, available.get(item.id) ?? 0);
      if (error) throw error;
    }

    const transaction = await tx.transaction.create({
      data: {
        borrowerId: input.borrowerId,
        locationId: location.id,
        issuedById,
        semesterId: semester.id,
        lines: {
          create: input.lines.map((line) => ({
            itemId: line.itemId,
            quantityBorrowed: line.quantity,
            note: line.note || null,
            expectedReturnDate: line.expectedReturnDate ? toDate(line.expectedReturnDate) : null,
          })),
        },
      },
      include: { lines: true },
    });
    const result: Checkout = {
      id: transaction.id,
      borrowerId: transaction.borrowerId,
      locationId: transaction.locationId,
      issuedById: transaction.issuedById,
      issuedAt: transaction.issuedAt.toISOString(),
      semesterId: transaction.semesterId,
      lines: transaction.lines.map((line) => ({
        id: line.id,
        itemId: line.itemId,
        quantity: line.quantityBorrowed,
        note: line.note,
        expectedReturnDate: line.expectedReturnDate?.toISOString().slice(0, 10) ?? null,
      })),
    };
    // Rule 14
    await audit(tx, {
      actorId: issuedById,
      action: 'CHECKOUT',
      entity: 'transaction',
      entityId: transaction.id,
      after: result,
    });
    return result;
  });
}
