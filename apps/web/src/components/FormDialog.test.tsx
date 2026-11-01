import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { emulateModalDialogs } from '../test-utils';
import { FormDialog } from './FormDialog';

beforeAll(emulateModalDialogs);

afterEach(cleanup);

function renderDialog(isPending = false) {
  const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
  const onCancel = vi.fn();
  render(
    <FormDialog
      open
      title="Rename category"
      submitLabel="Save name"
      onSubmit={onSubmit}
      onCancel={onCancel}
      isPending={isPending}
    >
      <label htmlFor="name">Category name</label>
      <input id="name" defaultValue="Cables" />
    </FormDialog>,
  );
  return { onSubmit, onCancel };
}

test('opens as a labeled dialog with the first field focused; Enter in the field saves', async () => {
  const user = userEvent.setup();
  const { onSubmit } = renderDialog();
  expect(screen.getByRole('dialog', { name: 'Rename category' })).toBeTruthy();
  const field = screen.getByLabelText('Category name');
  expect(document.activeElement).toBe(field);

  await user.type(field, '{Enter}');
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

test('Cancel and Escape close it; while saving, both buttons are disabled and Escape is ignored', async () => {
  const user = userEvent.setup();
  const { onCancel } = renderDialog();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  // Browsers fire "cancel" on Escape; jsdom does not, so fire it as the browser would.
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  expect(onCancel).toHaveBeenCalledTimes(2);
  cleanup();

  const pending = renderDialog(true);
  expect(screen.getByRole('button', { name: 'Save name' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true);
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  expect(pending.onCancel).not.toHaveBeenCalled();
});
