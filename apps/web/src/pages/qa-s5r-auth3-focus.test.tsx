import type { User } from '@bms/shared';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import type { SignedInUser } from '../auth';
import { emulateModalDialogs, mockApi, renderApp, signedInAs } from '../test-utils';

// QA rerun gap tests for the AUTH-3 focus fix (75e1d80): on submit, the first invalid field of
// Add user gets focus, whichever fields are invalid, also after the form is closed and reopened.

beforeAll(emulateModalDialogs);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ADMIN: SignedInUser = { id: 'u0', name: 'Ma. Teresa Lim', username: 'tlim', role: 'ADMIN' };
const TERESA: User = { ...ADMIN, active: true };

function fakeApi() {
  return mockApi((method, path) => {
    if (path === '/auth/me') return signedInAs(ADMIN);
    if (method === 'GET' && path.startsWith('/users'))
      return { status: 200, body: { data: [TERESA], page: 1, pageSize: 25, total: 1 } };
    throw new Error(`unexpected ${method} ${path}`);
  });
}

async function openAddForm() {
  const user = userEvent.setup();
  renderApp('/users');
  await user.click(await screen.findByRole('button', { name: '+ Add user' }));
  return { user, form: screen.getByRole('form', { name: 'Add user' }) };
}

test('AUTH-3: with only the starting password invalid, the password field gets focus', async () => {
  fakeApi();
  const { user, form } = await openAddForm();
  await user.type(within(form).getByLabelText('Full name'), 'Bea Navarro');
  await user.type(within(form).getByLabelText('Username'), 'bnavarro');
  await user.selectOptions(within(form).getByLabelText('Role'), 'HANDLER');
  await user.type(within(form).getByLabelText('Starting password'), 'short');
  await user.click(within(form).getByRole('button', { name: 'Create user' }));
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(within(form).getByLabelText('Starting password')),
  );
});

test('AUTH-3: with only Username and the password invalid, Username gets focus', async () => {
  fakeApi();
  const { user, form } = await openAddForm();
  await user.type(within(form).getByLabelText('Full name'), 'Bea Navarro');
  await user.selectOptions(within(form).getByLabelText('Role'), 'HANDLER');
  await user.click(within(form).getByRole('button', { name: 'Create user' }));
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(within(form).getByLabelText('Username')),
  );
});

test('AUTH-3: after closing and reopening Add user, an empty submit focuses Full name', async () => {
  fakeApi();
  const { user } = await openAddForm();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await user.click(screen.getByRole('button', { name: '+ Add user' }));
  const form = screen.getByRole('form', { name: 'Add user' });
  await user.click(within(form).getByRole('button', { name: 'Create user' }));
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(within(form).getByLabelText('Full name')),
  );
});
