import {
  type FlaggedLine,
  type FlaggedLinePage,
  FLAG_RETURNED_FILTERS,
  type OverrideInput,
  type OverrideResult,
  overrideSchema,
  OVERRIDE_REASON_MAX,
  OVERRIDE_REASON_MIN,
  SEARCH_MAX_LENGTH,
  SEARCH_MIN_LENGTH,
} from '@bms/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { ApiRequestError, apiFetch } from '../api';
import { Alert } from '../components/Alert';
import { cellTextClass, DataTable } from '../components/DataTable';
import { Field, SelectField, showApiFieldErrors, TextAreaField } from '../components/Field';
import { FormDialog } from '../components/FormDialog';
import { FlagIcon } from '../components/icons';
import { useNotify } from '../components/Notifications';
import { RetryAlert } from '../components/RetryAlert';
import { TIMEZONE } from '../timezone';

// Flag review (SPEC.md 5, admin only, FLG-4). Lists FLAGGED lines; an admin overrides one with a
// reason (BR 13), before or after it is returned. The server enforces every rule (CLAUDE.md rule 2).
// The mockup's "Run flagging now" button and strike counts are not part of FLG-4.

const PAGE_SIZE = 25;
const FLAGS_KEY = ['flags'];
const dateTime = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
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
const FILTER_LABELS = { all: 'All flagged lines', out: 'Still out', returned: 'Returned' } as const;
const FILTER_OPTIONS = FLAG_RETURNED_FILTERS.map((value) => ({
  value,
  label: FILTER_LABELS[value],
}));
const SEARCH_MESSAGE = `Search text must be ${SEARCH_MIN_LENGTH} to ${SEARCH_MAX_LENGTH} characters.`;

const strikeText = (count: number) => `${count} ${count === 1 ? 'strike' : 'strikes'}`;

const nowText = (line: FlaggedLine) =>
  line.outstanding === 0
    ? 'Returned'
    : line.outstanding === line.quantityBorrowed
      ? 'Still out'
      : `${line.outstanding} still out`;

export function FlagReviewPage() {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [returned, setReturned] = useState<(typeof FLAG_RETURNED_FILTERS)[number]>('all');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [searchError, setSearchError] = useState<string>();
  const [toOverride, setToOverride] = useState<FlaggedLine | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const flags = useQuery({
    queryKey: [...FLAGS_KEY, returned, q, page],
    queryFn: () => {
      const params = new URLSearchParams({
        returned,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (q) params.set('q', q);
      return apiFetch<FlaggedLinePage>('GET', `/flags?${params}`);
    },
    placeholderData: keepPreviousData,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: FLAGS_KEY });

  const form = useForm<OverrideInput>({
    resolver: zodResolver(overrideSchema),
    defaultValues: { reason: '' },
  });
  // The line travels with the request, not read from state: the dialog may close meanwhile.
  const override = useMutation({
    mutationFn: ({ line, input }: { line: FlaggedLine; input: OverrideInput }) =>
      apiFetch<{ line: OverrideResult }>('POST', `/flags/${line.lineId}/override`, input),
    onSuccess: async ({ line: result }, { line }) => {
      notify.success(
        `Flag overridden. ${line.borrower.name}'s ${line.item.name} line no longer counts. ${line.borrower.name} now has ${strikeText(result.strikes)}.`,
      );
      setToOverride(null);
      await refresh();
      // The row and its Override button are gone, so focus would drop to the page start.
      searchRef.current?.focus();
    },
    onError: async (error) => {
      if (showApiFieldErrors(form.setError, error, ['reason'])) return;
      notify.error(error);
      // Someone else already overrode it (LINE_NOT_FLAGGED) or it is gone: close and reload.
      if (
        error instanceof ApiRequestError &&
        ['LINE_NOT_FLAGGED', 'NOT_FOUND'].includes(error.code)
      ) {
        setToOverride(null);
        await refresh();
        searchRef.current?.focus();
      }
    },
  });

  // Run flagging now (FLG-2 endpoint, admin only, once a minute). A refusal within the minute shows
  // the mockup's message with the seconds left from Retry-After.
  const [runOpen, setRunOpen] = useState(false);
  const [runRefused, setRunRefused] = useState<string>();
  const run = useMutation({
    mutationFn: () =>
      apiFetch<{ run: { flagged: number; skipped: boolean } }>('POST', '/flagging/run'),
    onSuccess: ({ run: result }) => {
      setRunOpen(false);
      setRunRefused(undefined);
      notify.success(
        result.skipped
          ? 'Another flagging run is in progress. Nothing was changed.'
          : `Flagging run finished. ${result.flagged} ${result.flagged === 1 ? 'line' : 'lines'} flagged.`,
      );
      return refresh();
    },
    onError: (error) => {
      setRunOpen(false);
      if (error instanceof ApiRequestError && error.code === 'RATE_LIMITED') {
        setRunRefused(
          `Flagging was run less than a minute ago.${error.retryAfterSeconds ? ` Try again in ${error.retryAfterSeconds === 1 ? '1 second' : `${error.retryAfterSeconds} seconds`}.` : ' Try again shortly.'}`,
        );
      } else notify.error(error);
    },
  });

  function search(event: FormEvent) {
    event.preventDefault();
    const trimmed = text.trim();
    if (trimmed.length > 0 && trimmed.length < SEARCH_MIN_LENGTH) {
      setSearchError(SEARCH_MESSAGE);
      return;
    }
    setSearchError(undefined);
    setPage(1);
    setQ(trimmed);
  }

  function start(line: FlaggedLine) {
    form.reset({ reason: '' });
    setToOverride(line);
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-[28px] leading-tight font-bold">Flag review</h1>
        <button
          type="button"
          onClick={() => setRunOpen(true)}
          className="h-11 cursor-pointer rounded-lg border border-primary bg-surface px-4 text-[15px] font-semibold text-primary hover:bg-primary-tint"
        >
          Run flagging now
        </button>
      </div>

      {runRefused && <Alert kind="wait">{runRefused}</Alert>}

      <form
        onSubmit={search}
        role="search"
        noValidate
        className="flex min-w-0 flex-wrap items-start gap-3"
      >
        <div className="w-full min-w-0 sm:flex-[1_1_260px]">
          <Field
            ref={searchRef}
            id="flag-search"
            type="search"
            label="Borrower or item"
            maxLength={SEARCH_MAX_LENGTH}
            error={searchError}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <div className="w-full min-w-0 sm:w-56">
          <SelectField
            id="flag-returned"
            label="Returned?"
            options={FILTER_OPTIONS}
            value={returned}
            onChange={(event) => {
              setPage(1);
              setReturned(event.target.value as typeof returned);
            }}
          />
        </div>
        <button
          type="submit"
          className="h-11 w-full cursor-pointer rounded-lg bg-primary px-5 text-base font-semibold text-white hover:bg-primary-hover sm:mt-7 sm:w-auto"
        >
          Search
        </button>
      </form>

      {flags.isError ? (
        // Too broad is not a failure to retry: the same search would be refused again.
        flags.error instanceof ApiRequestError && flags.error.code === 'SEARCH_TOO_BROAD' ? (
          <Alert kind="error">{flags.error.message}</Alert>
        ) : (
          <RetryAlert query={flags} onRetried={() => searchRef.current?.focus()} />
        )
      ) : (
        <DataTable
          caption="Flagged lines"
          columns={[
            {
              header: 'Borrower',
              cell: (line) => (
                <div className={cellTextClass}>
                  <strong>{line.borrower.name}</strong>
                  <div className="text-[13px] text-muted">{line.borrower.schoolId}</div>
                  <div className="text-[13px] text-muted">
                    {strikeText(line.strikes)}
                    {line.strikes >= (flags.data?.blockThreshold ?? Infinity) && ' · blocked'}
                  </div>
                </div>
              ),
            },
            {
              header: 'Item',
              cell: (line) => (
                <div className={cellTextClass}>
                  {line.item.name}
                  <div className="text-[13px] text-muted">
                    {line.item.assetTag
                      ? `Asset tag ${line.item.assetTag}`
                      : `Quantity ${line.quantityBorrowed}`}
                  </div>
                </div>
              ),
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
              header: 'Flagged',
              cell: (line) => (
                // Colour is paired with an icon and the word Flagged (ARCHITECTURE 14).
                <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-tint px-2.5 py-0.5 text-[13px] font-semibold whitespace-nowrap text-danger">
                  <FlagIcon />
                  {dateTime.format(new Date(line.flaggedAt))}
                </span>
              ),
            },
            { header: 'Now', cell: nowText },
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
              cell: (line) =>
                line.expectedReturnDate
                  ? calendarDate.format(new Date(line.expectedReturnDate))
                  : '—',
            },
            {
              header: 'Action',
              cell: (line) => (
                <button
                  type="button"
                  aria-label={`Override flag for ${line.borrower.name}, ${line.item.name}`}
                  onClick={() => start(line)}
                  className="h-10 cursor-pointer rounded-lg border border-danger bg-surface px-3.5 text-[15px] font-semibold text-danger hover:bg-danger-tint"
                >
                  Override
                </button>
              ),
            },
          ]}
          rows={flags.data?.data}
          rowKey={(line) => line.lineId}
          isLoading={flags.isPending}
          emptyText="No flagged lines. Nothing needs review."
          page={page}
          pageSize={PAGE_SIZE}
          total={flags.data?.total ?? 0}
          onPageChange={setPage}
        />
      )}

      <FormDialog
        open={runOpen}
        title="Run flagging now?"
        submitLabel="Run flagging"
        onSubmit={(event) => {
          event.preventDefault();
          run.mutate();
        }}
        onCancel={() => setRunOpen(false)}
        isPending={run.isPending}
      >
        <p className="text-[15px] leading-normal">
          This flags every line that is still out and was issued before the last closing time. Lines
          already flagged or overridden are skipped, so running it again changes nothing.
        </p>
        <p className="text-sm leading-normal text-muted">
          It can be run once per minute. The run is recorded in the audit log.
        </p>
      </FormDialog>

      <FormDialog
        open={toOverride !== null}
        title="Override flag"
        submitLabel="Override flag"
        danger
        onSubmit={form.handleSubmit((input) => override.mutate({ line: toOverride!, input }))}
        onCancel={() => setToOverride(null)}
        isPending={override.isPending}
      >
        {toOverride && (
          <>
            <p className="text-[15px] leading-normal wrap-anywhere">
              {toOverride.borrower.name} · {toOverride.item.name}
              {toOverride.item.assetTag && ` (${toOverride.item.assetTag})`} · flagged{' '}
              {dateTime.format(new Date(toOverride.flaggedAt))}. {nowText(toOverride)}.
            </p>
            <p className="text-sm leading-normal text-muted">
              The line will no longer count as a strike and will never be flagged again. This is
              recorded in the audit log.
            </p>
          </>
        )}
        <TextAreaField
          id="override-reason"
          label={`Reason (required, ${OVERRIDE_REASON_MIN} to ${OVERRIDE_REASON_MAX} characters)`}
          error={form.formState.errors.reason?.message}
          {...form.register('reason')}
        />
      </FormDialog>
    </>
  );
}
