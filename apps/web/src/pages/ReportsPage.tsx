import { type ReactNode, useState } from 'react';
import { BorrowerHistoryTab, ItemHistoryTab } from './reports/HistoryTabs';

// Reports (SPEC.md 5, every role). One tab per report, as in the approved mockup. Each report
// lives in its own file under pages/reports.
const TABS: { label: string; panel: () => ReactNode }[] = [
  { label: 'History per borrower', panel: () => <BorrowerHistoryTab /> },
  { label: 'History per item', panel: () => <ItemHistoryTab /> },
];

export function ReportsPage() {
  const [active, setActive] = useState(0);
  return (
    <>
      <h1 className="text-[28px] leading-tight font-bold">Reports</h1>
      <div
        role="tablist"
        aria-label="Reports"
        className="flex flex-wrap gap-1 border-b border-divider"
      >
        {TABS.map((tab, index) => (
          <button
            key={tab.label}
            type="button"
            role="tab"
            id={`report-tab-${index}`}
            aria-selected={index === active}
            aria-controls="report-panel"
            onClick={() => setActive(index)}
            className={`h-11 cursor-pointer border-b-[3px] px-4 text-base font-semibold ${index === active ? 'border-primary text-primary' : 'border-transparent text-muted'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="report-panel" aria-labelledby={`report-tab-${active}`}>
        {TABS[active]!.panel()}
      </div>
    </>
  );
}
