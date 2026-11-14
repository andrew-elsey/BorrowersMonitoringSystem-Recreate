import {
  rangeDays,
  REPORT_MAX_RANGE_DAYS,
  usageQuerySchema,
  type UsageQuery,
  type UsageRow,
  type UsageSummary,
} from '@bms/shared';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import { apiFetch } from '../api';
import { Field } from '../components/Field';
import { RetryAlert } from '../components/RetryAlert';
import { todayInAppZone } from '../timezone';

// The Usage summary tab of Reports (RPT-4, all staff). Bars are plain CSS, one series per chart, so
// no chart library is needed; "Show as table" gives the same numbers as text. The server checks the
// range again (CLAUDE.md rule 2).

// Default period: From is 30 days before today, To is today (owner decision 2026-11-14).
const DEFAULT_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const daysBefore = (date: string, days: number) =>
  new Date(Date.parse(date) - days * DAY_MS).toISOString().slice(0, 10);
// from and to are calendar dates, so they are shown as is, not shifted by a timezone.
const calendarDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

// The approved mockup's message names how long the chosen range is.
function rangeError(range: UsageQuery): string | undefined {
  const parsed = usageQuerySchema.safeParse(range);
  if (parsed.success) return undefined;
  const days = rangeDays(range.from, range.to);
  if (days > REPORT_MAX_RANGE_DAYS) {
    return `The date range can be at most ${REPORT_MAX_RANGE_DAYS} days. You chose ${days} days.`;
  }
  return parsed.error.issues[0].message;
}

export function UsageReport() {
  const today = todayInAppZone();
  const [from, setFrom] = useState(daysBefore(today, DEFAULT_DAYS));
  const [to, setTo] = useState(today);
  const [shown, setShown] = useState<UsageQuery>({ from, to });
  const [error, setError] = useState<string>();
  const fromRef = useRef<HTMLInputElement>(null);

  const usage = useQuery({
    queryKey: ['reports', 'usage', shown],
    queryFn: () => apiFetch<UsageSummary>('GET', `/reports/usage?${new URLSearchParams(shown)}`),
  });

  function show(event: FormEvent) {
    event.preventDefault();
    const message = rangeError({ from, to });
    setError(message);
    if (message) fromRef.current?.focus();
    else setShown({ from, to });
  }

  const period = `${calendarDate.format(new Date(shown.from))} – ${calendarDate.format(new Date(shown.to))}`;
  const data = usage.data;
  return (
    <>
      <form onSubmit={show} noValidate className="flex min-w-0 flex-wrap items-start gap-3">
        <div className="w-full min-w-0 sm:w-44">
          <Field
            ref={fromRef}
            id="usage-from"
            type="date"
            label="From"
            required
            error={error}
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div className="w-full min-w-0 sm:w-44">
          <Field
            id="usage-to"
            type="date"
            label="To"
            required
            aria-invalid={error ? true : undefined}
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
        <button
          type="submit"
          className="h-11 w-full cursor-pointer rounded-lg bg-primary px-5 text-base font-semibold text-white hover:bg-primary-hover sm:mt-7 sm:w-auto"
        >
          Show report
        </button>
      </form>

      {usage.isError ? (
        <RetryAlert query={usage} onRetried={() => fromRef.current?.focus()} />
      ) : !data ? (
        <p className="text-muted">Loading…</p>
      ) : data.items.length === 0 ? (
        <p className="text-muted">Nothing was borrowed from {period}.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-5">
          <UsageChart
            id="usage-items"
            title="Most borrowed items"
            column="Item"
            period={period}
            rows={data.items.map((row) => ({
              ...row,
              name: row.assetTag ? `${row.name} ${row.assetTag}` : row.name,
            }))}
          />
          <UsageChart
            id="usage-categories"
            title="By category"
            column="Category"
            period={period}
            rows={data.categories}
          />
          <UsageChart
            id="usage-rooms"
            title="By room or lab"
            column="Room or lab"
            period={period}
            rows={data.rooms}
          />
        </div>
      )}
    </>
  );
}

// One bar chart. Bars scale to the largest count in the chart; the count is also written next to
// each bar, so the chart does not depend on reading bar lengths.
function UsageChart(props: {
  id: string;
  title: string;
  column: string;
  period: string;
  rows: UsageRow[];
}) {
  const max = Math.max(...props.rows.map((row) => row.timesBorrowed));
  return (
    <section
      aria-labelledby={props.id}
      className="flex flex-col gap-3.5 rounded-xl border border-divider bg-surface p-5"
    >
      <div>
        <h2 id={props.id} className="text-lg font-bold">
          {props.title}
        </h2>
        <p className="text-sm text-muted">Times borrowed, {props.period}</p>
      </div>
      <ul aria-label={props.title} className="flex flex-col gap-2.5">
        {props.rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-1">
            <span className="text-sm break-words">{row.name}</span>
            <div className="flex items-center gap-2">
              <div aria-hidden="true" className="h-3.5 flex-1 border-b border-divider">
                <div
                  className="h-3.5 rounded-r bg-primary"
                  style={{ width: `${(row.timesBorrowed / max) * 100}%` }}
                />
              </div>
              <span className="min-w-9 text-right text-sm font-semibold tabular-nums">
                {row.timesBorrowed}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <details>
        <summary className="min-h-8 cursor-pointer text-sm font-semibold text-primary">
          Show as table
        </summary>
        <table className="mt-1.5 w-full border-collapse text-[15px]">
          <thead>
            <tr>
              <th className="border-b border-divider px-3 py-2.5 text-left text-sm font-semibold text-muted">
                {props.column}
              </th>
              <th className="border-b border-divider px-3 py-2.5 text-right text-sm font-semibold text-muted">
                Times borrowed
              </th>
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row) => (
              <tr key={row.id}>
                <td className="border-b border-divider px-3 py-2.5 break-words">{row.name}</td>
                <td className="border-b border-divider px-3 py-2.5 text-right tabular-nums">
                  {row.timesBorrowed}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
