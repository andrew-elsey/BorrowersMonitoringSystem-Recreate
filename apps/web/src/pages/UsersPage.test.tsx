import type { User } from '@bms/shared';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import type { SignedInUser } from '../auth';
import {
  apiError,
  emulateModalDialogs,
  HANDLER,
  mockApi,
  renderApp,
  signedInAs,
} from '../test-utils';

// AUTH-3: the Users screen. TC-AUTH-19, TC-AUTH-21, and TC-AUTH-22 in TEST_CASES.md.

beforeAll(emulateModalDialogs);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ADMIN: SignedInUser = { id: 'u0', name: 'Ma. Teresa Lim', username: 'tlim', role: 'ADMIN' };
const TERESA: User = { ...ADMIN, active: true };
const JUAN: User = { ...HANDLER, active: true };
const RAMON: User = {
  id: 'u4',
  name: 'Ramon Cruz',
  username: 'rcruz',
  role: 'HANDLER',
  active: false,
};

type Reply = { status: number; body?: unknown };

// A fake API holding the users list. `answer` overrides any users request.
function fakeApi(
  answer?: (method: string, path: string, body: unknown) => Reply | undefined,
  me: SignedInUser = ADMIN,
) {
  return mockApi((method, path, body) => {
    if (path === '/auth/me') return signedInAs(me);
    const reply = answer?.(method, path, body);
    if (reply) return reply;
    if (method === 'GET' && path.startsWith('/users')) {
      return {
        status: 200,
        body: { data: [TERESA, JUAN, RAMON], page: 1, pageSize: 25, total: 3 },
      };
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
}

const requests = (fetchMock: ReturnType<typeof mockApi>, method: string) =>
  fetchMock.mock.calls
    .filter(([url, init]) => url.startsWith('/api/users') && init?.method === method)
    .map(([url, init]) => [url, init!.body && JSON.parse(init!.body as string)]);

test('lists users with role, status, and the signed-in admin marked "(you)"', async () => {
  fakeApi();
  renderApp('/users');
  const table = await screen.findByRole('table', { name: 'Users' });
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent),
  ).toEqual(['Name', 'Username', 'Role', 'Status', 'Actions']);
  const teresa = await within(table).findByRole('row', { name: /Ma\. Teresa Lim/ });
  expect(teresa.textContent).toMatch(/^Ma\. Teresa Lim \(you\)tlimAdminActive/);
  const ramon = within(table).getByRole('row', { name: /Ramon Cruz rcruz Handler Inactive/ });
  expect(within(ramon).getByRole('button', { name: 'Reactivate Ramon Cruz' })).toBeTruthy();
  expect(within(ramon).getByRole('button', { name: 'Reset password for Ramon Cruz' })).toBeTruthy();
  // BR 15: there is no Delete.
  expect(within(table).queryByRole('button', { name: /Delete/ })).toBeNull();
  // The menu has the Users screen for an admin.
  expect(screen.getByRole('link', { name: 'Users' })).toBeTruthy();
});

test('TC-AUTH-19: "+ Add user" opens the form; a short password is refused in the browser; creating sends the four fields', async () => {
  const fetchMock = fakeApi((method, _path, body) => {
    if (method !== 'POST') return undefined;
    const { name, username, role } = body as Record<string, string>;
    return { status: 201, body: { user: { id: 'u9', name, username, role, active: true } } };
  });
  const user = userEvent.setup();
  renderApp('/users');
  expect(screen.queryByRole('form', { name: 'Add user' })).toBeNull();
  await user.click(await screen.findByRole('button', { name: '+ Add user' }));
  const form = screen.getByRole('form', { name: 'Add user' });
  expect(document.activeElement).toBe(within(form).getByLabelText('Full name'));
  expect(within(form).getByText(/Tell the user this password/)).toBeTruthy();

  await user.type(within(form).getByLabelText('Full name'), 'Bea Navarro');
  await user.type(within(form).getByLabelText('Username'), 'bnavarro');
  await user.selectOptions(within(form).getByLabelText('Role'), 'Handler');
  await user.type(within(form).getByLabelText('Starting password'), 'short');
  await user.click(within(form).getByRole('button', { name: 'Create user' }));
  expect(await within(form).findByText('Too short: 5 of at least 10 characters.')).toBeTruthy();
  expect(requests(fetchMock, 'POST')).toEqual([]);

  await user.type(within(form).getByLabelText('Starting password'), '-but-longer');
  await user.click(within(form).getByRole('button', { name: 'Create user' }));
  expect(
    await screen.findByText('User Bea Navarro added. Tell them their starting password.'),
  ).toBeTruthy();
  expect(requests(fetchMock, 'POST')).toEqual([
    [
      '/api/users',
      { name: 'Bea Navarro', username: 'bnavarro', role: 'HANDLER', password: 'short-but-longer' },
    ],
  ]);
  expect((within(form).getByLabelText('Full name') as HTMLInputElement).value).toBe('');

  // Cancel closes the form and puts focus back on the button that opened it.
  await user.click(within(form).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('form', { name: 'Add user' })).toBeNull();
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '+ Add user' })),
  );
});

test('TC-AUTH-19: submitting Add user with errors focuses the first invalid field (card JITzLaQx)', async () => {
  fakeApi();
  const user = userEvent.setup();
  renderApp('/users');
  await user.click(await screen.findByRole('button', { name: '+ Add user' }));
  const form = screen.getByRole('form', { name: 'Add user' });
  await user.click(within(form).getByRole('button', { name: 'Create user' }));
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(within(form).getByLabelText('Full name')),
  );

  // Only the later fields invalid: focus goes to the first of those, Role.
  await user.type(within(form).getByLabelText('Full name'), 'Bea Navarro');
  await user.type(within(form).getByLabelText('Username'), 'bnavarro');
  await user.click(within(form).getByRole('button', { name: 'Create user' }));
  await vi.waitFor(() => expect(document.activeElement).toBe(within(form).getByLabelText('Role')));
});

test('a taken username shows under the Username field', async () => {
  fakeApi((method) =>
    method === 'POST'
      ? {
          status: 409,
          body: apiError('DUPLICATE_VALUE', 'Taken.', {
            fields: { username: ['The username "jdelacruz" is already taken.'] },
          }),
        }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/users');
  await user.click(await screen.findByRole('button', { name: '+ Add user' }));
  const form = screen.getByRole('form', { name: 'Add user' });
  await user.type(within(form).getByLabelText('Full name'), 'Juan');
  await user.type(within(form).getByLabelText('Username'), 'jdelacruz');
  await user.selectOptions(within(form).getByLabelText('Role'), 'Admin');
  await user.type(within(form).getByLabelText('Starting password'), 'long-enough-1');
  await user.click(within(form).getByRole('button', { name: 'Create user' }));
  expect(await within(form).findByText('The username "jdelacruz" is already taken.')).toBeTruthy();
  expect(document.activeElement).toBe(within(form).getByLabelText('Username'));
});

test('TC-AUTH-19: Edit opens a dialog filled from the row; saving sends only name, username, and role', async () => {
  const fetchMock = fakeApi((method, _path, body) =>
    method === 'PATCH'
      ? { status: 200, body: { user: { ...JUAN, ...(body as object) } } }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/users');
  await user.click(await screen.findByRole('button', { name: 'Edit Juan dela Cruz' }));
  const dialog = screen.getByRole('dialog', { name: 'Edit Juan dela Cruz' });
  expect((within(dialog).getByLabelText('Username') as HTMLInputElement).value).toBe('jdelacruz');
  await user.selectOptions(within(dialog).getByLabelText('Role'), 'View-only');
  await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('Changes to Juan dela Cruz saved.')).toBeTruthy();
  expect(requests(fetchMock, 'PATCH')).toEqual([
    ['/api/users/u1', { name: 'Juan dela Cruz', username: 'jdelacruz', role: 'VIEWER' }],
  ]);
});

test('TC-AUTH-39: editing your own row shows your role locked and never sends it', async () => {
  const fetchMock = fakeApi((method, _path, body) =>
    method === 'PATCH'
      ? { status: 200, body: { user: { ...TERESA, ...(body as object) } } }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/users');
  await user.click(await screen.findByRole('button', { name: 'Edit Ma. Teresa Lim' }));
  const dialog = screen.getByRole('dialog', { name: 'Edit Ma. Teresa Lim' });
  const role = within(dialog).getByLabelText('Role') as HTMLSelectElement;
  expect(role.disabled).toBe(true);
  expect(role.value).toBe('ADMIN');
  expect(
    within(dialog).getByText('You cannot change your own role. Ask another admin to do it.'),
  ).toBeTruthy();
  await user.clear(within(dialog).getByLabelText('Full name'));
  await user.type(within(dialog).getByLabelText('Full name'), 'Teresa Lim');
  await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('Changes to Teresa Lim saved.')).toBeTruthy();
  expect(requests(fetchMock, 'PATCH')).toEqual([
    ['/api/users/u0', { name: 'Teresa Lim', username: 'tlim' }],
  ]);
  // Someone else's role can still be chosen.
  await user.click(screen.getByRole('button', { name: 'Edit Juan dela Cruz' }));
  const other = screen.getByRole('dialog', { name: 'Edit Juan dela Cruz' });
  expect((within(other).getByLabelText('Role') as HTMLSelectElement).disabled).toBe(false);
});

test('TC-AUTH-19: Reset password sends the new password and says to tell the user', async () => {
  const fetchMock = fakeApi((method) => (method === 'PUT' ? { status: 204 } : undefined));
  const user = userEvent.setup();
  renderApp('/users');
  await user.click(
    await screen.findByRole('button', { name: 'Reset password for Juan dela Cruz' }),
  );
  const dialog = screen.getByRole('dialog', { name: 'Reset password for Juan dela Cruz' });
  await user.click(within(dialog).getByRole('button', { name: 'Reset password' }));
  expect(await within(dialog).findByText('Too short: 0 of at least 10 characters.')).toBeTruthy();
  await user.type(within(dialog).getByLabelText('New password'), 'fresh-pass-42');
  await user.click(within(dialog).getByRole('button', { name: 'Reset password' }));
  expect(
    await screen.findByText(
      'Password reset for Juan dela Cruz. Tell them the new password. They can change it on the Change password screen.',
    ),
  ).toBeTruthy();
  expect(requests(fetchMock, 'PUT')).toEqual([
    ['/api/users/u1/password', { password: 'fresh-pass-42' }],
  ]);
});

test('TC-AUTH-21: deactivating your own account shows the refusal from the server', async () => {
  const fetchMock = fakeApi((method) =>
    method === 'PATCH'
      ? {
          status: 409,
          body: apiError(
            'CANNOT_DEACTIVATE_SELF',
            'You cannot deactivate your own account. Ask another admin to do it.',
          ),
        }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/users');
  await user.click(await screen.findByRole('button', { name: 'Deactivate Ma. Teresa Lim' }));
  expect(
    await screen.findByText('You cannot deactivate your own account. Ask another admin to do it.'),
  ).toBeTruthy();
  expect(requests(fetchMock, 'PATCH')).toEqual([['/api/users/u0', { active: false }]]);
});

test('Deactivate and Reactivate send active and confirm', async () => {
  const fetchMock = fakeApi((method, _path, body) =>
    method === 'PATCH'
      ? { status: 200, body: { user: { ...RAMON, ...(body as object) } } }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/users');
  await user.click(await screen.findByRole('button', { name: 'Reactivate Ramon Cruz' }));
  expect(await screen.findByText('Ramon Cruz reactivated.')).toBeTruthy();
  expect(requests(fetchMock, 'PATCH')).toEqual([['/api/users/u4', { active: true }]]);
});

test('TC-AUTH-22: a handler opening Users sees "Not allowed" and no Users menu item', async () => {
  const fetchMock = fakeApi(undefined, HANDLER);
  renderApp('/users');
  expect(await screen.findByRole('heading', { name: "You can't open this page" })).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Users' })).toBeNull();
  expect(requests(fetchMock, 'GET')).toEqual([]);
});
