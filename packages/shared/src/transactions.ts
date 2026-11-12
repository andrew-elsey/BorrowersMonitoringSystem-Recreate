import { z } from 'zod';
import { searchTextField } from './borrowers.ts';
import { CONTROL_CHARACTER, pageQuerySchema } from './categories.ts';
import { type FlagStatus, ReturnCondition, type TrackingType } from './enums.ts';

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

// A calendar date in the app timezone (ARCHITECTURE.md 7). The services also refuse a date before
// today (BR 7), since the schema cannot know the app's "today".
export const expectedReturnDateField = z.iso
  .date('Enter a date as YYYY-MM-DD.')
  // PostgreSQL has no year 0, so 0000-01-01 could not be stored.
  .refine((date) => date >= '0001-01-01', 'Enter a real date.');

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
        expectedReturnDate: expectedReturnDateField.optional(),
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

// GET /api/returns/open?by=&q=&page=&pageSize= (BRW-5): the open lines the Return screen lists, found
// by borrower (name or school ID), item name, or asset tag. q is optional (left out, every open
// line); when given it has the search bounds (SPEC.md 7).
export const OPEN_LINE_SEARCH_BY = ['borrower', 'item', 'assetTag'] as const;
export const openLinesQuerySchema = pageQuerySchema.extend({
  by: z.enum(OPEN_LINE_SEARCH_BY).default('borrower'),
  q: searchTextField.optional(),
});
export type OpenLinesQuery = z.infer<typeof openLinesQuerySchema>;

// A line with something still out. flagStatus and flaggedAt are BR 8 and 9; FLAGGED stays on a
// line until an admin overrides it, even after a return (BR 6).
export type OpenLine = {
  lineId: string;
  transactionId: string;
  borrower: { id: string; schoolId: string; name: string };
  item: { id: string; name: string; assetTag: string | null; trackingType: TrackingType };
  location: string;
  issuedBy: string;
  issuedAt: string;
  expectedReturnDate: string | null;
  note: string | null;
  quantityBorrowed: number;
  outstanding: number;
  flagStatus: FlagStatus;
  flaggedAt: string | null;
  // The borrower's strikes this semester (BR 10), for the Return screen's badge (FLG-3).
  strikes: number;
};
// The thresholds come from settings once per reply (CLAUDE.md rule 3).
export type OpenLinePage = {
  data: OpenLine[];
  page: number;
  pageSize: number;
  total: number;
  warningThreshold: number;
  noticeThreshold: number;
  blockThreshold: number;
};

// PATCH /api/lines/:id (BRW-6, BR 7): set the note and expected return date of an open line. Both
// are sent every time: an empty note or a null date clears it.
export const lineNoteSchema = z.object({
  note: noteField,
  expectedReturnDate: expectedReturnDateField.nullable(),
});
export type LineNoteInput = z.infer<typeof lineNoteSchema>;

// The 200 reply.
export type LineNote = { lineId: string; note: string | null; expectedReturnDate: string | null };
