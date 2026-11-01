import type { Category } from '@bms/shared';
import { audit } from '../lib/audit.ts';
import { ApiError, isPrismaError } from '../lib/errors.ts';
import { prisma } from '../lib/prisma.ts';

// Categories (MD-1). Admin only; the route checks the role.

const withItemCount = { _count: { select: { items: true } } } as const;

function toCategory(row: { id: string; name: string; _count: { items: number } }): Category {
  return { id: row.id, name: row.name, itemCount: row._count.items };
}

// Names are unique regardless of case (SPEC.md 4, index on lower(name)).
// Reported as a field error, so the form shows it under the name.
function duplicateName(name: string): ApiError {
  const message = `A category named "${name}" already exists.`;
  return new ApiError(409, 'DUPLICATE_VALUE', message, { fields: { name: [message] } });
}

const notFound = () => new ApiError(404, 'NOT_FOUND', 'Category not found.');

export async function listCategories(page: number, pageSize: number) {
  const [rows, total] = await prisma.$transaction([
    prisma.category.findMany({
      include: withItemCount,
      orderBy: { name: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.category.count(),
  ]);
  return { data: rows.map(toCategory), page, pageSize, total };
}

export async function createCategory(actorId: string, name: string): Promise<Category> {
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.category.create({ data: { name }, include: withItemCount });
      // Rule 14
      await audit(tx, {
        actorId,
        action: 'CATEGORY_CREATED',
        entity: 'category',
        entityId: row.id,
        after: { name },
      });
      return toCategory(row);
    });
  } catch (error) {
    if (isPrismaError(error, 'P2002')) throw duplicateName(name);
    throw error;
  }
}

export async function renameCategory(actorId: string, id: string, name: string): Promise<Category> {
  try {
    return await prisma.$transaction(async (tx) => {
      const before = await tx.category.findUnique({ where: { id } });
      if (!before) throw notFound();
      const row = await tx.category.update({
        where: { id },
        data: { name },
        include: withItemCount,
      });
      // Rule 14
      await audit(tx, {
        actorId,
        action: 'CATEGORY_RENAMED',
        entity: 'category',
        entityId: id,
        before: { name: before.name },
        after: { name },
      });
      return toCategory(row);
    });
  } catch (error) {
    if (isPrismaError(error, 'P2002')) throw duplicateName(name);
    throw error;
  }
}

export async function deleteCategory(actorId: string, id: string): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.category.findUnique({ where: { id } });
      if (!before) throw notFound();
      // Rule 15: a category any item uses (retired items too) is never deleted. The items foreign
      // key (ON DELETE RESTRICT) refuses it, which also covers an item added at the same moment.
      await tx.category.delete({ where: { id } });
      // Rule 14
      await audit(tx, {
        actorId,
        action: 'CATEGORY_DELETED',
        entity: 'category',
        entityId: id,
        before: { name: before.name },
      });
    });
  } catch (error) {
    if (isPrismaError(error, 'P2003')) {
      throw new ApiError(
        409,
        'HAS_HISTORY',
        'This category is used by items, so it cannot be deleted. Rename it instead.',
      );
    }
    throw error;
  }
}
