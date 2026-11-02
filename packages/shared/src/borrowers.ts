import type { BorrowerType } from './enums.ts';

// A borrower as every caller sees it (SPEC.md 4). Read only through BorrowerService (CLAUDE.md
// rule 1), so a future external school database only has to produce this shape.
export type Borrower = {
  id: string;
  schoolId: string;
  name: string;
  type: BorrowerType;
  department: string;
  active: boolean;
};
