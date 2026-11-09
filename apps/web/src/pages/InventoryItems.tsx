import {
  type Category,
  DESCRIPTION_MAX_LENGTH,
  type Item,
  ItemCondition,
  type ItemInput,
  type ItemPage,
  itemSchema,
  ItemStatus,
  SEARCH_MAX_LENGTH,
  SEARCH_MIN_LENGTH,
  TrackingType,
} from '@bms/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { ApiRequestError, apiFetch } from '../api';
import { Alert } from '../components/Alert';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DataTable } from '../components/DataTable';
import { secondaryButtonClass } from '../components/Dialog';
import { Field, SelectField, showApiFieldErrors, TextAreaField } from '../components/Field';
import { FormDialog } from '../components/FormDialog';
import { useNotify } from '../components/Notifications';
import { RetryAlert } from '../components/RetryAlert';

// The Items tab of Inventory and categories (MD-2, admin only). "+ Add item" opens the add form,
// Edit opens a dialog from the row, and Delete works only for an item with no history; one with
// history is retired instead (BR 15, S19). The server enforces every rule (CLAUDE.md rule 2).

type ItemReply = { item: Item };
type CategoryPage = { data: Category[] };
const PAGE_SIZE = 25;
const ITEMS_KEY = ['items'];
// Wait for a pause in typing, so a name is one search request, not one per letter.
const SEARCH_DELAY_MS = 300;
// SPEC 7: one letter is too short to search, so the full list stays.
const searchFor = (text: string) => (text.length >= SEARCH_MIN_LENGTH ? text : '');
const FIELDS = [
  'trackingType',
  'name',
  'categoryId',
  'assetTag',
  'totalQuantity',
  'condition',
  'status',
  'description',
] as const;

const TRACKING_LABELS: Record<TrackingType, string> = { UNIT: 'Unit', QUANTITY: 'Quantity' };
const CONDITION_LABELS: Record<ItemCondition, string> = {
  NEW: 'New',
  GOOD: 'Good',
  FAIR: 'Fair',
  DAMAGED: 'Damaged',
};
const STATUS_LABELS: Record<ItemStatus, string> = {
  ACTIVE: 'Active',
  UNDER_REPAIR: 'Under repair',
  LOST: 'Lost',
  RETIRED: 'Retired',
};
const choices = <T extends string>(labels: Record<T, string>) =>
  (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
const CONDITION_CHOICES = choices(CONDITION_LABELS);
const STATUS_CHOICES = choices(STATUS_LABELS);
// The list filters, worded as in the approved mockup; the empty value matches everything.
const STATUS_FILTERS = [{ value: '', label: 'All statuses' }, ...STATUS_CHOICES];
const TRACKING_FILTERS = [{ value: '', label: 'Unit and quantity' }, ...choices(TRACKING_LABELS)];

// Text and color together, never color alone (ARCHITECTURE.md 14).
const STATUS_LOOK: Record<ItemStatus, string> = {
  ACTIVE: 'bg-primary-tint text-primary',
  UNDER_REPAIR: 'bg-accent-tint text-ink',
  LOST: 'bg-danger-tint text-danger',
  RETIRED: 'bg-page text-muted',
};

const EMPTY: ItemInput = {
  trackingType: 'UNIT',
  name: '',
  categoryId: '',
  description: '',
  assetTag: '',
  condition: 'NEW',
  status: 'ACTIVE',
};

// How an item is named in messages: its asset tag, or its name for a quantity item.
const labelOf = (item: Item) => item.assetTag ?? item.name;

const linkButtonClass = 'h-9 cursor-pointer rounded-lg px-2.5 text-[15px] font-semibold';
const primaryButtonClass =
  'h-11 cursor-pointer rounded-lg bg-primary px-5 text-base font-semibold text-white transition-colors duration-150 hover:bg-primary-hover disabled:cursor-wait disabled:opacity-80';

export function InventoryItems() {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [searchText, setSearchText] = useState('');
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [trackingFilter, setTrackingFilter] = useState('');
  const [adding, setAdding] = useState(false);
  const [toEdit, setToEdit] = useState<Item | null>(null);
  const [toDelete, setToDelete] = useState<Item | null>(null);
  // An item the server refused to delete because it has history (S19).
  const [refused, setRefused] = useState<Item | null>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = searchText.trim();
      setQuery(next);
      // Only a change to the search actually sent goes back to page 1.
      if (searchFor(next) !== searchFor(query)) setPage(1);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchText, query]);
  const q = searchFor(query);

  const items = useQuery({
    queryKey: [...ITEMS_KEY, q, categoryFilter, statusFilter, trackingFilter, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (q) params.set('q', q);
      if (categoryFilter) params.set('categoryId', categoryFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (trackingFilter) params.set('trackingType', trackingFilter);
      return apiFetch<ItemPage>('GET', `/items?${params}`);
    },
    placeholderData: keepPreviousData,
  });
  // shortcut: only the first 100 categories (the page size limit) can be picked; page through
  // them if a department ever has more.
  const categories = useQuery({
    queryKey: ['categories', 'choices'],
    queryFn: () => apiFetch<CategoryPage>('GET', '/categories?page=1&pageSize=100'),
  });
  const categoryChoices = (categories.data?.data ?? []).map((c) => ({
    value: c.id,
    label: c.name,
  }));
  const refresh = () => queryClient.invalidateQueries({ queryKey: ITEMS_KEY });

  // The add form replaces the list while it is open, so focus moves into it and back to
  // "+ Add item" when it closes.
  const addForm = useForm<ItemInput>({
    resolver: zodResolver(itemSchema),
    defaultValues: EMPTY,
    // The asset tag or quantity field of the other tracking type is dropped, not sent.
    shouldUnregister: true,
  });
  const wasAdding = useRef(false);
  useEffect(() => {
    if (adding) addForm.setFocus('trackingType');
    else if (wasAdding.current) addButtonRef.current?.focus();
    wasAdding.current = adding;
  }, [adding, addForm]);

  const add = useMutation({
    mutationFn: (input: ItemInput) => apiFetch<ItemReply>('POST', '/items', input),
    onSuccess: ({ item }) => {
      notify.success(`Item ${labelOf(item)} added.`);
      addForm.reset(EMPTY);
      setAdding(false);
      return refresh();
    },
    // A duplicate asset tag (DUPLICATE_VALUE) comes back as a field error under the asset tag.
    onError: (error) => showApiFieldErrors(addForm.setError, error, FIELDS) || notify.error(error),
  });

  // The edit dialog checks the same rules as the add form, with the item's own tracking type.
  const editForm = useForm<ItemInput>({ resolver: zodResolver(itemSchema) });
  const edit = useMutation({
    // The tracking type cannot be changed (owner decision 2026-11-03), so it is not sent.
    mutationFn: ({ item, input }: { item: Item; input: ItemInput }) =>
      apiFetch<ItemReply>('PATCH', `/items/${item.id}`, { ...input, trackingType: undefined }),
    onSuccess: ({ item }) => {
      notify.success(`Changes to ${labelOf(item)} saved.`);
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

  const remove = useMutation({
    mutationFn: (item: Item) => apiFetch('DELETE', `/items/${item.id}`),
    onSuccess: async (_reply, item) => {
      notify.success(`Item ${labelOf(item)} deleted.`);
      setToDelete(null);
      await refresh();
      // Its row and Delete button are gone, so focus would drop to the page start.
      addButtonRef.current?.focus();
    },
    onError: (error, item) => {
      setToDelete(null);
      // S19: the page explains it and offers to retire the item instead.
      if (error instanceof ApiRequestError && error.code === 'HAS_HISTORY') setRefused(item);
      else notify.error(error);
      return refresh();
    },
  });

  // BR 15: an item with history is retired, never deleted.
  const retire = useMutation({
    mutationFn: (item: Item) =>
      apiFetch<ItemReply>('PATCH', `/items/${item.id}`, { status: ItemStatus.RETIRED }),
    onSuccess: ({ item }) => {
      notify.success(`Item ${labelOf(item)} retired.`);
      setRefused(null);
      // The Retire button is gone, so focus would drop to the page start.
      addButtonRef.current?.focus();
      return refresh();
    },
    onError: (error) => notify.error(error),
  });

  function startEditing(item: Item) {
    const { trackingType, name, category, description, assetTag, totalQuantity } = item;
    editForm.reset({
      trackingType,
      name,
      categoryId: category.id,
      description: description ?? '',
      assetTag: assetTag ?? undefined,
      totalQuantity,
      condition: item.condition,
      status: item.status,
    });
    setToEdit(item);
  }

  const filterChanged =
    (set: (value: string) => void) => (event: { target: { value: string } }) => {
      set(event.target.value);
      // A filter change goes back to page 1, like a new search.
      setPage(1);
    };

  return (
    <>
      {refused && (
        <Alert kind="error" onDismiss={() => setRefused(null)}>
          <strong>Cannot delete {labelOf(refused)}.</strong> This item appears in past transactions.
          Set its status to Retired instead.{' '}
          <button
            type="button"
            aria-disabled={retire.isPending || undefined}
            onClick={() => !retire.isPending && retire.mutate(refused)}
            className="cursor-pointer font-bold underline underline-offset-4 aria-disabled:cursor-wait"
          >
            Retire {labelOf(refused)}
          </button>
        </Alert>
      )}

      {adding ? (
        <section
          aria-labelledby="add-item-heading"
          className="flex max-w-[720px] flex-col gap-4 rounded-xl border border-divider bg-surface p-5"
        >
          <h2 id="add-item-heading" className="text-xl font-bold">
            Add item
          </h2>
          <form
            noValidate
            aria-labelledby="add-item-heading"
            onSubmit={addForm.handleSubmit((input) => add.mutate(input))}
            className="flex flex-col gap-4"
          >
            <ErrorSummary form={addForm} />
            <fieldset className="flex flex-wrap gap-x-5 gap-y-2">
              <legend className="mb-1.5 text-[15px] font-semibold">Tracking type</legend>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  value={TrackingType.UNIT}
                  className="size-5"
                  {...addForm.register('trackingType')}
                />
                Unit (one asset tag per item)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  value={TrackingType.QUANTITY}
                  className="size-5"
                  {...addForm.register('trackingType')}
                />
                Quantity (supplies counted, returned)
              </label>
            </fieldset>
            <ItemFields
              form={addForm}
              idPrefix="new"
              trackingType={addForm.watch('trackingType')}
              categories={categoryChoices}
            />
            <div className="flex flex-wrap justify-end gap-3">
              <button
                type="button"
                disabled={add.isPending}
                onClick={() => {
                  addForm.reset(EMPTY);
                  setAdding(false);
                }}
                className={secondaryButtonClass}
              >
                Cancel
              </button>
              <button type="submit" disabled={add.isPending} className={primaryButtonClass}>
                Save item
              </button>
            </div>
          </form>
        </section>
      ) : (
        <>
          {/* Search, filters, and "+ Add item" in one row, as in the approved mockup. */}
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex-[1_1_220px]">
              <Field
                id="item-search"
                type="search"
                label="Name or asset tag"
                maxLength={SEARCH_MAX_LENGTH}
                hint={
                  query.length === 1 ? `Type at least ${SEARCH_MIN_LENGTH} characters.` : undefined
                }
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
              />
            </div>
            <div className="flex-[0_1_180px]">
              <SelectField
                id="category-filter"
                label="Category"
                options={[{ value: '', label: 'All categories' }, ...categoryChoices]}
                value={categoryFilter}
                onChange={filterChanged(setCategoryFilter)}
              />
            </div>
            <div className="flex-[0_1_160px]">
              <SelectField
                id="status-filter"
                label="Status"
                options={STATUS_FILTERS}
                value={statusFilter}
                onChange={filterChanged(setStatusFilter)}
              />
            </div>
            <div className="flex-[0_1_160px]">
              <SelectField
                id="tracking-filter"
                label="Tracking"
                options={TRACKING_FILTERS}
                value={trackingFilter}
                onChange={filterChanged(setTrackingFilter)}
              />
            </div>
            {/* The label above the fields is 27px tall, so the button lines up with them. */}
            <div className="pt-[29px]">
              <button
                ref={addButtonRef}
                type="button"
                onClick={() => setAdding(true)}
                className={primaryButtonClass}
              >
                + Add item
              </button>
            </div>
          </div>

          {items.isError ? (
            // Without this, a failed load would look like an empty list.
            <RetryAlert query={items} />
          ) : (
            <DataTable
              caption="Items"
              columns={[
                {
                  header: 'Name',
                  cell: (i) => <strong className="break-words">{i.name}</strong>,
                },
                {
                  header: 'Category',
                  cell: (i) => <span className="break-words">{i.category.name}</span>,
                },
                { header: 'Tracking', cell: (i) => TRACKING_LABELS[i.trackingType] },
                {
                  header: 'Asset tag',
                  cell: (i) => <span className="break-words">{i.assetTag ?? '—'}</span>,
                },
                {
                  header: 'Available',
                  // Worded as in the approved mockup. Only ACTIVE items can be issued (BR 1).
                  cell: (i) =>
                    i.status !== 'ACTIVE'
                      ? '—'
                      : i.trackingType === 'UNIT'
                        ? i.available > 0
                          ? 'Available'
                          : 'Out'
                        : `${i.available} of ${i.totalQuantity}`,
                },
                { header: 'Condition', cell: (i) => CONDITION_LABELS[i.condition] },
                {
                  header: 'Status',
                  cell: (i) => (
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-[13px] font-semibold whitespace-nowrap ${STATUS_LOOK[i.status]}`}
                    >
                      {STATUS_LABELS[i.status]}
                    </span>
                  ),
                },
                { header: 'Actions', cell: (i) => actions(i) },
              ]}
              rows={items.data?.data}
              rowKey={(i) => i.id}
              isLoading={items.isPending}
              emptyText={
                q
                  ? `No item matches "${q}".`
                  : categoryFilter || statusFilter || trackingFilter
                    ? 'No items match these filters.'
                    : 'No items yet.'
              }
              page={page}
              pageSize={PAGE_SIZE}
              total={items.data?.total ?? 0}
              onPageChange={setPage}
            />
          )}
        </>
      )}

      <FormDialog
        open={toEdit !== null}
        title={toEdit ? `Edit ${labelOf(toEdit)}` : ''}
        submitLabel="Save changes"
        onSubmit={editForm.handleSubmit((input) => edit.mutate({ item: toEdit!, input }))}
        onCancel={() => setToEdit(null)}
        isPending={edit.isPending}
      >
        {toEdit && (
          <ItemFields
            form={editForm}
            idPrefix="edit"
            trackingType={toEdit.trackingType}
            categories={categoryChoices}
          />
        )}
      </FormDialog>

      <ConfirmDialog
        open={toDelete !== null}
        title="Delete item?"
        confirmLabel="Delete item"
        onConfirm={() => remove.mutate(toDelete!)}
        onCancel={() => setToDelete(null)}
        isPending={remove.isPending}
      >
        {toDelete && labelOf(toDelete)} will be deleted. This cannot be undone.
      </ConfirmDialog>
    </>
  );

  function actions(item: Item) {
    const label = labelOf(item);
    return (
      <div className="flex flex-wrap items-center gap-1 whitespace-nowrap">
        <button
          type="button"
          aria-label={`Edit ${label}`}
          onClick={() => startEditing(item)}
          className={`${linkButtonClass} text-primary hover:bg-primary-tint`}
        >
          Edit
        </button>
        <button
          type="button"
          aria-label={`Delete ${label}`}
          onClick={() => {
            setRefused(null);
            setToDelete(item);
          }}
          className={`${linkButtonClass} text-danger hover:bg-danger-tint`}
        >
          Delete
        </button>
      </div>
    );
  }
}

// "Fix N fields below." at the top of the add form, as in the approved mockup.
function ErrorSummary({ form }: { form: UseFormReturn<ItemInput> }) {
  const count = Object.keys(form.formState.errors).length;
  if (count === 0) return null;
  return (
    <Alert kind="error">
      Fix {count} {count === 1 ? 'field' : 'fields'} below.
    </Alert>
  );
}

// The fields of the add form (below the tracking type choice) and of the edit dialog.
function ItemFields({
  form,
  idPrefix,
  trackingType,
  categories,
}: {
  form: UseFormReturn<ItemInput>;
  idPrefix: string;
  trackingType: TrackingType;
  categories: { value: string; label: string }[];
}) {
  const { errors } = form.formState;
  const isUnit = trackingType === TrackingType.UNIT;
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] items-start gap-4">
        <Field
          id={`${idPrefix}-name`}
          label="Name"
          error={errors.name?.message}
          {...form.register('name')}
        />
        <SelectField
          id={`${idPrefix}-category`}
          label="Category"
          options={[{ value: '', label: 'Choose a category' }, ...categories]}
          error={errors.categoryId?.message}
          {...form.register('categoryId')}
        />
        {isUnit ? (
          <>
            <Field
              id={`${idPrefix}-asset-tag`}
              label="Asset tag"
              error={errors.assetTag?.message}
              {...form.register('assetTag')}
            />
            {/* SPEC 4: always 1, so it is shown but not sent (the server sets it). */}
            <Field
              id={`${idPrefix}-quantity`}
              label="Total quantity"
              value="1"
              disabled
              hint="Always 1 for unit items."
              className="bg-page text-muted"
            />
          </>
        ) : (
          <Field
            id={`${idPrefix}-quantity`}
            label="Total quantity"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            error={errors.totalQuantity?.message}
            {...form.register('totalQuantity', { valueAsNumber: true })}
          />
        )}
        <SelectField
          id={`${idPrefix}-condition`}
          label="Condition"
          options={CONDITION_CHOICES}
          error={errors.condition?.message}
          {...form.register('condition')}
        />
        <SelectField
          id={`${idPrefix}-status`}
          label="Status"
          options={STATUS_CHOICES}
          error={errors.status?.message}
          {...form.register('status')}
        />
      </div>
      <TextAreaField
        id={`${idPrefix}-description`}
        label="Description (optional)"
        rows={2}
        maxLength={DESCRIPTION_MAX_LENGTH}
        error={errors.description?.message}
        {...form.register('description')}
      />
    </>
  );
}
