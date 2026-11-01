import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

// jsdom has no modal dialogs. Browsers provide these; here they only toggle `open`.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false;
  };
});

afterEach(cleanup);

function renderDialog(props: { open?: boolean; isPending?: boolean } = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const result = render(
    <ConfirmDialog
      open={props.open ?? true}
      title="Delete category?"
      confirmLabel="Delete category"
      onConfirm={onConfirm}
      onCancel={onCancel}
      isPending={props.isPending}
    >
      Cables will be deleted. This cannot be undone.
    </ConfirmDialog>,
  );
  return { onConfirm, onCancel, ...result };
}

test('opens as a labeled dialog with Cancel focused (TC-FND-25)', () => {
  renderDialog();
  const dialog = screen.getByRole('dialog', { name: 'Delete category?' });
  expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
  expect(screen.getByText('Cables will be deleted. This cannot be undone.')).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
});

test('Cancel does nothing destructive; confirm runs the action (TC-FND-25)', async () => {
  const user = userEvent.setup();
  const { onConfirm, onCancel } = renderDialog();

  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: 'Delete category' }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
});

test('Escape cancels (TC-FND-23)', () => {
  const { onCancel } = renderDialog();
  // Browsers fire "cancel" on the dialog when Escape is pressed.
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  expect(onCancel).toHaveBeenCalledTimes(1);
});

test('while the request runs, both buttons are disabled so it is sent once', () => {
  const { onCancel } = renderDialog({ isPending: true });
  expect(screen.getByRole('button', { name: 'Delete category' }).hasAttribute('disabled')).toBe(
    true,
  );
  expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true);
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  expect(onCancel).not.toHaveBeenCalled();
});

test('closed, it shows nothing; setting open shows it', () => {
  const { rerender, onConfirm, onCancel } = renderDialog({ open: false });
  expect(screen.queryByRole('dialog')).toBeNull();

  rerender(
    <ConfirmDialog
      open
      title="Delete category?"
      confirmLabel="Delete category"
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      Cables will be deleted.
    </ConfirmDialog>,
  );
  expect(screen.getByRole('dialog', { name: 'Delete category?' })).toBeTruthy();
});
