import { Link } from 'react-router';
import { UsageReport } from './UsageReport';

// Reports (SPEC.md 5, all staff). Each report is a tab with its own address; the other tabs join in
// their own tickets (RPT-1 to RPT-3).
export function ReportsPage() {
  return (
    <>
      <h1 className="text-[28px] leading-tight font-bold">Reports</h1>
      <nav aria-label="Reports" className="flex flex-wrap gap-1 border-b border-divider">
        <Link
          to="/reports?tab=usage"
          aria-current="page"
          className="flex h-11 items-center border-b-3 border-primary px-4 font-semibold text-primary"
        >
          Usage summary
        </Link>
      </nav>
      <UsageReport />
    </>
  );
}
