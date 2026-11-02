import type { Borrower } from '@bms/shared';
import { z } from 'zod';
import { ApiError } from '../lib/errors.ts';
import { prisma } from '../lib/prisma.ts';

// BorrowerService (MD-4, ARCHITECTURE.md 4). INTEGRATION POINT: this file is the only code that
// reads the borrowers table (CLAUDE.md rule 1). Checkout, reports, and the CSV import call
// `borrowerService` and depend only on the interface below. To use an external school database,
// write another class that implements BorrowerService and assign it to `borrowerService` here;
// no caller changes. Tests prove a test double works the same way (tests/borrower-service.test.ts).

export interface BorrowerService {
  findById(id: string): Promise<Borrower | null>;
  // Matches name or school ID. `query` is 2 to 100 characters, `limit` 1 to 100 (SPEC.md 7).
  search(query: string, limit?: number): Promise<Borrower[]>;
  // `reason` is the error code checkout should answer with, such as BORROWER_INACTIVE.
  isEligible(id: string): Promise<{ eligible: boolean; reason?: string }>;
}

// Bounds from SPEC.md 7 (CLAUDE.md rule 12): search text 2 to 100 characters, at most 100 rows.
const SEARCH_MIN_LENGTH = 2;
const SEARCH_MAX_LENGTH = 100;
const SEARCH_MAX_LIMIT = 100;
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

// Shared by every implementation, so a replacement keeps the same bounds.
export function checkSearchBounds(query: string, limit: number): void {
  if (query.length < SEARCH_MIN_LENGTH || query.length > SEARCH_MAX_LENGTH) {
    const message = `Search text must be ${SEARCH_MIN_LENGTH} to ${SEARCH_MAX_LENGTH} characters.`;
    throw new ApiError(400, 'VALIDATION_ERROR', message, { fields: { q: [message] } });
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > SEARCH_MAX_LIMIT) {
    const message = `Limit must be a whole number from 1 to ${SEARCH_MAX_LIMIT}.`;
    throw new ApiError(400, 'VALIDATION_ERROR', message, { fields: { limit: [message] } });
  }
}

// Reads the local `borrowers` table.
export class LocalBorrowerService implements BorrowerService {
  async findById(id: string): Promise<Borrower | null> {
    // PostgreSQL rejects a malformed uuid with an error; an id that cannot exist is simply not found.
    // z.guid, not z.uuid: PostgreSQL accepts any well-formed uuid, not only RFC versions 1 to 8.
    if (!z.guid().safeParse(id).success) return null;
    return prisma.borrower.findUnique({ where: { id }, select: borrowerFields });
  }

  // async, so a bounds error rejects the promise instead of throwing.
  // Includes inactive borrowers (active: false) so admins can find them; checkout refuses them
  // through isEligible (rule 3).
  async search(query: string, limit = SEARCH_DEFAULT_LIMIT): Promise<Borrower[]> {
    const text = query.trim();
    checkSearchBounds(text, limit);
    // Prisma passes % and _ to LIKE as wildcards; escape them so the text matches literally.
    const literal = text.replace(/[\\%_]/g, '\\$&');
    return prisma.borrower.findMany({
      where: {
        OR: [
          { name: { contains: literal, mode: 'insensitive' } },
          { schoolId: { contains: literal, mode: 'insensitive' } },
        ],
      },
      select: borrowerFields,
      orderBy: [{ name: 'asc' }, { schoolId: 'asc' }],
      take: limit,
    });
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
