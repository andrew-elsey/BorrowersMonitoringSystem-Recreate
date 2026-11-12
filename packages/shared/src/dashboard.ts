import type { BorrowerType } from './enums.ts';

// GET /api/dashboard/flagged-borrowers (RPT-1, BR section 4): borrowers with strikes in the
// current semester, most strikes first. The thresholds come from settings once per reply
// (CLAUDE.md rule 3); semesterName is null when no semester is current (then the list is empty).
export type FlaggedBorrower = {
  borrower: { id: string; schoolId: string; name: string; type: BorrowerType };
  strikes: number;
};
export type FlaggedBorrowerPage = {
  data: FlaggedBorrower[];
  page: number;
  pageSize: number;
  total: number;
  warningThreshold: number;
  noticeThreshold: number;
  blockThreshold: number;
  semesterName: string | null;
};
