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
  strikes: 3,
  note: 'Back tomorrow',
  expectedReturnDate: '2026-11-03',
};

function fakeApi(answer?: (method: string, path: string, body: unknown) => object | undefined) {
  return mockApi((method, path, body) => {
    if (path === '/auth/me') return signedInAs(ADMIN);
    const reply = answer?.(method, path, body);
    if (reply) return reply as { status: number; body?: unknown };
    if (method === 'GET' && path.startsWith('/flags')) {
      return {
        status: 200,
        body: { data: [LINE], page: 1, pageSize: 25, total: 1, blockThreshold: 5 },
      };
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
      return { status: 200, body: { line: { strikes: 2 } } };
    }
    if (overridden)
      return {
        status: 200,
        body: { data: [], page: 1, pageSize: 25, total: 0, blockThreshold: 5 },
      };
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

test('TC-FLG-39: shows Issued in Manila time and strikes, blocked at the threshold', async () => {
  fakeApi((method, path) =>
    method === 'GET' && path.startsWith('/flags')
      ? {
          status: 200,
          body: {
            data: [
              LINE,
              {
                ...LINE,
                lineId: 'l2',
                borrower: { ...LINE.borrower, name: 'Carlo Dizon' },
                strikes: 5,
              },
            ],
            page: 1,
            pageSize: 25,
            total: 2,
            blockThreshold: 5,
          },
        }
      : undefined,
  );
  renderApp('/flags');
  const miguel = await screen.findByRole('row', { name: /Miguel Bautista/ });
  expect(miguel.textContent).toMatch(/3 strikes(?! · blocked)/);
  expect(miguel.textContent).toMatch(/2 Nov, 09:12/); // issued 01:12 UTC is 09:12 in Manila
  expect(screen.getByRole('row', { name: /Carlo Dizon/ }).textContent).toMatch(
    /5 strikes · blocked/,
  );
});

test('TC-FLG-24: the success message says how many strikes the borrower now has', async () => {
  fakeApi((method) =>
    method === 'POST' ? { status: 200, body: { line: { strikes: 1 } } } : undefined,
  );
  const user = userEvent.setup();
  renderApp('/flags');
  await user.click(await screen.findByRole('button', { name: /Override flag for Miguel/ }));
  const dialog = await screen.findByRole('dialog');
  // The submit button is the danger red, not the green primary.
  expect(within(dialog).getByRole('button', { name: 'Override flag' }).className).toMatch(
    /bg-danger/,
  );
  await user.type(within(dialog).getByLabelText(/Reason/), 'valid reason');
  await user.click(within(dialog).getByRole('button', { name: 'Override flag' }));
  expect(
    await screen.findByText(
      "Flag overridden. Miguel Bautista's Laptop line no longer counts. Miguel Bautista now has 1 strike.",
    ),
  ).toBeTruthy();
});

test('TC-FLG-40: after an override, focus goes to the search field', async () => {
  let overridden = false;
  fakeApi((method) => {
    if (method === 'POST') {
      overridden = true;
      return { status: 200, body: { line: { strikes: 2 } } };
    }
    // The row is gone after the reload, as in real use.
    return overridden
      ? { status: 200, body: { data: [], page: 1, pageSize: 25, total: 0, blockThreshold: 5 } }
      : undefined;
  });
  const user = userEvent.setup();
  renderApp('/flags');
  await user.click(await screen.findByRole('button', { name: /Override flag for Miguel/ }));
  const dialog = await screen.findByRole('dialog');
  await user.type(within(dialog).getByLabelText(/Reason/), 'valid reason');
  await user.click(within(dialog).getByRole('button', { name: 'Override flag' }));
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(screen.getByLabelText('Borrower or item')),
  );
});

test('TC-FLG-40: after a failed load and Retry, focus goes to the search field', async () => {
  let fail = true;
  fakeApi((method) =>
    method === 'GET' && fail
      ? { status: 500, body: apiError('INTERNAL', 'Something went wrong. Try again.') }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/flags');
  expect(await screen.findByText('Something went wrong. Try again.')).toBeTruthy();
  fail = false;
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(screen.getByLabelText('Borrower or item')),
  );
});

test('TC-FLG-36: a too-broad search shows the message with no Retry button', async () => {
  fakeApi((method, path) =>
    method === 'GET' && path.includes('q=')
      ? {
          status: 422,
          body: apiError(
            'SEARCH_TOO_BROAD',
            'Too many borrowers have flagged lines; search by item or asset tag.',
          ),
        }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/flags');
  await user.type(await screen.findByLabelText('Borrower or item'), 'Smith');
  await user.click(screen.getByRole('button', { name: 'Search' }));
  expect(
    await screen.findByText('Too many borrowers have flagged lines; search by item or asset tag.'),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
});

test('TC-FLG-41: Run flagging now asks first, runs, and shows the refusal within a minute', async () => {
  let runs = 0;
  const fetchMock = fakeApi((method, path) => {
    if (path === '/flagging/run') {
      runs += 1;
      return runs === 1
        ? { status: 200, body: { run: { flagged: 3, skipped: false } } }
        : {
            status: 429,
            body: apiError('RATE_LIMITED', 'Too many requests. Try again later.'),
            headers: { 'Retry-After': '38' },
          };
    }
    return undefined;
  });
  const user = userEvent.setup();
  renderApp('/flags');
  await user.click(await screen.findByRole('button', { name: 'Run flagging now' }));
  // Cancel sends nothing.
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }),
  );
  expect(fetchMock.mock.calls.some(([url]) => url === '/api/flagging/run')).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Run flagging now' }));
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Run flagging' }),
  );
  expect(await screen.findByText('Flagging run finished. 3 lines flagged.')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Run flagging now' }));
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Run flagging' }),
  );
  expect(
    await screen.findByText('Flagging was run less than a minute ago. Try again in 38 seconds.'),
  ).toBeTruthy();
});
