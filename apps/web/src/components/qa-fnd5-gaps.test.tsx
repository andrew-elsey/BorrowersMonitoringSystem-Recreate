// QA (FND-5): edge cases the shipped component tests do not pin down. Uncommitted, for review.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { ApiRequestError } from '../api';
import { apiError, HANDLER, mockApi, renderApp, signedInAs } from '../test-utils';
import { ConfirmDialog } from './ConfirmDialog';
import { DataTable } from './DataTable';
import { NotificationProvider, useNotify } from './Notifications';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false;
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function dialog(open: boolean, onConfirm = vi.fn(), onCancel = vi.fn()) {
  return (
    <ConfirmDialog
      open={open}
      title="Delete category?"
      confirmLabel="Delete category"
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      Cables will be deleted.
    </ConfirmDialog>
  );
}

test('confirm dialog: a close the parent asked for (open set to false) does not call onCancel', () => {
  const onCancel = vi.fn();
  const { rerender, container } = render(dialog(true, vi.fn(), onCancel));
  rerender(dialog(false, vi.fn(), onCancel));
  // Browsers fire "close" after dialog.close(); jsdom does not, so fire it as the browser would.
  fireEvent(container.querySelector('dialog')!, new Event('close'));
  expect(onCancel).not.toHaveBeenCalled();
});

test('confirm dialog: the action can be confirmed with the keyboard only (Tab, Enter)', async () => {
  const user = userEvent.setup();
  const onConfirm = vi.fn();
  render(dialog(true, onConfirm));
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete category' }));
  await user.keyboard('{Enter}');
  expect(onConfirm).toHaveBeenCalledTimes(1);
});

function NotifyButton() {
  const notify = useNotify();
  return (
    <button
      onClick={() =>
        notify.error(new ApiRequestError(409, 'HAS_HISTORY', 'Retire it instead.', {}, null))
      }
    >
      Delete
    </button>
  );
}

test('notifications: the live region exists before any message and messages render inside it', async () => {
  const user = userEvent.setup();
  render(
    <NotificationProvider>
      <NotifyButton />
    </NotificationProvider>,
  );
  const region = document.querySelector('[aria-live="polite"]') as HTMLElement;
  expect(region).toBeTruthy();
  expect(region.children).toHaveLength(0);

  await user.click(screen.getByRole('button', { name: 'Delete' }));
  expect(within(region).getByRole('alert').textContent).toContain('Retire it instead.');
  // Same element: React kept the region, it was not mounted with the first message.
  expect(document.querySelector('[aria-live="polite"]')).toBe(region);
});

test('notifications: a message can be dismissed with the keyboard', async () => {
  const user = userEvent.setup();
  render(
    <NotificationProvider>
      <NotifyButton />
    </NotificationProvider>,
  );
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  screen.getByRole('button', { name: 'Dismiss' }).focus();
  await user.keyboard('{Enter}');
  expect(screen.queryByRole('alert')).toBeNull();
});

type Row = { id: string };
function table(props: {
  page: number;
  total: number;
  isLoading: boolean;
  onPageChange: () => void;
}) {
  return (
    <DataTable<Row>
      caption="Rows"
      columns={[{ header: 'Id', cell: (r) => r.id }]}
      rows={props.isLoading ? undefined : []}
      rowKey={(r) => r.id}
      emptyText="None."
      pageSize={25}
      {...props}
    />
  );
}

test('data table: a page past the end does not jump while the total is still loading', () => {
  const onPageChange = vi.fn();
  render(table({ page: 3, total: 0, isLoading: true, onPageChange }));
  expect(onPageChange).not.toHaveBeenCalled();
});

test('data table: a middle page shows its range and both page buttons enabled', () => {
  render(table({ page: 2, total: 60, isLoading: false, onPageChange: vi.fn() }));
  expect(screen.getByText('Showing 26–50 of 60')).toBeTruthy();
  expect(screen.getByText('Page 2 of 3')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled')).toBe(false);
  expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(false);
});

test('data table: page buttons are disabled while a page loads', () => {
  render(table({ page: 2, total: 60, isLoading: true, onPageChange: vi.fn() }));
  expect(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(true);
});

test('change password: an API field error with no field on the form still shows the message', async () => {
  mockApi((_method, path) => {
    if (path === '/auth/me') return signedInAs(HANDLER);
    return {
      status: 400,
      body: apiError('VALIDATION_ERROR', 'Some fields are invalid.', {
        fields: {
          newPassword: ['Too common.'],
          somethingElse: ['Not on this form.'],
        },
      }),
    };
  });
  renderApp('/password');
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Current password'), 'old-password-1');
  await user.type(screen.getByLabelText('New password'), 'a longer phrase');
  await user.type(screen.getByLabelText('Confirm new password'), 'a longer phrase');
  await user.click(screen.getByRole('button', { name: 'Change password' }));

  expect((await screen.findByRole('alert')).textContent).toContain('Some fields are invalid.');
  expect(screen.getByText('Too common.')).toBeTruthy();
});
