import type { Borrower } from '@bms/shared';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import type { SignedInUser } from '../auth';
import { apiError, emulateModalDialogs, mockApi, renderApp, signedInAs } from '../test-utils';

// QA gap tests for MD-5 (head cf05cad): error paths of the edit dialog, Deactivate, and search.

beforeAll(emulateModalDialogs);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ADMIN: SignedInUser = { id: 'u0', name: 'Ma. Teresa Lim', username: 'tlim', role: 'ADMIN' };
const CARLO: Borrower = {
  id: 'b1',
  schoolId: '2020-08812',
  name: 'Carlo Dizon',
  type: 'STUDENT',
  department: 'Visual Communication',
  active: true,
};

type Reply = { status: number; body?: unknown };

// Lists Carlo on every GET; `onChange` answers PATCH requests.
function fakeApi(
  onChange: (path: string, body: unknown) => Reply,
  onList?: (path: string) => Reply | undefined,
) {
  return mockApi((method, path, body) => {
    if (path === '/auth/me') return signedInAs(ADMIN);
    if (method === 'PATCH') return onChange(path, body);
    if (method === 'GET' && path.startsWith('/borrowers')) {
      return (
        onList?.(path) ?? { status: 200, body: { data: [CARLO], page: 1, pageSize: 25, total: 1 } }
      );
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
}

const listLoads = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => url.startsWith('/api/borrowers') && init?.method === 'GET',
  ).length;

test('a duplicate school ID on edit shows under School ID in the dialog, which stays open', async () => {
  const message = 'A borrower with school ID "2018-03321" already exists.';
  fakeApi(() => ({
    status: 409,
    body: apiError('DUPLICATE_VALUE', 'Already exists.', { fields: { schoolId: [message] } }),
  }));
  const user = userEvent.setup();
  renderApp('/borrowers');
  await user.click(await screen.findByRole('button', { name: 'Edit Carlo Dizon' }));
  const dialog = screen.getByRole('dialog', { name: 'Edit Carlo Dizon' });
  const schoolId = within(dialog).getByLabelText('School ID');
  await user.clear(schoolId);
  await user.type(schoolId, '2018-03321');
  await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

  expect(await within(dialog).findByText(message)).toBeTruthy();
  expect(document.activeElement).toBe(schoolId);
  expect(screen.getByRole('dialog', { name: 'Edit Carlo Dizon' })).toBe(dialog);
  // The field error is the whole message: no toast repeats it.
  expect(screen.queryByText('Already exists.')).toBeNull();
});

test('NOT_FOUND on edit shows the error, closes the dialog, and reloads the list', async () => {
  const fetchMock = fakeApi(() => ({
    status: 404,
    body: apiError('NOT_FOUND', 'Borrower not found.'),
  }));
  const user = userEvent.setup();
  renderApp('/borrowers');
  await user.click(await screen.findByRole('button', { name: 'Edit Carlo Dizon' }));
  const dialog = screen.getByRole('dialog', { name: 'Edit Carlo Dizon' });
  const loadsBefore = listLoads(fetchMock);
  await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

  expect(await screen.findByText('Borrower not found.')).toBeTruthy();
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await vi.waitFor(() => expect(listLoads(fetchMock)).toBe(loadsBefore + 1));
});

test('a failed Deactivate shows the error as a toast and reloads the list', async () => {
  const fetchMock = fakeApi(() => ({
    status: 500,
    body: apiError('INTERNAL_ERROR', 'The change could not be saved.'),
  }));
  const user = userEvent.setup();
  renderApp('/borrowers');
  const button = await screen.findByRole('button', { name: 'Deactivate Carlo Dizon' });
  const loadsBefore = listLoads(fetchMock);
  await user.click(button);

  expect(await screen.findByText('The change could not be saved.')).toBeTruthy();
  await vi.waitFor(() => expect(listLoads(fetchMock)).toBe(loadsBefore + 1));
  // Nothing changed, so the row still offers Deactivate and no success message appears.
  expect(screen.getByRole('button', { name: 'Deactivate Carlo Dizon' })).toBeTruthy();
  expect(screen.queryByText('Carlo Dizon deactivated.')).toBeNull();
});

test('a search with a control character shows only the list error with Retry, no field error', async () => {
  const message = 'Search text cannot contain control characters.';
  const fetchMock = fakeApi(
    () => ({ status: 500 }),
    (path) =>
      path.includes('q=')
        ? {
            status: 400,
            body: apiError('VALIDATION_ERROR', message, { fields: { q: [message] } }),
          }
        : undefined,
  );
  const user = userEvent.setup();
  renderApp('/borrowers');
  await screen.findByRole('table', { name: 'Borrowers' });
  const search = screen.getByLabelText('Name or school ID');
  await user.click(search);
  await user.paste('Car\u0007lo');

  const alert = await screen.findByRole('alert');
  expect(fetchMock.mock.calls.some(([url]) => url.includes('q=Car%07lo'))).toBe(true);
  expect(alert.textContent).toBe(`${message} Retry`);
  expect(within(alert).getByRole('button', { name: 'Retry' })).toBeTruthy();
  expect(screen.getAllByText(message)).toHaveLength(1);
  expect(screen.queryByRole('table', { name: 'Borrowers' })).toBeNull();
  expect(search.getAttribute('aria-invalid')).not.toBe('true');
});
