# Borrowers Monitoring System

Inventory and borrowing system for a college department's handout room. See `CLAUDE.md` and `docs/` for requirements and architecture.

## Requirements

- Node.js 24.11.1 (see `.nvmrc`)
- Docker (from FND-2 onward)

## Layout

npm workspaces monorepo:

```
apps/api/          Express API (routes, services, Prisma)
apps/web/          React + Vite front end
packages/shared/   Zod schemas, enums, and types used by api and web
docs/              SPEC, BUSINESS_RULES, ARCHITECTURE, BACKLOG
```

Shared TypeScript settings live in `tsconfig.base.json` (strict mode). Each package extends it. ESLint and Prettier are configured once at the root. `vitest.config.ts` runs every package's tests.

### Compile step

`apps/api` and `packages/shared` are compiled with `tsc` (each package's `tsconfig.build.json`) and run as plain JavaScript under Node. They use `NodeNext` modules, so relative imports end in `.js`: `import { x } from './x.js'`. `apps/web` is bundled by Vite.

`@bms/shared` exports a `source` condition that points at its TypeScript files. TypeScript, Vite, and Vitest use it, so development and tests never need a build first. Plain Node uses the compiled `dist/`, so run `npm run build` before starting the api with Node.

## Commands

Run from the repo root:

```
npm install         # install all workspaces
npm run lint        # ESLint
npm run typecheck   # tsc in every workspace
npm test            # Vitest across all workspaces
npm run build       # compile shared and api to dist/, build web with Vite
npm run format      # Prettier
```

More commands (database, seed) are added by later tickets; `CLAUDE.md` lists them.

## Running with Docker

```
cp .env.example .env        # then set POSTGRES_PASSWORD (letters and digits only), ADMIN_PASSWORD, and SESSION_SECRET
docker compose up --build   # or add -d to run in the background
```

Open http://127.0.0.1:8080. Three containers start:

- **db**: PostgreSQL 18. Data lives in the `db-data` volume and survives `docker compose down`. `docker compose down -v` deletes it.
- **api**: the compiled Express API. Not published to the host; nginx reaches it on port 3000.
- **web**: nginx serving the React build and proxying `/api` to the api.

Only the web port is published, and by default only to this machine. To reach the app from other machines on the LAN, set `WEB_BIND_ADDRESS` in `.env` to this PC's LAN address. All variables are described in `.env.example` and `docs/ARCHITECTURE.md` section 10.

## Development data

The api seeds the first admin and default settings on every start. Sample data (categories, rooms, items, borrowers, a semester) and the QA role accounts come only from `npm run db:seed`, which never runs in production.

**Start over with clean data.** This deletes everything in the dev database, including any password changes:

```
docker compose down -v
docker compose up --build -d --wait
npm run dev:db
npm run db:seed             # needs DATABASE_URL in .env, pointing at 127.0.0.1:5432
```

Rows written before FND-6 (2026-10-31) are stored 8 hours early. Resetting is the fix for them; there is no correcting migration.

**Role test accounts for QA** (until AUTH-3 adds user management): set `QA_PASSWORD` in `.env` (at least 10 characters), then run `npm run db:seed`. It creates `qa-handler` (Handler) and `qa-viewer` (View-only) if they do not exist, and never changes them afterwards. To set a new password for one of them: `docker compose exec api npm run admin:reset-password -- qa-handler`.

## Shared web components

Building blocks for the screens, in `apps/web/src/components/` (FND-5). Use these instead of writing new ones, so every screen is labeled, keyboard friendly, and shows errors the same way. Colors come from the theme tokens in ARCHITECTURE section 14.

### Form fields

`Field` (input), `SelectField`, and `TextAreaField` take a label, an optional hint, an error, and React Hook Form's `register()` props. Validate with the shared Zod schema from `@bms/shared`, and send the API's field errors back to the form with `showApiFieldErrors`, which also moves focus to the first errored field. Field errors are announced to screen readers (`role="alert"`). Give it the fields the form shows: the API reports nested errors under the top-level name (for example `lines`), and an error with no matching field must still reach the user as a notification.

```tsx
const form = useForm<RoomInput>({ resolver: zodResolver(roomSchema), defaultValues: { name: '' } });
const save = useMutation({
  mutationFn: (input: RoomInput) => apiFetch('POST', '/rooms', input),
  onSuccess: () => notify.success('Room saved.'),
  // VALIDATION_ERROR field details go next to their fields; anything else becomes a notification.
  onError: (error) => showApiFieldErrors(form.setError, error, ['name', 'type']) || notify.error(error),
});

<Field id="name" label="Name" error={form.formState.errors.name?.message} {...form.register('name')} />
<SelectField id="type" label="Type" options={[{ value: '', label: 'Choose one' }, ...]} {...form.register('type')} />
```

### Data table

`DataTable` shows one page from a list endpoint (`{ data, page, pageSize, total }`, ARCHITECTURE section 7) with loading and empty states and Previous and Next buttons. The row count is hidden while loading or empty, and a page change moves focus to the table. When the query fails, show a `RetryAlert` instead of the table, so a failed load does not look like an empty list. Keep the page number in state and pass it to the query; page size is at most 100 (SPEC section 7).

```tsx
<DataTable
  caption="Rooms and labs"
  columns={[{ header: 'Name', cell: (room) => room.name }]}
  rows={rooms.data?.data}
  rowKey={(room) => room.id}
  isLoading={rooms.isPending}
  emptyText="No rooms yet."
  page={page}
  pageSize={25}
  total={rooms.data?.total ?? 0}
  onPageChange={setPage}
/>
```

### Retry alert

`RetryAlert` shows a failed query's error with a Retry button. Pass the query; `onRetried` runs after a Retry that worked, because the button is then gone and focus would drop to the page start, so move focus to the first field of the page's form (SPEC section 8).

```tsx
{rooms.isError ? (
  <RetryAlert query={rooms} onRetried={() => addForm.setFocus('name')} />
) : (
  <DataTable ... />
)}
```

### Confirm dialog

`ConfirmDialog` asks before a destructive action. Cancel has focus when it opens, Escape cancels, and both buttons are disabled while `isPending` is true so the request is sent once.

```tsx
<ConfirmDialog
  open={toDelete !== null}
  title="Delete category?"
  confirmLabel="Delete category"
  onConfirm={() => remove.mutate(toDelete!.id)}
  onCancel={() => setToDelete(null)}
  isPending={remove.isPending}
>
  {toDelete?.name} will be deleted. This cannot be undone.
</ConfirmDialog>
```

### Form dialog

`FormDialog` edits a record in a modal dialog opened from its table row: renaming a category, editing a borrower or an item, and rooms later. The children are the fields of a React Hook Form form. The browser focuses the first field when it opens, Enter saves, Escape and Cancel close it, and focus goes back to the row button that opened it. Both buttons are disabled while `isPending` is true. Reset the form with the record before opening it, and send API errors to the fields with `showApiFieldErrors`.

```tsx
const editForm = useForm<CategoryInput>({ resolver: zodResolver(categorySchema) });
function startRenaming(category: Category) {
  editForm.reset({ name: category.name });
  setToRename(category);
}

<FormDialog
  open={toRename !== null}
  title={`Rename ${toRename?.name}`}
  submitLabel="Save name"
  onSubmit={editForm.handleSubmit((input) => rename.mutate(input))}
  onCancel={() => setToRename(null)}
  isPending={rename.isPending}
>
  <Field id="new-name" label="New name" error={editForm.formState.errors.name?.message} {...editForm.register('name')} />
</FormDialog>
```

`ConfirmDialog` and `FormDialog` share the modal shell in `Dialog.tsx`. In component tests, call `emulateModalDialogs` from `test-utils.tsx` in `beforeAll`: jsdom has no modal dialogs, and it acts like a browser's `showModal()` and `close()`.

### Notifications

`useNotify()` shows a message at the top of the page content, above the page heading, until it is dismissed. Messages sit in the page flow, never floating over the page, so they never cover a button. Only the newest three are kept. `notify.success(text)` for a saved change; `notify.error(error)` shows the API error `message`, or "Try again in N seconds" on 429 and 503. `AppShell` mounts `NotificationProvider` inside `<main>`, so every signed-in page (and `renderApp` in tests) has it; a page outside the app shell, such as login, has none.
