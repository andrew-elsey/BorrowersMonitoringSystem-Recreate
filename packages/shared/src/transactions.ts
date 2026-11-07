import { z } from 'zod';
import { CONTROL_CHARACTER } from './categories.ts';
import { ReturnCondition } from './enums.ts';

// Checkout (BRW-2, BR 1 to 4). Limits from SPEC.md 7.
export const CHECKOUT_MAX_LINES = 50;
export const LINE_QUANTITY_MAX = 10_000;
export const NOTE_MAX_LENGTH = 500;

const QUANTITY_MESSAGE = `Enter a whole number from 1 to ${LINE_QUANTITY_MAX.toLocaleString('en-US')}.`;

// A note on a line is optional and informational only (BR 7). Empty means no note.
export const noteField = z
  .string()
  .trim()
  .max(NOTE_MAX_LENGTH, `Too long: at most ${NOTE_MAX_LENGTH} characters.`)
  .refine((value) => !CONTROL_CHARACTER.test(value), 'Remove the control characters.');

// POST /api/transactions. The issuing handler, issue time, and semester are never sent: the server
// takes them from the session, the clock, and the current semester (BR 2).
export const checkoutSchema = z.object({
  // Lower case, as PostgreSQL returns ids, so lookups and the repeated-item check match any case.
  borrowerId: z.guid('Choose a borrower.').toLowerCase(),
  locationId: z.guid('Choose a room or lab.').toLowerCase(),
  lines: z
    .array(
      z.object({
        itemId: z.guid('Choose an item.').toLowerCase(),
        quantity: z
          .number({ error: QUANTITY_MESSAGE })
          .int(QUANTITY_MESSAGE)
          .min(1, QUANTITY_MESSAGE)
          .max(LINE_QUANTITY_MAX, QUANTITY_MESSAGE),
        note: noteField.optional(),
        // A calendar date in the app timezone (ARCHITECTURE.md 7).
        expectedReturnDate: z.iso
          .date('Enter a date as YYYY-MM-DD.')
          // PostgreSQL has no year 0, so 0000-01-01 could not be stored.
          .refine((date) => date >= '0001-01-01', 'Enter a real date.')
          .optional(),
      }),
    )
    .min(1, 'Add at least one item.')
    .max(CHECKOUT_MAX_LINES, `At most ${CHECKOUT_MAX_LINES} items per checkout.`)
    // One line per item, so each line's quantity is checked against the item's whole availability.
    .refine(
      (lines) => new Set(lines.map((line) => line.itemId)).size === lines.length,
      'Each item can appear only once. Change its quantity instead.',
    ),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

// The 201 reply. issuedAt is ISO 8601 in UTC.
export type CheckoutLine = {
  id: string;
  itemId: string;
  quantity: number;
  note: string | null;
  expectedReturnDate: string | null;
};
export type Checkout = {
  id: string;
  borrowerId: string;
  locationId: string;
  issuedById: string;
  issuedAt: string;
  semesterId: string;
  lines: CheckoutLine[];
};

// Returns (BRW-4, BR 5 and 6). One request returns part or all of up to 50 lines, together or not at
// all. The receiving handler and the return time come from the session and the clock (BR 5).
export const RETURN_MAX_LINES = 50;

export const returnSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: z.guid('Choose a line.').toLowerCase(),
        quantity: z
          .number({ error: QUANTITY_MESSAGE })
          .int(QUANTITY_MESSAGE)
          .min(1, QUANTITY_MESSAGE)
          .max(LINE_QUANTITY_MAX, QUANTITY_MESSAGE),
        condition: z.enum(ReturnCondition, { error: 'Choose a condition.' }),
      }),
    )
    .min(1, 'Add at least one line.')
    .max(RETURN_MAX_LINES, `At most ${RETURN_MAX_LINES} lines per return.`)
    // One entry per line, so each quantity is checked against that line's whole outstanding.
    .refine(
      (lines) => new Set(lines.map((line) => line.lineId)).size === lines.length,
      'Each line can appear only once. Change its quantity instead.',
    ),
});
export type ReturnInput = z.infer<typeof returnSchema>;

// The 201 reply: one return event per line. returnedAt is ISO 8601 in UTC; outstanding is what is
// still out on the line after this return (0 means the line is complete).
export type ReturnEvent = {
  id: string;
  lineId: string;
  quantity: number;
  condition: ReturnCondition;
  receivedById: string;
  returnedAt: string;
  outstanding: number;
};
