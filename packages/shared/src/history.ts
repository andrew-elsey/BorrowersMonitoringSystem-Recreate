import { z } from 'zod';
import { FlagStatus, ReturnCondition } from './enums.ts';
import { pageQuerySchema } from './categories.ts';
import { refineReportRange, reportRangeFields } from './usage.ts';

// Borrowing history reports (RPT-2 per borrower, RPT-3 per item, BR section 4). Limits from SPEC.md 7.

// ?from=&to=&page=&pageSize=: issue dates are calendar days in the app timezone, both ends included.
export const historyQuerySchema = refineReportRange(pageQuerySchema.extend(reportRangeFields));
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
