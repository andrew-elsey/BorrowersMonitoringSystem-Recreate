import { z } from 'zod';
import { FlagStatus, ReturnCondition } from './enums.ts';
import { pageQuerySchema } from './categories.ts';

// Borrowing history reports (RPT-2 per borrower, BR section 4). Limits from SPEC.md 7.
export const HISTORY_MAX_RANGE_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;

// Days covered by a from-to range of YYYY-MM-DD dates, both ends included (1 Jan to 1 Jan is 1 day).
// Calendar dates parse as UTC midnight, so the difference is always a whole number of days.
export function historyRangeDays(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / DAY_MS + 1;
}

// ?from=&to=&page=&pageSize=: issue dates are calendar days in the app timezone, both ends included.
export const historyQuerySchema = pageQuerySchema
  .extend({
    from: z.iso
      .date('Enter a start date.')
      // PostgreSQL has no year 0, so 0000-01-01 could not be compared.
      .refine((date) => date >= '0001-01-01', 'Enter a real date.'),
    to: z.iso.date('Enter an end date.'),
  })
  // YYYY-MM-DD strings sort in date order.
  .refine((query) => query.to >= query.from, {
    path: ['to'],
    message: 'The end date cannot be before the start date.',
  })
  .refine((query) => historyRangeDays(query.from, query.to) <= HISTORY_MAX_RANGE_DAYS, {
    path: ['to'],
    message: `The date range can be at most ${HISTORY_MAX_RANGE_DAYS} days.`,
  });
export type HistoryQuery = z.infer<typeof historyQuerySchema>;

type Person = { id: string; name: string };

// One checkout line with everything that happened to it (BR section 4): room, issuing and
// receiving handlers, each return event, and the flag status.
export type HistoryLine = {
  lineId: string;
  transactionId: string;
  borrower: { id: string; schoolId: string; name: string };
  item: { id: string; name: string; assetTag: string | null };
  room: Person;
  issuedAt: string;
  issuedBy: Person;
  quantityBorrowed: number;
  outstanding: number; // 0 means fully returned
  returns: {
    id: string;
    quantity: number;
    returnedAt: string;
    condition: ReturnCondition;
    receivedBy: Person;
  }[];
  flagStatus: FlagStatus;
  flaggedAt: string | null;
  override: { by: Person; at: string; reason: string } | null;
  note: string | null;
  expectedReturnDate: string | null;
};
export type HistoryPage = { data: HistoryLine[]; page: number; pageSize: number; total: number };
