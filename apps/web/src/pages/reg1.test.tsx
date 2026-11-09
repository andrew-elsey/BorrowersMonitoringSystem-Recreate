import type { Item } from '@bms/shared';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { apiError, HANDLER, mockApi, renderApp, signedInAs, signedOut } from '../test-utils';

// REG-1: follow-ups from manual regression round 2.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ADMIN = { id: 'u0', name: 'Ma. Teresa Lim', username: 'tlim', role: 'ADMIN' } as const;
const base: Item = {
  id: 'i',
  name: 'x',
  category: { id: 'c', name: 'Cables' },
  description: null,
  trackingType: 'UNIT',
  assetTag: null,
  totalQuantity: 1,
  condition: 'GOOD',
  status: 'ACTIVE',
};
const rows = [
  {
    ...base,
    id: '1',
    name: 'Extension cord',
    trackingType: 'QUANTITY',
    totalQuantity: 20,
    available: 8,
  },
  { ...base, id: '2', name: 'Laptop out', assetTag: 'LT-1', available: 0 },
  { ...base, id: '3', name: 'Laptop in', assetTag: 'LT-2', available: 1 },
  {
    ...base,
    id: '4',
    name: 'Laptop repair',
    assetTag: 'LT-3',
    status: 'UNDER_REPAIR',
    available: 0,
  },
] as const;

function adminApi() {
  return mockApi((method, path) => {
    if (path === '/auth/me') return signedInAs(ADMIN);
    if (path.startsWith('/items')) {
      return { status: 200, body: { data: rows, page: 1, pageSize: 25, total: rows.length } };
    }
    return { status: 200, body: { data: [], page: 1, pageSize: 100, total: 0 } };
  });
}

test('the items table shows Available after Asset tag, worded as in the mockup (TC-MD-34)', async () => {
  adminApi();
  renderApp('/inventory');
  await screen.findByText('Extension cord');
  const table = screen.getByRole('table', { name: 'Items' });
  const headers = within(table)
    .getAllByRole('columnheader')
    .map((h) => h.textContent);
  expect(headers.slice(3, 6)).toEqual(['Asset tag', 'Available', 'Condition']);
  const cell = (name: string) =>
    within(within(table).getByText(name).closest('tr')!).getAllByRole('cell')[4]!.textContent;
  expect(cell('Extension cord')).toBe('8 of 20');
  expect(cell('Laptop out')).toBe('Out');
  expect(cell('Laptop in')).toBe('Available');
  expect(cell('Laptop repair')).toBe('—');
});

test('table names break only inside a too-long word, and the table scrolls inside its own box (TC-MD-35 automated part)', async () => {
  adminApi();
  renderApp('/inventory');
  const name = await screen.findByText('Extension cord');
  expect(name.className).toContain('break-words');
  expect(name.className).toContain('max-w-64'); // browsers ignore break-words alone in a table
  expect(name.className).not.toContain('wrap-anywhere');
  expect(screen.getByRole('table', { name: 'Items' }).parentElement!.className).toContain(
    'overflow-x-auto',
  );
});

test('each page sets its own tab title (TC-FND-31)', async () => {
  mockApi((_m, path) =>
    path === '/auth/me'
      ? signedInAs(HANDLER)
      : { status: 200, body: { data: [], page: 1, pageSize: 25, total: 0 } },
  );
  const router = renderApp('/');
  await waitFor(() => expect(document.title).toBe('Home · Borrowers Monitoring System'));
  await router.navigate('/checkout');
  await waitFor(() => expect(document.title).toBe('Checkout · Borrowers Monitoring System'));
  await router.navigate('/checkout/'); // a trailing slash is the same page
  await waitFor(() => expect(document.title).toBe('Checkout · Borrowers Monitoring System'));
  await router.navigate('/password');
  await waitFor(() => expect(document.title).toBe('Change password · Borrowers Monitoring System'));
  await router.navigate('/inventory'); // a handler may not open it
  await waitFor(() => expect(document.title).toBe('Not allowed · Borrowers Monitoring System'));
  await router.navigate('/nowhere'); // redirects home
  await waitFor(() => expect(document.title).toBe('Home · Borrowers Monitoring System'));
});

test('the sign-in page has its own tab title (TC-FND-31)', async () => {
  mockApi(() => signedOut);
  renderApp('/');
  await screen.findByLabelText('Username');
  expect(document.title).toBe('Sign in · Borrowers Monitoring System');
});

const EXPIRED = 'Your session has expired. Please sign in again.';

test('a 401 on a signed-in session shows the expiry message on the login page (TC-AUTH-37)', async () => {
  let signedIn = true;
  mockApi((_m, path) => {
    if (path === '/auth/me') return signedIn ? signedInAs(HANDLER) : signedOut;
    signedIn = false;
    return { status: 401, body: apiError('UNAUTHENTICATED', 'Please sign in.') };
  });
  renderApp('/checkout');
  expect(await screen.findByText(EXPIRED)).toBeTruthy();
});

test('Sign out does not show the expiry message (TC-AUTH-37)', async () => {
  mockApi((method, path) => {
    if (path === '/auth/me') return signedInAs(HANDLER);
    if (path === '/auth/logout') return { status: 204 };
    return { status: 200, body: { data: [], page: 1, pageSize: 25, total: 0 } };
  });
  renderApp('/');
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Sign out' }));
  await screen.findByLabelText('Username');
  expect(screen.queryByText(EXPIRED)).toBeNull();
});

test('a first visit and a failed login do not show the expiry message (TC-AUTH-37)', async () => {
  mockApi((method, path) =>
    path === '/auth/me'
      ? signedOut
      : { status: 401, body: apiError('INVALID_CREDENTIALS', 'Wrong.') },
  );
  renderApp('/checkout'); // redirected to login with state.from set
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Username'), 'a');
  expect(screen.queryByText(EXPIRED)).toBeNull();
  await user.type(screen.getByLabelText('Password'), 'b');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByText('Wrong.');
  expect(screen.queryByText(EXPIRED)).toBeNull();
});
