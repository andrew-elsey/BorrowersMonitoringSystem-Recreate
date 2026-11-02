import { z } from 'zod';
import { NAME_MAX_LENGTH, pageQuerySchema } from './categories.ts';
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

// PostgreSQL text cannot hold NUL (Prisma P2039 would be a 500), and no field here needs a tab or
// newline, so every control character is refused as invalid input.
export const CONTROL_CHARACTER = /\p{Cc}/u;

const textField = (missing: string) =>
  z
    .string()
    .trim()
    .min(1, missing)
    .max(NAME_MAX_LENGTH, `Too long: at most ${NAME_MAX_LENGTH} characters.`)
    .refine((value) => !CONTROL_CHARACTER.test(value), 'Remove the control characters.');

// Create body. School ID is unique (SPEC.md 4); the API answers DUPLICATE_VALUE. New borrowers
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

// GET /api/borrowers?q=&page=&pageSize=. BorrowerService checks q against the search bounds.
export const borrowerListQuerySchema = pageQuerySchema.extend({ q: z.string().optional() });
