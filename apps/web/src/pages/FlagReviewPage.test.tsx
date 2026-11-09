import type { FlaggedLine } from '@bms/shared';
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

// FLG-4: the Flag review screen. The rules themselves are tested in api/flag-override.test.ts.

beforeAll(emulateModalDialogs);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ADMIN: SignedInUser = { id: 'u0', name: 'Ma. Teresa Lim', username: 'tlim', role: 'ADMIN' };
const LINE: FlaggedLine = {
  lineId: 'l1',
  transactionId: 't1',
  borrower: { id: 'b1', schoolId: '2026-0001', name: 'Miguel Bautista' },
  item: { id: 'i1', name: 'Laptop', assetTag: 'LT-0012' },
  issuedAt: '2026-11-02T01:12:00.000Z',
  flaggedAt: '2026-11-02T09:00:00.000Z',
  quantityBorrowed: 1,
  outstanding: 1,
  note: 'Back tomorrow',
  expectedReturnDate: '2026-11-03',
};

function fakeApi(answer?: (method: string, path: string, body: unknown) => object | undefined) {
  return mockApi((method, path, body) => {
    if (path === '/auth/me') return signedInAs(ADMIN);
    const reply = answer?.(method, path, body);
    if (reply) return reply as { status: number; body?: unknown };
    if (method === 'GET' && path.startsWith('/flags')) {
      return { status: 200, body: { data: [LINE], page: 1, pageSize: 25, total: 1 } };
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
}

test('TC-FLG-22: lists borrower, item, note, and expected return date', async () => {
  fakeApi();
  renderApp('/flags');
  const row = await screen.findByRole('row', { name: /Miguel Bautista/ });
  expect(row.textContent).toMatch(/2026-0001/);
  expect(row.textContent).toMatch(/Laptop/);
  expect(row.textContent).toMatch(/Asset tag LT-0012/);
  expect(row.textContent).toMatch(/Back tomorrow/);
  expect(row.textContent).toMatch(/3 Nov 2026/);
  expect(row.textContent).toMatch(/Still out/);
});

test('TC-FLG-23: a short reason is refused on screen and nothing is sent', async () => {
  const fetchMock = fakeApi();
  const user = userEvent.setup();
  renderApp('/flags');
  await user.click(await screen.findByRole('button', { name: /Override flag for Miguel/ }));
  const dialog = await screen.findByRole('dialog');
  await user.type(within(dialog).getByLabelText(/Reason/), 'ok');
  await user.click(within(dialog).getByRole('button', { name: 'Override flag' }));
  expect(await within(dialog).findByText('Enter a reason of at least 5 characters.')).toBeTruthy();
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});

test('TC-FLG-24: overriding sends the reason, confirms, and reloads the list', async () => {
  let overridden = false;
  const fetchMock = fakeApi((method, path, body) => {
    if (method === 'POST') {
      expect(path).toBe('/flags/l1/override');
      expect(body).toEqual({ reason: 'Approved by Prof. Aquino' });
      overridden = true;
      return { status: 200, body: { line: {} } };
    }
    if (overridden) return { status: 200, body: { data: [], page: 1, pageSize: 25, total: 0 } };
  });
  const user = userEvent.setup();
  renderApp('/flags');
  await user.click(await screen.findByRole('button', { name: /Override flag for Miguel/ }));
  const dialog = await screen.findByRole('dialog');
  await user.type(within(dialog).getByLabelText(/Reason/), 'Approved by Prof. Aquino');
  await user.click(within(dialog).getByRole('button', { name: 'Override flag' }));
  expect(await screen.findByText(/Flag overridden/)).toBeTruthy();
  expect(await screen.findByText('No flagged lines. Nothing needs review.')).toBeTruthy();
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});

test('an API refusal (line already overridden) shows the message and reloads', async () => {
  fakeApi((method) =>
    method === 'POST'
      ? {
          status: 409,
          body: apiError('LINE_NOT_FLAGGED', 'Only a flagged line can be overridden.'),
        }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/flags');
  await user.click(await screen.findByRole('button', { name: /Override flag for Miguel/ }));
  const dialog = await screen.findByRole('dialog');
  await user.type(within(dialog).getByLabelText(/Reason/), 'valid reason');
  await user.click(within(dialog).getByRole('button', { name: 'Override flag' }));
  expect(await screen.findByText('Only a flagged line can be overridden.')).toBeTruthy();
});

test('the menu shows Flag review to admins only; a handler sees the not-allowed page', async () => {
  mockApi((method, path) => {
    if (path === '/auth/me') return signedInAs(HANDLER);
    throw new Error(`unexpected ${method} ${path}`);
  });
  renderApp('/flags');
  expect(await screen.findByText(/does not have access to/)).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Flag review' })).toBeNull();
});
