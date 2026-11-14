import {
  type ResetPasswordInput,
  resetPasswordSchema,
  Role,
  type User,
  type UserInput,
  type UserPage,
  userSchema,
  type UserUpdate,
  userUpdateSchema,
} from '@bms/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { type UseFormReturn, useForm } from 'react-hook-form';
import { ApiRequestError, apiFetch } from '../api';
import { ROLE_LABELS, useAuth } from '../auth';
import { cellTextClass, DataTable } from '../components/DataTable';
import { secondaryButtonClass } from '../components/Dialog';
import { Field, SelectField, showApiFieldErrors } from '../components/Field';
import { FormDialog } from '../components/FormDialog';
import { useNotify } from '../components/Notifications';
import { RetryAlert } from '../components/RetryAlert';
import { StatusBadge } from '../components/StatusBadge';

// Users (SPEC.md 5, admin only, AUTH-3). "+ Add user" opens the add form; edit and reset a password
// in a dialog from the row; deactivate or reactivate from the row. Users are never deleted
// (BR 15). The server enforces every rule (CLAUDE.md rule 2), such as unique usernames and that an
// admin cannot deactivate their own account.

type UserReply = { user: User };
const PAGE_SIZE = 25;
const USERS_KEY = ['users'];
const EDIT_FIELDS = ['name', 'username', 'role'] as const;
const FIELDS = [...EDIT_FIELDS, 'password'] as const;
const TELL_THE_USER =
  'Tell the user this password. They can change it on the Change password screen.';

const ROLE_OPTIONS = [
  { value: '', label: 'Choose a role' },
  ...Object.values(Role).map((role) => ({ value: role, label: ROLE_LABELS[role] })),
];
// The role starts unchosen; the schema refuses the empty value with "Choose a role."
const EMPTY: UserInput = { name: '', username: '', role: '' as Role, password: '' };

const linkButtonClass =
  'h-9 cursor-pointer rounded-lg px-2.5 text-[15px] font-semibold text-primary hover:bg-primary-tint';
const primaryButtonClass =
  'h-11 cursor-pointer rounded-lg bg-primary px-5 text-base font-semibold text-white transition-colors duration-150 hover:bg-primary-hover disabled:cursor-wait disabled:opacity-80';

const isNotFound = (error: unknown) =>
  error instanceof ApiRequestError && error.code === 'NOT_FOUND';

export function UsersPage() {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const me = useAuth().user!;
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const [toEdit, setToEdit] = useState<User | null>(null);
  const [toReset, setToReset] = useState<User | null>(null);

  const users = useQuery({
    queryKey: [...USERS_KEY, page],
    queryFn: () => apiFetch<UserPage>('GET', `/users?page=${page}&pageSize=${PAGE_SIZE}`),
    placeholderData: keepPreviousData,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: USERS_KEY });

  const addForm = useForm<UserInput>({ resolver: zodResolver(userSchema), defaultValues: EMPTY });
  const add = useMutation({
    mutationFn: (input: UserInput) => apiFetch<UserReply>('POST', '/users', input),
    onSuccess: ({ user }) => {
      notify.success(`User ${user.name} added. Tell them their starting password.`);
      addForm.reset(EMPTY);
      return refresh();
    },
    // A taken username (DUPLICATE_VALUE) comes back as a field error under the username.
    onError: (error) => showApiFieldErrors(addForm.setError, error, FIELDS) || notify.error(error),
  });

  function closeAddForm() {
    setAdding(false);
    addForm.reset(EMPTY);
    // The form and its Cancel button are gone, so focus goes back to the button that opened it.
    setTimeout(() => addButtonRef.current?.focus());
  }

  const editForm = useForm<UserUpdate>({ resolver: zodResolver(userUpdateSchema) });
  // The user travels with the request, not read from state: the dialog may close meanwhile.
  const edit = useMutation({
    mutationFn: ({ user, input }: { user: User; input: UserUpdate }) =>
      apiFetch<UserReply>('PATCH', `/users/${user.id}`, input),
    onSuccess: ({ user }) => {
      notify.success(`Changes to ${user.name} saved.`);
      setToEdit(null);
      return refresh();
    },
    onError: (error) => {
      if (showApiFieldErrors(editForm.setError, error, EDIT_FIELDS)) return;
      notify.error(error);
      if (isNotFound(error)) {
        setToEdit(null);
        return refresh();
      }
    },
  });

  const resetForm = useForm<ResetPasswordInput>({ resolver: zodResolver(resetPasswordSchema) });
  const reset = useMutation({
    mutationFn: ({ user, input }: { user: User; input: ResetPasswordInput }) =>
      apiFetch('PUT', `/users/${user.id}/password`, input),
    onSuccess: (_reply, { user }) => {
      notify.success(
        `Password reset for ${user.name}. Tell them the new password. They can change it on the Change password screen.`,
      );
      setToReset(null);
    },
    onError: (error) => {
      if (showApiFieldErrors(resetForm.setError, error, ['password'])) return;
      notify.error(error);
      if (isNotFound(error)) {
        setToReset(null);
        return refresh();
      }
    },
  });

  // BR 15: deactivating keeps the account and its history; an inactive user cannot sign in.
  // It is undone with Reactivate, so no confirmation is asked. Deactivating yourself is refused
  // by the server (CANNOT_DEACTIVATE_SELF), and its message is shown.
  const setActive = useMutation({
    mutationFn: (user: User) =>
      apiFetch<UserReply>('PATCH', `/users/${user.id}`, { active: !user.active }),
    onSuccess: ({ user }) => {
      notify.success(`${user.name} ${user.active ? 'reactivated' : 'deactivated'}.`);
      return refresh();
    },
    onError: (error) => {
      notify.error(error);
      return refresh();
    },
  });

  function startEditing(user: User) {
    const { name, username, role } = user;
    // Your own role is not part of the form, so it is never sent.
    editForm.reset(user.id === me.id ? { name, username } : { name, username, role });
    setToEdit(user);
  }

  function startResetting(user: User) {
    resetForm.reset({ password: '' });
    setToReset(user);
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] leading-tight font-bold">Users</h1>
        <button
          ref={addButtonRef}
          type="button"
          aria-expanded={adding}
          onClick={() => (adding ? addForm.setFocus('name') : setAdding(true))}
          className={primaryButtonClass}
        >
          + Add user
        </button>
      </div>

      {adding && (
        <form
          noValidate
          aria-label="Add user"
          onSubmit={addForm.handleSubmit((input) => add.mutate(input))}
          className="flex max-w-[720px] flex-col gap-4 rounded-xl border border-divider bg-surface p-5"
        >
          <h2 className="text-xl font-bold">Add user</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] items-start gap-4">
            <UserFields form={addForm} idPrefix="new" autoFocus />
            <StartingPasswordField form={addForm} />
          </div>
          <div className="flex flex-wrap justify-end gap-3">
            <button type="button" onClick={closeAddForm} className={secondaryButtonClass}>
              Cancel
            </button>
            <button type="submit" disabled={add.isPending} className={primaryButtonClass}>
              Create user
            </button>
          </div>
        </form>
      )}

      <div className="max-w-[900px]">
        {users.isError ? (
          <RetryAlert query={users} onRetried={() => addButtonRef.current?.focus()} />
        ) : (
          <DataTable
            caption="Users"
            columns={[
              {
                header: 'Name',
                cell: (user) => (
                  <span className={cellTextClass}>
                    <strong>{user.name}</strong>
                    {user.id === me.id && <span className="text-muted"> (you)</span>}
                  </span>
                ),
              },
              {
                header: 'Username',
                cell: (user) => <span className={cellTextClass}>{user.username}</span>,
              },
              { header: 'Role', cell: (user) => ROLE_LABELS[user.role] },
              { header: 'Status', cell: (user) => <StatusBadge active={user.active} /> },
              { header: 'Actions', cell: (user) => actions(user) },
            ]}
            rows={users.data?.data}
            rowKey={(user) => user.id}
            isLoading={users.isPending}
            emptyText="No users yet."
            page={page}
            pageSize={PAGE_SIZE}
            total={users.data?.total ?? 0}
            onPageChange={setPage}
          />
        )}
      </div>

      <FormDialog
        open={toEdit !== null}
        title={`Edit ${toEdit?.name}`}
        submitLabel="Save changes"
        onSubmit={editForm.handleSubmit((input) => edit.mutate({ user: toEdit!, input }))}
        onCancel={() => setToEdit(null)}
        isPending={edit.isPending}
      >
        <UserFields
          form={editForm}
          idPrefix="edit"
          ownRole={toEdit?.id === me.id ? toEdit.role : undefined}
        />
      </FormDialog>

      <FormDialog
        open={toReset !== null}
        title={`Reset password for ${toReset?.name}`}
        submitLabel="Reset password"
        onSubmit={resetForm.handleSubmit((input) => reset.mutate({ user: toReset!, input }))}
        onCancel={() => setToReset(null)}
        isPending={reset.isPending}
      >
        <Field
          id="reset-password"
          type="password"
          autoComplete="new-password"
          label="New password"
          hint={TELL_THE_USER}
          error={resetForm.formState.errors.password?.message}
          {...resetForm.register('password')}
        />
      </FormDialog>
    </>
  );

  function actions(user: User) {
    const toggle = user.active ? 'Deactivate' : 'Reactivate';
    return (
      <div className="flex flex-wrap items-center gap-1 whitespace-nowrap">
        <button
          type="button"
          aria-label={`Edit ${user.name}`}
          onClick={() => startEditing(user)}
          className={linkButtonClass}
        >
          Edit
        </button>
        <button
          type="button"
          aria-label={`Reset password for ${user.name}`}
          onClick={() => startResetting(user)}
          className={linkButtonClass}
        >
          Reset password
        </button>
        <button
          type="button"
          aria-label={`${toggle} ${user.name}`}
          // aria-disabled, not disabled, so focus stays on the button while the request runs.
          aria-disabled={setActive.isPending || undefined}
          onClick={() => !setActive.isPending && setActive.mutate(user)}
          className={`${linkButtonClass} aria-disabled:cursor-wait`}
        >
          {toggle}
        </button>
      </div>
    );
  }
}

// Full name, username, and role: shared by the add form and the edit dialog.
// Its own component so the field is registered after UserFields' fields: react-hook-form focuses
// the first invalid field in registration order (FND-5 form behaviour, card JITzLaQx).
function StartingPasswordField({ form }: { form: UseFormReturn<UserInput> }) {
  return (
    <Field
      id="new-password"
      type="password"
      autoComplete="new-password"
      label="Starting password"
      hint={TELL_THE_USER}
      error={form.formState.errors.password?.message}
      {...form.register('password')}
    />
  );
}

function UserFields({
  form,
  idPrefix,
  autoFocus,
  ownRole,
}: {
  form: UseFormReturn<UserInput> | UseFormReturn<UserUpdate>;
  idPrefix: string;
  autoFocus?: boolean;
  ownRole?: Role; // set when admins edit themselves: the role is shown but cannot be changed
}) {
  // Both forms have these three fields, so either can be treated as the edit form here.
  const { register, formState } = form as UseFormReturn<UserUpdate>;
  const { errors } = formState;
  return (
    <>
      <Field
        id={`${idPrefix}-name`}
        label="Full name"
        autoFocus={autoFocus}
        error={errors.name?.message}
        {...register('name')}
      />
      <Field
        id={`${idPrefix}-username`}
        label="Username"
        autoComplete="off"
        error={errors.username?.message}
        {...register('username')}
      />
      {ownRole ? (
        // Not registered, so the edit sends no role. The server refuses a change anyway
        // (CANNOT_CHANGE_OWN_ROLE, owner decision 2026-11-12).
        <SelectField
          id={`${idPrefix}-role`}
          label="Role"
          options={ROLE_OPTIONS}
          value={ownRole}
          disabled
          hint="You cannot change your own role. Ask another admin to do it."
        />
      ) : (
        <SelectField
          id={`${idPrefix}-role`}
          label="Role"
          options={ROLE_OPTIONS}
          error={errors.role?.message}
          {...register('role')}
        />
      )}
    </>
  );
}
