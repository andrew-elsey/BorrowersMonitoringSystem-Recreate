import type { Room } from '@bms/shared';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import type { SignedInUser } from '../auth';
import { apiError, emulateModalDialogs, mockApi, renderApp, signedInAs } from '../test-utils';

// QA (automated) gap tests for MD-3, Rooms and labs screen: the inactive-duplicate message in the
// add form and the rename dialog, Reactivate, a delete refused with HAS_HISTORY, a same-name
// rename, and the empty list. TC-MD-09, 11 and 12 in TEST_CASES.md.

beforeAll(emulateModalDialogs);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ADMIN: SignedInUser = { id: 'u0', name: 'Test Admin', username: 'qa-admin', role: 'ADMIN' };
const ACTIVE: Room = {
  id: 'r1',
  name: 'QA-201',
  active: true,
  createdBy: { id: 'u0', name: 'Test Admin' },
  createdAt: '2026-08-10T02:00:00.000Z',
  transactionCount: 0,
};
const INACTIVE: Room = { ...ACTIVE, id: 'r2', name: 'QA-108', active: false };
const INACTIVE_MESSAGE = '"QA-108" exists but is inactive. Reactivate it instead.';
const inactiveDuplicate = {
  status: 409,
  body: apiError('DUPLICATE_VALUE', INACTIVE_MESSAGE, { fields: { name: [INACTIVE_MESSAGE] } }),
};

function fakeApi(
  answer?: (method: string, path: string, body: unknown) => object | undefined,
  rows: Room[] = [INACTIVE, ACTIVE],
) {
  return mockApi((method, path, body) => {
    if (path === '/auth/me') return signedInAs(ADMIN);
    const reply = answer?.(method, path, body);
    if (reply) return reply as { status: number; body?: unknown };
    if (method === 'GET' && path.startsWith('/rooms')) {
      return { status: 200, body: { data: rows, page: 1, pageSize: 25, total: rows.length } };
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
}

const requests = (fetchMock: ReturnType<typeof mockApi>, method: string) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => url.startsWith('/api/rooms') && (init?.method ?? 'GET') === method,
  );

test('the inactive-duplicate message shows under the add field', async () => {
  fakeApi((method) => (method === 'POST' ? inactiveDuplicate : undefined));
  const user = userEvent.setup();
  renderApp('/rooms');
  await user.type(await screen.findByLabelText('New room or lab name'), 'qa-108');
  await user.click(screen.getByRole('button', { name: 'Add room or lab' }));
  expect(await screen.findByText(INACTIVE_MESSAGE)).toBeTruthy();
  expect(screen.getByLabelText('New room or lab name').getAttribute('aria-invalid')).toBe('true');
});

test('a duplicate on rename shows under the dialog field and keeps the dialog open', async () => {
  fakeApi((method) => (method === 'PATCH' ? inactiveDuplicate : undefined));
  const user = userEvent.setup();
  renderApp('/rooms');
  await user.click(await screen.findByRole('button', { name: 'Rename QA-201' }));
  const dialog = screen.getByRole('dialog', { name: 'Rename QA-201' });
  const field = within(dialog).getByLabelText('New name');
  await user.clear(field);
  await user.type(field, 'qa-108');
  await user.click(within(dialog).getByRole('button', { name: 'Save name' }));
  expect(await within(dialog).findByText(INACTIVE_MESSAGE)).toBeTruthy();
  expect(field.getAttribute('aria-invalid')).toBe('true');
  expect(screen.getByRole('dialog', { name: 'Rename QA-201' })).toBeTruthy();
});

test('Reactivate sends active: true and confirms', async () => {
  const fetchMock = fakeApi((method, _path, body) =>
    method === 'PATCH'
      ? { status: 200, body: { room: { ...INACTIVE, ...(body as object) } } }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/rooms');
  await user.click(await screen.findByRole('button', { name: 'Reactivate QA-108' }));
  expect(await screen.findByText('Room "QA-108" reactivated.')).toBeTruthy();
  const [[url, init]] = requests(fetchMock, 'PATCH');
  expect([url, JSON.parse(init!.body as string)]).toEqual(['/api/rooms/r2', { active: true }]);
});

test('a delete refused with HAS_HISTORY shows the message, closes the confirm, and reloads', async () => {
  const message =
    'This room is used in transactions, so it cannot be deleted. Deactivate it instead.';
  const fetchMock = fakeApi((method) =>
    method === 'DELETE' ? { status: 409, body: apiError('HAS_HISTORY', message) } : undefined,
  );
  const user = userEvent.setup();
  renderApp('/rooms');
  await user.click(await screen.findByRole('button', { name: 'Delete QA-201' }));
  const loadsBefore = requests(fetchMock, 'GET').length;
  await user.click(
    within(screen.getByRole('dialog', { name: 'Delete room?' })).getByRole('button', {
      name: 'Delete room',
    }),
  );
  expect(await screen.findByText(message)).toBeTruthy();
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await vi.waitFor(() => expect(requests(fetchMock, 'GET').length).toBeGreaterThan(loadsBefore));
});

test('saving a rename with the same name closes the dialog without a "renamed" message', async () => {
  fakeApi((method) => (method === 'PATCH' ? { status: 200, body: { room: ACTIVE } } : undefined));
  const user = userEvent.setup();
  renderApp('/rooms');
  await user.click(await screen.findByRole('button', { name: 'Rename QA-201' }));
  await user.click(screen.getByRole('button', { name: 'Save name' }));
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.queryByText(/renamed to/)).toBeNull();
});

test('an empty list shows the empty text', async () => {
  fakeApi(undefined, []);
  renderApp('/rooms');
  expect(await screen.findByText('No rooms or labs yet. Add the first one above.')).toBeTruthy();
});
