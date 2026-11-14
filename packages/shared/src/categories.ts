import { z } from 'zod';

// Names are at most 200 characters (SPEC.md 7).
export const NAME_MAX_LENGTH = 200;

// Lists paginate with ?page=1&pageSize=25, at most 100 rows a page (ARCHITECTURE.md 7, SPEC.md 7).
// Query strings arrive as text, so the numbers are coerced.
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

// PostgreSQL text cannot hold NUL (Prisma P2039 would be a 500), and no name field needs a tab or
// newline, so every control character is refused as invalid input.
export const CONTROL_CHARACTER = /\p{Cc}/u;

// A required one-line text field: trimmed, 1 to 200 characters, no control characters.
export const textField = (missing: string) =>
  z
    .string()
    .trim()
    .min(1, missing)
    .max(NAME_MAX_LENGTH, `Too long: at most ${NAME_MAX_LENGTH} characters.`)
    .refine((value) => !CONTROL_CHARACTER.test(value), 'Remove the control characters.');

// A date field YYYY-MM-DD. PostgreSQL has no year 0, so 0000-01-01 could not be stored or compared.
export const realDateField = (missing: string) =>
  z.iso.date(missing).refine((date) => date >= '0001-01-01', 'Enter a real date.');

// Refine for PATCH bodies, checked on the parsed object so unknown (stripped) keys count as empty.
export const nothingToUpdate = [
  (changes: object) => Object.keys(changes).length > 0,
  'Nothing to update.',
] as const;

// Zod's own English texts ("Invalid input: expected string, received undefined") must never reach
// users. Messages written on a schema still win; this only words what is left.
z.config({
  customError: (issue) => {
    if (issue.code === 'invalid_type') return 'Enter a valid value.';
    if (issue.code === 'too_big' && issue.origin === 'string')
      return `Too long: at most ${issue.maximum} characters.`;
    if (issue.code === 'too_small' && issue.origin === 'string')
      return `Too short: at least ${issue.minimum} characters.`;
    if (issue.code === 'too_big') return `Enter a value of at most ${issue.maximum}.`;
    if (issue.code === 'too_small') return `Enter a value of at least ${issue.minimum}.`;
    return 'Enter a valid value.';
  },
});

// Create and rename take the same body. Names are unique regardless of case (SPEC.md 4); the API
// answers DUPLICATE_VALUE.
export const categorySchema = z.object({ name: textField('Enter a category name.') });
export type CategoryInput = z.infer<typeof categorySchema>;

// One row of GET /api/categories. itemCount > 0 means the category is in use and cannot be deleted.
export type Category = { id: string; name: string; itemCount: number };
