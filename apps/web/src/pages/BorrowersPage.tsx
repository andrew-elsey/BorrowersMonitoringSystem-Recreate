import {
  type Borrower,
  type BorrowerInput,
  type BorrowerPage,
  borrowerSchema,
  BorrowerType,
  SEARCH_MAX_LENGTH,
  SEARCH_MIN_LENGTH,
} from '@bms/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { ApiRequestError, apiFetch, errorText } from '../api';
import { Alert } from '../components/Alert';
import { DataTable } from '../components/DataTable';
import { Field, SelectField, showApiFieldErrors } from '../components/Field';
import { FormDialog } from '../components/FormDialog';
import { useNotify } from '../components/Notifications';

// Borrowers (SPEC.md 5, admin only). Add with the top form, edit in a dialog from the row,
// deactivate or reactivate from the row; borrowers are never deleted (BR 15). The server enforces
// every rule (CLAUDE.md rule 2), such as unique school IDs.

type BorrowerReply = { borrower: Borrower };
const PAGE_SIZE = 25;
const BORROWERS_KEY = ['borrowers'];
// Wait for a pause in typing, so a name is one search request, not one per letter.
const SEARCH_DELAY_MS = 300;
// SPEC 7: one letter is too short to search, so the full list stays.
const searchFor = (text: string) => (text.length >= SEARCH_MIN_LENGTH ? text : '');
const FIELDS = ['schoolId', 'name', 'type', 'department'] as const;

const TYPE_LABELS: Record<BorrowerType, string> = {
  STUDENT: 'Student',
  FACULTY: 'Faculty',
  EMPLOYEE: 'Employee',
};
const TYPE_CHOICES = Object.values(BorrowerType).map((type) => ({
  value: type,
  label: TYPE_LABELS[type],
}));
const TYPE_OPTIONS = [{ value: '', label: 'Choose a type' }, ...TYPE_CHOICES];
// The list filters, worded and ordered as in the approved mockup; the empty value matches everyone.
const TYPE_FILTERS = [{ value: '', label: 'All types' }, ...TYPE_CHOICES];
const STATUS_FILTERS = [
  { value: '', label: 'Active and inactive' },
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
];
// The type starts unchosen; the schema refuses the empty value with "Choose a type."
const EMPTY: BorrowerInput = { schoolId: '', name: '', type: '' as BorrowerType, department: '' };

const linkButtonClass =
  'h-9 cursor-pointer rounded-lg px-2.5 text-[15px] font-semibold text-primary hover:bg-primary-tint';

export function BorrowersPage() {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [searchText, setSearchText] = useState('');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const statusFilterRef = useRef<HTMLSelectElement>(null);
  const [toEdit, setToEdit] = useState<Borrower | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = searchText.trim();
      setQuery(next);
      // Only a change to the search actually sent goes back to page 1: not the first render,
      // a trailing space, or a single letter (which still shows the full list).
      if (searchFor(next) !== searchFor(query)) setPage(1);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchText, query]);
  const q = searchFor(query);

  const borrowers = useQuery({
    queryKey: [...BORROWERS_KEY, q, typeFilter, statusFilter, page],
    queryFn: () => {
      const search = q ? `&q=${encodeURIComponent(q)}` : '';
      const type = typeFilter ? `&type=${typeFilter}` : '';
      const status = statusFilter ? `&active=${statusFilter}` : '';
      return apiFetch<BorrowerPage>(
        'GET',
        `/borrowers?page=${page}&pageSize=${PAGE_SIZE}${search}${type}${status}`,
      );
    },
    placeholderData: keepPreviousData,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: BORROWERS_KEY });

  const addForm = useForm<BorrowerInput>({
    resolver: zodResolver(borrowerSchema),
    defaultValues: EMPTY,
  });
  const add = useMutation({
    mutationFn: (input: BorrowerInput) => apiFetch<BorrowerReply>('POST', '/borrowers', input),
    onSuccess: ({ borrower }) => {
      notify.success(`Borrower ${borrower.name} added.`);
      addForm.reset(EMPTY);
      return refresh();
    },
    // A duplicate school ID (DUPLICATE_VALUE) comes back as a field error under the school ID.
    onError: (error) => showApiFieldErrors(addForm.setError, error, FIELDS) || notify.error(error),
  });

  const editForm = useForm<BorrowerInput>({ resolver: zodResolver(borrowerSchema) });
  // The borrower travels with the request, not read from state: the dialog may close meanwhile.
  const edit = useMutation({
    mutationFn: ({ borrower, input }: { borrower: Borrower; input: BorrowerInput }) =>
      apiFetch<BorrowerReply>('PATCH', `/borrowers/${borrower.id}`, input),
    onSuccess: ({ borrower }) => {
      notify.success(`Changes to ${borrower.name} saved.`);
      setToEdit(null);
      return refresh();
    },
    onError: (error) => {
      if (showApiFieldErrors(editForm.setError, error, FIELDS)) return;
      notify.error(error);
      if (error instanceof ApiRequestError && error.code === 'NOT_FOUND') {
        setToEdit(null);
        return refresh();
      }
    },
  });

  // BR 3: an inactive borrower cannot borrow. Deactivating is undone with Reactivate, so no
  // confirmation is asked.
  const setActive = useMutation({
    mutationFn: (borrower: Borrower) =>
      apiFetch<BorrowerReply>('PATCH', `/borrowers/${borrower.id}`, { active: !borrower.active }),
    onSuccess: ({ borrower }) => {
      notify.success(`${borrower.name} ${borrower.active ? 'reactivated' : 'deactivated'}.`);
      // The focused button stays (only its label flips), unless the Status filter now hides the
      // row; then focus goes to that filter instead of dropping to the page start.
      if (statusFilter && String(borrower.active) !== statusFilter)
        statusFilterRef.current?.focus();
      return refresh();
    },
    onError: (error) => {
      notify.error(error);
      return refresh();
    },
  });

  async function retryLoading() {
    const result = await borrowers.refetch();
    // The Retry button is gone once the list loads, so focus would drop to the page start.
    if (!result.isError) addForm.setFocus('schoolId');
  }

  function startEditing(borrower: Borrower) {
    const { schoolId, name, type, department } = borrower;
    editForm.reset({ schoolId, name, type, department });
    setToEdit(borrower);
  }

  return (
    <>
      <h1 className="text-[28px] leading-tight font-bold">Borrowers</h1>

      <form
        noValidate
        aria-label="Add borrower"
        onSubmit={addForm.handleSubmit((input) => add.mutate(input))}
        className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] items-start gap-3"
      >
        <BorrowerFields form={addForm} idPrefix="new" />
        {/* The label above the field is 27px tall, so the button lines up with the inputs. */}
        <div className="pt-[29px]">
          <button
            type="submit"
            disabled={add.isPending}
            className="h-11 cursor-pointer rounded-lg bg-primary px-5 text-base font-semibold text-white transition-colors duration-150 hover:bg-primary-hover disabled:cursor-wait disabled:opacity-80"
          >
            Add borrower
          </button>
        </div>
      </form>

      {/* Search, Type, and Status in one row, as in the approved mockup. */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-[1_1_280px]">
          <Field
            id="search"
            type="search"
            label="Name or school ID"
            maxLength={SEARCH_MAX_LENGTH}
            hint={query.length === 1 ? `Type at least ${SEARCH_MIN_LENGTH} characters.` : undefined}
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
        </div>
        {/* A filter change goes back to page 1, like a new search. */}
        <div className="flex-[0_1_180px]">
          <SelectField
            id="type-filter"
            label="Type"
            options={TYPE_FILTERS}
            value={typeFilter}
            onChange={(event) => {
              setTypeFilter(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="flex-[0_1_180px]">
          <SelectField
            ref={statusFilterRef}
            id="status-filter"
            label="Status"
            options={STATUS_FILTERS}
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

      {borrowers.isError ? (
        // Without this, a failed load would look like an empty list.
        <Alert kind="error">
          {errorText(borrowers.error)}{' '}
          <button
            type="button"
            disabled={borrowers.isFetching}
            onClick={retryLoading}
            className="cursor-pointer font-semibold underline underline-offset-4 disabled:cursor-wait"
          >
            Retry
          </button>
        </Alert>
      ) : (
        <DataTable
          caption="Borrowers"
          columns={[
            {
              header: 'School ID',
              cell: (b) => <span className="wrap-anywhere">{b.schoolId}</span>,
            },
            { header: 'Name', cell: (b) => <strong className="wrap-anywhere">{b.name}</strong> },
            { header: 'Type', cell: (b) => TYPE_LABELS[b.type] },
            {
              header: 'Department',
              cell: (b) => <span className="wrap-anywhere">{b.department}</span>,
            },
            { header: 'Status', cell: (b) => <StatusBadge active={b.active} /> },
            { header: 'Actions', cell: (b) => actions(b) },
          ]}
          rows={borrowers.data?.data}
          rowKey={(b) => b.id}
          isLoading={borrowers.isPending}
          emptyText={
            q
              ? `No borrower matches "${q}". Check the spelling or search by school ID.`
              : typeFilter || statusFilter
                ? 'No borrowers match these filters.'
                : 'No borrowers yet.'
          }
          page={page}
          pageSize={PAGE_SIZE}
          total={borrowers.data?.total ?? 0}
          onPageChange={setPage}
        />
      )}

      <FormDialog
        open={toEdit !== null}
        title={`Edit ${toEdit?.name}`}
        submitLabel="Save changes"
        onSubmit={editForm.handleSubmit((input) => edit.mutate({ borrower: toEdit!, input }))}
        onCancel={() => setToEdit(null)}
        isPending={edit.isPending}
      >
        <BorrowerFields form={editForm} idPrefix="edit" />
      </FormDialog>
    </>
  );

  function actions(borrower: Borrower) {
    return (
      <div className="flex flex-wrap items-center gap-1 whitespace-nowrap">
        <button
          type="button"
          aria-label={`Edit ${borrower.name}`}
          onClick={() => startEditing(borrower)}
          className={linkButtonClass}
        >
          Edit
        </button>
        <button
          type="button"
          aria-label={`${borrower.active ? 'Deactivate' : 'Reactivate'} ${borrower.name}`}
          // aria-disabled, not disabled, so focus stays on the button while the request runs.
          aria-disabled={setActive.isPending || undefined}
          onClick={() => !setActive.isPending && setActive.mutate(borrower)}
          className={`${linkButtonClass} aria-disabled:cursor-wait`}
        >
          {borrower.active ? 'Deactivate' : 'Reactivate'}
        </button>
      </div>
    );
  }
}

// The four fields of the add form and the edit dialog.
function BorrowerFields({
  form,
  idPrefix,
}: {
  form: UseFormReturn<BorrowerInput>;
  idPrefix: string;
}) {
  const { errors } = form.formState;
  return (
    <>
      <Field
        id={`${idPrefix}-school-id`}
        label="School ID"
        error={errors.schoolId?.message}
        {...form.register('schoolId')}
      />
      <Field
        id={`${idPrefix}-name`}
        label="Name"
        error={errors.name?.message}
        {...form.register('name')}
      />
      <SelectField
        id={`${idPrefix}-type`}
        label="Type"
        options={TYPE_OPTIONS}
        error={errors.type?.message}
        {...form.register('type')}
      />
      <Field
        id={`${idPrefix}-department`}
        label="Department"
        error={errors.department?.message}
        {...form.register('department')}
      />
    </>
  );
}

// Text and color together, never color alone (ARCHITECTURE.md 14).
function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${active ? 'bg-primary-tint text-primary' : 'bg-page text-muted'}`}
    >
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}
