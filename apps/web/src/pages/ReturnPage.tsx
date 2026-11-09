import {
  LINE_QUANTITY_MAX,
  type OpenLine,
  type OpenLinePage,
  type ReturnCondition,
  type ReturnEvent,
  returnSchema,
  SEARCH_MAX_LENGTH,
  SEARCH_MIN_LENGTH,
} from '@bms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiRequestError, apiFetch, errorText, fieldErrors } from '../api';
import { Alert } from '../components/Alert';
import { Field, SelectField } from '../components/Field';
import { FlagIcon } from '../components/icons';
import { useMessageArea } from '../components/Notifications';
import { RetryAlert } from '../components/RetryAlert';

// Return (SPEC.md 5, admins and handlers, BRW-5). Finds open lines and returns all or part of one
// line at a time. Every rule (BR 5, 6) is enforced by POST /api/returns; the screen shows the
// server's answer (CLAUDE.md rule 2). Returns are never blocked (BR 11) and the flag stays (BR 6).

// shortcut: one page of 50 lines and no pager; a note under the list says to narrow the search.
const PAGE_SIZE = 50;
const TIMEZONE = (import.meta.env.APP_TIMEZONE as string | undefined) || 'Asia/Manila';
const dateTime = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TIMEZONE,
});
const time = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TIMEZONE,
});
// expectedReturnDate is a calendar date, so it is shown as is, not shifted by a timezone.
const calendarDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const CONDITIONS: { value: ReturnCondition; label: string }[] = [
  { value: 'GOOD', label: 'Good' },
  { value: 'FAIR', label: 'Fair' },
  { value: 'DAMAGED', label: 'Damaged' },
];
const SEARCH_BY = [
  { value: 'borrower', label: 'Borrower' },
  { value: 'item', label: 'Item' },
  { value: 'assetTag', label: 'Asset tag' },
];
const SEARCH_MESSAGE = `Search text must be ${SEARCH_MIN_LENGTH} to ${SEARCH_MAX_LENGTH} characters.`;

// What one Return button sends, with the line it came from for the confirmation message.
type Giving = { line: OpenLine; quantity: number; condition: ReturnCondition };
// A line the API refused: the row to mark and the message to show on it.
type Refused = { lineId: string; message: string };

const controlClass =
  'h-11 rounded-lg border border-field-border bg-surface px-3 text-base text-ink aria-[invalid=true]:border-2 aria-[invalid=true]:border-danger';
const primaryButtonClass =
  'h-10 cursor-pointer rounded-lg bg-primary px-3.5 text-[15px] font-semibold whitespace-nowrap text-white hover:bg-primary-hover disabled:cursor-wait disabled:opacity-80';

export function ReturnPage() {
  const messageArea = useMessageArea();
  const queryClient = useQueryClient();
  const [by, setBy] = useState('borrower');
  const [text, setText] = useState('');
  const [searchError, setSearchError] = useState<string>();
  // What the last Find pressed: typing alone does not search.
  const [search, setSearch] = useState({ by: 'borrower', q: '' });
  const [refused, setRefused] = useState<Refused>();
  const searchRef = useRef<HTMLInputElement>(null);
  const sending = useRef(false);

  const open = useQuery({
    queryKey: ['open-lines', search],
    queryFn: () => {
      const params = new URLSearchParams({ by: search.by, page: '1', pageSize: String(PAGE_SIZE) });
      if (search.q) params.set('q', search.q);
      return apiFetch<OpenLinePage>('GET', `/returns/open?${params}`);
    },
  });

  const giveBack = useMutation({
    mutationFn: ({ line, quantity, condition }: Giving) =>
      apiFetch<{ returns: ReturnEvent[] }>('POST', '/returns', {
        lines: [{ lineId: line.lineId, quantity, condition }],
      }),
    onSuccess: () => {
      setRefused(undefined);
      void queryClient.invalidateQueries({ queryKey: ['open-lines'] });
    },
    onError: (error, { line }) => {
      // The API names the line it refused (RETURN_EXCEEDS_OUTSTANDING, NOT_FOUND): mark that row,
      // and reload the list so it shows what is really outstanding now.
      if (error instanceof ApiRequestError && error.details.lineId === line.lineId) {
        setRefused({ lineId: line.lineId, message: error.message });
        void queryClient.invalidateQueries({ queryKey: ['open-lines'] });
      }
    },
    onSettled: () => {
      sending.current = false;
    },
  });

  // Focus the refused row's quantity (FND-7). An effect, so the row has rendered first.
  useEffect(() => {
    if (refused) document.getElementById(`qty-${refused.lineId}`)?.focus();
  }, [refused]);
  // After a return the Return button may be gone (line complete), so focus goes to the search.
  useEffect(() => {
    if (giveBack.isSuccess) searchRef.current?.focus();
  }, [giveBack.isSuccess]);
  // The pinned "not saved" message must not cover the focused row. jsdom has no scrollIntoView.
  useEffect(() => {
    if (giveBack.error)
      (document.activeElement as HTMLElement | null)?.scrollIntoView?.({ block: 'nearest' });
  }, [giveBack.error]);

  function find(event: FormEvent) {
    event.preventDefault();
    const q = text.trim();
    if (q.length > 0 && q.length < SEARCH_MIN_LENGTH) {
      setSearchError(SEARCH_MESSAGE);
      searchRef.current?.focus();
      return;
    }
    setSearchError(undefined);
    setRefused(undefined);
    giveBack.reset();
    setSearch({ by, q });
  }

  function submitReturn(giving: Giving) {
    if (sending.current) return;
    // Early hint from the shared schema; the API checks again, including against what is outstanding.
    const check = returnSchema.safeParse({
      lines: [
        { lineId: giving.line.lineId, quantity: giving.quantity, condition: giving.condition },
      ],
    });
    if (!check.success) {
      setRefused({ lineId: giving.line.lineId, message: check.error.issues[0]!.message });
      return;
    }
    sending.current = true;
    setRefused(undefined);
    giveBack.mutate(giving);
  }

  const lines = open.data?.data ?? [];
  const groups: OpenLine[][] = [];
  for (const line of lines) {
    const group = groups.find((other) => other[0]!.transactionId === line.transactionId);
    if (group) group.push(line);
    else groups.push([line]);
  }
  const done = giveBack.data?.returns[0];
  const doneLine = giveBack.variables?.line;
  // A schema error the API keys as "lines" belongs to no row, so it shows at the top.
  const lineSchemaError = fieldErrors(giveBack.error).lines;

  return (
    <>
      <h1 className="text-[28px] leading-tight font-bold">Return</h1>

      {/* The result goes in the pinned message area, as on Checkout (ARCHITECTURE 14.1). */}
      {messageArea &&
        createPortal(
          <>
            {done && doneLine && (
              <Alert kind="success">
                <strong>Return recorded.</strong> {doneLine.item.name}
                {doneLine.item.assetTag && ` ${doneLine.item.assetTag}`} received from{' '}
                {doneLine.borrower.name} at {time.format(new Date(done.returnedAt))} (condition:{' '}
                {done.condition.toLowerCase()}).
                {doneLine.flagStatus === 'FLAGGED' &&
                  ' The flag on this line stays until an admin overrides it.'}
              </Alert>
            )}
            {giveBack.isError && (
              <Alert kind="error">
                <strong>Return not saved.</strong> {errorText(giveBack.error)}
                {lineSchemaError &&
                  lineSchemaError !== errorText(giveBack.error) &&
                  ` ${lineSchemaError}`}{' '}
                Nothing was recorded.
              </Alert>
            )}
          </>,
          messageArea,
        )}

      <form
        role="search"
        onSubmit={find}
        noValidate
        className="flex min-w-0 flex-wrap items-start gap-3 rounded-xl border border-divider bg-surface p-5"
      >
        <div className="w-full max-w-full min-w-0 sm:w-52">
          <SelectField
            id="find-by"
            label="Find by"
            options={SEARCH_BY}
            value={by}
            onChange={(event) => setBy(event.target.value)}
          />
        </div>
        <div className="w-full min-w-0 flex-1 sm:min-w-64">
          <Field
            ref={searchRef}
            id="open-search"
            type="search"
            label="Search"
            maxLength={SEARCH_MAX_LENGTH}
            error={searchError}
            hint="Leave empty to list every open borrowing."
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <button type="submit" className={`${primaryButtonClass} h-11 sm:mt-7`}>
          Find open borrowings
        </button>
      </form>

      {open.isError ? (
        <RetryAlert query={open} onRetried={() => searchRef.current?.focus()} />
      ) : open.isPending ? (
        <p className="text-muted">Loading…</p>
      ) : lines.length === 0 ? (
        <section className="rounded-xl border border-divider bg-surface px-5 py-10 text-center text-muted wrap-anywhere">
          {search.q
            ? `No open borrowings match "${search.q}". Check the spelling, or search by something else.`
            : 'Nothing is out right now.'}
        </section>
      ) : (
        <section
          aria-label="Open borrowings"
          className="flex w-full max-w-full min-w-0 flex-col gap-3.5 rounded-xl border border-divider bg-surface p-5"
        >
          <p className="text-sm text-muted">
            Returns are always allowed, even for a blocked borrower. Returning an item does not
            remove its flag.
          </p>
          {groups.map((group) => (
            <div
              key={group[0]!.transactionId}
              className="min-w-0 overflow-hidden rounded-lg border border-divider"
            >
              <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-divider bg-page px-3.5 py-2.5 text-sm text-muted wrap-anywhere">
                <strong className="text-ink">
                  {group[0]!.borrower.name} {group[0]!.borrower.schoolId}
                </strong>
                <span>{dateTime.format(new Date(group[0]!.issuedAt))}</span>
                <span>Room: {group[0]!.location}</span>
                <span>Issued by {group[0]!.issuedBy}</span>
              </div>
              {group.map((line) => (
                <LineRow
                  key={line.lineId}
                  line={line}
                  busy={giveBack.isPending}
                  error={refused?.lineId === line.lineId ? refused.message : undefined}
                  onReturn={submitReturn}
                />
              ))}
            </div>
          ))}
          {open.data!.total > lines.length && (
            <p className="text-sm text-muted">
              Showing {lines.length} of {open.data!.total} open lines. Search for a borrower, item,
              or asset tag to narrow the list.
            </p>
          )}
        </section>
      )}
    </>
  );
}

// One open line with its own quantity and condition. GOOD is the default. A unit item is one
// piece, so its quantity is fixed at 1.
function LineRow({
  line,
  busy,
  error,
  onReturn,
}: {
  line: OpenLine;
  busy: boolean;
  error?: string;
  onReturn: (giving: Giving) => void;
}) {
  const unit = line.item.trackingType === 'UNIT';
  const [quantity, setQuantity] = useState(String(line.outstanding));
  const [condition, setCondition] = useState<ReturnCondition>('GOOD');
  const flagged = line.flagStatus === 'FLAGGED';
  const name = line.item.assetTag ? `${line.item.name} ${line.item.assetTag}` : line.item.name;
  const out =
    line.outstanding === line.quantityBorrowed
      ? String(line.outstanding)
      : `${line.outstanding} of ${line.quantityBorrowed}`;
  return (
    <div
      className={`flex min-w-0 flex-wrap items-start gap-x-6 gap-y-3 border-b border-divider px-3.5 py-3 last:border-b-0 ${flagged ? 'bg-danger-tint/50' : ''}`}
    >
      <div className="min-w-0 flex-[1_1_220px] wrap-anywhere">
        <div className="font-semibold">{line.item.name}</div>
        <div className="text-[13px] text-muted">
          {line.item.assetTag ? `Asset tag ${line.item.assetTag}` : 'Quantity item'}
        </div>
        {line.note && <div className="mt-1 text-sm">{line.note}</div>}
      </div>
      <div className="min-w-0 flex-[0_1_160px] text-sm">
        <div>Out: {out}</div>
        {line.expectedReturnDate && (
          <div className="text-muted">
            Expected {calendarDate.format(new Date(line.expectedReturnDate))}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-[0_1_120px]">
        {/* Colour is paired with an icon and the word Flagged (ARCHITECTURE 14). */}
        {flagged ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-tint px-2.5 py-0.5 text-[13px] font-semibold whitespace-nowrap text-danger">
            <FlagIcon />
            Flagged
          </span>
        ) : (
          <span className="text-sm text-muted">
            {line.flagStatus === 'OVERRIDDEN' ? 'Flag overridden' : 'Not flagged'}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-[1_1_300px] flex-wrap items-start gap-2">
        <div>
          <input
            id={`qty-${line.lineId}`}
            type="number"
            min={1}
            max={LINE_QUANTITY_MAX}
            aria-label={`Quantity to return for ${name}`}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `qty-${line.lineId}-message` : undefined}
            disabled={unit}
            value={unit ? '1' : quantity}
            onChange={(event) => setQuantity(event.target.value)}
            className={`${controlClass} w-24 disabled:opacity-70`}
          />
          {error && (
            <p
              id={`qty-${line.lineId}-message`}
              role="alert"
              className="mt-1.5 max-w-52 text-sm font-semibold text-danger"
            >
              {error}
            </p>
          )}
        </div>
        <select
          aria-label={`Condition for ${name}`}
          value={condition}
          onChange={(event) => setCondition(event.target.value as ReturnCondition)}
          className={`${controlClass} w-32 max-w-full`}
        >
          {CONDITIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy}
          onClick={() => onReturn({ line, quantity: unit ? 1 : Number(quantity), condition })}
          className={primaryButtonClass}
        >
          {unit ? 'Return' : 'Return quantity'}
        </button>
      </div>
    </div>
  );
}
