import {
  type Item,
  type ItemInput,
  type ItemListQuery,
  type ItemPage,
  type ItemUpdate,
  trackingErrors,
} from '@bms/shared';
import type { Prisma } from '../generated/prisma/client.ts';
import { audit } from '../lib/audit.ts';
import { ApiError, isPrismaError } from '../lib/errors.ts';
import { prisma } from '../lib/prisma.ts';
import { getAvailability } from './availability.ts';

// Items (MD-2). Writes are admin only and the list is open to all staff; the routes check the role.

// Only these columns leave the service; the shape is the shared `Item` type.
const itemFields = {
  id: true,
  name: true,
  category: { select: { id: true, name: true } },
  description: true,
  trackingType: true,
  assetTag: true,
  totalQuantity: true,
  condition: true,
  status: true,
} as const;

const notFound = () => new ApiError(404, 'NOT_FOUND', 'Item not found.');

const fieldError = (status: number, code: string, field: string, message: string) =>
  new ApiError(status, code, message, { fields: { [field]: [message] } });

// Asset tags are unique regardless of case (SPEC.md 4, index on lower(asset_tag)); stored as typed.
// The only unique column on items, so P2002 always means the asset tag.
// Items point at categories (P2003) only through categoryId, so on create and update it means
// the chosen category does not exist.
function toFieldError(error: unknown, assetTag: string | null | undefined): unknown {
  if (isPrismaError(error, 'P2002')) {
    return fieldError(
      409,
      'DUPLICATE_VALUE',
      'assetTag',
      `Asset tag ${assetTag} is already used by another item.`,
    );
  }
  if (isPrismaError(error, 'P2003')) {
    return fieldError(400, 'VALIDATION_ERROR', 'categoryId', 'Choose a category that exists.');
  }
  return error;
}

// An empty description is stored as none.
const storedDescription = (description: string | undefined) =>
  description === undefined ? undefined : description || null;

export async function listItems({
  q,
  categoryId,
  status,
  trackingType,
  page,
  pageSize,
}: ItemListQuery): Promise<ItemPage> {
  // Prisma passes % and _ to LIKE as wildcards; escape them so the text matches literally.
  const literal = q?.replace(/[\\%_]/g, '\\$&');
  const where: Prisma.ItemWhereInput = {
    categoryId,
    status,
    trackingType,
    ...(literal && {
      OR: [
        { name: { contains: literal, mode: 'insensitive' } },
        { assetTag: { contains: literal, mode: 'insensitive' } },
      ],
    }),
  };
  const [data, total] = await prisma.$transaction([
    prisma.item.findMany({
      where,
      select: itemFields,
      orderBy: [{ name: 'asc' }, { assetTag: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.item.count({ where }),
  ]);
  // One availability read for the whole page (BR 1), so the checkout search can show what is left.
  const available = await getAvailability(data.map((item) => item.id));
  return {
    data: data.map((item) => ({ ...item, available: available.get(item.id) ?? 0 })),
    page,
    pageSize,
    total,
  };
}

export async function createItem(actorId: string, input: ItemInput): Promise<Item> {
  const data = {
    ...input,
    description: storedDescription(input.description),
    // SPEC.md 4: a UNIT item is always one piece.
    totalQuantity: input.trackingType === 'UNIT' ? 1 : input.totalQuantity!,
  };
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.item.create({ data, select: itemFields });
      // Rule 14
      await audit(tx, {
        actorId,
        action: 'ITEM_CREATED',
        entity: 'item',
        entityId: row.id,
        after: data,
      });
      return row;
    });
  } catch (error) {
    throw toFieldError(error, input.assetTag);
  }
}

// Edits fields, including status (retiring is setting it to RETIRED, rule 15). The tracking type
// never changes (the schema refuses it).
export async function updateItem(actorId: string, id: string, changes: ItemUpdate): Promise<Item> {
  // Only the fields sent are in `changes` (the schema refuses trackingType).
  const data: Omit<ItemUpdate, 'description' | 'trackingType'> & { description?: string | null } = {
    ...changes,
  };
  if (changes.description !== undefined) data.description = storedDescription(changes.description);
  try {
    return await prisma.$transaction(async (tx) => {
      // Lock the row first, so two admins editing at once take turns and each audit entry
      // records the values its change really replaced (rule 14).
      await tx.$queryRaw`SELECT 1 FROM items WHERE id = ${id}::uuid FOR UPDATE`;
      const row = await tx.item.findUnique({ where: { id }, select: itemFields });
      if (!row) throw notFound();
      const before = { ...row, categoryId: row.category.id };
      // SPEC.md 4, checked against the item's own tracking type.
      const errors = Object.entries(trackingErrors({ ...before, ...data }));
      if (errors.length > 0) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Some fields are invalid.', {
          fields: Object.fromEntries(errors.map(([field, message]) => [field, [message]])),
        });
      }
      const changedKeys = (Object.keys(data) as (keyof typeof data)[]).filter(
        (key) => data[key] !== before[key],
      );
      // Nothing differs: nothing is written or audited.
      if (changedKeys.length === 0) return row;
      const pick = (source: Record<string, unknown>) =>
        Object.fromEntries(changedKeys.map((key) => [key, source[key]])) as Prisma.InputJsonObject;
      const updated = await tx.item.update({ where: { id }, data, select: itemFields });
      // Rule 14: the changed fields, before and after.
      await audit(tx, {
        actorId,
        action: 'ITEM_UPDATED',
        entity: 'item',
        entityId: id,
        before: pick(before),
        after: pick(data),
      });
      return updated;
    });
  } catch (error) {
    throw toFieldError(error, data.assetTag);
  }
}

export async function deleteItem(actorId: string, id: string): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.item.findUnique({ where: { id }, select: itemFields });
      if (!before) throw notFound();
      // Rule 15, S19: an item in any transaction line is retired, never deleted. The lines foreign
      // key (ON DELETE RESTRICT) refuses it, which also covers a checkout at the same moment.
      await tx.item.delete({ where: { id } });
      // Rule 14
      await audit(tx, {
        actorId,
        action: 'ITEM_DELETED',
        entity: 'item',
        entityId: id,
        before,
      });
    });
  } catch (error) {
    if (isPrismaError(error, 'P2003')) {
      throw new ApiError(
        409,
        'HAS_HISTORY',
        'This item appears in past transactions. Set its status to Retired instead.',
      );
    }
    throw error;
  }
}
