import { z } from 'zod';

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

// GET /api/reports/usage?from=&to=&categoryId=: dates are calendar days in the app timezone.
export const usageQuerySchema = z
  .object({
    from: z.iso.date('Enter a start date.'),
    to: z.iso.date('Enter an end date.'),
    categoryId: z.guid().toLowerCase().optional(),
  })
  // YYYY-MM-DD strings sort in date order.
  .refine((query) => query.to >= query.from, {
    path: ['to'],
    message: 'The end date cannot be before the start date.',
  })
  .refine((query) => rangeDays(query.from, query.to) <= REPORT_MAX_RANGE_DAYS, {
    path: ['to'],
    message: `The date range can be at most ${REPORT_MAX_RANGE_DAYS} days.`,
  });
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
