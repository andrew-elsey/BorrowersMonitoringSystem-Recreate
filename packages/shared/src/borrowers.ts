import { z } from 'zod';
import { CONTROL_CHARACTER, nothingToUpdate, pageQuerySchema, textField } from './categories.ts';
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
const SEARCH_MESSAGE = `Search text must be ${SEARCH_MIN_LENGTH} to ${SEARCH_MAX_LENGTH} characters.`;

// The ?q= search text of a list request, trimmed. Shared by the borrower and item lists.
export const searchTextField = z
  .string()
  .trim()
  .min(SEARCH_MIN_LENGTH, SEARCH_MESSAGE)
  .max(SEARCH_MAX_LENGTH, SEARCH_MESSAGE)
  .refine(
    (value) => !CONTROL_CHARACTER.test(value),
    'Search text cannot contain control characters.',
  );

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
export const borrowerUpdateSchema = borrowerSchema
  .extend({ active: z.boolean() })
  .partial()
  .refine(...nothingToUpdate);
export type BorrowerUpdate = z.infer<typeof borrowerUpdateSchema>;

// GET /api/borrowers?q=&type=&active=&page=&pageSize=. q has the search bounds (SPEC.md 7); BorrowerService
// checks them again for callers that skip this schema. type and active are filters from the Borrowers screen; left out, they match everyone.
export const borrowerListQuerySchema = pageQuerySchema.extend({
  q: searchTextField.optional(),
  type: z.enum(BorrowerType).optional(),
  // Query strings are text: only "true" or "false" (z.coerce.boolean would read "false" as true).
  active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
export type BorrowerListQuery = z.infer<typeof borrowerListQuerySchema>;

// GET /api/borrowers/:id/strikes (FLG-3): the borrower's strikes this semester and the thresholds
// from settings, so Checkout and Return can show the warning, notice, and blocked messages.
export type StrikeStatus = {
  strikes: number;
  warningThreshold: number;
  noticeThreshold: number;
  blockThreshold: number;
  semesterName: string | null;
};

// GET /api/borrowers/lookup?q=&page=&pageSize= (BRW-3): the checkout borrower search for admins
// and handlers. q is required; BorrowerService checks it against the search bounds (SPEC.md 7).
export const borrowerLookupQuerySchema = pageQuerySchema.extend({
  q: z.string({
    error: `Search text must be ${SEARCH_MIN_LENGTH} to ${SEARCH_MAX_LENGTH} characters.`,
  }),
});

// POST /api/borrowers/import (MD-6): a CSV in the format of SPEC.md 6, sent as multipart field
// "file". Upload limits from SPEC.md 7, checked before parsing (PAYLOAD_TOO_LARGE).
export const CSV_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const CSV_IMPORT_MAX_ROWS = 5000;
export const CSV_IMPORT_HEADER = ['school_id', 'name', 'type', 'department', 'active'] as const;

// The 200 reply. `row` is the line in the file (the header is line 1). `unchanged` counts rows
// that matched a borrower with exactly the same values: nothing is written or audited for them.
export type BorrowerImportResult = {
  created: number;
  updated: number;
  unchanged: number;
  rejected: { row: number; schoolId: string; reason: string }[];
};
