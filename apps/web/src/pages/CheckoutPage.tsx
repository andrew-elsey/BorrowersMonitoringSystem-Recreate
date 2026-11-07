import {
  type Borrower,
  type BorrowerPage,
  BorrowerType,
  type Checkout,
  type CheckoutInput,
  checkoutSchema,
  type Item,
  type ItemPage,
  NOTE_MAX_LENGTH,
  type Room,
  type RoomInput,
  type RoomPage,
  roomSchema,
  SEARCH_MAX_LENGTH,
  SEARCH_MIN_LENGTH,
} from '@bms/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ComponentProps, type ReactNode, useEffect, useRef, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { ApiRequestError, apiFetch, errorText, fieldErrors } from '../api';
import { useAuth } from '../auth';
import { Alert } from '../components/Alert';
import { Field, SelectField, showApiFieldErrors } from '../components/Field';
import { useNotify } from '../components/Notifications';
import { RetryAlert } from '../components/RetryAlert';
import { StatusBadge } from '../components/StatusBadge';

// Checkout (SPEC.md 5, admins and handlers, BRW-3). Steps 1 to 3 fill the form, the Summary panel
// confirms it. Every rule (BR 1 to 4, 7) is enforced by POST /api/transactions; the screen only
// gives early hints from the shared checkoutSchema and shows the server's answer (CLAUDE.md rule 2).

type FormValues = z.input<typeof checkoutSchema>;
const EMPTY: FormValues = { borrowerId: '', locationId: '', lines: [] };
const RESULTS = 10;
// Wait for a pause in typing, so a name is one search request, not one per letter.
const SEARCH_DELAY_MS = 300;
// ARCHITECTURE.md 6: "today" and times are in the app timezone, as on the Rooms screen.
const TIMEZONE = (import.meta.env.APP_TIMEZONE as string | undefined) || 'Asia/Manila';
const todayInAppZone = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format();
const issueTime = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TIMEZONE,
});
// BR 8, S10: a line issued at or after closing is first checked at tomorrow's closing.
// Both times are zero-padded 24-hour HH:mm, so comparing the strings compares the times.
const dueDay = (at: Date, closingTime: string) =>
  issueTime.format(at) >= closingTime ? 'tomorrow' : 'today';

const TYPE_LABELS: Record<BorrowerType, string> = {
  STUDENT: 'Student',
  FACULTY: 'Faculty',
  EMPLOYEE: 'Employee',
};
const STATUS_TEXT: Record<Item['status'], string> = {
  ACTIVE: 'Active',
  UNDER_REPAIR: 'Under repair',
  LOST: 'Lost',
  RETIRED: 'Retired',
};

// min-w-0: a fieldset is min-content wide by default, so the wide lines table would widen the page
// instead of scrolling in its own box (BRW-3 QA BUG-1).
const sectionClass =
  'flex min-w-0 flex-col gap-3.5 rounded-xl border border-divider bg-surface p-5 disabled:opacity-55';
const outlineButtonClass =
  'h-10 cursor-pointer rounded-lg border border-primary bg-surface px-3.5 text-[15px] font-semibold text-primary hover:bg-primary-tint disabled:cursor-not-allowed disabled:border-field-border disabled:text-muted';
const primaryButtonClass =
  'h-11 cursor-pointer rounded-lg bg-primary px-4.5 text-[15px] font-semibold text-white hover:bg-primary-hover disabled:cursor-wait disabled:opacity-80';
const linkButtonClass =
  'h-10 cursor-pointer rounded-lg px-3 text-[15px] font-semibold hover:bg-primary-tint';

// Search text after a pause in typing; one letter is too short to search (SPEC 7).
function useSearchText(text: string): string {
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);
  return query.length >= SEARCH_MIN_LENGTH ? query : '';
}

const itemLabel = (item: Item) => (item.assetTag ? `${item.name} ${item.assetTag}` : item.name);

// An item from the list, with what can be issued now (BR 1).
type ListedItem = ItemPage['data'][number];
// Worded as in the approved mockup. Items that are not ACTIVE show their status (BR 1).
function availabilityText(item: ListedItem): string {
  if (item.status !== 'ACTIVE') return STATUS_TEXT[item.status];
  if (item.trackingType === 'UNIT') return item.available > 0 ? 'Available' : 'Out';
  return `${item.available} available`;
}

export function CheckoutPage() {
  const user = useAuth().user!;
  const notify = useNotify();
  const queryClient = useQueryClient();

  const form = useForm<FormValues, unknown, CheckoutInput>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: EMPTY,
    shouldFocusError: false, // see the focus effect below submit
  });
  const lines = useFieldArray({ control: form.control, name: 'lines', keyName: 'key' });
  const errors = form.formState.errors;

  // The chosen borrower and the items on the lines, for display; the form holds only their ids.
  const [borrower, setBorrower] = useState<Borrower | null>(null);
  const [items, setItems] = useState<Record<string, ListedItem>>({});
  const [borrowerText, setBorrowerText] = useState('');
  const [showBorrowers, setShowBorrowers] = useState(true);
  const [itemText, setItemText] = useState('');
  const [addingRoom, setAddingRoom] = useState(false);
  const borrowerQ = useSearchText(borrowerText);
  const itemQ = useSearchText(itemText);
  const borrowerSearchRef = useRef<HTMLInputElement>(null);
  const itemSearchRef = useRef<HTMLInputElement>(null);

  const borrowers = useQuery({
    queryKey: ['borrowers', borrowerQ, 'checkout'],
    queryFn: () =>
      apiFetch<BorrowerPage>(
        'GET',
        `/borrowers/lookup?q=${encodeURIComponent(borrowerQ)}&page=1&pageSize=${RESULTS}`,
      ),
    enabled: borrowerQ !== '',
    placeholderData: keepPreviousData,
  });
  const itemResults = useQuery({
    queryKey: ['items', itemQ, 'checkout'],
    queryFn: () =>
      apiFetch<ItemPage>('GET', `/items?q=${encodeURIComponent(itemQ)}&page=1&pageSize=${RESULTS}`),
    enabled: itemQ !== '',
    placeholderData: keepPreviousData,
  });
  // shortcut: only the first 100 rooms (the page size limit, SPEC 7); page or search them if a
  // department ever has more.
  const rooms = useQuery({
    queryKey: ['rooms', 'checkout'],
    queryFn: () => apiFetch<RoomPage>('GET', '/rooms?page=1&pageSize=100'),
  });
  // Lines still out at closing time are flagged (BR 8). From settings, never hardcoded (rule 3);
  // "closing time" stands in until it loads.
  const closing = useQuery({
    queryKey: ['closing-time'],
    queryFn: () => apiFetch<{ closingTime: string }>('GET', '/closing-time'),
  });
  const closingTime = closing.data?.closingTime ?? 'closing time';
  // BR 2: only active rooms can be used. Handlers only get active rooms; admins get all of them.
  const activeRooms = (rooms.data?.data ?? []).filter((room) => room.active !== false);
  const roomOptions = [
    { value: '', label: 'Choose a room or lab' },
    ...activeRooms.map((room) => ({ value: room.id, label: room.name })),
  ];

  const roomForm = useForm<RoomInput>({
    resolver: zodResolver(roomSchema),
    defaultValues: { name: '' },
  });
  // The quick add (SPEC 3): POST /api/rooms, then the new room is the chosen one.
  const addRoom = useMutation({
    mutationFn: (input: RoomInput) => apiFetch<{ room: Room }>('POST', '/rooms', input),
    onSuccess: async ({ room }) => {
      notify.success(`Room "${room.name}" added.`);
      await rooms.refetch(); // the new option must exist before it can be selected
      form.setValue('locationId', room.id, { shouldValidate: true });
      roomForm.reset({ name: '' });
      setAddingRoom(false);
      form.setFocus('locationId');
    },
    // A duplicate name (DUPLICATE_VALUE) comes back as a field error under the name.
    onError: (error) =>
      showApiFieldErrors(roomForm.setError, error, ['name']) || notify.error(error),
  });

  const save = useMutation({
    mutationFn: (input: CheckoutInput) =>
      apiFetch<{ transaction: Checkout }>('POST', '/transactions', input),
    onSuccess: () =>
      // What is available changed, so the next search must not show cached counts.
      queryClient.invalidateQueries({ queryKey: ['items'] }),
    onError: (error, input) => markRefusedLine(error, input),
  });
  // A second click while the first request is on its way sends nothing (BRW-3).
  const sending = useRef(false);
  const submit = form.handleSubmit((input) => {
    if (sending.current) return;
    sending.current = true;
    save.mutate(input, {
      onSettled: () => {
        sending.current = false;
      },
    });
  });
  // Focus the first field with an error in page order, as FND-7 does. The borrower has no input
  // of its own (its error shows on the search field), so React Hook Form cannot do this itself.
  // Keyed on submitCount, which arrives in the same update as the errors. A state set from
  // onInvalid can render before them (a browser renders it at once during the click), when
  // nothing is invalid yet (BRW-3 QA BUG-3).
  const { submitCount, isSubmitSuccessful } = form.formState;
  useEffect(() => {
    if (submitCount && !isSubmitSuccessful) {
      document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }
  }, [submitCount, isSubmitSuccessful]);

  // Puts the refusal next to the line it is about and moves focus there (FND-7). The API reports
  // only the first failing line: by itemId for item refusals, and as lines.N.expectedReturnDate
  // for a date before today (BR 7). Anything else shows only in the message at the top.
  function markRefusedLine(error: unknown, input: CheckoutInput) {
    const dateFields = input.lines.map((_, index) => `lines.${index}.expectedReturnDate` as const);
    showApiFieldErrors(form.setError, error, ['borrowerId', 'locationId', ...dateFields]);
    if (!(error instanceof ApiRequestError)) return;
    const index = input.lines.findIndex((line) => line.itemId === error.details.itemId);
    const line = input.lines[index];
    if (!line) return;
    const { available } = error.details;
    if (typeof available === 'number') {
      // INSUFFICIENT_QUANTITY (BR 1): the quantity is what needs changing, and the line shows the
      // count the API just checked instead of the one from the search.
      setItems((current) => ({
        ...current,
        [line.itemId]: { ...current[line.itemId]!, available },
      }));
      form.setError(
        `lines.${index}.quantity`,
        { message: `Only ${available} available` },
        { shouldFocus: true },
      );
    } else {
      // ITEM_UNAVAILABLE or NOT_FOUND: the item has to come off the list.
      form.setError(`lines.${index}.itemId`, { message: error.message });
      document.getElementById(`remove-${index}`)?.focus();
    }
  }

  function chooseBorrower(chosen: Borrower) {
    setBorrower(chosen);
    form.setValue('borrowerId', chosen.id, { shouldValidate: form.formState.isSubmitted });
    setShowBorrowers(false);
  }

  function addLine(item: ListedItem) {
    setItems((current) => ({ ...current, [item.id]: item }));
    lines.append({ itemId: item.id, quantity: 1 }, { shouldFocus: false });
    form.clearErrors('lines');
    itemSearchRef.current?.focus();
  }

  function startOver() {
    form.reset(EMPTY);
    save.reset();
    setBorrower(null);
    setItems({});
    setBorrowerText('');
    setItemText('');
    setShowBorrowers(true);
    borrowerSearchRef.current?.focus();
  }

  const values = form.watch();
  const chosenRoom = activeRooms.find((room) => room.id === values.locationId);
  const saved = save.data?.transaction;
  // Confirm is disabled once saved, so focus goes to the next step instead of the page start.
  // An effect, so the button has rendered first.
  useEffect(() => {
    if (saved) document.getElementById('start-over')?.focus();
  }, [saved]);
  const dueNow = dueDay(new Date(), closingTime);
  // BR 3: an inactive borrower cannot borrow. The API refuses it too (BORROWER_INACTIVE).
  // FLG-3 adds the blocked borrower (BORROWER_BLOCKED) here.
  const locked = borrower !== null && !borrower.active;
  const onLines = new Set(values.lines.map((line) => line.itemId));
  // VALIDATION_ERROR details the API keys as "lines" (a schema error on some line) belong to no
  // single field, so they go with the message at the top.
  const lineSchemaError = fieldErrors(save.error).lines;
  const linesError = errors.lines?.message ?? errors.lines?.root?.message;

  return (
    <>
      <h1 className="text-[28px] leading-tight font-bold">Checkout</h1>

      {saved && borrower && (
        <Alert kind="success">
          <strong>Checkout saved.</strong> {plural(saved.lines.length, 'item')} issued to{' '}
          {borrower.name} for {chosenRoom?.name} at {issueTime.format(new Date(saved.issuedAt))}.
          Due back by {closingTime} {dueDay(new Date(saved.issuedAt), closingTime)}.{' '}
          <button
            type="button"
            id="start-over"
            onClick={startOver}
            className="cursor-pointer font-semibold underline underline-offset-4"
          >
            Start a new checkout
          </button>
        </Alert>
      )}
      {save.isError && (
        <Alert kind="error">
          <strong>Checkout not saved.</strong> {errorText(save.error)}
          {lineSchemaError &&
            lineSchemaError !== errorText(save.error) &&
            ` ${lineSchemaError}`}{' '}
          Nothing was issued.
        </Alert>
      )}

      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-5">
          <section aria-labelledby="borrower-heading" className={sectionClass}>
            <h2 id="borrower-heading" className="text-xl font-bold">
              1. Borrower
            </h2>
            <Field
              ref={borrowerSearchRef}
              id="borrower-search"
              type="search"
              label="Find by name or school ID"
              maxLength={SEARCH_MAX_LENGTH}
              error={errors.borrowerId?.message}
              value={borrowerText}
              onChange={(event) => {
                setBorrowerText(event.target.value);
                setShowBorrowers(true);
              }}
            />
            {showBorrowers &&
              borrowerQ &&
              !saved &&
              (borrowers.isError ? (
                <RetryAlert query={borrowers} />
              ) : (
                <SearchResults
                  label="Borrowers found"
                  loading={borrowers.isPending}
                  empty={`No borrower matches "${borrowerQ}". Check the spelling or search by school ID.`}
                  rows={borrowers.data?.data}
                  render={(found) => (
                    <>
                      <div className="flex flex-col">
                        <span className="font-semibold">{found.name}</span>
                        <span className="text-[13px] text-muted">{borrowerLine(found)}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        {!found.active && <StatusBadge active={false} />}
                        <button
                          type="button"
                          aria-label={`Choose ${found.name}`}
                          onClick={() => chooseBorrower(found)}
                          className={outlineButtonClass}
                        >
                          Choose
                        </button>
                      </div>
                    </>
                  )}
                />
              ))}
            {borrower && (
              <div
                aria-label="Chosen borrower"
                role="group"
                className="flex flex-wrap justify-between gap-3 rounded-lg border border-divider bg-page/40 px-4 py-3.5"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-[17px] font-bold wrap-anywhere">{borrower.name}</span>
                  <span className="text-[15px] text-muted wrap-anywhere">
                    {borrowerLine(borrower)}
                  </span>
                </div>
                {/* FLG-3: the strike count for the current semester goes here (right side). */}
              </div>
            )}
            {/* FLG-3: the warning, notice, and blocked strike banners (BR 11) go here. */}
            {locked && (
              <Alert kind="error">
                <strong>Inactive borrower.</strong> {borrower.name}&apos;s record is inactive, so
                this borrower cannot borrow. An admin can reactivate the record in Borrowers.
              </Alert>
            )}
          </section>

          <fieldset
            disabled={locked || !!saved}
            aria-labelledby="room-heading"
            className={sectionClass}
          >
            <h2 id="room-heading" className="text-xl font-bold">
              2. Room or lab
            </h2>
            {rooms.isError ? (
              <RetryAlert query={rooms} onRetried={() => form.setFocus('locationId')} />
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex-[1_1_260px]">
                  <SelectField
                    id="room"
                    label="Where will the items be used?"
                    options={roomOptions}
                    error={errors.locationId?.message}
                    {...form.register('locationId')}
                    // Controlled, so a room added below is selected once its option exists.
                    value={values.locationId}
                  />
                </div>
                {!addingRoom && (
                  <button
                    type="button"
                    onClick={() => {
                      setAddingRoom(true);
                      // After the box renders, so the field exists.
                      setTimeout(() => roomForm.setFocus('name'));
                    }}
                    className={`h-11 ${outlineButtonClass}`}
                  >
                    + Add a new room or lab
                  </button>
                )}
              </div>
            )}
            {addingRoom && (
              <form
                noValidate
                aria-label="Add a new room or lab"
                onSubmit={roomForm.handleSubmit((input) => addRoom.mutate(input))}
                className="flex flex-wrap items-start gap-3 rounded-lg border border-dashed border-field-border p-3.5"
              >
                <div className="flex-[1_1_240px]">
                  <Field
                    id="new-room"
                    label="New room or lab name"
                    error={roomForm.formState.errors.name?.message}
                    {...roomForm.register('name')}
                  />
                </div>
                {/* The label above the field is 27px tall, so the buttons line up with the input. */}
                <div className="flex gap-1 pt-[29px]">
                  <button type="submit" disabled={addRoom.isPending} className={primaryButtonClass}>
                    Add and select
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAddingRoom(false);
                      roomForm.reset({ name: '' });
                      form.setFocus('locationId');
                    }}
                    className={`h-11 text-primary ${linkButtonClass}`}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </fieldset>

          <fieldset
            disabled={locked || !!saved}
            aria-labelledby="items-heading"
            className={sectionClass}
          >
            <h2 id="items-heading" className="text-xl font-bold">
              3. Items
            </h2>
            <Field
              ref={itemSearchRef}
              id="item-search"
              type="search"
              label="Search by name or asset tag"
              maxLength={SEARCH_MAX_LENGTH}
              error={linesError}
              value={itemText}
              onChange={(event) => setItemText(event.target.value)}
            />
            {itemQ &&
              !saved &&
              (itemResults.isError ? (
                <RetryAlert query={itemResults} />
              ) : (
                <SearchResults
                  label="Search results"
                  loading={itemResults.isPending}
                  empty={`No item matches "${itemQ}".`}
                  rows={itemResults.data?.data}
                  render={(item) => (
                    <>
                      <div className="flex flex-col">
                        <span className="font-semibold wrap-anywhere">{item.name}</span>
                        <span className="text-[13px] text-muted wrap-anywhere">
                          {item.assetTag
                            ? `Asset tag ${item.assetTag}`
                            : `Quantity item · ${item.totalQuantity} in total`}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        {/* Availability as of the search; the API checks it again on Confirm */}
                        {/* (BR 1, 4). */}
                        <span
                          className={`text-sm font-semibold ${item.available > 0 ? 'text-primary' : 'text-muted'}`}
                        >
                          {onLines.has(item.id) ? 'Added' : availabilityText(item)}
                        </span>
                        <button
                          type="button"
                          aria-label={`Add ${itemLabel(item)}`}
                          disabled={item.available === 0 || onLines.has(item.id)}
                          onClick={() => addLine(item)}
                          className={outlineButtonClass}
                        >
                          Add
                        </button>
                      </div>
                    </>
                  )}
                />
              ))}
            {lines.fields.length > 0 && !saved && (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] border-collapse">
                    <caption className="sr-only">Items to check out</caption>
                    <thead>
                      <tr>
                        {['Item', 'Quantity', 'Note (optional)', 'Expected return (optional)'].map(
                          (header) => (
                            <th key={header} className={thClass}>
                              {header}
                            </th>
                          ),
                        )}
                        <th className={thClass}>
                          <span className="sr-only">Remove</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.fields.map((line, index) => {
                        const item = items[line.itemId]!;
                        const label = itemLabel(item);
                        const lineErrors = errors.lines?.[index];
                        return (
                          <tr key={line.key}>
                            <td className={tdClass}>
                              <div className="font-semibold wrap-anywhere">{item.name}</div>
                              <div className="text-[13px] text-muted">
                                {item.assetTag
                                  ? `Asset tag ${item.assetTag} · unit item`
                                  : `Quantity item · ${item.available} available`}
                              </div>
                              <LineError message={lineErrors?.itemId?.message} />
                            </td>
                            <td className={tdClass}>
                              {item.trackingType === 'UNIT' ? (
                                1 // a unit item line always has quantity 1 (glossary)
                              ) : (
                                <LineInput
                                  label={`Quantity of ${label}`}
                                  error={lineErrors?.quantity?.message}
                                  type="number"
                                  min={1}
                                  className="w-24"
                                  {...form.register(`lines.${index}.quantity`, {
                                    valueAsNumber: true,
                                  })}
                                />
                              )}
                            </td>
                            <td className={tdClass}>
                              <LineInput
                                label={`Note for ${label}`}
                                error={lineErrors?.note?.message}
                                placeholder="e.g. returning tomorrow"
                                maxLength={NOTE_MAX_LENGTH}
                                className="w-56"
                                {...form.register(`lines.${index}.note`, {
                                  setValueAs: (value: string) => value || undefined,
                                })}
                              />
                            </td>
                            <td className={tdClass}>
                              <LineInput
                                label={`Expected return for ${label}`}
                                error={lineErrors?.expectedReturnDate?.message}
                                type="date"
                                // A hint only: the API refuses a date before today (BR 7).
                                min={todayInAppZone()}
                                className="w-44"
                                {...form.register(`lines.${index}.expectedReturnDate`, {
                                  setValueAs: (value: string) => value || undefined,
                                })}
                              />
                            </td>
                            <td className={tdClass}>
                              <button
                                type="button"
                                id={`remove-${index}`}
                                aria-label={`Remove ${label}`}
                                onClick={() => {
                                  lines.remove(index);
                                  itemSearchRef.current?.focus();
                                }}
                                className={`text-danger ${linkButtonClass} hover:bg-danger-tint`}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-sm text-muted">
                  Notes and expected return dates are for information only. Lines still out at{' '}
                  {closingTime} {dueNow === 'tomorrow' && 'tomorrow '}are flagged anyway.
                </p>
              </>
            )}
          </fieldset>
        </div>

        {/* The confirmation summary: what Confirm will send (owner decision: a panel by the form). */}
        <aside
          aria-labelledby="summary-heading"
          className="flex flex-[1_1_280px] flex-col gap-3 rounded-xl border border-divider bg-surface p-5"
        >
          <h2 id="summary-heading" className="text-xl font-bold">
            Summary
          </h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[15px]">
            <dt className="text-muted">Borrower</dt>
            <dd className="font-semibold wrap-anywhere">{borrower?.name ?? '—'}</dd>
            <dt className="text-muted">Room or lab</dt>
            <dd className="wrap-anywhere">{chosenRoom?.name ?? '—'}</dd>
            <dt className="text-muted">Items</dt>
            <dd>
              {values.lines.length === 0 ? (
                'None'
              ) : (
                <ul>
                  {values.lines.map((line) => (
                    <li key={line.itemId} className="wrap-anywhere">
                      {Number.isNaN(line.quantity) ? '?' : line.quantity} ×{' '}
                      {itemLabel(items[line.itemId]!)}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
            <dt className="text-muted">Issued by</dt>
            <dd>{user.name} (you)</dd>
            <dt className="text-muted">Due back</dt>
            <dd>
              {dueNow === 'today' ? 'Today' : 'Tomorrow'} by {closingTime}
            </dd>
          </dl>
          <button
            type="button"
            onClick={submit}
            disabled={locked || !!saved || save.isPending}
            className="h-12 cursor-pointer rounded-lg bg-primary text-base font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-page disabled:text-muted"
          >
            {saved ? 'Saved' : save.isPending ? 'Saving…' : 'Confirm checkout'}
          </button>
          {locked && <p className="text-sm text-muted">Inactive borrowers cannot borrow.</p>}
        </aside>
      </div>
    </>
  );
}

const thClass =
  'border-b border-divider px-3 py-2.5 text-left text-sm font-semibold whitespace-nowrap text-muted';
const tdClass = 'border-b border-divider px-3 py-2.5 align-top text-[15px]';

const borrowerLine = (b: Borrower) => `${b.schoolId} · ${TYPE_LABELS[b.type]} · ${b.department}`;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

// A list of search results, each row with its own buttons.
function SearchResults<T extends { id: string }>(props: {
  label: string;
  loading: boolean;
  empty: string;
  rows: T[] | undefined;
  render: (row: T) => ReactNode;
}) {
  if (props.loading) return <p className="text-muted">Searching…</p>;
  if (!props.rows?.length) return <p className="text-muted">{props.empty}</p>;
  return (
    <ul aria-label={props.label} className="rounded-lg border border-divider">
      {props.rows.map((row) => (
        <li
          key={row.id}
          className="flex flex-wrap items-center justify-between gap-2.5 border-b border-divider px-3.5 py-2.5 last:border-b-0"
        >
          {props.render(row)}
        </li>
      ))}
    </ul>
  );
}

// An input in a line of the table: labeled for screen readers (the column header shows the label),
// with its error under it, read together with the field.
function LineInput({
  label,
  error,
  className,
  ...inputProps
}: ComponentProps<'input'> & { label: string; error?: string }) {
  const messageId = `${inputProps.name}-message`;
  return (
    <>
      <input
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? messageId : undefined}
        className={`h-11 rounded-lg border bg-surface px-3 text-base text-ink ${error ? 'border-2 border-danger' : 'border-field-border'} ${className}`}
        {...inputProps}
      />
      <LineError id={messageId} message={error} />
    </>
  );
}

function LineError({ id, message }: { id?: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 text-sm font-semibold text-danger">
      {message}
    </p>
  );
}
