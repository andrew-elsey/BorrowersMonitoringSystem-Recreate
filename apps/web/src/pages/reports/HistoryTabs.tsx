import {
  type BorrowerPage,
  type HistoryLine,
  type ItemPage,
  SEARCH_MAX_LENGTH,
  SEARCH_MIN_LENGTH,
} from '@bms/shared';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { apiFetch } from '../../api';
import { type Column, cellTextClass } from '../../components/DataTable';
import { Field } from '../../components/Field';
import { RetryAlert } from '../../components/RetryAlert';
import { HistoryTable, useDateRange } from './HistoryTable';

// History per borrower (RPT-2) and per item (RPT-3), BR section 4. Find the borrower or item by
// text, choose it when several match, then show its lines issued in the date range. The server
// checks the text and the range again (SPEC.md 7).

// Enough to pick from; a vaguer search shows a hint to type more.
const MATCHES = 10;
const SEARCH_MESSAGE = `Search text must be ${SEARCH_MIN_LENGTH} to ${SEARCH_MAX_LENGTH} characters.`;

type Match = { id: string; title: string; detail: string };

function LookupHistoryTab(props: {
  id: string;
  noun: string; // "borrower" or "item"
  label: string;
  // One page of matches for the search text, in the Match shape.
  lookup: (q: string) => Promise<{ data: Match[]; total: number }>;
  historyPath: (id: string) => string;
  first: Column<HistoryLine>;
}) {
  const range = useDateRange();
  const [text, setText] = useState('');
  const [textError, setTextError] = useState<string>();
  // What was last submitted: the search text and the range it was submitted with.
  const [shown, setShown] = useState<{ q: string; from: string; to: string }>();
  const [chosen, setChosen] = useState<Match>();

  const matches = useQuery({
    queryKey: ['report-lookup', props.id, shown?.q],
    queryFn: () => props.lookup(shown!.q),
    enabled: shown !== undefined,
  });
  // One match is the one; several need a choice.
  const match = chosen ?? (matches.data?.data.length === 1 ? matches.data.data[0] : undefined);

  function submit(event: FormEvent) {
    event.preventDefault();
    const q = text.trim();
    const textOk = q.length >= SEARCH_MIN_LENGTH && q.length <= SEARCH_MAX_LENGTH;
    setTextError(textOk ? undefined : SEARCH_MESSAGE);
    if (!range.check() || !textOk) return;
    // A new search text forgets the choice; a new range alone keeps it.
    if (q !== shown?.q) setChosen(undefined);
    setShown({ q, from: range.from, to: range.to });
  }

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={submit} noValidate className="flex min-w-0 flex-wrap items-start gap-3">
        <div className="w-full min-w-0 sm:flex-[1_1_240px]">
          <Field
            id={`${props.id}-lookup`}
            type="search"
            label={props.label}
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
        <p role="status">
          No {props.noun} matches “{shown?.q}”.
        </p>
      )}
      {matches.data && matches.data.data.length > 1 && !chosen && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[15px] font-semibold">
            {matches.data.total} {props.noun}s match. Choose one:
          </legend>
          {matches.data.data.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setChosen(option)}
              className="min-h-11 cursor-pointer rounded-lg border border-divider bg-surface px-3.5 text-left hover:bg-primary-tint"
            >
              <strong>{option.title}</strong>{' '}
              <span className="text-[13px] text-muted">{option.detail}</span>
            </button>
          ))}
          {matches.data.total > MATCHES && (
            <p className="text-sm text-muted">
              Showing the first {MATCHES}. Type more to narrow it down.
            </p>
          )}
        </fieldset>
      )}

      {match && shown && (
        <section aria-labelledby={`${props.id}-title`} className="flex flex-col gap-3">
          <h2 id={`${props.id}-title`} className="text-lg font-bold">
            {match.title} <span className="text-[15px] font-normal text-muted">{match.detail}</span>
          </h2>
          <HistoryTable
            // A new choice or range starts again at page 1.
            key={`${match.id} ${shown.from} ${shown.to}`}
            path={props.historyPath(match.id)}
            from={shown.from}
            to={shown.to}
            caption={`Borrowing history of ${match.title}`}
            first={props.first}
          />
        </section>
      )}
    </div>
  );
}

const lookupQuery = (q: string) => `q=${encodeURIComponent(q)}&page=1&pageSize=${MATCHES}`;
const noteLine = (line: HistoryLine) =>
  line.note && <div className="text-[13px] text-muted">Note: {line.note}</div>;

// RPT-2. View-only users may read reports but not the checkout lookup, so the report has its own.
export function BorrowerHistoryTab() {
  return (
    <LookupHistoryTab
      id="history-borrower"
      noun="borrower"
      label="Borrower name or school ID"
      lookup={async (q) => {
        const found = await apiFetch<BorrowerPage>('GET', `/reports/borrowers?${lookupQuery(q)}`);
        return {
          total: found.total,
          data: found.data.map((b) => ({ id: b.id, title: b.name, detail: b.schoolId })),
        };
      }}
      historyPath={(id) => `/reports/borrowers/${id}/history`}
      first={{
        header: 'Item',
        cell: (line) => (
          <div className={cellTextClass}>
            <strong>{line.item.name}</strong>
            {line.item.assetTag && (
              <div className="text-[13px] text-muted">Asset tag {line.item.assetTag}</div>
            )}
            {noteLine(line)}
          </div>
        ),
      }}
    />
  );
}

// RPT-3. GET /api/items?q= matches name or asset tag and is open to every role.
export function ItemHistoryTab() {
  return (
    <LookupHistoryTab
      id="history-item"
      noun="item"
      label="Item or asset tag"
      lookup={async (q) => {
        const found = await apiFetch<ItemPage>('GET', `/items?${lookupQuery(q)}`);
        return {
          total: found.total,
          data: found.data.map((item) => ({
            id: item.id,
            title: item.name,
            detail: item.assetTag ? `Asset tag ${item.assetTag}` : item.category.name,
          })),
        };
      }}
      historyPath={(id) => `/reports/items/${id}/history`}
      first={{
        header: 'Borrower',
        cell: (line) => (
          <div className={cellTextClass}>
            <strong>{line.borrower.name}</strong>
            <div className="text-[13px] text-muted">{line.borrower.schoolId}</div>
            {noteLine(line)}
          </div>
        ),
      }}
    />
  );
}
