import {
  type Borrower,
  type BorrowerPage,
  SEARCH_MAX_LENGTH,
  SEARCH_MIN_LENGTH,
} from '@bms/shared';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { apiFetch } from '../../api';
import { cellTextClass } from '../../components/DataTable';
import { Field } from '../../components/Field';
import { RetryAlert } from '../../components/RetryAlert';
import { HistoryTable, useDateRange } from './HistoryTable';

// History per borrower (RPT-2, BR section 4). Find the borrower by name or school ID, then show
// their lines issued in the date range. The server checks the range again (SPEC.md 7).

// Enough to pick from; a vaguer search shows a hint to type more.
const MATCHES = 10;
const SEARCH_MESSAGE = `Search text must be ${SEARCH_MIN_LENGTH} to ${SEARCH_MAX_LENGTH} characters.`;

export function BorrowerHistoryTab() {
  const range = useDateRange();
  const [text, setText] = useState('');
  const [textError, setTextError] = useState<string>();
  // What was last submitted: the search text and the range it was submitted with.
  const [shown, setShown] = useState<{ q: string; from: string; to: string }>();
  const [chosen, setChosen] = useState<Borrower>();

  const matches = useQuery({
    queryKey: ['report-borrowers', shown?.q],
    queryFn: () =>
      apiFetch<BorrowerPage>(
        'GET',
        `/reports/borrowers?q=${encodeURIComponent(shown!.q)}&page=1&pageSize=${MATCHES}`,
      ),
    enabled: shown !== undefined,
  });
  // One match is the borrower; several need a choice.
  const borrower = chosen ?? (matches.data?.data.length === 1 ? matches.data.data[0] : undefined);

  function submit(event: FormEvent) {
    event.preventDefault();
    const q = text.trim();
    const textOk = q.length >= SEARCH_MIN_LENGTH && q.length <= SEARCH_MAX_LENGTH;
    setTextError(textOk ? undefined : SEARCH_MESSAGE);
    if (!range.check() || !textOk) return;
    // A new search text forgets the chosen borrower; a new range alone keeps them.
    if (q !== shown?.q) setChosen(undefined);
    setShown({ q, from: range.from, to: range.to });
  }

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={submit} noValidate className="flex min-w-0 flex-wrap items-start gap-3">
        <div className="w-full min-w-0 sm:flex-[1_1_240px]">
          <Field
            id="history-borrower"
            type="search"
            label="Borrower name or school ID"
            maxLength={SEARCH_MAX_LENGTH}
            value={text}
            error={textError}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        {range.fields}
        <button
          type="submit"
          className="h-11 w-full cursor-pointer rounded-lg bg-primary px-5 text-base font-semibold text-white hover:bg-primary-hover sm:mt-7 sm:w-auto"
        >
          Show report
        </button>
      </form>

      {matches.isError && <RetryAlert query={matches} />}
      {matches.data && matches.data.total === 0 && (
        <p role="status">No borrower matches “{shown?.q}”.</p>
      )}
      {matches.data && matches.data.data.length > 1 && !chosen && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[15px] font-semibold">
            {matches.data.total} borrowers match. Choose one:
          </legend>
          {matches.data.data.map((match) => (
            <button
              key={match.id}
              type="button"
              onClick={() => setChosen(match)}
              className="min-h-11 cursor-pointer rounded-lg border border-divider bg-surface px-3.5 text-left hover:bg-primary-tint"
            >
              <strong>{match.name}</strong>{' '}
              <span className="text-[13px] text-muted">{match.schoolId}</span>
            </button>
          ))}
          {matches.data.total > MATCHES && (
            <p className="text-sm text-muted">
              Showing the first {MATCHES}. Type more to narrow it down.
            </p>
          )}
        </fieldset>
      )}

      {borrower && shown && (
        <section aria-labelledby="history-borrower-title" className="flex flex-col gap-3">
          <h2 id="history-borrower-title" className="text-lg font-bold">
            {borrower.name}{' '}
            <span className="text-[15px] font-normal text-muted">{borrower.schoolId}</span>
          </h2>
          <HistoryTable
            // A new borrower or range starts again at page 1.
            key={`${borrower.id} ${shown.from} ${shown.to}`}
            path={`/reports/borrowers/${borrower.id}/history`}
            from={shown.from}
            to={shown.to}
            caption={`Borrowing history of ${borrower.name}`}
            first={{
              header: 'Item',
              cell: (line) => (
                <div className={cellTextClass}>
                  <strong>{line.item.name}</strong>
                  {line.item.assetTag && (
                    <div className="text-[13px] text-muted">Asset tag {line.item.assetTag}</div>
                  )}
                  {line.note && <div className="text-[13px] text-muted">Note: {line.note}</div>}
                </div>
              ),
            }}
          />
        </section>
      )}
    </div>
  );
}
