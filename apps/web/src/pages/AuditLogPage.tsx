import {
  AUDIT_ENTITIES,
  auditQuerySchema,
  type AuditEntryView,
  type AuditPage,
  type UserPage,
} from '@bms/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import { apiFetch } from '../api';
import { type Column, DataTable } from '../components/DataTable';
import { Field, SelectField } from '../components/Field';
import { RetryAlert } from '../components/RetryAlert';
import { TIMEZONE, todayInAppZone } from '../timezone';

// Audit log (HRD-1, admin only), as in the approved mockup. The server checks the filters again
// (CLAUDE.md rule 2); this page only gives the messages early.

const PAGE_SIZE = 25;
const DEFAULT_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const daysBefore = (date: string, days: number) =>
  new Date(Date.parse(date) - days * DAY_MS).toISOString().slice(0, 10);
const dateTime = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZone: TIMEZONE,
});
const ENTITY_LABELS: Record<(typeof AUDIT_ENTITIES)[number], string> = {
  borrower: 'Borrower',
  borrower_import: 'Borrower import',
  category: 'Category',
  item: 'Item',
  location: 'Room or lab',
  return: 'Return',
  semester: 'Semester',
  setting: 'Settings',
  transaction: 'Transaction',
  transaction_item: 'Transaction line',
  user: 'User',
  flagging_run: 'Flagging run',
};
const entityLabel = (entity: string) =>
  ENTITY_LABELS[entity as keyof typeof ENTITY_LABELS] ?? entity;
const ENTITY_OPTIONS = [
  { value: '', label: 'All entities' },
  ...AUDIT_ENTITIES.map((value) => ({ value, label: ENTITY_LABELS[value] })),
];

type Filters = { from: string; to: string; actor: string; entity: string };

// `before` or `after` as readable JSON; null means the entry has none (a new record has no before).
const json = (value: unknown) => (value == null ? '—' : JSON.stringify(value, null, 2));

const COLUMNS: Column<AuditEntryView>[] = [
  {
    header: 'Time',
    cell: (row) => (
      <span className="whitespace-nowrap">{dateTime.format(new Date(row.createdAt))}</span>
    ),
  },
  { header: 'Actor', cell: (row) => row.actor?.name ?? 'System' },
  { header: 'Action', cell: (row) => <span className="font-semibold">{row.action}</span> },
  { header: 'Entity', cell: (row) => entityLabel(row.entity) },
  {
    header: 'Change',
    cell: (row) => (
      <details>
        <summary className="min-h-8 cursor-pointer font-semibold break-all text-primary">
          {row.entityId}
        </summary>
        <div className="mt-2 grid min-w-64 grid-cols-1 gap-3 sm:grid-cols-2">
          {(['before', 'after'] as const).map((side) => (
            <div key={side}>
              <div className="text-[13px] font-semibold text-muted">
                {side === 'before' ? 'Before' : 'After'}
              </div>
              <pre className="font-mono text-[13px] break-words whitespace-pre-wrap">
                {json(row[side])}
              </pre>
            </div>
          ))}
        </div>
      </details>
    ),
  },
];

export function AuditLogPage() {
  const today = todayInAppZone();
  const [form, setForm] = useState<Filters>({
    from: daysBefore(today, DEFAULT_DAYS - 1),
    to: today,
    actor: '',
    entity: '',
  });
  const [shown, setShown] = useState(form);
  const [page, setPage] = useState(1);
  const [errors, setErrors] = useState<{ from?: string; to?: string }>({});
  const fromRef = useRef<HTMLInputElement>(null);

  // shortcut: Actor lists only the first 100 users (page size limit, SPEC 7); page or search users if the department ever has more.
  const users = useQuery({
    queryKey: ['users', 'audit-actors'],
    queryFn: () => apiFetch<UserPage>('GET', '/users?pageSize=100'),
  });
  const actorOptions = [
    { value: '', label: 'All staff and system' },
    ...(users.data?.data ?? []).map((user) => ({ value: user.id, label: user.name })),
    { value: 'system', label: 'System' },
  ];

  const audit = useQuery({
    queryKey: ['audit', shown, page],
    queryFn: () => {
      const params = new URLSearchParams({ from: shown.from, to: shown.to, page: String(page) });
      params.set('pageSize', String(PAGE_SIZE));
      if (shown.actor) params.set('actor', shown.actor);
      if (shown.entity) params.set('entity', shown.entity);
      return apiFetch<AuditPage>('GET', `/audit?${params}`);
    },
    placeholderData: keepPreviousData,
  });

  function apply(event: FormEvent) {
    event.preventDefault();
    const result = auditQuerySchema.safeParse({ from: form.from, to: form.to });
    const issues = result.success ? [] : result.error.issues;
    const first = (field: string) => issues.find((issue) => issue.path[0] === field)?.message;
    setErrors({ from: first('from'), to: first('to') });
    if (result.success) {
      setShown(form);
      setPage(1);
    } else {
      fromRef.current?.focus();
    }
  }

  const set = (field: keyof Filters) => (event: { target: { value: string } }) =>
    setForm({ ...form, [field]: event.target.value });
  const period = `${shown.from} to ${shown.to}`;
  return (
    <>
      <h1 className="text-[28px] leading-tight font-bold">Audit log</h1>
      {users.isError && <RetryAlert query={users} onRetried={() => fromRef.current?.focus()} />}
      <form onSubmit={apply} noValidate className="flex min-w-0 flex-wrap items-start gap-3">
        <div className="w-full min-w-0 sm:w-44">
          <Field
            ref={fromRef}
            id="audit-from"
            type="date"
            label="From (required)"
            error={errors.from}
            value={form.from}
            onChange={set('from')}
          />
        </div>
        <div className="w-full min-w-0 sm:w-44">
          <Field
            id="audit-to"
            type="date"
            label="To (required)"
            error={errors.to}
            value={form.to}
            onChange={set('to')}
          />
        </div>
        <div className="w-full min-w-0 sm:w-52">
          <SelectField
            id="audit-actor"
            label="Actor"
            options={actorOptions}
            value={form.actor}
            onChange={set('actor')}
          />
        </div>
        <div className="w-full min-w-0 sm:w-52">
          <SelectField
            id="audit-entity"
            label="Entity"
            options={ENTITY_OPTIONS}
            value={form.entity}
            onChange={set('entity')}
          />
        </div>
        <button
          type="submit"
          className="h-11 w-full cursor-pointer rounded-lg bg-primary px-5 text-base font-semibold text-white hover:bg-primary-hover sm:mt-7 sm:w-auto"
        >
          Filter
        </button>
      </form>

      {audit.isError ? (
        <RetryAlert query={audit} onRetried={() => fromRef.current?.focus()} />
      ) : (
        <DataTable
          caption="Audit log entries"
          columns={COLUMNS}
          rows={audit.data?.data}
          rowKey={(row) => row.id}
          isLoading={!audit.data}
          emptyText={`No audit entries match these filters in ${period}.`}
          page={page}
          pageSize={PAGE_SIZE}
          total={audit.data?.total ?? 0}
          onPageChange={setPage}
        />
      )}
    </>
  );
}
