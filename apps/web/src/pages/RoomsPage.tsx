import { type Room, type RoomInput, type RoomPage, roomSchema } from '@bms/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { ApiRequestError, apiFetch } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { cellTextClass, DataTable } from '../components/DataTable';
import { Field, showApiFieldErrors } from '../components/Field';
import { FormDialog } from '../components/FormDialog';
import { useNotify } from '../components/Notifications';
import { RetryAlert } from '../components/RetryAlert';
import { StatusBadge } from '../components/StatusBadge';
import { TIMEZONE } from '../timezone';

// Rooms and labs (SPEC.md 5, admin only, MD-3). Add with the top form, rename in a dialog from the
// row, deactivate or reactivate from the row. Only a room no transaction uses can be deleted
// (BR 15). The server enforces every rule (CLAUDE.md rule 2), such as unique names.

type RoomReply = { room: Room };
const PAGE_SIZE = 25;
const ROOMS_KEY = ['rooms'];

const addedDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: TIMEZONE,
});

const isNotFound = (error: unknown) =>
  error instanceof ApiRequestError && error.code === 'NOT_FOUND';

const linkButtonClass = 'h-9 cursor-pointer rounded-lg px-2.5 text-[15px] font-semibold';
const primaryLinkClass = `${linkButtonClass} text-primary hover:bg-primary-tint`;

export function RoomsPage() {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [toRename, setToRename] = useState<Room | null>(null);
  const [toDelete, setToDelete] = useState<Room | null>(null);

  const rooms = useQuery({
    queryKey: [...ROOMS_KEY, page],
    queryFn: () => apiFetch<RoomPage>('GET', `/rooms?page=${page}&pageSize=${PAGE_SIZE}`),
    placeholderData: keepPreviousData,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ROOMS_KEY });

  const addForm = useForm<RoomInput>({
    resolver: zodResolver(roomSchema),
    defaultValues: { name: '' },
  });
  const add = useMutation({
    mutationFn: (input: RoomInput) => apiFetch<RoomReply>('POST', '/rooms', input),
    onSuccess: ({ room }) => {
      notify.success(`Room "${room.name}" added.`);
      addForm.reset({ name: '' });
      return refresh();
    },
    // A duplicate name (DUPLICATE_VALUE) comes back as a field error under the name.
    onError: (error) =>
      showApiFieldErrors(addForm.setError, error, ['name']) || notify.error(error),
  });

  const renameForm = useForm<RoomInput>({ resolver: zodResolver(roomSchema) });
  // The room travels with the request, not read from state: the dialog may close meanwhile.
  const rename = useMutation({
    mutationFn: ({ room, input }: { room: Room; input: RoomInput }) =>
      apiFetch<RoomReply>('PATCH', `/rooms/${room.id}`, input),
    onSuccess: ({ room }, { room: before }) => {
      // Saving the same name changes nothing, so there is nothing to confirm.
      if (room.name !== before.name) {
        notify.success(`Room "${before.name}" renamed to "${room.name}".`);
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

  // BR 15: deactivating keeps the room and its history. It is undone with Reactivate, so no
  // confirmation is asked.
  const setActive = useMutation({
    mutationFn: (room: Room) =>
      apiFetch<RoomReply>('PATCH', `/rooms/${room.id}`, { active: !room.active }),
    onSuccess: ({ room }) => {
      notify.success(`Room "${room.name}" ${room.active ? 'reactivated' : 'deactivated'}.`);
      return refresh();
    },
    onError: (error) => {
      notify.error(error);
      return refresh();
    },
  });

  const remove = useMutation({
    mutationFn: (room: Room) => apiFetch('DELETE', `/rooms/${room.id}`),
    onSuccess: async (_reply, room) => {
      notify.success(`Room "${room.name}" deleted.`);
      setToDelete(null);
      await refresh();
      // Its row and Delete button are gone, so focus would drop to the page start.
      addForm.setFocus('name');
    },
    // HAS_HISTORY (a checkout used it) or NOT_FOUND (someone deleted it) since the list loaded:
    // reload so the row shows the current state.
    onError: (error) => {
      notify.error(error);
      setToDelete(null);
      return refresh();
    },
  });

  function startRenaming(room: Room) {
    renameForm.reset({ name: room.name });
    setToRename(room);
  }

  return (
    <>
      <h1 className="text-[28px] leading-tight font-bold">Rooms and labs</h1>

      <form
        noValidate
        aria-label="Add room or lab"
        onSubmit={addForm.handleSubmit((input) => add.mutate(input))}
        className="flex max-w-[760px] flex-wrap items-start gap-3 rounded-xl border border-divider bg-surface p-5"
      >
        <div className="flex-[1_1_280px]">
          <Field
            id="name"
            label="New room or lab name"
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
            Add room or lab
          </button>
        </div>
      </form>
      <p className="text-sm text-muted">
        Handlers can also add a room from the Checkout screen. Rooms used in transactions are
        deactivated, never deleted.
      </p>

      <div className="max-w-[900px]">
        {rooms.isError ? (
          <RetryAlert query={rooms} onRetried={() => addForm.setFocus('name')} />
        ) : (
          <DataTable
            caption="Rooms and labs"
            columns={[
              {
                header: 'Name',
                // cellTextClass: a long name with no spaces wraps inside the cell, not out of sight.
                cell: (room) => <strong className={cellTextClass}>{room.name}</strong>,
              },
              { header: 'Added by', cell: (room) => room.createdBy.name },
              { header: 'Added', cell: (room) => addedDate.format(new Date(room.createdAt)) },
              { header: 'Status', cell: (room) => <StatusBadge active={room.active} /> },
              { header: 'Actions', cell: (room) => actions(room) },
            ]}
            rows={rooms.data?.data}
            rowKey={(room) => room.id}
            isLoading={rooms.isPending}
            emptyText="No rooms or labs yet. Add the first one above."
            page={page}
            pageSize={PAGE_SIZE}
            total={rooms.data?.total ?? 0}
            onPageChange={setPage}
          />
        )}
      </div>

      <FormDialog
        open={toRename !== null}
        title={`Rename ${toRename?.name}`}
        submitLabel="Save name"
        onSubmit={renameForm.handleSubmit((input) => rename.mutate({ room: toRename!, input }))}
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
        title="Delete room?"
        confirmLabel="Delete room"
        onConfirm={() => remove.mutate(toDelete!)}
        onCancel={() => setToDelete(null)}
        isPending={remove.isPending}
      >
        {toDelete?.name} will be deleted. This cannot be undone.
      </ConfirmDialog>
    </>
  );

  function actions(room: Room) {
    const inUse = room.transactionCount > 0;
    const reasonId = `in-use-${room.id}`;
    const toggle = room.active ? 'Deactivate' : 'Reactivate';
    return (
      <div className="flex flex-wrap items-center gap-1 whitespace-nowrap">
        <button
          type="button"
          aria-label={`Rename ${room.name}`}
          onClick={() => startRenaming(room)}
          className={primaryLinkClass}
        >
          Rename
        </button>
        <button
          type="button"
          aria-label={`${toggle} ${room.name}`}
          // aria-disabled, not disabled, so focus stays on the button while the request runs.
          aria-disabled={setActive.isPending || undefined}
          onClick={() => !setActive.isPending && setActive.mutate(room)}
          className={`${primaryLinkClass} aria-disabled:cursor-wait`}
        >
          {toggle}
        </button>
        {/* BR 15: a room used in a transaction keeps its history, so only unused ones can be
            deleted. aria-disabled, not disabled, so keyboard and screen reader users still reach
            the reason. */}
        <button
          type="button"
          aria-label={`Delete ${room.name}`}
          aria-disabled={inUse || undefined}
          aria-describedby={inUse ? reasonId : undefined}
          onClick={() => !inUse && setToDelete(room)}
          className={`${linkButtonClass} ${inUse ? 'cursor-not-allowed text-muted' : 'text-danger hover:bg-danger-tint'}`}
        >
          Delete
        </button>
        {inUse && (
          <span id={reasonId} className="text-sm text-muted">
            Used in {room.transactionCount}{' '}
            {room.transactionCount === 1 ? 'transaction' : 'transactions'}
          </span>
        )}
      </div>
    );
  }
}
