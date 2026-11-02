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

// Create and rename take the same body. Names are unique regardless of case (SPEC.md 4); the API
// answers DUPLICATE_VALUE.
export const categorySchema = z.object({ name: textField('Enter a category name.') });
export type CategoryInput = z.infer<typeof categorySchema>;

// One row of GET /api/categories. itemCount > 0 means the category is in use and cannot be deleted.
export type Category = { id: string; name: string; itemCount: number };
