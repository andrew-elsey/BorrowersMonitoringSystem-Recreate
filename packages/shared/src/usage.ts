import { z } from 'zod';
import { realDateField } from './categories.ts';

// Usage summary report (RPT-4, BR section 4). Limits from SPEC.md 7.
export const REPORT_MAX_RANGE_DAYS = 366;
// Each chart lists at most this many rows, so the reply stays small however much data there is.
export const USAGE_TOP_ROWS = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

// Days covered by a from-to range of YYYY-MM-DD dates, both ends included (1 Jan to 1 Jan is 1 day).
// Calendar dates parse as UTC midnight, so the difference is always a whole number of days.
export function rangeDays(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / DAY_MS + 1;
}

// ?from=&to= of every report (RPT-2 to RPT-4): calendar days in the app timezone, both ends
// included, at most 366 days (SPEC.md 7). Each report schema adds these fields, then applies
// refineReportRange.
export const reportRangeFields = {
  from: realDateField('Enter a start date.'),
  to: realDateField('Enter an end date.'),
};

export function refineReportRange<T extends z.ZodType<{ from: string; to: string }>>(schema: T) {
  return (
    schema
      // YYYY-MM-DD strings sort in date order.
      .refine((query) => query.to >= query.from, {
        path: ['to'],
        message: 'The end date cannot be before the start date.',
      })
      .refine((query) => rangeDays(query.from, query.to) <= REPORT_MAX_RANGE_DAYS, {
        path: ['to'],
        message: `The date range can be at most ${REPORT_MAX_RANGE_DAYS} days.`,
      })
  );
}

// GET /api/reports/usage?from=&to=
export const usageQuerySchema = refineReportRange(z.object(reportRangeFields));
export type UsageQuery = z.infer<typeof usageQuerySchema>;

// One bar: how many times something was borrowed (one checkout line is one time).
export type UsageRow = { id: string; name: string; timesBorrowed: number };
export type UsageSummary = {
  from: string;
  to: string;
  items: (UsageRow & { assetTag: string | null })[];
  categories: UsageRow[];
  rooms: UsageRow[];
};
