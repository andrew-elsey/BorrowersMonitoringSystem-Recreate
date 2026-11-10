import { z } from 'zod';
import { searchTextField } from './borrowers.ts';
import { CONTROL_CHARACTER, pageQuerySchema } from './categories.ts';

// Flag review and override (FLG-4, BR 13). Limits from SPEC.md 7.
export const OVERRIDE_REASON_MIN = 5;
export const OVERRIDE_REASON_MAX = 500;

// BR 13: a reason of 5 to 500 characters. Line breaks are allowed (the dialog uses a textarea).
export const overrideSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(OVERRIDE_REASON_MIN, `Enter a reason of at least ${OVERRIDE_REASON_MIN} characters.`)
    .max(OVERRIDE_REASON_MAX, `Too long: at most ${OVERRIDE_REASON_MAX} characters.`)
    .refine(
      (value) => !CONTROL_CHARACTER.test(value.replace(/[\r\n\t]/g, ' ')),
      'Remove the control characters.',
    ),
});
export type OverrideInput = z.infer<typeof overrideSchema>;

// GET /api/flags?returned=&q=&page=&pageSize=: FLAGGED lines only (an overridden line leaves the list).
export const FLAG_RETURNED_FILTERS = ['all', 'out', 'returned'] as const;
export const flagListQuerySchema = pageQuerySchema.extend({
  returned: z.enum(FLAG_RETURNED_FILTERS).default('all'),
  q: searchTextField.optional(),
});
export type FlagListQuery = z.infer<typeof flagListQuerySchema>;

export type FlaggedLine = {
  lineId: string;
  transactionId: string;
  borrower: { id: string; schoolId: string; name: string };
  item: { id: string; name: string; assetTag: string | null };
  issuedAt: string;
  flaggedAt: string;
  quantityBorrowed: number;
  outstanding: number; // 0 means fully returned
  strikes: number; // the borrower's strikes this semester (BR 10)
  note: string | null;
  expectedReturnDate: string | null;
};
export type FlaggedLinePage = {
  data: FlaggedLine[];
  page: number;
  pageSize: number;
  total: number;
  blockThreshold: number; // strikes at or over this are blocked (BR 11)
  hasCurrentSemester: boolean; // false: the list is empty because no semester is current (BR 10)
  borrowerSearchSkipped: boolean; // true: too many flagged borrowers, so q matched item or asset tag only
};

// The 200 reply of POST /api/flags/:id/override. strikes is the borrower's count afterwards.
export type OverrideResult = {
  lineId: string;
  flagStatus: 'OVERRIDDEN';
  overrideAt: string;
  strikes: number;
};
