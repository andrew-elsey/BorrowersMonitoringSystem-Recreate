import { z } from 'zod';
import { pageQuerySchema } from './categories.ts';
import { refineReportRange, reportRangeFields } from './usage.ts';

// Audit log viewer (HRD-1, BR section 14). Admin only, always date-filtered and paginated (SPEC.md 7).

// The Entity filter is a fixed list: every `entity` the api and the seed write. A new audited
// entity must be added here, or the viewer cannot filter by it.
export const AUDIT_ENTITIES = [
  'borrower',
  'borrower_import',
  'category',
  'item',
  'location',
  'return',
  'semester',
  'setting',
  'transaction',
  'transaction_item',
  'user',
  'flagging_run',
] as const;

// ?from=&to=&entity=&actor=&page=&pageSize=. The date range rules (at most 366 days) are the reports'.
// actor is a user id, or "system" for entries with no actor (the flagging job, the seed).
export const auditQuerySchema = refineReportRange(
  pageQuerySchema.extend({
    ...reportRangeFields,
    entity: z.enum(AUDIT_ENTITIES).optional(),
    actor: z.union([z.literal('system'), z.guid()]).optional(),
  }),
);
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export type AuditEntryView = {
  id: string;
  createdAt: string;
  actor: { id: string; name: string } | null; // null: a system action
  action: string;
  entity: string;
  entityId: string;
  before: unknown;
  after: unknown;
};
export type AuditPage = { data: AuditEntryView[]; page: number; pageSize: number; total: number };
