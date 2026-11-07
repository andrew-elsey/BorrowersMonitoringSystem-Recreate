import type { Borrower, Item, Room } from '@bms/shared';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { apiError, HANDLER, mockApi, renderApp, signedInAs } from '../test-utils';

// QA (automated) gap tests for BRW-3 round 2 (f240000..bd83671): the line availability taken from
// an INSUFFICIENT_QUANTITY refusal (only that line, also 0, not for ITEM_UNAVAILABLE); focus to the
// first missing field for each section and on a repeated empty Confirm; focus to "Start a new
// checkout" on every save; and the "tomorrow" helper text at the closing-time boundaries (BR 8, S10).
// Round 3 (9a900d0..1bc7f02) adds browser-like first-error focus cases and the "Issued by" wrap.

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
  id: 'b0000000-0000-4000-8000-0000000000b1',
  schoolId: 'QA-0002',
  name: 'Test Borrower',
  type: 'STUDENT',
  department: 'QA Dept',
  active: true,
};
const ROOM: Room = {
  id: 'c0000000-0000-4000-8000-0000000000b1',
  name: 'QA Lab',
  active: true,
  createdBy: { id: 'u0', name: 'QA Admin' },
  createdAt: '2026-08-01T00:00:00.000Z',
  transactionCount: 0,
};
type ListedItem = Item & { available: number };
const CORD: ListedItem = {
  id: 'd0000000-0000-4000-8000-0000000000b1',
  name: 'QA Cord',
  category: { id: 'k1', name: 'QA Category' },
  description: null,
  trackingType: 'QUANTITY',
  assetTag: null,
  totalQuantity: 5,
  condition: 'GOOD',
  status: 'ACTIVE',
  available: 5,
};
const ADAPTER: ListedItem = {
  ...CORD,
  id: 'd0000000-0000-4000-8000-0000000000b2',
  name: 'QA Adapter',
  totalQuantity: 4,
  available: 4,
};
const page = <T,>(data: T[]) => ({
  status: 200,
  body: { data, page: 1, pageSize: 10, total: data.length },
});
const saved = (issuedAt = '2026-11-05T02:00:00.000Z') => ({
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

type Reply = { status: number; body?: unknown };
// The API with closing time `closingTime`. `checkout` answers POST /transactions.
function fakeApi(checkout: () => Reply = () => saved(), closingTime = '17:00') {
  return mockApi((method, path) => {
    if (path === '/auth/me') return signedInAs(HANDLER);
    if (method === 'GET' && path.startsWith('/borrowers/lookup?')) return page([BORROWER]);
    if (method === 'GET' && path.startsWith('/rooms')) return page([ROOM]);
    if (method === 'GET' && path.startsWith('/items?')) return page([CORD, ADAPTER]);
    if (method === 'GET' && path === '/closing-time') return { status: 200, body: { closingTime } };
    if (method === 'POST' && path === '/transactions') return checkout();
    throw new Error(`unexpected ${method} ${path}`);
  });
}

type User = ReturnType<typeof userEvent.setup>;
const borrowerSearch = () => screen.getByLabelText('Find by name or school ID');
const roomSelect = () => screen.getByLabelText('Where will the items be used?');
const itemSearch = () => screen.getByLabelText('Search by name or asset tag');
const confirmButton = () => screen.getByRole('button', { name: /Confirm checkout|Saving…/ });

async function chooseBorrower(user: User) {
  await screen.findByRole('heading', { name: 'Checkout' });
  await user.type(borrowerSearch(), 'te');
  await user.click(await screen.findByRole('button', { name: 'Choose Test Borrower' }));
}
async function chooseRoom(user: User) {
  await screen.findByRole('option', { name: 'QA Lab' });
  await user.selectOptions(roomSelect(), 'QA Lab');
}
async function addItems(user: User, ...names: string[]) {
  await user.type(itemSearch(), 'qa');
  for (const name of names)
    await user.click(await screen.findByRole('button', { name: `Add ${name}` }));
}
async function fillCheckout(user: User, ...names: string[]) {
  await chooseBorrower(user);
  await chooseRoom(user);
  await addItems(user, ...(names.length ? names : ['QA Cord']));
}
const lineRow = (name: string) =>
  within(screen.getByRole('table', { name: 'Items to check out' }))
    .getByText(name)
    .closest('tr')!;

// --- Availability from an INSUFFICIENT_QUANTITY refusal (TC-BRW-18) ---

test('a refusal with 0 available shows "0 available" on the line, matching the error', async () => {
  fakeApi(() => ({
    status: 409,
    body: apiError('INSUFFICIENT_QUANTITY', 'Only 0 of QA Cord available, 1 requested.', {
      itemId: CORD.id,
      available: 0,
    }),
  }));
  const user = userEvent.setup();
  renderApp('/checkout');
  await fillCheckout(user);
  expect(within(lineRow('QA Cord')).getByText('Quantity item · 5 available')).toBeTruthy();
  await user.click(confirmButton());

  await screen.findByText('Only 0 available');
  expect(within(lineRow('QA Cord')).getByText('Quantity item · 0 available')).toBeTruthy();
});

test('a refusal updates only the refused line; the other line keeps its count', async () => {
  fakeApi(() => ({
    status: 409,
    body: apiError('INSUFFICIENT_QUANTITY', 'Only 2 of QA Adapter available, 3 requested.', {
      itemId: ADAPTER.id,
      available: 2,
    }),
  }));
  const user = userEvent.setup();
  renderApp('/checkout');
  await fillCheckout(user, 'QA Cord', 'QA Adapter');
  await user.click(confirmButton());

  await screen.findByText('Only 2 available');
  expect(within(lineRow('QA Adapter')).getByText('Quantity item · 2 available')).toBeTruthy();
  expect(within(lineRow('QA Cord')).getByText('Quantity item · 5 available')).toBeTruthy();
});

test('an ITEM_UNAVAILABLE refusal (no available count) leaves the line count unchanged', async () => {
  fakeApi(() => ({
    status: 409,
    body: apiError('ITEM_UNAVAILABLE', 'QA Cord is not available.', { itemId: CORD.id }),
  }));
  const user = userEvent.setup();
  renderApp('/checkout');
  await fillCheckout(user);
  await user.click(confirmButton());

  const row = lineRow('QA Cord');
  await within(row).findByText('QA Cord is not available.');
  expect(within(row).getByText('Quantity item · 5 available')).toBeTruthy();
  expect(document.activeElement).toBe(within(row).getByRole('button', { name: /^Remove/ }));
});

test('after a refusal and a successful retry, Start a new checkout shows fresh counts', async () => {
  let refuse = true;
  fakeApi(() => {
    if (!refuse) return saved();
    refuse = false;
    return {
      status: 409,
      body: apiError('INSUFFICIENT_QUANTITY', 'Only 1 of QA Cord available, 2 requested.', {
        itemId: CORD.id,
        available: 1,
      }),
    };
  });
  const user = userEvent.setup();
  renderApp('/checkout');
  await fillCheckout(user);
  await user.click(confirmButton());
  await screen.findByText('Only 1 available');
  await user.click(confirmButton());
  await user.click(await screen.findByRole('button', { name: 'Start a new checkout' }));

  // The refusal's count belonged to that checkout; a new line takes the count from the search.
  await addItems(user, 'QA Cord');
  expect(within(lineRow('QA Cord')).getByText('Quantity item · 5 available')).toBeTruthy();
});

// --- Focus to the first missing field (TC-BRW-17, FND-7) ---

test('Confirm with a borrower but no room moves focus to the room picker', async () => {
  fakeApi();
  const user = userEvent.setup();
  renderApp('/checkout');
  await chooseBorrower(user);
  await addItems(user, 'QA Cord');
  await user.click(confirmButton());

  await screen.findByText('Choose a room or lab.');
  await waitFor(() => expect(document.activeElement).toBe(roomSelect()));
});

test('Confirm with a borrower and a room but no item moves focus to the item search', async () => {
  fakeApi();
  const user = userEvent.setup();
  renderApp('/checkout');
  await chooseBorrower(user);
  await chooseRoom(user);
  await user.click(confirmButton());

  await screen.findByText('Add at least one item.');
  await waitFor(() => expect(document.activeElement).toBe(itemSearch()));
});

test('Confirm with a quantity of 0 moves focus to that quantity field and sends nothing', async () => {
  const fetchMock = fakeApi();
  const user = userEvent.setup();
  renderApp('/checkout');
  await fillCheckout(user);
  const quantity = screen.getByLabelText('Quantity of QA Cord');
  await user.clear(quantity);
  await user.type(quantity, '0');
  await user.click(confirmButton());

  await waitFor(() => expect(quantity.getAttribute('aria-invalid')).toBe('true'));
  await waitFor(() => expect(document.activeElement).toBe(quantity));
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});

test('a second empty Confirm moves focus to the first missing field again', async () => {
  fakeApi();
  const user = userEvent.setup();
  renderApp('/checkout');
  await screen.findByRole('heading', { name: 'Checkout' });
  await user.click(confirmButton());
  await waitFor(() => expect(document.activeElement).toBe(borrowerSearch()));

  confirmButton().focus();
  await user.click(confirmButton());
  await waitFor(() => expect(document.activeElement).toBe(borrowerSearch()));
});

// --- Focus after save (TC-BRW-17) ---

test('every save moves focus to Start a new checkout, and Enter on it starts a clean form', async () => {
  const fetchMock = fakeApi();
  const user = userEvent.setup();
  renderApp('/checkout');

  for (const round of [1, 2]) {
    await fillCheckout(user);
    await user.click(confirmButton());
    const startOver = await screen.findByRole('button', { name: 'Start a new checkout' });
    await waitFor(() => expect(document.activeElement).toBe(startOver));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(document.activeElement).toBe(borrowerSearch()));
    expect((borrowerSearch() as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('table', { name: 'Items to check out' })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => url === '/api/transactions' && init?.method === 'POST',
      ),
    ).toHaveLength(round);
  }
});

// --- "tomorrow" in the helper text (BR 8, S10, TC-BRW-40) ---

const helperText = () => screen.getByText(/Lines still out at/).textContent;

test.each([
  [
    'one minute before closing (16:59)',
    '2026-11-05T08:59:00.000Z',
    '17:00',
    'Lines still out at 17:00 are flagged anyway.',
  ],
  [
    'exactly at closing (17:00)',
    '2026-11-05T09:00:00.000Z',
    '17:00',
    'Lines still out at 17:00 tomorrow are flagged anyway.',
  ],
  [
    'just after midnight Manila (00:10)',
    '2026-11-04T16:10:00.000Z',
    '17:00',
    'Lines still out at 17:00 are flagged anyway.',
  ],
  [
    'at 18:00 with closing 18:30',
    '2026-11-05T10:00:00.000Z',
    '18:30',
    'Lines still out at 18:30 are flagged anyway.',
  ],
  [
    'at 18:30 with closing 18:30',
    '2026-11-05T10:30:00.000Z',
    '18:30',
    'Lines still out at 18:30 tomorrow are flagged anyway.',
  ],
])('the helper text says the right day %s', async (_name, now, closingTime, expected) => {
  setClock(now);
  fakeApi(undefined, closingTime);
  const user = userEvent.setup();
  renderApp('/checkout');
  await fillCheckout(user);

  await waitFor(() => expect(helperText()).toContain(expected));
  // The helper text and the Summary always agree on the day.
  const day = expected.includes('tomorrow') ? 'Tomorrow' : 'Today';
  expect(
    within(screen.getByRole('complementary')).getByText(`${day} by ${closingTime}`),
  ).toBeTruthy();
});

// --- Round 3 (9a900d0..1bc7f02): first-error focus keyed on submitCount (QA BUG-3) ---
// In a browser, window.event is still the click while the submit runs, so React renders an update
// made there at once, before the errors exist. jsdom clears it, so these tests keep it set, as the
// TC-BRW-17 test in CheckoutPage.test.tsx does. Without this, jsdom cannot tell the fix apart.
const actLikeABrowser = () => vi.stubGlobal('event', new MouseEvent('click'));

test.each([
  [
    'a borrower but no room',
    'the room picker',
    roomSelect,
    async (user: User) => {
      await chooseBorrower(user);
      await addItems(user, 'QA Cord');
    },
  ],
  [
    'a borrower and a room but no item',
    'the item search',
    itemSearch,
    async (user: User) => {
      await chooseBorrower(user);
      await chooseRoom(user);
    },
  ],
])('in a browser, Confirm with %s moves focus to %s', async (_what, _where, target, fill) => {
  fakeApi();
  const user = userEvent.setup();
  renderApp('/checkout');
  await fill(user);
  actLikeABrowser();
  await user.click(confirmButton());
  await waitFor(() => expect(document.activeElement).toBe(target()));
});

test('in a browser, a quantity of 0 on Confirm moves focus to that quantity field', async () => {
  fakeApi();
  const user = userEvent.setup();
  renderApp('/checkout');
  await fillCheckout(user);
  const quantity = screen.getByLabelText('Quantity of QA Cord');
  await user.clear(quantity);
  await user.type(quantity, '0');
  actLikeABrowser();
  await user.click(confirmButton());
  await waitFor(() => expect(document.activeElement).toBe(quantity));
});

test('in a browser, an empty Confirm, then a fixed and saved one, focuses Start a new checkout', async () => {
  // The first-error effect must not run again on the successful submit and pull focus back.
  const fetchMock = fakeApi();
  const user = userEvent.setup();
  renderApp('/checkout');
  await screen.findByRole('heading', { name: 'Checkout' });
  actLikeABrowser();
  await user.click(confirmButton());
  await waitFor(() => expect(document.activeElement).toBe(borrowerSearch()));

  await fillCheckout(user);
  await user.click(confirmButton());
  const startOver = await screen.findByRole('button', { name: 'Start a new checkout' });
  await waitFor(() => expect(document.activeElement).toBe(startOver));
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});

test('in a browser, an invalid Confirm after a server refusal still moves focus to the error', async () => {
  // After a refusal isSubmitSuccessful is true; the next invalid submit must set it back and focus.
  fakeApi(() => ({
    status: 409,
    body: apiError('ITEM_UNAVAILABLE', 'QA Cord is not available.', { itemId: CORD.id }),
  }));
  const user = userEvent.setup();
  renderApp('/checkout');
  await fillCheckout(user);
  actLikeABrowser();
  await user.click(confirmButton());
  await screen.findByText('QA Cord is not available.');
  await user.click(screen.getByRole('button', { name: /^Remove/ }));

  confirmButton().focus();
  await user.click(confirmButton());
  await screen.findByText('Add at least one item.');
  await waitFor(() => expect(document.activeElement).toBe(itemSearch()));
});

test('"Start a new checkout" resets the count, so the next page does not jump to an error', async () => {
  fakeApi();
  const user = userEvent.setup();
  renderApp('/checkout');
  await fillCheckout(user);
  await user.click(confirmButton());
  await user.click(await screen.findByRole('button', { name: 'Start a new checkout' }));
  await waitFor(() => expect(document.activeElement).toBe(borrowerSearch()));
  expect(screen.queryByText('Choose a borrower.')).toBeNull();
  expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
});

test('the Summary "Issued by" wraps a long handler name instead of widening the page (BUG-2)', async () => {
  // jsdom has no layout, so this checks the class; the widths are checked by hand (TC-BRW-41).
  fakeApi();
  renderApp('/checkout');
  const issuedBy = await within(await screen.findByRole('complementary')).findByText(
    `${HANDLER.name} (you)`,
  );
  expect(issuedBy.className.split(' ')).toContain('wrap-anywhere');
});
