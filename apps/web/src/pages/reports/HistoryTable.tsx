import { historyQuerySchema, type HistoryLine, type HistoryPage } from '@bms/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch } from '../../api';
import { type Column, cellTextClass, DataTable } from '../../components/DataTable';
import { Field } from '../../components/Field';
import { FlagIcon } from '../../components/icons';
import { RetryAlert } from '../../components/RetryAlert';
import { TIMEZONE } from '../../timezone';

// The borrowing history table shared by the per-borrower and per-item reports (BR section 4):
// room, issuing and receiving handlers, each return event, and the flag status.

const PAGE_SIZE = 25;
const dateTime = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TIMEZONE,
});
const CONDITION_LABELS = { GOOD: 'Good', FAIR: 'Fair', DAMAGED: 'Damaged' } as const;
const at = (iso: string) => (
  <span className="whitespace-nowrap">{dateTime.format(new Date(iso))}</span>
);

// Today as YYYY-MM-DD in the app timezone (en-CA formats dates that way).
function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date());
}
const DAY_MS = 24 * 60 * 60 * 1000;
// A calendar date `days` before `date`; UTC midnight keeps the arithmetic whole days.
const daysBefore = (date: string, days: number) =>
  new Date(Date.parse(date) - days * DAY_MS).toISOString().slice(0, 10);

// The date range fields. Starts at the last 90 days; checked with the server's schema (SPEC.md 7).
export function useDateRange() {
  const [to, setTo] = useState(today);
  const [from, setFrom] = useState(() => daysBefore(to, 89));
  const [errors, setErrors] = useState<{ from?: string; to?: string }>({});
  function check(): boolean {
    const result = historyQuerySchema.safeParse({ from, to });
    const issues = result.success ? [] : result.error.issues;
    const first = (field: string) => issues.find((issue) => issue.path[0] === field)?.message;
    setErrors({ from: first('from'), to: first('to') });
    return result.success;
  }
  const fields = (
    <>
      <div className="w-full min-w-0 sm:w-44">
        <Field
          id="history-from"
          type="date"
          label="From"
          value={from}
          error={errors.from}
          onChange={(event) => setFrom(event.target.value)}
        />
      </div>
      <div className="w-full min-w-0 sm:w-44">
        <Field
          id="history-to"
          type="date"
          label="To"
          value={to}
          error={errors.to}
          onChange={(event) => setTo(event.target.value)}
        />
      </div>
    </>
  );
  return { from, to, check, fields };
}

function FlagBadge({ line }: { line: HistoryLine }) {
  // Text and color together, never color alone (ARCHITECTURE.md 14).
  const base =
    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-semibold whitespace-nowrap';
  if (line.flagStatus === 'FLAGGED') {
    return (
      <span className={`${base} bg-danger-tint text-danger`}>
        <FlagIcon />
        Flagged
      </span>
    );
  }
  if (line.flagStatus === 'OVERRIDDEN') {
    return (
      <div className={cellTextClass}>
        <span className={`${base} bg-page text-muted`}>Overridden</span>
        {line.override && (
          <div className="text-[13px] text-muted">
            by {line.override.by.name}: {line.override.reason}
          </div>
        )}
      </div>
    );
  }
  return <span className={`${base} bg-primary-tint text-primary`}>Not flagged</span>;
}

// One page of a history endpoint (`path` without the query), with its own pagination.
export function HistoryTable(props: {
  path: string;
  from: string;
  to: string;
  caption: string;
  first: Column<HistoryLine>; // the borrower or the item, whichever the report is not about
}) {
  const [page, setPage] = useState(1);
  const history = useQuery({
    queryKey: ['history', props.path, props.from, props.to, page],
    queryFn: () => {
      const params = new URLSearchParams({
        from: props.from,
        to: props.to,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      return apiFetch<HistoryPage>('GET', `${props.path}?${params}`);
    },
    placeholderData: keepPreviousData,
  });

  if (history.isError) return <RetryAlert query={history} />;
  return (
    <DataTable
      caption={props.caption}
      columns={[
        props.first,
        { header: 'Room', cell: (line) => line.room.name },
        {
          header: 'Issued',
          cell: (line) => (
            <div className={cellTextClass}>
              {at(line.issuedAt)}
              <div className="text-[13px] text-muted">Quantity {line.quantityBorrowed}</div>
            </div>
          ),
        },
        { header: 'Issued by', cell: (line) => line.issuedBy.name },
        // A line can come back in several return events (BR 5): one row per event in each column.
        {
          header: 'Returned',
          cell: (line) => (
            <div className="flex flex-col gap-1">
              {line.returns.map((event) => (
                <div key={event.id}>
                  {at(event.returnedAt)}
                  {line.quantityBorrowed > 1 && (
                    <span className="text-[13px] text-muted"> · {event.quantity}</span>
                  )}
                </div>
              ))}
              {line.outstanding > 0 && (
                <div className="font-semibold">
                  {line.outstanding === line.quantityBorrowed
                    ? 'Still out'
                    : `${line.outstanding} still out`}
                </div>
              )}
            </div>
          ),
        },
        {
          header: 'Received by',
          cell: (line) =>
            line.returns.length === 0 ? (
              '—'
            ) : (
              <div className="flex flex-col gap-1">
                {line.returns.map((event) => (
                  <div key={event.id}>{event.receivedBy.name}</div>
                ))}
              </div>
            ),
        },
        {
          header: 'Condition',
          cell: (line) =>
            line.returns.length === 0 ? (
              '—'
            ) : (
              <div className="flex flex-col gap-1">
                {line.returns.map((event) => (
                  <div key={event.id}>{CONDITION_LABELS[event.condition]}</div>
                ))}
              </div>
            ),
        },
        { header: 'Flag', cell: (line) => <FlagBadge line={line} /> },
      ]}
      rows={history.data?.data}
      rowKey={(line) => line.lineId}
      isLoading={history.isPending}
      emptyText="Nothing was borrowed in this date range."
      page={page}
      pageSize={PAGE_SIZE}
      total={history.data?.total ?? 0}
      onPageChange={setPage}
    />
  );
}
