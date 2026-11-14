import { Prisma } from '../generated/prisma/client.ts';
import { prisma } from './prisma.ts';

// Read-only checks for `npm run audit:sweep` (HRD-1, BR 14). Kept apart from services/audit-sweep.ts
// so services/borrowers.ts can run the same checks on its own table (CLAUDE.md rule 1).

export type Finding = { check: string; count: number; ids: string[] };
export const SWEEP_MAX_IDS = 20;

// A row's updated_at is a few milliseconds after its audit entry, because both are written in one
// transaction. This slack is the interactive transaction timeout (lib/prisma.ts), the most one can last.
const SLACK_SECONDS = 10;

type IdRow = { id: string; total: number };

async function toFinding(check: string, rows: Promise<IdRow[]>): Promise<Finding> {
  const found = await rows;
  return { check, count: found[0]?.total ?? 0, ids: found.map((row) => row.id) };
}

// Rows of `table` with no audit entry of `action`. `table` and `extraWhere` are fixed strings in
// our code, never user input. Seed rows have their entries (null actor), so they pass.
export function missingEntry(table: string, entity: string, action: string, extraWhere = 'TRUE') {
  return toFinding(
    `${table} without a ${action} entry`,
    prisma.$queryRaw<IdRow[]>`
      SELECT t.id::text AS id, COUNT(*) OVER ()::int AS total
      FROM ${Prisma.raw(table)} t
      WHERE ${Prisma.raw(extraWhere)} AND NOT EXISTS (
        SELECT 1 FROM audit_log a
        WHERE a.entity = ${entity} AND a.entity_id = t.id::text AND a.action = ${action})
      ORDER BY t.id LIMIT ${SWEEP_MAX_IDS}`,
  );
}

// Rows of `table` whose updated_at is later than their newest audit entry. `related` is a SQL
// expression for the newest entry kept under another entity id (see services/audit-sweep.ts).
// Rows with no entry at all are the missingEntry checks' job, so they are not repeated here.
export function changedAfterLastEntry(table: string, entity: string, related = 'NULL') {
  return toFinding(
    `${table} changed after their last audit entry`,
    prisma.$queryRaw<IdRow[]>`
      SELECT t.id::text AS id, COUNT(*) OVER ()::int AS total
      FROM ${Prisma.raw(table)} t
      WHERE t.updated_at > GREATEST(
        (SELECT MAX(a.created_at) FROM audit_log a
          WHERE a.entity = ${entity} AND a.entity_id = t.id::text),
        ${Prisma.raw(related)}) + make_interval(secs => ${SLACK_SECONDS})
      ORDER BY t.id LIMIT ${SWEEP_MAX_IDS}`,
  );
}
