import type { FlaggedBorrowerPage } from '@bms/shared';
import { prisma } from '../lib/prisma.ts';
import { borrowerService } from './borrowers.ts';
import { getCurrentSemester } from './semesters.ts';
import { getSettings } from './settings.ts';

// Dashboard (RPT-1, BR section 4). The "currently unreturned" list is listOpenLines in returns.ts;
// this is the other half: borrowers with strikes in the current semester. Read-only, no audit.

// BR 10: a strike is a transaction in the current semester with at least one FLAGGED line, the same
// count as countStrikes. Grouped and paged in SQL, so the work is one page (SPEC 7, rule 12).
export async function listFlaggedBorrowers({
  page,
  pageSize,
}: {
  page: number;
  pageSize: number;
}): Promise<FlaggedBorrowerPage> {
  const [semester, { warningThreshold, noticeThreshold, blockThreshold }] = await Promise.all([
    getCurrentSemester(),
    getSettings(),
  ]);
  const thresholds = { warningThreshold, noticeThreshold, blockThreshold };
  // BR 12: no current semester, so nobody has a strike.
  if (!semester) return { data: [], page, pageSize, total: 0, ...thresholds, semesterName: null };

  const struck = prisma.$queryRaw<{ borrower_id: string; strikes: number }[]>`
    SELECT t.borrower_id, COUNT(*)::int AS strikes FROM transactions t
    WHERE t.semester_id = ${semester.id}::uuid
      AND EXISTS (SELECT 1 FROM transaction_items ti
                  WHERE ti.transaction_id = t.id AND ti.flag_status = 'FLAGGED')
    GROUP BY t.borrower_id
    ORDER BY strikes DESC, t.borrower_id
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
  const counted = prisma.$queryRaw<{ total: number }[]>`
    SELECT COUNT(DISTINCT t.borrower_id)::int AS total FROM transactions t
    WHERE t.semester_id = ${semester.id}::uuid
      AND EXISTS (SELECT 1 FROM transaction_items ti
                  WHERE ti.transaction_id = t.id AND ti.flag_status = 'FLAGGED')`;
  const [rows, [{ total }]] = await Promise.all([struck, counted]);

  // Rule 1: borrower details come only through BorrowerService.
  const borrowers = new Map(
    (await borrowerService.findByIds(rows.map((row) => row.borrower_id))).map((b) => [b.id, b]),
  );
  const data = rows.map((row) => {
    const b = borrowers.get(row.borrower_id)!;
    return {
      borrower: { id: b.id, schoolId: b.schoolId, name: b.name, type: b.type },
      strikes: row.strikes,
    };
  });
  return { data, page, pageSize, total, ...thresholds, semesterName: semester.name };
}
