import { type Finding, changedAfterLastEntry, missingEntry } from '../lib/audit-sweep-sql.ts';
import { borrowerAuditFindings } from './borrowers.ts';

// The audit sweep (HRD-1, BR 14, run by `npm run audit:sweep`): finds records with no audit entry,
// and rows changed after their latest entry. Read-only. Seed rows pass: the seed audits with a null actor.

// Newest RETURN entry of a line's returns: a return changes the line (quantity_returned) but the
// entry is kept under entity "return".
const LINE_RETURN_ENTRY = `(SELECT MAX(a.created_at) FROM returns r JOIN audit_log a
  ON a.entity = 'return' AND a.entity_id = r.id::text WHERE r.transaction_item_id = t.id)`;
// A line with no entry of its own (a fresh open line) is judged by its checkout's entry, so an
// unaudited edit of it is still reported.
const LINE_RELATED_ENTRY = `GREATEST(${LINE_RETURN_ENTRY}, (SELECT MAX(a.created_at) FROM audit_log a
  WHERE a.entity = 'transaction' AND a.entity_id = t.transaction_id::text))`;
// Setting another semester current also clears the old one, but its one entry is under the new id.
const SEMESTER_SWITCH_ENTRY = `(SELECT MAX(a.created_at) FROM audit_log a
  WHERE a.action = 'SEMESTER_SET_CURRENT' AND a.before -> 'currentSemester' ->> 'id' = t.id::text)`;

const MASTER_TABLES = [
  ['users', 'user', 'USER_CREATED'],
  ['categories', 'category', 'CATEGORY_CREATED'],
  ['locations', 'location', 'LOCATION_CREATED'],
  ['items', 'item', 'ITEM_CREATED'],
  ['semesters', 'semester', 'SEMESTER_CREATED'],
  ['settings', 'setting', 'SETTING_CREATED'],
] as const;

export async function runAuditSweep(): Promise<Finding[]> {
  const findings = await Promise.all([
    missingEntry('transactions', 'transaction', 'CHECKOUT'),
    missingEntry('returns', 'return', 'RETURN'),
    missingEntry(
      'transaction_items',
      'transaction_item',
      'LINE_FLAGGED',
      `t.flag_status IN ('FLAGGED', 'OVERRIDDEN')`,
    ),
    missingEntry(
      'transaction_items',
      'transaction_item',
      'FLAG_OVERRIDDEN',
      `t.flag_status = 'OVERRIDDEN'`,
    ),
    ...MASTER_TABLES.map(([table, entity, created]) => missingEntry(table, entity, created)),
    borrowerAuditFindings(),
    ...MASTER_TABLES.map(([table, entity]) =>
      changedAfterLastEntry(
        table,
        entity,
        table === 'semesters' ? SEMESTER_SWITCH_ENTRY : undefined,
      ),
    ),
    changedAfterLastEntry('transactions', 'transaction'),
    changedAfterLastEntry('returns', 'return'),
    changedAfterLastEntry('transaction_items', 'transaction_item', LINE_RELATED_ENTRY),
  ]);
  return findings.flat();
}
