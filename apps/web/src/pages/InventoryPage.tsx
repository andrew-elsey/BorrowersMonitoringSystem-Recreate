import { categorySchema, type Category, type CategoryInput } from '@bms/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { apiFetch } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DataTable } from '../components/DataTable';
import { Field, showApiFieldErrors } from '../components/Field';
import { useNotify } from '../components/Notifications';

// Inventory and categories (SPEC.md 5, admin only). MD-1 builds the categories part; MD-2 adds items.
// The server enforces every rule (CLAUDE.md rule 2): names are unique, and a category in use cannot
// be deleted (BR 15). The disabled Delete button only saves a pointless request.

type CategoryPage = { data: Category[]; page: number; pageSize: number; total: number };
const PAGE_SIZE = 25;
const CATEGORIES_KEY = ['categories'];

const buttonClass =
  'h-11 cursor-pointer rounded-lg px-5 text-base font-semibold transition-colors duration-150 disabled:cursor-wait disabled:opacity-80';
const linkButtonClass =
  'h-9 cursor-pointer rounded-lg px-2.5 text-[15px] font-semibold disabled:cursor-not-allowed';

export function InventoryPage() {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  // The category being renamed, or null while the form adds a new one.
  const [editing, setEditing] = useState<Category | null>(null);
  const [toDelete, setToDelete] = useState<Category | null>(null);

  const categories = useQuery({
    queryKey: [...CATEGORIES_KEY, page],
    queryFn: () => apiFetch<CategoryPage>('GET', `/categories?page=${page}&pageSize=${PAGE_SIZE}`),
    placeholderData: keepPreviousData,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: CATEGORIES_KEY });

  const form = useForm<CategoryInput>({
    resolver: zodResolver(categorySchema),
    defaultValues: { name: '' },
  });
  const save = useMutation({
    mutationFn: (input: CategoryInput) =>
      editing
        ? apiFetch('PUT', `/categories/${editing.id}`, input)
        : apiFetch('POST', '/categories', input),
    onSuccess: () => {
      notify.success(editing ? 'Category renamed.' : 'Category added.');
      stopEditing();
      return refresh();
    },
    // A duplicate name (DUPLICATE_VALUE) comes back as a field error under the name.
    onError: (error) => showApiFieldErrors(form.setError, error, ['name']) || notify.error(error),
  });
  const remove = useMutation({
    mutationFn: (category: Category) => apiFetch('DELETE', `/categories/${category.id}`),
    onSuccess: () => {
      notify.success('Category deleted.');
      return refresh();
    },
    // HAS_HISTORY: someone added an item to it since the list loaded.
    onError: (error) => notify.error(error),
    onSettled: () => setToDelete(null),
  });

  // After Rename, move focus to the name field. Done after the render, once reset() has finished.
  useEffect(() => {
    if (editing) form.setFocus('name');
  }, [editing, form]);

  function startEditing(category: Category) {
    setEditing(category);
    form.reset({ name: category.name });
  }
  function stopEditing() {
    setEditing(null);
    form.reset({ name: '' });
  }

  return (
    <>
      <h1 className="text-[28px] leading-tight font-bold">Inventory and categories</h1>

      <form
        noValidate
        onSubmit={form.handleSubmit((input) => save.mutate(input))}
        className="flex flex-wrap items-start gap-3"
      >
        <div className="flex-[0_1_320px]">
          <Field
            id="name"
            label={editing ? `New name for ${editing.name}` : 'New category'}
            error={form.formState.errors.name?.message}
            {...form.register('name')}
          />
        </div>
        {/* The label above the field is 27px tall, so the buttons line up with the input. */}
        <div className="flex gap-3 pt-[29px]">
          <button
            type="submit"
            disabled={save.isPending}
            className={`${buttonClass} bg-primary text-white hover:bg-primary-hover`}
          >
            {editing ? 'Save name' : 'Add category'}
          </button>
          {editing && (
            <button
              type="button"
              onClick={stopEditing}
              className={`${buttonClass} border border-field-border font-medium hover:bg-page`}
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="max-w-[760px]">
        <DataTable
          caption="Categories"
          columns={[
            { header: 'Category', cell: (category) => <strong>{category.name}</strong> },
            { header: 'Items', cell: (category) => category.itemCount },
            { header: 'Actions', cell: (category) => actions(category) },
          ]}
          rows={categories.data?.data}
          rowKey={(category) => category.id}
          isLoading={categories.isPending}
          emptyText="No categories yet."
          page={page}
          pageSize={PAGE_SIZE}
          total={categories.data?.total ?? 0}
          onPageChange={setPage}
        />
      </div>

      <ConfirmDialog
        open={toDelete !== null}
        title="Delete category?"
        confirmLabel="Delete category"
        onConfirm={() => remove.mutate(toDelete!)}
        onCancel={() => setToDelete(null)}
        isPending={remove.isPending}
      >
        {toDelete?.name} will be deleted. This cannot be undone.
      </ConfirmDialog>
    </>
  );

  function actions(category: Category) {
    const inUse = category.itemCount > 0;
    return (
      <div className="flex flex-wrap items-center gap-1 whitespace-nowrap">
        <button
          type="button"
          aria-label={`Rename ${category.name}`}
          onClick={() => startEditing(category)}
          className={`${linkButtonClass} text-primary hover:bg-primary-tint`}
        >
          Rename
        </button>
        {/* BR 15: a category in use keeps its history, so only unused ones can be deleted. */}
        <button
          type="button"
          aria-label={`Delete ${category.name}`}
          disabled={inUse}
          onClick={() => setToDelete(category)}
          className={`${linkButtonClass} text-danger hover:bg-danger-tint disabled:text-muted disabled:hover:bg-transparent`}
        >
          Delete
        </button>
        {inUse && <span className="text-[13px] text-muted">In use, cannot delete</span>}
      </div>
    );
  }
}
