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
import { randomUUID } from 'node:crypto';
import { type AuditEntry, audit, auditMany } from '../lib/audit.ts';
import { type Finding, changedAfterLastEntry, missingEntry } from '../lib/audit-sweep-sql.ts';
import { ApiError, isPrismaError } from '../lib/errors.ts';
import { prisma } from '../lib/prisma.ts';
import { getSettings } from './settings.ts';
import { countStrikes } from './strikes.ts';

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
  // `reason` is the error code checkout should answer with: NOT_FOUND, BORROWER_INACTIVE, or
  // BORROWER_BLOCKED. Checkout calls it inside its transaction (`tx`); the borrower row is locked
  // FOR SHARE so the answer holds until commit. `semesterId` is the semester checkout records, so
  // the strikes counted are the ones of that semester (BR 11, 12); left out, the current one.
  isEligible(
    id: string,
    tx: Prisma.TransactionClient,
    semesterId?: string,
  ): Promise<{ eligible: boolean; reason?: string }>;
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

  async isEligible(id: string, tx: Prisma.TransactionClient, semesterId?: string) {
    if (!z.guid().safeParse(id).success) return { eligible: false, reason: 'NOT_FOUND' };
    // FOR SHARE: an admin deactivating this borrower at the same moment waits for the checkout.
    const [borrower] = await tx.$queryRaw<{ active: boolean }[]>`
      SELECT active FROM borrowers WHERE id = ${id}::uuid FOR SHARE`;
    if (!borrower) return { eligible: false, reason: 'NOT_FOUND' };
    // BR 3: inactive borrowers cannot borrow.
    if (!borrower.active) return { eligible: false, reason: 'BORROWER_INACTIVE' };
    // BR 11: at or over the block threshold (from settings, rule 3), checkout is blocked.
    const { blockThreshold } = await getSettings(tx);
    if ((await countStrikes(id, tx, semesterId)) >= blockThreshold) {
      return { eligible: false, reason: 'BORROWER_BLOCKED' };
    }
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

// One valid CSV row (MD-6). `row` is its line in the file.
export type BorrowerImportRow = BorrowerInput & { row: number; active: boolean };

// Room for 5,000 rows and their audit entries, under the 30 s request timeout (ARCHITECTURE.md 12.3).
const IMPORT_TRANSACTION_TIMEOUT_MS = 20_000;

// Prisma builds each statement in JavaScript, which holds the event loop for about 0.2 s at
// 5,000 rows; pieces of 500 keep every pause short for other requests (ARCHITECTURE.md 12.3).
const IMPORT_CHUNK_ROWS = 500;
function chunks<T>(list: T[]): T[][] {
  const parts: T[][] = [];
  for (let i = 0; i < list.length; i += IMPORT_CHUNK_ROWS) {
    parts.push(list.slice(i, i + IMPORT_CHUNK_ROWS));
  }
  return parts;
}

const importFields = ({ schoolId, name, type, department, active }: BorrowerImportRow) => ({
  schoolId,
  name,
  type,
  department,
  active,
});

// Creates or updates borrowers matched on school ID, ignoring case (SPEC.md 6), in one
// transaction with their audit entries and one BORROWER_IMPORT entry with the counts (rule 14).
// Set-based (a few statements, not one per row) so 5,000 rows stay quick.
export async function importBorrowers(
  actorId: string,
  rows: BorrowerImportRow[],
  rejected: number,
): Promise<{ created: number; updated: number; unchanged: number }> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        // Lock the matched borrowers, like updateBorrower, so an admin editing one at the same
        // moment takes turns with the import and the audit entries record what was replaced.
        const lowered = rows.map((row) => row.schoolId.toLowerCase());
        const existing = await tx.$queryRaw<Borrower[]>`
          SELECT id, school_id AS "schoolId", name, type::text AS type, department, active
          FROM borrowers WHERE lower(school_id) = ANY(${lowered}::text[]) FOR UPDATE`;
        const bySchoolId = new Map(existing.map((b) => [b.schoolId.toLowerCase(), b]));

        const toCreate: BorrowerImportRow[] = [];
        const toUpdate: { before: Borrower; after: Borrower; keys: (keyof Borrower)[] }[] = [];
        for (const row of rows) {
          const before = bySchoolId.get(row.schoolId.toLowerCase());
          if (!before) {
            toCreate.push(row);
            continue;
          }
          const after: Borrower = { id: before.id, ...importFields(row) };
          const keys = (Object.keys(after) as (keyof Borrower)[]).filter(
            (key) => after[key] !== before[key],
          );
          if (keys.length > 0) toUpdate.push({ before, after, keys });
        }

        const created: Borrower[] = [];
        for (const part of chunks(toCreate)) {
          created.push(
            ...(await tx.borrower.createManyAndReturn({
              data: part.map(importFields),
              select: borrowerFields,
            })),
          );
        }
        if (toUpdate.length > 0) {
          const column = (key: keyof Borrower) => toUpdate.map((u) => u.after[key]);
          await tx.$executeRaw`
            UPDATE borrowers AS b
            SET school_id = u.school_id, name = u.name, type = u.type::borrower_type,
                department = u.department, active = u.active, updated_at = now()
            FROM unnest(${column('id')}::uuid[], ${column('schoolId')}::text[],
                        ${column('name')}::text[], ${column('type')}::text[],
                        ${column('department')}::text[], ${column('active')}::boolean[])
              AS u(id, school_id, name, type, department, active)
            WHERE b.id = u.id`;
        }

        const counts = {
          created: created.length,
          updated: toUpdate.length,
          unchanged: rows.length - created.length - toUpdate.length,
        };
        const pick = (source: Borrower, keys: (keyof Borrower)[]) =>
          Object.fromEntries(keys.map((key) => [key, source[key]]));
        // Rule 14: the same entries as a create or an edit on the Borrowers screen, plus the summary.
        const entries: AuditEntry[] = [
          ...created.map(({ id, ...after }) => ({
            actorId,
            action: 'BORROWER_CREATED',
            entity: 'borrower',
            entityId: id,
            after,
          })),
          ...toUpdate.map(({ before, after, keys }) => ({
            actorId,
            action: 'BORROWER_UPDATED',
            entity: 'borrower',
            entityId: before.id,
            before: pick(before, keys),
            after: pick(after, keys),
          })),
          {
            actorId,
            action: 'BORROWER_IMPORT',
            entity: 'borrower_import',
            entityId: randomUUID(),
            after: { ...counts, rejected },
          },
        ];
        for (const part of chunks(entries)) await auditMany(tx, part);
        return counts;
      },
      { timeout: IMPORT_TRANSACTION_TIMEOUT_MS },
    );
  } catch (error) {
    // Someone added one of these school IDs between the lookup and the insert.
    if (isPrismaError(error, 'P2002')) {
      throw new ApiError(
        409,
        'DUPLICATE_VALUE',
        'A borrower in this file was added by someone else meanwhile. Import the file again.',
      );
    }
    throw error;
  }
}

// The audit sweep's checks for this table (HRD-1, BR 14). They live here because only this file
// may read the borrowers table (CLAUDE.md rule 1).
export async function borrowerAuditFindings(): Promise<Finding[]> {
  return Promise.all([
    missingEntry('borrowers', 'borrower', 'BORROWER_CREATED'),
    changedAfterLastEntry('borrowers', 'borrower'),
  ]);
}
