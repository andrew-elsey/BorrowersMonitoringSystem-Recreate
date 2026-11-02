import type { Category } from '@bms/shared';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import type { SignedInUser } from '../auth';
import { apiError, emulateModalDialogs, mockApi, renderApp, signedInAs } from '../test-utils';

// QA round 5 (needs MD-1 and FND-7): Inventory field errors are announced (role="alert")
// and focus moves to the field. Added once both were on main.

beforeAll(emulateModalDialogs);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ADMIN: SignedInUser = { id: 'u0', name: 'Ma. Teresa Lim', username: 'tlim', role: 'ADMIN' };
const AUDIO: Category = { id: 'c1', name: 'Audio', itemCount: 0 };
const CAMERAS: Category = { id: 'c3', name: 'Cameras', itemCount: 1 };
const message = 'A category named "Audio" already exists.';

function duplicateApi() {
  mockApi((method, path) => {
    if (path === '/auth/me') return signedInAs(ADMIN);
    if (method === 'GET')
      return { status: 200, body: { data: [AUDIO, CAMERAS], page: 1, pageSize: 25, total: 2 } };
    return {
      status: 409,
      body: apiError('DUPLICATE_VALUE', message, { fields: { name: [message] } }),
    };
  });
}

test('a duplicate name in the add form is announced with role="alert" and focus moves to the field', async () => {
  duplicateApi();
  const user = userEvent.setup();
  renderApp('/inventory?tab=categories');
  await screen.findByRole('row', { name: /Audio/ });

  await user.type(screen.getByLabelText('New category'), 'audio');
  await user.click(screen.getByRole('button', { name: 'Add category' }));

  const error = await screen.findByText(message);
  expect(error.getAttribute('role')).toBe('alert');
  expect(document.activeElement).toBe(screen.getByLabelText('New category'));
});

test('a duplicate name in the rename dialog is announced with role="alert" and focus moves to the field', async () => {
  duplicateApi();
  const user = userEvent.setup();
  renderApp('/inventory?tab=categories');

  await user.click(await screen.findByRole('button', { name: 'Rename Cameras' }));
  const dialog = screen.getByRole('dialog');
  const field = within(dialog).getByRole('textbox');
  await user.clear(field);
  await user.type(field, 'Audio');
  // Move focus away so the test proves the error puts it back on the field.
  within(dialog)
    .getByRole('button', { name: /Save|Rename/ })
    .focus();
  await user.keyboard('{Enter}');

  const error = await within(dialog).findByText(message);
  expect(error.getAttribute('role')).toBe('alert');
  expect(document.activeElement).toBe(field);
});
