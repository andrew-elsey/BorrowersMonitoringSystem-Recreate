import type { Borrower, Item, Room } from '@bms/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { apiError, HANDLER, mockApi, renderApp, signedInAs } from '../test-utils';

// QA (automated) gap tests for BRW-3, the Checkout screen: the due-back "today"/"tomorrow" boundary
// exactly at closing, one minute before, and after midnight (BR 8, S10); error replies the screen
// must still explain (NOT_FOUND, BORROWER_INACTIVE, server-side field errors, 500 without JSON,
// 429, a network failure, an itemId on no line); double submit while a request is pending and a
// retry after a refusal; removing a refused line; and the lookup's search text bounds and encoding.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// Only Date is faked, so user events and timers still run normally.
const setClock = (iso: string) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
};

const BORROWER: Borrower = {
  id: 'b0000000-0000-4000-8000-0000000000a1',
  schoolId: 'QA-0001',
  name: 'Test Borrower',
  type: 'FACULTY',
  department: 'QA Dept',
  active: true,
};
const ROOM: Room = {
  id: 'c0000000-0000-4000-8000-0000000000a1',
  name: 'QA Lab',
  active: true,
  createdBy: { id: 'u0', name: 'QA Admin' },
  createdAt: '2026-08-01T00:00:00.000Z',
  transactionCount: 0,
};
type ListedItem = Item & { available: number };
const UNIT: ListedItem = {
  id: 'd0000000-0000-4000-8000-0000000000a1',
  name: 'QA Projector',
  category: { id: 'k1', name: 'QA Category' },
  description: null,
  trackingType: 'UNIT',
  assetTag: 'QA-PJ-1',
  totalQuantity: 1,
  condition: 'GOOD',
  status: 'ACTIVE',
  available: 1,
};
const SUPPLY: ListedItem = {
  ...UNIT,
  id: 'd0000000-0000-4000-8000-0000000000a2',
  name: 'QA Cord',
  trackingType: 'QUANTITY',
  assetTag: null,
  totalQuantity: 5,
  available: 5,
};
const page = <T,>(data: T[]) => ({
  status: 200,
  body: { data, page: 1, pageSize: 10, total: data.length },
});
const saved = (issuedAt: string) => ({
  status: 201,
  body: {
    transaction: {
      id: 't1',
      borrowerId: BORROWER.id,
      locationId: ROOM.id,
      issuedById: 'u1',
      issuedAt,
      semesterId: 's1',
      lines: [{ id: 'l1' }],
    },
  },
});

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };
// The API with closing time 17:00. `checkout` answers POST /transactions.
function fakeApi(checkout: (body: unknown) => Reply = () => saved('2026-11-05T06:00:00.000Z')) {
  return mockApi((method, path, body) => {
    if (path === '/auth/me') return signedInAs(HANDLER);
    if (method === 'GET' && path.startsWith('/borrowers/lookup?')) return page([BORROWER]);
    if (method === 'GET' && path.startsWith('/rooms')) return page([ROOM]);
    if (method === 'GET' && path.startsWith('/items?')) return page([UNIT, SUPPLY]);
    if (method === 'GET' && path === '/closing-time') {
      return { status: 200, body: { closingTime: '17:00' } };
    }
    if (method === 'POST' && path === '/transactions') return checkout(body);
    throw new Error(`unexpected ${method} ${path}`);
  });
}

const callsTo = (fetchMock: ReturnType<typeof mockApi>, prefix: string, method = 'GET') =>
  fetchMock.mock.calls
    .filter(([url, init]) => url.startsWith(`/api${prefix}`) && (init?.method ?? 'GET') === method)
    .map(([url, init]) => ({
      url,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    }));

async function fillCheckout(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('heading', { name: 'Checkout' });
  await user.type(screen.getByLabelText('Find by name or school ID'), 'te');
  await user.click(await screen.findByRole('button', { name: 'Choose Test Borrower' }));
  await screen.findByRole('option', { name: 'QA Lab' });
  await user.selectOptions(screen.getByLabelText('Where will the items be used?'), 'QA Lab');
  await user.type(screen.getByLabelText('Search by name or asset tag'), 'qa');
  await user.click(await screen.findByRole('button', { name: 'Add QA Projector QA-PJ-1' }));
  await user.click(screen.getByRole('button', { name: 'Add QA Cord' }));
}

const summary = () => screen.getByRole('complementary');
const confirmButton = () => screen.getByRole('button', { name: /Confirm checkout|Saving…/ });
const topError = async () =>
  (await screen.findByText('Checkout not saved.')).closest('[role=alert]')!.textContent;

// --- Due back today or tomorrow (BR 8, S10); closing time 17:00 ---

test.each([
  ['one minute before closing (16:59)', '2026-11-05T08:59:00.000Z', 'Today by 17:00'],
  ['one second before closing (16:59:59)', '2026-11-05T08:59:59.000Z', 'Today by 17:00'],
  ['exactly at closing (17:00)', '2026-11-05T09:00:00.000Z', 'Tomorrow by 17:00'],
  [
    'just after midnight Manila (00:10, still 16:10 UTC the day before)',
    '2026-11-04T16:10:00.000Z',
    'Today by 17:00',
  ],
  ['one minute before midnight Manila (23:59)', '2026-11-05T15:59:00.000Z', 'Tomorrow by 17:00'],
])('the Summary says the right due day %s', async (_name, now, expected) => {
  setClock(now);
  fakeApi();
  renderApp('/checkout');
  expect(await within(await screen.findByRole('complementary')).findByText(expected)).toBeTruthy();
});

test.each([
  ['issued at 16:59', '2026-11-05T08:59:00.000Z', 'Due back by 17:00 today.'],
  ['issued exactly at 17:00', '2026-11-05T09:00:00.000Z', 'Due back by 17:00 tomorrow.'],
])('the saved message uses the issue time from the API when %s', async (_name, issuedAt, text) => {
  // The browser clock says morning; only the server's issuedAt decides the saved message.
  setClock('2026-11-05T01:00:00.000Z');
  fakeApi(() => saved(issuedAt));
  const user = userEvent.setup();
  renderApp('/checkout');
  await fillCheckout(user);
  await user.click(confirmButton());
  expect((await screen.findByRole('status')).textContent).toContain(text);
});

// --- Error replies are shown with their messages ---

test('NOT_FOUND for an item marks its line and moves focus to its Remove button', async () => {
  fakeApi(() => ({
    status: 404,
    body: apiError('NOT_FOUND', 'Item not found.', { itemId: SUPPLY.id }),
  }));
  const user = userEvent.setup();
  renderApp('/checkout');
  await fillCheckout(user);
  await user.click(confirmButton());
  expect(await topError()).toContain('Item not found.');
  const row = screen.getByRole('row', { name: /QA Cord/ });
  expect(within(row).getByRole('alert').textContent).toBe('Item not found.');
  expect(document.activeElement).toBe(within(row).getByRole('button', { name: 'Remove QA Cord' }));
});

test('BORROWER_INACTIVE (the record changed since the lookup) shows its message at the top', async () => {
  fakeApi(() => ({
    status: 409,
    body: apiError('BORROWER_INACTIVE', 'This borrower record is inactive.'),
  }));
  const user = userEvent.setup();
  renderApp('/checkout');
  await fillCheckout(user);
  await user.click(confirmButton());
  expect(await topError()).toBe(
    'Checkout not saved. This borrower record is inactive. Nothing was issued.',
  );
});

test('an item refusal for an itemId on no line shows only at the top', async () => {
  fakeApi(() => ({
    status: 409,
    body: apiError('ITEM_UNAVAILABLE', 'Something else is unavailable.', {
      itemId: 'd0000000-0000-4000-8000-0000000000ff',
    }),
  }));
  const user = userEvent.setup();
  renderApp('/checkout');
  await fillCheckout(user);
  await user.click(confirmButton());
  expect(await topError()).toContain('Something else is unavailable.');
  const table = screen.getByRole('table', { name: 'Items to check out' });
  expect(within(table).queryByRole('alert')).toBeNull();
});

test('server field errors for borrowerId and locationId show on their fields', async () => {
  fakeApi(() => ({
    status: 400,
    body: apiError('VALIDATION_ERROR', 'Some fields are invalid.', {
      fields: { borrowerId: ['Choose a borrower.'], locationId: ['Choose a room or lab.'] },
    }),
  }));
  const user = userEvent.setup();
  renderApp('/checkout');
  await fillCheckout(user);
  await user.click(confirmButton());
  await topError();
  expect(screen.getByLabelText('Where will the items be used?').getAttribute('aria-invalid')).toBe(
    'true',
  );
  expect(screen.getByLabelText('Find by name or school ID').getAttribute('aria-invalid')).toBe(
    'true',
  );
});

test.each([
  ['a 500 without a JSON body', { status: 500 }, 'Something went wrong. Please try again.'],
  [
    'a 429 with Retry-After',
    {
      status: 429,
      headers: { 'Retry-After': '30' },
      body: apiError('RATE_LIMITED', 'Too many requests. Try again later.'),
    },
    'Too many requests. Try again in 30 seconds.',
  ],
])('%s shows a readable message and nothing is issued', async (_name, reply, text) => {
  fakeApi(() => reply);
  const user = userEvent.setup();
  renderApp('/checkout');
  await fillCheckout(user);
  await user.click(confirmButton());
  expect(await topError()).toBe(`Checkout not saved. ${text} Nothing was issued.`);
  expect(screen.queryByRole('status')).toBeNull();
});

test('a network failure shows that the server could not be reached', async () => {
  fakeApi(() => {
    throw new TypeError('Failed to fetch');
  });
  const user = userEvent.setup();
  renderApp('/checkout');
  await fillCheckout(user);
  await user.click(confirmButton());
  expect(await topError()).toBe(
    'Checkout not saved. Could not reach the server. Please try again. Nothing was issued.',
  );
});

// --- Double submission ---

test('while the request is on its way, Confirm says Saving…, is disabled, and more clicks send nothing', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const fetchMock = fakeApi();
  const answer = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url, init) => {
    if (url === '/api/transactions') await gate;
    return answer(url, init);
  });
  const user = userEvent.setup();
  renderApp('/checkout');
  await fillCheckout(user);

  fireEvent.click(confirmButton());
  const pending = await screen.findByRole('button', { name: 'Saving…' });
  expect(pending).toHaveProperty('disabled', true);
  fireEvent.click(pending);
  fireEvent.click(pending);
  release();
  expect(await screen.findByRole('status')).toBeTruthy();
  expect(callsTo(fetchMock, '/transactions', 'POST')).toHaveLength(1);
});

test('after a refusal, Confirm can be used again and sends exactly one more request', async () => {
  let refuse = true;
  const fetchMock = fakeApi(() =>
    refuse
      ? { status: 409, body: apiError('LOCATION_INACTIVE', 'This room is no longer in use.') }
      : saved('2026-11-05T06:00:00.000Z'),
  );
  const user = userEvent.setup();
  renderApp('/checkout');
  await fillCheckout(user);
  await user.click(confirmButton());
  await topError();
  refuse = false;
  fireEvent.click(confirmButton());
  fireEvent.click(confirmButton());
  expect(await screen.findByRole('status')).toBeTruthy();
  expect(callsTo(fetchMock, '/transactions', 'POST')).toHaveLength(2);
});

// --- Lines ---

test('removing a refused line removes its error; the other line is not marked and is sent alone', async () => {
  let refuse = true;
  const fetchMock = fakeApi(() =>
    refuse
      ? {
          status: 409,
          body: apiError('ITEM_UNAVAILABLE', 'QA Projector QA-PJ-1 is already borrowed.', {
            itemId: UNIT.id,
          }),
        }
      : saved('2026-11-05T06:00:00.000Z'),
  );
  const user = userEvent.setup();
  renderApp('/checkout');
  await fillCheckout(user);
  await user.click(confirmButton());
  await topError();
  await user.click(screen.getByRole('button', { name: 'Remove QA Projector QA-PJ-1' }));

  const table = screen.getByRole('table', { name: 'Items to check out' });
  expect(within(table).queryByText('QA Projector QA-PJ-1 is already borrowed.')).toBeNull();
  expect(within(table).queryByRole('alert')).toBeNull();
  refuse = false;
  await user.click(confirmButton());
  await screen.findByRole('status');
  expect(callsTo(fetchMock, '/transactions', 'POST')[1]!.body.lines).toEqual([
    { itemId: SUPPLY.id, quantity: 1 },
  ]);
});

test('a cleared quantity shows "?" in the Summary and blocks Confirm on that line', async () => {
  const fetchMock = fakeApi();
  const user = userEvent.setup();
  renderApp('/checkout');
  await fillCheckout(user);
  const quantity = screen.getByLabelText('Quantity of QA Cord');
  await user.clear(quantity);
  expect(within(summary()).getByText('? × QA Cord')).toBeTruthy();
  await user.click(confirmButton());
  await waitFor(() => expect(quantity.getAttribute('aria-invalid')).toBe('true'));
  expect(callsTo(fetchMock, '/transactions', 'POST')).toEqual([]);
});

// --- Lookup search text (SPEC 7) ---

test('the borrower lookup never sends fewer than 2 characters, trims spaces, and encodes the text', async () => {
  const fetchMock = fakeApi();
  const user = userEvent.setup();
  renderApp('/checkout');
  const search = await screen.findByLabelText('Find by name or school ID');

  await user.type(search, '   t   ');
  // The item search has the same delay and starts later, so once it has fired, a lookup for the
  // one letter would have fired too. This waits on a request instead of sleeping.
  await user.type(screen.getByLabelText('Search by name or asset tag'), 'qa');
  await waitFor(() => expect(callsTo(fetchMock, '/items?')).toHaveLength(1));
  expect(callsTo(fetchMock, '/borrowers/lookup')).toEqual([]);

  await user.clear(search);
  await user.type(search, "o'ne & #1");
  await waitFor(() => expect(callsTo(fetchMock, '/borrowers/lookup').length).toBeGreaterThan(0));
  const urls = callsTo(fetchMock, '/borrowers/lookup').map((call) => call.url);
  expect(urls.at(-1)).toBe(
    `/api/borrowers/lookup?q=${encodeURIComponent("o'ne & #1")}&page=1&pageSize=10`,
  );
  for (const url of urls) {
    const q = new URL(url, 'http://x').searchParams.get('q')!;
    expect(q.length).toBeGreaterThanOrEqual(2);
    expect(q).toBe(q.trim());
  }
  expect(callsTo(fetchMock, '/borrowers?')).toEqual([]); // never the admin-only list
});

test('the search fields cap input at 100 characters', async () => {
  fakeApi();
  renderApp('/checkout');
  for (const label of ['Find by name or school ID', 'Search by name or asset tag']) {
    expect((await screen.findByLabelText<HTMLInputElement>(label)).maxLength).toBe(100);
  }
});
