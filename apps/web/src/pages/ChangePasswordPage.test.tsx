import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { RequireRole } from '../App';
import { AuthProvider, createQueryClient } from '../auth';
import { apiError, HANDLER, mockApi, renderApp, signedInAs } from '../test-utils';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function fillForm(current: string, newPassword: string, confirm: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Current password'), current);
  await user.type(screen.getByLabelText('New password'), newPassword);
  await user.type(screen.getByLabelText('Confirm new password'), confirm);
  await user.click(screen.getByRole('button', { name: 'Change password' }));
}

const passwordRequests = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.filter(([url]) => url === '/api/auth/password');

test('the password rule from ARCHITECTURE.md 5 is shown, and a short password is refused in the browser', async () => {
  const fetchMock = mockApi(() => signedInAs(HANDLER));
  renderApp('/password');

  expect(
    await screen.findByText('At least 10 characters. Spaces and any characters are allowed.'),
  ).toBeTruthy();
  await fillForm('old-password-1', 'short', 'short');

  expect(await screen.findByText('Too short: 5 of at least 10 characters.')).toBeTruthy();
  expect(passwordRequests(fetchMock)).toHaveLength(0);
});

test('the two new passwords must match, checked in the browser only', async () => {
  const fetchMock = mockApi(() => signedInAs(HANDLER));
  renderApp('/password');

  await fillForm('old-password-1', 'a longer phrase', 'a longer phrasf');

  expect(await screen.findByText('The two new passwords do not match.')).toBeTruthy();
  expect(passwordRequests(fetchMock)).toHaveLength(0);
});

test('a valid change sends only the current and new password, then confirms and clears the form', async () => {
  const fetchMock = mockApi((method, path) => {
    if (path === '/auth/me') return signedInAs(HANDLER);
    if (method === 'PUT' && path === '/auth/password') return { status: 204 };
    throw new Error(`unexpected ${method} ${path}`);
  });
  renderApp('/password');

  await fillForm('old-password-1', 'a longer phrase', 'a longer phrase');

  expect((await screen.findByRole('status')).textContent).toBe('Password changed.');
  const [[, init]] = passwordRequests(fetchMock);
  expect(JSON.parse(init!.body as string)).toEqual({
    currentPassword: 'old-password-1',
    newPassword: 'a longer phrase',
  });
  expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe('');
});

test('a wrong current password from the API shows next to the current password field', async () => {
  mockApi((method, path) => {
    if (path === '/auth/me') return signedInAs(HANDLER);
    return {
      status: 400,
      body: apiError('VALIDATION_ERROR', 'The current password is incorrect.', {
        fields: { currentPassword: ['The current password is incorrect.'] },
      }),
    };
  });
  renderApp('/password');

  await fillForm('wrong-password', 'a longer phrase', 'a longer phrase');

  const message = await screen.findByText('The current password is incorrect.');
  expect(screen.getByLabelText('Current password').getAttribute('aria-describedby')).toBe(
    message.id,
  );
});

test('a 401 (session expired) returns the user to the login page', async () => {
  let signedIn = true;
  mockApi((method, path) => {
    if (path === '/auth/me' && signedIn) return signedInAs(HANDLER);
    signedIn = false;
    return { status: 401, body: apiError('UNAUTHENTICATED', 'Please sign in.') };
  });
  const router = renderApp('/password');

  await fillForm('old-password-1', 'a longer phrase', 'a longer phrase');

  expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
  expect(router.state.location.pathname).toBe('/login');
});

test('a role that may not open a page sees the "not allowed" page (SPEC.md 3)', async () => {
  mockApi(() => signedInAs({ ...HANDLER, name: 'Ana Reyes', role: 'VIEWER' }));
  const router = createMemoryRouter([
    {
      path: '/',
      element: (
        <RequireRole roles={['ADMIN', 'HANDLER']} pageName="Checkout">
          <p>Checkout screen</p>
        </RequireRole>
      ),
    },
  ]);
  render(
    <QueryClientProvider client={createQueryClient()}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );

  expect(await screen.findByRole('heading', { name: "You can't open this page" })).toBeTruthy();
  expect(screen.getByText(/Your role, View-only, does not have access to/)).toBeTruthy();
  expect(screen.queryByText('Checkout screen')).toBeNull();
});
