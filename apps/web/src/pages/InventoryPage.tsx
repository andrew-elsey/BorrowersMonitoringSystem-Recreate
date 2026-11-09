import { categorySchema, type Category, type CategoryInput } from '@bms/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router';
import { ApiRequestError, apiFetch } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DataTable } from '../components/DataTable';
import { Field, showApiFieldErrors } from '../components/Field';
import { FormDialog } from '../components/FormDialog';
import { useNotify } from '../components/Notifications';
import { RetryAlert } from '../components/RetryAlert';
import { InventoryItems } from './InventoryItems';

// Inventory and categories (SPEC.md 5, admin only), with an Items tab (MD-2) and a Categories tab
// (MD-1). The tab is in the address (?tab=categories), so a reload or the Back button keeps it.
export function InventoryPage() {
  const [params] = useSearchParams();
  const onCategories = params.get('tab') === 'categories';
  return (
    <>
      <h1 className="text-[28px] leading-tight font-bold">Inventory and categories</h1>
      <nav aria-label="Inventory sections" className="flex gap-1 border-b border-divider">
        <TabLink to="/inventory" current={!onCategories}>
          Items
        </TabLink>
        <TabLink to="/inventory?tab=categories" current={onCategories}>
          Categories
        </TabLink>
      </nav>
      {onCategories ? <CategoriesTab /> : <InventoryItems />}
    </>
  );
}

function TabLink({ to, current, children }: { to: string; current: boolean; children: string }) {
  return (
    <Link
      to={to}
      aria-current={current ? 'page' : undefined}
      className={`flex h-11 items-center border-b-3 px-4.5 font-semibold ${current ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-ink'}`}
    >
      {children}
    </Link>
  );
}

// The Categories tab (MD-1).
// The server enforces every rule (CLAUDE.md rule 2): names are unique, and a category in use cannot
// be deleted (BR 15). The unavailable Delete button only saves a pointless request.

type CategoryPage = { data: Category[]; page: number; pageSize: number; total: number };
type CategoryReply = { category: Category };
const PAGE_SIZE = 25;
const CATEGORIES_KEY = ['categories'];

const isNotFound = (error: unknown) =>
  error instanceof ApiRequestError && error.code === 'NOT_FOUND';

const linkButtonClass = 'h-9 cursor-pointer rounded-lg px-2.5 text-[15px] font-semibold';

function CategoriesTab() {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [toRename, setToRename] = useState<Category | null>(null);
  const [toDelete, setToDelete] = useState<Category | null>(null);

  const categories = useQuery({
    queryKey: [...CATEGORIES_KEY, page],
    queryFn: () => apiFetch<CategoryPage>('GET', `/categories?page=${page}&pageSize=${PAGE_SIZE}`),
    placeholderData: keepPreviousData,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: CATEGORIES_KEY });

  const addForm = useForm<CategoryInput>({
    resolver: zodResolver(categorySchema),
    defaultValues: { name: '' },
  });
  const add = useMutation({
    mutationFn: (input: CategoryInput) => apiFetch<CategoryReply>('POST', '/categories', input),
    onSuccess: ({ category }) => {
      notify.success(`Category "${category.name}" added.`);
      addForm.reset({ name: '' });
      return refresh();
    },
    // A duplicate name (DUPLICATE_VALUE) comes back as a field error under the name.
    onError: (error) =>
      showApiFieldErrors(addForm.setError, error, ['name']) || notify.error(error),
  });

  const renameForm = useForm<CategoryInput>({ resolver: zodResolver(categorySchema) });
  // The category travels with the request, not read from state: the browser can close the dialog
  // (and clear toRename) while the request runs.
  const rename = useMutation({
    mutationFn: ({ category, input }: { category: Category; input: CategoryInput }) =>
      apiFetch<CategoryReply>('PUT', `/categories/${category.id}`, input),
    onSuccess: ({ category }, { category: before }) => {
      // Saving the same name changes nothing, so there is nothing to confirm.
      if (category.name !== before.name) {
        notify.success(`Category "${before.name}" renamed to "${category.name}".`);
      }
      setToRename(null);
      return refresh();
    },
    onError: (error) => {
      if (showApiFieldErrors(renameForm.setError, error, ['name'])) return;
      notify.error(error);
      // Someone else deleted it while the dialog was open: close it and drop the row.
      if (isNotFound(error)) {
        setToRename(null);
        return refresh();
      }
    },
  });

  const remove = useMutation({
    mutationFn: (category: Category) => apiFetch('DELETE', `/categories/${category.id}`),
    onSuccess: async (_reply, category) => {
      notify.success(`Category "${category.name}" deleted.`);
      setToDelete(null);
      await refresh();
      // Its row and Delete button are gone, so focus would drop to the page start.
      addForm.setFocus('name');
    },
    // HAS_HISTORY (someone added an item to it) or NOT_FOUND (someone deleted it) since the list
    // loaded: reload so the row shows the current state.
    onError: (error) => {
      notify.error(error);
      setToDelete(null);
      return refresh();
    },
  });

  function startRenaming(category: Category) {
    renameForm.reset({ name: category.name });
    setToRename(category);
  }

  return (
    <>
      <form
        noValidate
        onSubmit={addForm.handleSubmit((input) => add.mutate(input))}
        className="flex flex-wrap items-start gap-3"
      >
        <div className="flex-[0_1_320px]">
          <Field
            id="name"
            label="New category"
            error={addForm.formState.errors.name?.message}
            {...addForm.register('name')}
          />
        </div>
        {/* The label above the field is 27px tall, so the button lines up with the input. */}
        <div className="pt-[29px]">
          <button
            type="submit"
            disabled={add.isPending}
            className="h-11 cursor-pointer rounded-lg bg-primary px-5 text-base font-semibold text-white transition-colors duration-150 hover:bg-primary-hover disabled:cursor-wait disabled:opacity-80"
          >
            Add category
          </button>
        </div>
      </form>

      <div className="max-w-[760px]">
        {categories.isError ? (
          // Without this, a failed load would look like "No categories yet."
          <RetryAlert query={categories} onRetried={() => addForm.setFocus('name')} />
        ) : (
          <DataTable
            caption="Categories"
            columns={[
              {
                header: 'Category',
                // A long name with no spaces must wrap, or it pushes the buttons out of sight.
                cell: (category) => <strong className="break-words">{category.name}</strong>,
              },
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
        )}
      </div>

      <FormDialog
        open={toRename !== null}
        title={`Rename ${toRename?.name}`}
        submitLabel="Save name"
        onSubmit={renameForm.handleSubmit((input) => rename.mutate({ category: toRename!, input }))}
        onCancel={() => setToRename(null)}
        isPending={rename.isPending}
      >
        <Field
          id="new-name"
          label="New name"
          error={renameForm.formState.errors.name?.message}
          {...renameForm.register('name')}
        />
      </FormDialog>

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
    const reasonId = `in-use-${category.id}`;
    return (
      <div className="flex flex-wrap items-center gap-1 whitespace-nowrap">
        <button
          type="button"
          aria-label={`Rename ${category.name}`}
          onClick={() => startRenaming(category)}
          className={`${linkButtonClass} text-primary hover:bg-primary-tint`}
        >
          Rename
        </button>
        {/* BR 15: a category in use keeps its history, so only unused ones can be deleted.
            aria-disabled, not disabled, so keyboard and screen reader users still reach the reason. */}
        <button
          type="button"
          aria-label={`Delete ${category.name}`}
          aria-disabled={inUse || undefined}
          aria-describedby={inUse ? reasonId : undefined}
          onClick={() => !inUse && setToDelete(category)}
          className={`${linkButtonClass} ${inUse ? 'cursor-not-allowed text-muted' : 'text-danger hover:bg-danger-tint'}`}
        >
          Delete
        </button>
        {inUse && (
          <span id={reasonId} className="text-sm text-muted">
            Used by {category.itemCount} {category.itemCount === 1 ? 'item' : 'items'}
          </span>
        )}
      </div>
    );
  }
}
