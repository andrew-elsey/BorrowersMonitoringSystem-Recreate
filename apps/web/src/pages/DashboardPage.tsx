import type { BorrowerType, FlaggedBorrowerPage, OpenLine, OpenLinePage } from '@bms/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch } from '../api';
import { cellTextClass, DataTable } from '../components/DataTable';
import { FlagIcon } from '../components/icons';
import { RetryAlert } from '../components/RetryAlert';
import { StrikeBadge, strikeLevel } from '../components/Strikes';
import { TIMEZONE, todayInAppZone } from '../timezone';

// Dashboard (SPEC.md 5, every role, RPT-1, BR section 4): what is out right now, with notes and
// expected return dates (BRW-6, edited on the Return screen only), and the borrowers with strikes
// this semester. Read-only: nothing here changes data.

const PAGE_SIZE = 25;
const today = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: TIMEZONE,
});
const dateTime = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TIMEZONE,
});
const shortDateTime = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TIMEZONE,
});
const timeOfDay = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TIMEZONE,
});
const dayOf = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE });
// Calendar dates (YYYY-MM-DD) are shown as is, not shifted by a timezone.
const calendarDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const TYPE_LABELS: Record<BorrowerType, string> = {
  STUDENT: 'Student',
  FACULTY: 'Faculty',
  EMPLOYEE: 'Employee',
};

// BR 8, S10: a line is due at the closing of the day it was issued, or of the next day when it was
// issued at or after closing. Zero-padded HH:mm strings compare as times.
function dueText(issuedAt: string, closingTime: string) {
  const issued = new Date(issuedAt);
  let due = dayOf.format(issued);
  if (timeOfDay.format(issued) >= closingTime) {
    const next = new Date(`${due}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    due = next.toISOString().slice(0, 10);
  }
  const now = todayInAppZone();
  const tomorrow = new Date(`${now}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const day =
    due === now
      ? 'today'
      : due === tomorrow.toISOString().slice(0, 10)
        ? 'tomorrow'
        : calendarDate.format(new Date(due));
  return `Due ${day} ${closingTime}`;
}

export function DashboardPage() {
  const [linesPage, setLinesPage] = useState(1);
  const [borrowersPage, setBorrowersPage] = useState(1);
  const unreturned = useQuery({
    queryKey: ['dashboard', 'unreturned', linesPage],
    queryFn: () =>
      apiFetch<OpenLinePage>(
        'GET',
        `/dashboard/unreturned?page=${linesPage}&pageSize=${PAGE_SIZE}`,
      ),
    placeholderData: keepPreviousData,
  });
  const flagged = useQuery({
    queryKey: ['dashboard', 'flagged-borrowers', borrowersPage],
    queryFn: () =>
      apiFetch<FlaggedBorrowerPage>(
        'GET',
        `/dashboard/flagged-borrowers?page=${borrowersPage}&pageSize=${PAGE_SIZE}`,
      ),
    placeholderData: keepPreviousData,
  });
  // From settings, never hardcoded (rule 3).
  const closing = useQuery({
    queryKey: ['closing-time'],
    queryFn: () => apiFetch<{ closingTime: string }>('GET', '/closing-time'),
  });
  const closingTime = closing.data?.closingTime;

  const subtitle = [
    today.format(new Date()),
    flagged.data && (flagged.data.semesterName ?? 'No current semester'),
    closingTime && `Closing time ${closingTime}`,
  ].filter(Boolean);

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-[28px] leading-tight font-bold">Dashboard</h1>
        <p className="text-[15px] text-muted">{subtitle.join(' · ')}</p>
      </div>

      <section aria-labelledby="out-heading" className="flex min-w-0 flex-col gap-3">
        <h2 id="out-heading" className="text-xl font-bold">
          Currently unreturned{' '}
          {unreturned.data && (
            <span className="font-medium text-muted">({unreturned.data.total})</span>
          )}
        </h2>
        {unreturned.isError ? (
          <RetryAlert query={unreturned} />
        ) : (
          <DataTable
            caption="Currently unreturned"
            columns={[
              {
                header: 'Borrower',
                cell: (line: OpenLine) => (
                  <div className={cellTextClass}>
                    <strong>{line.borrower.name}</strong>
                    <div className="text-[13px] text-muted">{line.borrower.schoolId}</div>
                  </div>
                ),
              },
              {
                header: 'Item',
                cell: (line) => (
                  <div className={cellTextClass}>
                    {line.item.name}
                    <div className="text-[13px] text-muted">
                      {line.item.assetTag ? `Asset tag ${line.item.assetTag}` : 'Quantity item'}
                    </div>
                  </div>
                ),
              },
              {
                header: 'Out',
                cell: (line) =>
                  line.outstanding === line.quantityBorrowed
                    ? line.outstanding
                    : `${line.outstanding} of ${line.quantityBorrowed}`,
              },
              {
                header: 'Room or lab',
                cell: (line) => <span className={cellTextClass}>{line.location}</span>,
              },
              {
                header: 'Issued',
                cell: (line) => (
                  <span className="whitespace-nowrap">
                    {dateTime.format(new Date(line.issuedAt))}
                  </span>
                ),
              },
              {
                header: 'Issued by',
                cell: (line) => <span className={cellTextClass}>{line.issuedBy}</span>,
              },
              {
                header: 'Note',
                cell: (line) =>
                  line.note ? (
                    <span className={cellTextClass}>{line.note}</span>
                  ) : (
                    <span className="text-muted">No note</span>
                  ),
              },
              {
                header: 'Expected return',
                cell: (line) => (
                  <span className="whitespace-nowrap">
                    {line.expectedReturnDate
                      ? calendarDate.format(new Date(line.expectedReturnDate))
                      : '—'}
                  </span>
                ),
              },
              {
                header: 'Flag',
                cell: (line) => <FlagCell line={line} closingTime={closingTime} />,
              },
            ]}
            rows={unreturned.data?.data}
            rowKey={(line) => line.lineId}
            isLoading={unreturned.isPending}
            emptyText="Nothing is out right now. Every item has been returned."
            page={linesPage}
            pageSize={PAGE_SIZE}
            total={unreturned.data?.total ?? 0}
            onPageChange={setLinesPage}
          />
        )}
      </section>

      <section aria-labelledby="strikes-heading" className="flex min-w-0 flex-col gap-3">
        <h2 id="strikes-heading" className="text-xl font-bold">
          Flagged borrowers this semester{' '}
          {flagged.data && <span className="font-medium text-muted">({flagged.data.total})</span>}
        </h2>
        {flagged.isError ? (
          <RetryAlert query={flagged} />
        ) : (
          <DataTable
            caption="Flagged borrowers this semester"
            columns={[
              {
                header: 'Borrower',
                cell: (row) => <strong className={cellTextClass}>{row.borrower.name}</strong>,
              },
              { header: 'School ID', cell: (row) => row.borrower.schoolId },
              { header: 'Type', cell: (row) => TYPE_LABELS[row.borrower.type] },
              { header: 'Strikes', cell: (row) => row.strikes },
              {
                header: 'Status',
                // The thresholds come from settings with the reply (rule 3, BR 11).
                cell: (row) => {
                  const status = { ...flagged.data!, strikes: row.strikes };
                  return strikeLevel(status) === 'none' ? (
                    <span className="text-sm text-muted">Below warning</span>
                  ) : (
                    <StrikeBadge data={status} />
                  );
                },
              },
            ]}
            rows={flagged.data?.data}
            rowKey={(row) => row.borrower.id}
            isLoading={flagged.isPending}
            emptyText={
              flagged.data?.semesterName === null
                ? 'No current semester is set.'
                : 'No borrower has a strike this semester.'
            }
            page={borrowersPage}
            pageSize={PAGE_SIZE}
            total={flagged.data?.total ?? 0}
            onPageChange={setBorrowersPage}
          />
        )}
      </section>
    </>
  );
}

// Colour is paired with an icon and the word Flagged (ARCHITECTURE 14).
function FlagCell({ line, closingTime }: { line: OpenLine; closingTime?: string }) {
  if (line.flagStatus === 'FLAGGED') {
    return (
      <div className="whitespace-nowrap">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-tint px-2.5 py-0.5 text-[13px] font-semibold text-danger">
          <FlagIcon />
          Flagged
        </span>
        {line.flaggedAt && (
          <div className="mt-1 text-[13px] text-muted">
            Since {shortDateTime.format(new Date(line.flaggedAt))}
          </div>
        )}
      </div>
    );
  }
  if (line.flagStatus === 'OVERRIDDEN') {
    return <span className="text-sm whitespace-nowrap text-muted">Flag overridden</span>;
  }
  return (
    <span className="text-sm whitespace-nowrap text-muted">
      {closingTime ? dueText(line.issuedAt, closingTime) : 'Not flagged'}
    </span>
  );
}
