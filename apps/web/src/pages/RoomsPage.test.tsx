import type { Room } from '@bms/shared';
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

// MD-3: the Rooms and labs screen. The rules themselves are tested in api/rooms.test.ts.

beforeAll(emulateModalDialogs);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ADMIN: SignedInUser = { id: 'u0', name: 'Ma. Teresa Lim', username: 'tlim', role: 'ADMIN' };
const by = { id: 'u0', name: 'Ma. Teresa Lim' };
// 16:30 UTC on 9 Aug is 00:30 on 10 Aug in Manila: the date shows in the app timezone.
const CL201: Room = {
  id: 'r1',
  name: 'CL-201',
  active: true,
  createdBy: by,
  createdAt: '2026-08-09T16:30:00.000Z',
  transactionCount: 3,
};
const CL108: Room = { ...CL201, id: 'r2', name: 'CL-108', active: false, transactionCount: 0 };

function fakeApi(answer?: (method: string, path: string, body: unknown) => object | undefined) {
  return mockApi((method, path, body) => {
    if (path === '/auth/me') return signedInAs(ADMIN);
    const reply = answer?.(method, path, body);
    if (reply) return reply as { status: number; body?: unknown };
    if (method === 'GET' && path.startsWith('/rooms')) {
      return { status: 200, body: { data: [CL108, CL201], page: 1, pageSize: 25, total: 2 } };
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
}

const changeRequests = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls
    .filter(([url, init]) => url.startsWith('/api/rooms') && init?.method !== 'GET')
    .map(([url, init]) => [init!.method, url, init!.body && JSON.parse(init!.body as string)]);

test('lists rooms with who added them, when, and status; a room in use cannot be deleted (BR 15)', async () => {
  const fetchMock = fakeApi();
  const user = userEvent.setup();
  renderApp('/rooms');

  const table = await screen.findByRole('table', { name: 'Rooms and labs' });
  const used = await within(table).findByRole('row', {
    name: /CL-201 Ma\. Teresa Lim 10 Aug 2026 Active/,
  });
  const deleteUsed = within(used).getByRole('button', { name: 'Delete CL-201' });
  expect(deleteUsed.getAttribute('aria-disabled')).toBe('true');
  expect(document.getElementById(deleteUsed.getAttribute('aria-describedby')!)!.textContent).toBe(
    'Used in 3 transactions',
  );
  await user.click(deleteUsed);
  expect(screen.queryByRole('dialog')).toBeNull();

  const unused = within(table).getByRole('row', { name: /CL-108 .* Inactive/ });
  expect(within(unused).getByRole('button', { name: 'Reactivate CL-108' })).toBeTruthy();
  expect(changeRequests(fetchMock)).toEqual([]);
});

test('a failed list load shows the error and a Retry button, not the empty state', async () => {
  let fail = true;
  fakeApi((method) =>
    method === 'GET' && fail
      ? { status: 500, body: apiError('INTERNAL', 'Something went wrong. Try again.') }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/rooms');

  expect(await screen.findByText('Something went wrong. Try again.')).toBeTruthy();
  expect(screen.queryByText('No rooms or labs yet. Add the first one above.')).toBeNull();
  expect(screen.queryByText(/Showing/)).toBeNull();

  fail = false;
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('table', { name: 'Rooms and labs' })).toBeTruthy();
  // The Retry button is gone, so focus goes to the name field instead of the page start.
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(screen.getByLabelText('New room or lab name')),
  );
});

test('TC-MD-11: a duplicate name shows the API message under the field', async () => {
  const message = '"CL-201" already exists. Names are compared without regard to case.';
  const fetchMock = fakeApi((method) =>
    method === 'POST'
      ? { status: 409, body: apiError('DUPLICATE_VALUE', message, { fields: { name: [message] } }) }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/rooms');

  await user.type(await screen.findByLabelText('New room or lab name'), 'cl-201');
  await user.click(screen.getByRole('button', { name: 'Add room or lab' }));
  expect(await screen.findByText(message)).toBeTruthy();
  expect(screen.getByLabelText('New room or lab name').getAttribute('aria-invalid')).toBe('true');
  expect(changeRequests(fetchMock)).toEqual([['POST', '/api/rooms', { name: 'cl-201' }]]);
});

test('TC-MD-09: rename opens a dialog from the row; Deactivate and Delete send their requests', async () => {
  const fetchMock = fakeApi((method, _path, body) => {
    if (method === 'PATCH')
      return { status: 200, body: { room: { ...CL201, ...(body as object) } } };
    if (method === 'DELETE') return { status: 204 };
    return undefined;
  });
  const user = userEvent.setup();
  renderApp('/rooms');

  await user.click(await screen.findByRole('button', { name: 'Rename CL-201' }));
  const dialog = screen.getByRole('dialog', { name: 'Rename CL-201' });
  const field = within(dialog).getByLabelText('New name');
  await user.clear(field);
  await user.type(field, 'CL-202');
  await user.click(within(dialog).getByRole('button', { name: 'Save name' }));
  expect(await screen.findByText('Room "CL-201" renamed to "CL-202".')).toBeTruthy();

  await user.click(screen.getByRole('button', { name: 'Deactivate CL-201' }));
  expect(await screen.findByText('Room "CL-201" deactivated.')).toBeTruthy();

  await user.click(screen.getByRole('button', { name: 'Delete CL-108' }));
  const confirm = screen.getByRole('dialog', { name: 'Delete room?' });
  await user.click(within(confirm).getByRole('button', { name: 'Delete room' }));
  expect(await screen.findByText('Room "CL-108" deleted.')).toBeTruthy();

  expect(changeRequests(fetchMock)).toEqual([
    ['PATCH', '/api/rooms/r1', { name: 'CL-202' }],
    ['PATCH', '/api/rooms/r1', { active: false }],
    ['DELETE', '/api/rooms/r2', undefined],
  ]);
});

test('the screen is in the admin menu only; a handler gets the not-allowed page (SPEC 3)', async () => {
  fakeApi();
  renderApp('/');
  const menu = await screen.findByRole('navigation', { name: 'Main' });
  expect(within(menu).getByRole('link', { name: 'Rooms and labs' })).toBeTruthy();
  cleanup();

  mockApi((_method, path) => {
    if (path === '/auth/me') return signedInAs(HANDLER);
    throw new Error(`unexpected request ${path}`);
  });
  renderApp('/rooms');
  expect(await screen.findByRole('heading', { name: "You can't open this page" })).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Rooms and labs' })).toBeNull();
});
