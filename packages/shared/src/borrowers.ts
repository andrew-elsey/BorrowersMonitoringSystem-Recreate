import { z } from 'zod';
import { pageQuerySchema, textField } from './categories.ts';
import { BorrowerType } from './enums.ts';

// A borrower as every caller sees it (SPEC.md 4). Read only through BorrowerService (CLAUDE.md
// rule 1), so a future external school database only has to produce this shape.
export type Borrower = {
  id: string;
  schoolId: string;
  name: string;
  type: BorrowerType;
  department: string;
  active: boolean;
};

// One page of GET /api/borrowers (ARCHITECTURE.md 7).
export type BorrowerPage = { data: Borrower[]; page: number; pageSize: number; total: number };

// Search bounds from SPEC.md 7 (CLAUDE.md rule 12): 2 to 100 characters, at most 100 rows.
export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 100;
export const SEARCH_MAX_LIMIT = 100;

// Create body. School ID is unique, ignoring case (SPEC.md 4); the API answers DUPLICATE_VALUE. New borrowers
// are active.
export const borrowerSchema = z.object({
  schoolId: textField('Enter a school ID.'),
  name: textField('Enter a name.'),
  type: z.enum(BorrowerType, { error: 'Choose a type.' }),
  department: textField('Enter a department.'),
});
export type BorrowerInput = z.infer<typeof borrowerSchema>;

// Edit body: any of the fields, plus active to deactivate or reactivate (BR 15).
export const borrowerUpdateSchema = borrowerSchema.extend({ active: z.boolean() }).partial();
export type BorrowerUpdate = z.infer<typeof borrowerUpdateSchema>;

// GET /api/borrowers?q=&type=&active=&page=&pageSize=. BorrowerService checks q against the search
// bounds. type and active are filters from the Borrowers screen; left out, they match everyone.
export const borrowerListQuerySchema = pageQuerySchema.extend({
  q: z.string().optional(),
  type: z.enum(BorrowerType).optional(),
  // Query strings are text: only "true" or "false" (z.coerce.boolean would read "false" as true).
  active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
export type BorrowerListQuery = z.infer<typeof borrowerListQuerySchema>;

// GET /api/borrowers/lookup?q=&page=&pageSize= (BRW-3): the checkout borrower search for admins
// and handlers. q is required; BorrowerService checks it against the search bounds (SPEC.md 7).
export const borrowerLookupQuerySchema = pageQuerySchema.extend({
  q: z.string({
    error: `Search text must be ${SEARCH_MIN_LENGTH} to ${SEARCH_MAX_LENGTH} characters.`,
  }),
});
