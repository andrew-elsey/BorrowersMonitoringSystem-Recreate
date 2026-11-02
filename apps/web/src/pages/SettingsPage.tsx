import {
  semesterSchema,
  settingsSchema,
  type Semester,
  type SemesterInput,
  type SemesterPage,
  type Settings,
  type SettingsInput,
} from '@bms/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { apiFetch, errorText } from '../api';
import { Alert } from '../components/Alert';
import { DataTable } from '../components/DataTable';
import { Field, showApiFieldErrors } from '../components/Field';
import { FormDialog } from '../components/FormDialog';
import { CheckIcon } from '../components/icons';
import { useNotify } from '../components/Notifications';

// Settings and semesters (SPEC.md 5, admin only, MD-7). The server enforces every rule
// (CLAUDE.md rule 2): thresholds in order (BR 11), end date not before start, one current semester.
export function SettingsPage() {
  const [page, setPage] = useState(1);
  const semesters = useQuery({
    queryKey: [...SEMESTERS_KEY, page],
    queryFn: () => apiFetch<SemesterPage>('GET', `/semesters?page=${page}&pageSize=${PAGE_SIZE}`),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <h1 className="text-[28px] leading-tight font-bold">Settings and semesters</h1>
      {/* BR 2: checkout is rejected while no semester is current. */}
      {semesters.data && !semesters.data.current && (
        <Alert kind="error">
          <strong>No current semester.</strong> Checkout is unavailable until you set one as current
          below.
        </Alert>
      )}
      <SettingsSection />
      <SemestersSection semesters={semesters} page={page} onPageChange={setPage} />
    </>
  );
}

const sectionClass = 'flex flex-col gap-4 rounded-xl border border-divider bg-surface p-5';
const linkButtonClass =
  'h-9 cursor-pointer rounded-lg px-2.5 text-[15px] font-semibold text-primary hover:bg-primary-tint';

function RetryAlert({
  error,
  onRetry,
  busy,
}: {
  error: unknown;
  onRetry: () => void;
  busy: boolean;
}) {
  return (
    <Alert kind="error">
      {errorText(error)}{' '}
      <button
        type="button"
        disabled={busy}
        onClick={onRetry}
        className="cursor-pointer font-semibold underline underline-offset-4 disabled:cursor-wait"
      >
        Retry
      </button>
    </Alert>
  );
}

const SETTINGS_FIELDS = [
  'closingTime',
  'warningThreshold',
  'noticeThreshold',
  'blockThreshold',
] as const;

function SettingsSection() {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await apiFetch<{ settings: Settings }>('GET', '/settings')).settings,
  });
  // `values` fills the form once the settings load.
  const form = useForm<SettingsInput>({
    resolver: zodResolver(settingsSchema),
    values: settings.data,
  });
  const save = useMutation({
    mutationFn: (input: SettingsInput) =>
      apiFetch<{ settings: Settings }>('PUT', '/settings', input),
    onSuccess: ({ settings: saved }) => {
      notify.success('Settings saved.');
      queryClient.setQueryData(['settings'], saved);
    },
    onError: (error) =>
      showApiFieldErrors(form.setError, error, SETTINGS_FIELDS) || notify.error(error),
  });
  const { errors } = form.formState;
  const thresholdField = (name: (typeof SETTINGS_FIELDS)[number], label: string) => (
    <Field
      id={name}
      label={label}
      type="number"
      inputMode="numeric"
      min={1}
      step={1}
      hint="strikes"
      error={errors[name]?.message}
      {...form.register(name, { valueAsNumber: true })}
    />
  );

  return (
    <section aria-labelledby="settings-heading" className={`${sectionClass} max-w-[760px]`}>
      <h2 id="settings-heading" className="text-xl font-bold">
        Settings
      </h2>
      {settings.isError ? (
        <RetryAlert
          error={settings.error}
          onRetry={() => settings.refetch()}
          busy={settings.isFetching}
        />
      ) : !settings.data ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <form
          noValidate
          onSubmit={form.handleSubmit((input) => save.mutate(input))}
          className="flex flex-col gap-4"
        >
          <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] items-start gap-4">
            <Field
              id="closingTime"
              label="Closing time"
              type="time"
              hint={settings.data.timezone}
              error={errors.closingTime?.message}
              {...form.register('closingTime')}
            />
            {thresholdField('warningThreshold', 'Warning at')}
            {thresholdField('noticeThreshold', 'Notice at')}
            {thresholdField('blockThreshold', 'Block at')}
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={save.isPending}
              className="h-11 cursor-pointer rounded-lg bg-primary px-5 text-base font-semibold text-white transition-colors duration-150 hover:bg-primary-hover disabled:cursor-wait disabled:opacity-80"
            >
              Save settings
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

// Semester dates are calendar dates (YYYY-MM-DD), so they are formatted as they are, in UTC,
// never shifted by a timezone.
const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const showDate = (date: string) => dateFormat.format(new Date(`${date}T00:00:00Z`));

const PAGE_SIZE = 25;
const SEMESTERS_KEY = ['semesters'];
const SEMESTER_FIELDS = ['name', 'startDate', 'endDate'] as const;
const emptySemester: SemesterInput = { name: '', startDate: '', endDate: '' };

function SemesterFields({
  idPrefix,
  form,
}: {
  idPrefix: string;
  form: ReturnType<typeof useForm<SemesterInput>>;
}) {
  const { errors } = form.formState;
  return (
    <>
      <Field
        id={`${idPrefix}-name`}
        label={idPrefix === 'new' ? 'New semester name' : 'Name'}
        error={errors.name?.message}
        {...form.register('name')}
      />
      <Field
        id={`${idPrefix}-start`}
        label="Start date"
        type="date"
        error={errors.startDate?.message}
        {...form.register('startDate')}
      />
      <Field
        id={`${idPrefix}-end`}
        label="End date"
        type="date"
        error={errors.endDate?.message}
        {...form.register('endDate')}
      />
    </>
  );
}

function SemestersSection({
  semesters,
  page,
  onPageChange,
}: {
  semesters: UseQueryResult<SemesterPage>;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [toEdit, setToEdit] = useState<Semester | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: SEMESTERS_KEY });

  const addForm = useForm<SemesterInput>({
    resolver: zodResolver(semesterSchema),
    defaultValues: emptySemester,
  });
  const add = useMutation({
    mutationFn: (input: SemesterInput) =>
      apiFetch<{ semester: Semester }>('POST', '/semesters', input),
    onSuccess: ({ semester }) => {
      notify.success(`Semester "${semester.name}" added.`);
      addForm.reset(emptySemester);
      return refresh();
    },
    onError: (error) =>
      showApiFieldErrors(addForm.setError, error, SEMESTER_FIELDS) || notify.error(error),
  });

  const editForm = useForm<SemesterInput>({ resolver: zodResolver(semesterSchema) });
  // The semester travels with the request, as the dialog can close while it runs.
  const edit = useMutation({
    mutationFn: ({ semester, input }: { semester: Semester; input: SemesterInput }) =>
      apiFetch<{ semester: Semester }>('PUT', `/semesters/${semester.id}`, input),
    onSuccess: ({ semester }) => {
      notify.success(`Semester "${semester.name}" saved.`);
      setToEdit(null);
      return refresh();
    },
    onError: (error) => {
      if (showApiFieldErrors(editForm.setError, error, SEMESTER_FIELDS)) return;
      notify.error(error);
    },
  });

  // BR 12: a new current semester starts every borrower at 0 strikes.
  const makeCurrent = useMutation({
    mutationFn: (semester: Semester) =>
      apiFetch<{ semester: Semester }>('POST', `/semesters/${semester.id}/current`),
    onSuccess: ({ semester }) => {
      notify.success(`"${semester.name}" is now the current semester.`);
      return refresh();
    },
    onError: (error) => {
      notify.error(error);
      return refresh();
    },
  });

  function startEditing(semester: Semester) {
    editForm.reset({
      name: semester.name,
      startDate: semester.startDate,
      endDate: semester.endDate,
    });
    setToEdit(semester);
  }

  return (
    <>
      <section aria-labelledby="semesters-heading" className={`${sectionClass} max-w-[900px]`}>
        <h2 id="semesters-heading" className="text-xl font-bold">
          Semesters
        </h2>
        <p className="text-sm text-muted">
          Strikes count only in the current semester. Making a new semester current starts every
          borrower at 0 strikes; old flags stay in history.
        </p>
        {semesters.isError ? (
          <RetryAlert
            error={semesters.error}
            onRetry={() => semesters.refetch()}
            busy={semesters.isFetching}
          />
        ) : (
          <DataTable
            caption="Semesters"
            columns={[
              {
                header: 'Name',
                cell: (s) => (
                  <span className={`wrap-anywhere ${s.isCurrent ? 'font-bold' : ''}`}>
                    {s.name}
                  </span>
                ),
              },
              { header: 'Start', cell: (s) => showDate(s.startDate) },
              { header: 'End', cell: (s) => showDate(s.endDate) },
              { header: 'Current', cell: (s) => s.isCurrent && <CurrentBadge /> },
              { header: 'Actions', cell: (s) => actions(s) },
            ]}
            rows={semesters.data?.data}
            rowKey={(s) => s.id}
            isLoading={semesters.isPending}
            emptyText="No semesters yet."
            page={page}
            pageSize={PAGE_SIZE}
            total={semesters.data?.total ?? 0}
            onPageChange={onPageChange}
          />
        )}

        <form
          noValidate
          onSubmit={addForm.handleSubmit((input) => add.mutate(input))}
          className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] items-start gap-3"
        >
          <SemesterFields idPrefix="new" form={addForm} />
          {/* The label above the field is 27px tall, so the button lines up with the input. */}
          <div className="pt-[29px]">
            <button
              type="submit"
              disabled={add.isPending}
              className="h-11 cursor-pointer rounded-lg border border-primary bg-surface px-5 text-base font-semibold text-primary transition-colors duration-150 hover:bg-primary-tint disabled:cursor-wait"
            >
              Add semester
            </button>
          </div>
        </form>
      </section>

      <FormDialog
        open={toEdit !== null}
        title={`Edit ${toEdit?.name}`}
        submitLabel="Save semester"
        onSubmit={editForm.handleSubmit((input) => edit.mutate({ semester: toEdit!, input }))}
        onCancel={() => setToEdit(null)}
        isPending={edit.isPending}
      >
        <SemesterFields idPrefix="edit" form={editForm} />
      </FormDialog>
    </>
  );

  function actions(semester: Semester) {
    return (
      <div className="flex flex-wrap items-center gap-1 whitespace-nowrap">
        <button
          type="button"
          aria-label={`Edit ${semester.name}`}
          onClick={() => startEditing(semester)}
          className={linkButtonClass}
        >
          Edit
        </button>
        {!semester.isCurrent && (
          <button
            type="button"
            aria-label={`Set ${semester.name} as current`}
            disabled={makeCurrent.isPending}
            onClick={() => makeCurrent.mutate(semester)}
            className={`${linkButtonClass} disabled:cursor-wait`}
          >
            Set as current
          </button>
        )}
      </div>
    );
  }
}

// Text and icon with the color, never color alone (ARCHITECTURE.md 14).
function CurrentBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-tint px-2.5 py-0.5 text-[13px] font-semibold text-primary">
      <CheckIcon />
      Current
    </span>
  );
}
