import {
  type Borrower,
  type BorrowerInput,
  type BorrowerListQuery,
  type BorrowerPage,
  type BorrowerUpdate,
  CONTROL_CHARACTER,
  SEARCH_MAX_LENGTH,
  SEARCH_MAX_LIMIT,
  SEARCH_MIN_LENGTH,
} from '@bms/shared';
import { z } from 'zod';
import type { Prisma } from '../generated/prisma/client.ts';
import { audit } from '../lib/audit.ts';
import { ApiError, isPrismaError } from '../lib/errors.ts';
import { prisma } from '../lib/prisma.ts';

// BorrowerService (MD-4, ARCHITECTURE.md 4). INTEGRATION POINT: this file is the only code that
// reads the borrowers table (CLAUDE.md rule 1). Checkout, reports, and the CSV import call
// `borrowerService` and depend only on the interface below. To use an external school database,
// write another class that implements BorrowerService and assign it to `borrowerService` here;
// no caller changes. Tests prove a test double works the same way (tests/borrower-service.test.ts).

export interface BorrowerService {
  findById(id: string): Promise<Borrower | null>;
  // Several at once; ids that do not exist are left out. For screens that list other records.
  findByIds(ids: string[]): Promise<Borrower[]>;
  // Matches name or school ID. `query` is 2 to 100 characters, `limit` 1 to 100 (SPEC.md 7).
  // `ids` (optional) limits the search to those borrowers, so callers can search among a known set.
  search(query: string, limit?: number, options?: { ids?: string[] }): Promise<Borrower[]>;
  // One page for the Borrowers screen: everyone, or those matching `q` (same bounds as search),
  // narrowed to one `type` and to active or inactive borrowers when those are given.
  list(params: BorrowerListQuery): Promise<BorrowerPage>;
  // `reason` is the error code checkout should answer with, such as BORROWER_INACTIVE.
  isEligible(id: string): Promise<{ eligible: boolean; reason?: string }>;
}

const SEARCH_DEFAULT_LIMIT = 25;

// Only these columns leave the service, so callers never see local-only fields.
const borrowerFields = {
  id: true,
  schoolId: true,
  name: true,
  type: true,
  department: true,
  active: true,
} as const;

// PostgreSQL rejects a malformed uuid, so ids that cannot exist are dropped.
const validIds = (ids: string[]) => ids.filter((id) => z.guid().safeParse(id).success);

const byName: Prisma.BorrowerOrderByWithRelationInput[] = [{ name: 'asc' }, { schoolId: 'asc' }];

// Shared by every implementation, so a replacement keeps the same bounds (SPEC.md 7).
export function checkSearchBounds(query: string, limit: number): void {
  if (query.length < SEARCH_MIN_LENGTH || query.length > SEARCH_MAX_LENGTH) {
    const message = `Search text must be ${SEARCH_MIN_LENGTH} to ${SEARCH_MAX_LENGTH} characters.`;
    throw new ApiError(400, 'VALIDATION_ERROR', message, { fields: { q: [message] } });
  }
  // A NUL makes PostgreSQL reject the query (Prisma P2039, a 500), so control characters are refused.
  if (CONTROL_CHARACTER.test(query)) {
    const message = 'Search text cannot contain control characters.';
    throw new ApiError(400, 'VALIDATION_ERROR', message, { fields: { q: [message] } });
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > SEARCH_MAX_LIMIT) {
    const message = `Limit must be a whole number from 1 to ${SEARCH_MAX_LIMIT}.`;
    throw new ApiError(400, 'VALIDATION_ERROR', message, { fields: { limit: [message] } });
  }
}

// Name or school ID contains the text, ignoring case.
function matching(text: string) {
  // Prisma passes % and _ to LIKE as wildcards; escape them so the text matches literally.
  const literal = text.replace(/[\\%_]/g, '\\$&');
  return {
    OR: [
      { name: { contains: literal, mode: 'insensitive' as const } },
      { schoolId: { contains: literal, mode: 'insensitive' as const } },
    ],
  };
}

// Reads the local `borrowers` table.
export class LocalBorrowerService implements BorrowerService {
  async findById(id: string): Promise<Borrower | null> {
    // PostgreSQL rejects a malformed uuid with an error; an id that cannot exist is simply not found.
    // z.guid, not z.uuid: PostgreSQL accepts any well-formed uuid, not only RFC versions 1 to 8.
    if (!z.guid().safeParse(id).success) return null;
    return prisma.borrower.findUnique({ where: { id }, select: borrowerFields });
  }

  async findByIds(ids: string[]): Promise<Borrower[]> {
    return prisma.borrower.findMany({
      where: { id: { in: validIds(ids) } },
      select: borrowerFields,
    });
  }

  // async, so a bounds error rejects the promise instead of throwing.
  // Includes inactive borrowers (active: false) so admins can find them; checkout refuses them
  // through isEligible (rule 3).
  async search(
    query: string,
    limit = SEARCH_DEFAULT_LIMIT,
    options: { ids?: string[] } = {},
  ): Promise<Borrower[]> {
    const text = query.trim();
    checkSearchBounds(text, limit);
    return prisma.borrower.findMany({
      where: options.ids
        ? { ...matching(text), id: { in: validIds(options.ids) } }
        : matching(text),
      select: borrowerFields,
      orderBy: byName,
      take: limit,
    });
  }

  // Like search, but paginated with a total. The route schema checks page and pageSize.
  async list({ q, type, active, page, pageSize }: BorrowerListQuery) {
    let where: Prisma.BorrowerWhereInput = { type, active };
    if (q !== undefined) {
      const text = q.trim();
      checkSearchBounds(text, pageSize);
      where = { ...where, ...matching(text) };
    }
    const [data, total] = await prisma.$transaction([
      prisma.borrower.findMany({
        where,
        select: borrowerFields,
        orderBy: byName,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.borrower.count({ where }),
    ]);
    return { data, page, pageSize, total };
  }

  async isEligible(id: string): Promise<{ eligible: boolean; reason?: string }> {
    const borrower = await this.findById(id);
    if (!borrower) return { eligible: false, reason: 'NOT_FOUND' };
    // Rule 3: inactive borrowers cannot borrow.
    if (!borrower.active) return { eligible: false, reason: 'BORROWER_INACTIVE' };
    // Rule 3 and 11: the strike-based block (BORROWER_BLOCKED) is added here in FLG-3.
    return { eligible: true };
  }
}

// The one instance callers use. Swap the implementation on this line (see the top of this file).
export const borrowerService: BorrowerService = new LocalBorrowerService();

// Writes for the Borrowers screen (MD-5, admin only; the route checks the role). They live here
// because rule 1 lets only this file touch the borrowers table. They are not part of
// BorrowerService: an external school database would own the records, so these would be removed
// then, not reimplemented.

// School IDs are unique regardless of case (SPEC.md 4, index on lower(school_id)); stored as typed.
// Reported on the field, so the form shows it.
function duplicateSchoolId(schoolId: string): ApiError {
  const message = `A borrower with school ID "${schoolId}" already exists.`;
  return new ApiError(409, 'DUPLICATE_VALUE', message, { fields: { schoolId: [message] } });
}

export async function createBorrower(actorId: string, input: BorrowerInput): Promise<Borrower> {
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.borrower.create({ data: input, select: borrowerFields });
      // Rule 14
      await audit(tx, {
        actorId,
        action: 'BORROWER_CREATED',
        entity: 'borrower',
        entityId: row.id,
        after: { ...input, active: row.active },
      });
      return row;
    });
  } catch (error) {
    if (isPrismaError(error, 'P2002')) throw duplicateSchoolId(input.schoolId);
    throw error;
  }
}

// Edits fields, and deactivates or reactivates. Borrowers are never deleted (rule 15).
export async function updateBorrower(
  actorId: string,
  id: string,
  changes: BorrowerUpdate,
): Promise<Borrower> {
  try {
    return await prisma.$transaction(async (tx) => {
      // Lock the row first, so two admins editing at once take turns and each audit entry
      // records the values its change really replaced (rule 14).
      await tx.$queryRaw`SELECT 1 FROM borrowers WHERE id = ${id}::uuid FOR UPDATE`;
      const before = await tx.borrower.findUnique({ where: { id }, select: borrowerFields });
      if (!before) throw new ApiError(404, 'NOT_FOUND', 'Borrower not found.');
      const changedKeys = (Object.keys(changes) as (keyof BorrowerUpdate)[]).filter(
        (key) => changes[key] !== before[key],
      );
      // Nothing differs: nothing is written or audited.
      if (changedKeys.length === 0) return before;
      const pick = (source: BorrowerUpdate) =>
        Object.fromEntries(changedKeys.map((key) => [key, source[key]]));
      const row = await tx.borrower.update({
        where: { id },
        data: pick(changes),
        select: borrowerFields,
      });
      // Rule 14: the changed fields, before and after.
      await audit(tx, {
        actorId,
        action: 'BORROWER_UPDATED',
        entity: 'borrower',
        entityId: id,
        before: pick(before),
        after: pick(changes),
      });
      return row;
    });
  } catch (error) {
    if (isPrismaError(error, 'P2002')) throw duplicateSchoolId(changes.schoolId ?? '');
    throw error;
  }
}
