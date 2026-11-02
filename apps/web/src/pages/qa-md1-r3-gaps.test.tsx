import type { Category } from '@bms/shared';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import type { SignedInUser } from '../auth';
import { apiError, emulateModalDialogs, mockApi, renderApp, signedInAs } from '../test-utils';

// QA round 3 gap tests for MD-1. Gaps 1 and 2 were fixed after manual QA; the tests check the fix.

beforeAll(emulateModalDialogs);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ADMIN: SignedInUser = { id: 'u0', name: 'Ma. Teresa Lim', username: 'tlim', role: 'ADMIN' };
const AUDIO: Category = { id: 'c1', name: 'Audio', itemCount: 0 };
const LAPTOPS: Category = { id: 'c2', name: 'Laptops', itemCount: 14 };

const page = (data: Category[], p = 1, total = data.length) => ({
  status: 200,
  body: { data, page: p, pageSize: 25, total },
});

function api(other: (method: string, path: string, body: unknown) => object) {
  return mockApi((method, path, body) => {
    if (path === '/auth/me') return signedInAs(ADMIN);
    return other(method, path, body) as { status: number; body?: unknown };
  });
}

const puts = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT');

test('TC-MD-25: an unreachable API (fetch rejects) shows the error and Retry, not the empty state', async () => {
  let down = true;
  mockApi((_method, path) => {
    if (path === '/auth/me') return signedInAs(ADMIN);
    if (down) throw new TypeError('Failed to fetch');
    return page([AUDIO]);
  });
  const user = userEvent.setup();
  renderApp('/inventory?tab=categories');

  expect(await screen.findByText(/Could not reach the server/)).toBeTruthy();
  expect(screen.queryByText('No categories yet.')).toBeNull();
  expect(screen.queryByText(/Showing/)).toBeNull();

  // A Retry that fails again keeps the error and the button.
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();

  down = false;
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('row', { name: /Audio 0/ })).toBeTruthy();
});

test('TC-MD-26 keyboard only: Enter opens Rename, Escape closes without saving and focus returns; in-use Delete is reachable and inert', async () => {
  const fetchMock = api((method) => (method === 'GET' ? page([AUDIO, LAPTOPS]) : { status: 500 }));
  const user = userEvent.setup();
  renderApp('/inventory?tab=categories');

  const rename = await screen.findByRole('button', { name: 'Rename Audio' });
  rename.focus();
  await user.keyboard('{Enter}');
  const dialog = screen.getByRole('dialog', { name: 'Rename Audio' });
  const field = within(dialog).getByLabelText('New name') as HTMLInputElement;
  expect(document.activeElement).toBe(field);
  expect(field.value).toBe('Audio');
  await user.type(field, 'X');

  // jsdom does not turn Escape into the dialog "cancel" event; a browser does.
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(rename);
  expect(puts(fetchMock)).toEqual([]);

  // Tab from Rename Laptops reaches its Delete, which does nothing on Enter or Space.
  screen.getByRole('button', { name: 'Rename Laptops' }).focus();
  await user.tab();
  const del = screen.getByRole('button', { name: 'Delete Laptops' });
  expect(document.activeElement).toBe(del);
  await user.keyboard('{Enter}');
  await user.keyboard(' ');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(del.getAttribute('aria-describedby')).toBeTruthy();
});

test('a same-name rename padded with spaces sends the trimmed name, closes the dialog, and shows no toast', async () => {
  const fetchMock = api((method) =>
    method === 'GET' ? page([AUDIO]) : { status: 200, body: { category: AUDIO } },
  );
  const user = userEvent.setup();
  renderApp('/inventory?tab=categories');

  await user.click(await screen.findByRole('button', { name: 'Rename Audio' }));
  const field = screen.getByLabelText('New name');
  await user.clear(field);
  await user.type(field, '  Audio  {Enter}');

  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(puts(fetchMock).map(([, init]) => JSON.parse(init!.body as string))).toEqual([
    { name: 'Audio' },
  ]);
  // Nothing changed, so nothing is confirmed.
  expect(screen.queryByText(/renamed to/)).toBeNull();
});

test('rename NOT_FOUND (deleted by someone else while the dialog is open) shows the message, closes the dialog and reloads', async () => {
  let loads = 0;
  api((method) => {
    if (method === 'GET') {
      loads++;
      return page([AUDIO]);
    }
    return { status: 404, body: apiError('NOT_FOUND', 'Category not found.') };
  });
  const user = userEvent.setup();
  renderApp('/inventory?tab=categories');

  await user.click(await screen.findByRole('button', { name: 'Rename Audio' }));
  const field = screen.getByLabelText('New name');
  await user.clear(field);
  await user.type(field, 'Sound{Enter}');

  expect(await screen.findByText('Category not found.')).toBeTruthy();
  expect(screen.queryByRole('dialog', { name: 'Rename Audio' })).toBeNull();
  await vi.waitFor(() => expect(loads).toBe(2));
});

test('paging on the Inventory page loads the next page and moves focus to the table', async () => {
  const many = Array.from({ length: 30 }, (_, i) => ({
    id: `c${i}`,
    name: `Cat ${String(i).padStart(2, '0')}`,
    itemCount: 0,
  }));
  api((method, path) => {
    const p = Number(new URL(path, 'http://x').searchParams.get('page'));
    return p === 2 ? page(many.slice(25), 2, 30) : page(many.slice(0, 25), 1, 30);
  });
  const user = userEvent.setup();
  renderApp('/inventory?tab=categories');

  await screen.findByRole('row', { name: /Cat 00/ });
  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByRole('row', { name: /Cat 29/ })).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole('table', { name: 'Categories' }));
  expect(screen.getByText('Showing 26–30 of 30')).toBeTruthy();
});
