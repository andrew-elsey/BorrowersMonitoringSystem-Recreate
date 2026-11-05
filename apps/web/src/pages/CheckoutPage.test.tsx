import type { Borrower, Item, Room } from '@bms/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { apiError, HANDLER, mockApi, renderApp, signedInAs } from '../test-utils';

// BRW-3: the Checkout screen. The rules themselves (BR 1 to 4, 7) are tested in
// api/checkout.test.ts; these tests check what the screen sends and shows.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// Only Date is faked, so user events and timers still run normally.
const setManilaClock = (iso: string) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
};

const PAOLO: Borrower = {
  id: 'b0000000-0000-4000-8000-000000000001',
  schoolId: '2022-15530',
  name: 'Paolo Garcia',
  type: 'STUDENT',
  department: 'Multimedia Arts',
  active: true,
};
const RHEA: Borrower = {
  ...PAOLO,
  id: 'b0000000-0000-4000-8000-000000000002',
  schoolId: '2018-03321',
  name: 'Rhea Soriano',
  active: false,
};
const room = (id: string, name: string): Room => ({
  id,
  name,
  active: true,
  createdBy: { id: 'u0', name: 'Ma. Teresa Lim' },
  createdAt: '2026-08-01T00:00:00.000Z',
  transactionCount: 0,
});
const CL201 = room('c0000000-0000-4000-8000-000000000001', 'CL-201');
const category = { id: 'c1', name: 'Laptops' };
type ListedItem = Item & { available: number };
const LAPTOP: ListedItem = {
  id: 'd0000000-0000-4000-8000-000000000001',
  name: 'Laptop, Dell Latitude 5440',
  category,
  description: null,
  trackingType: 'UNIT',
  assetTag: 'LT-0013',
  totalQuantity: 1,
  condition: 'GOOD',
  status: 'ACTIVE',
  available: 1,
};
const REPAIR: ListedItem = {
  ...LAPTOP,
  id: 'd0000000-0000-4000-8000-000000000002',
  assetTag: 'LT-0009',
  status: 'UNDER_REPAIR',
  available: 0,
};
const OUT: ListedItem = {
  ...LAPTOP,
  id: 'd0000000-0000-4000-8000-000000000004',
  assetTag: 'LT-0012',
  available: 0,
};
const CORD: ListedItem = {
  ...LAPTOP,
  id: 'd0000000-0000-4000-8000-000000000003',
  name: 'Extension cord, 5 m',
  trackingType: 'QUANTITY',
  assetTag: null,
  totalQuantity: 8,
  available: 3,
};
const page = <T,>(data: T[]) => ({
  status: 200,
  body: { data, page: 1, pageSize: 10, total: data.length },
});
const SAVED = {
  status: 201,
  body: {
    transaction: {
      id: 't1',
      borrowerId: 'b0000000-0000-4000-8000-000000000001',
      locationId: 'c0000000-0000-4000-8000-000000000001',
      issuedById: 'u1',
      issuedAt: '2026-11-05T06:20:00.000Z', // 14:20 in Manila
      semesterId: 's1',
      lines: [{ id: 'l1' }, { id: 'l2' }], // only the count is shown
    },
  },
};

type Answer = (method: string, path: string, body: unknown) => object | undefined;
function fakeApi(answer?: Answer) {
  let rooms = [CL201];
  return mockApi((method, path, body) => {
    if (path === '/auth/me') return signedInAs(HANDLER);
    const reply = answer?.(method, path, body);
    if (reply) return reply as { status: number; body?: unknown };
    // The handler-allowed lookup, not the admin-only GET /borrowers.
    if (method === 'GET' && path.startsWith('/borrowers/lookup?q=')) return page([PAOLO, RHEA]);
    if (method === 'GET' && path.startsWith('/rooms')) return page(rooms);
    if (method === 'GET' && path.startsWith('/items?q=')) return page([LAPTOP, OUT, REPAIR, CORD]);
    if (method === 'GET' && path === '/closing-time') {
      return { status: 200, body: { closingTime: '17:00' } };
    }
    if (method === 'POST' && path === '/rooms') {
      const added = room('c0000000-0000-4000-8000-000000000009', (body as { name: string }).name);
      rooms = [...rooms, added];
      return { status: 201, body: { room: added } };
    }
    if (method === 'POST' && path === '/transactions') return SAVED;
    throw new Error(`unexpected ${method} ${path}`);
  });
}

const posts = (fetchMock: ReturnType<typeof mockApi>, path: string) =>
  fetchMock.mock.calls
    .filter(([url, init]) => url === `/api${path}` && init?.method === 'POST')
    .map(([, init]) => JSON.parse(init!.body as string));

// The refusal message at the top of the page (the strong text sits inside it).
const topMessage = () => screen.getByText('Checkout not saved.').closest('[role=alert]')!;
const findTopMessage = async () =>
  (await screen.findByText('Checkout not saved.')).closest('[role=alert]')!;

async function chooseBorrower(user: ReturnType<typeof userEvent.setup>, name = 'Paolo Garcia') {
  await user.type(screen.getByLabelText('Find by name or school ID'), 'ga');
  await user.click(await screen.findByRole('button', { name: `Choose ${name}` }));
}

async function fillCheckout(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('heading', { name: 'Checkout' });
  await chooseBorrower(user);
  await user.selectOptions(await screen.findByLabelText('Where will the items be used?'), 'CL-201');
  await user.type(screen.getByLabelText('Search by name or asset tag'), 'la');
  await user.click(
    await screen.findByRole('button', { name: 'Add Laptop, Dell Latitude 5440 LT-0013' }),
  );
  await user.click(screen.getByRole('button', { name: 'Add Extension cord, 5 m' }));
}

test('TC-BRW-14: borrower lookup shows name, type, and department; an inactive borrower cannot be checked out', async () => {
  fakeApi();
  const user = userEvent.setup();
  renderApp('/checkout');
  await screen.findByRole('heading', { name: 'Checkout' });

  await user.type(screen.getByLabelText('Find by name or school ID'), 'ga');
  const results = await screen.findByRole('list', { name: 'Borrowers found' });
  expect(within(results).getByText('2022-15530 · Student · Multimedia Arts')).toBeTruthy();
  await user.click(within(results).getByRole('button', { name: 'Choose Paolo Garcia' }));

  const chosen = screen.getByRole('group', { name: 'Chosen borrower' });
  expect(chosen.textContent).toBe('Paolo Garcia2022-15530 · Student · Multimedia Arts');
  expect(screen.queryByRole('list', { name: 'Borrowers found' })).toBeNull();

  // BR 3: the API refuses an inactive borrower; the screen says so and does not offer Confirm.
  await user.type(screen.getByLabelText('Find by name or school ID'), 'r');
  await user.click(await screen.findByRole('button', { name: 'Choose Rhea Soriano' }));
  expect(screen.getByRole('alert').textContent).toContain('Inactive borrower.');
  expect(screen.getByRole('button', { name: 'Confirm checkout' })).toHaveProperty('disabled', true);
  // The room and item steps sit in a disabled fieldset.
  expect(screen.getByLabelText('Search by name or asset tag').matches(':disabled')).toBe(true);
});

test('TC-BRW-15: pick a room, or add a new one from the picker and it is selected', async () => {
  const fetchMock = fakeApi();
  const user = userEvent.setup();
  renderApp('/checkout');

  const picker = await screen.findByLabelText<HTMLSelectElement>('Where will the items be used?');
  await screen.findByRole('option', { name: 'CL-201' });
  await user.selectOptions(picker, 'CL-201');
  expect(within(screen.getByRole('complementary')).getByText('CL-201')).toBeTruthy();

  await user.click(screen.getByRole('button', { name: '+ Add a new room or lab' }));
  expect(document.activeElement).toBe(screen.getByLabelText('New room or lab name'));
  await user.keyboard('DL-105{Enter}');

  expect(await screen.findByText('Room "DL-105" added.')).toBeTruthy();
  expect(posts(fetchMock, '/rooms')).toEqual([{ name: 'DL-105' }]);
  expect(picker.selectedOptions[0]!.textContent).toBe('DL-105');
  expect(document.activeElement).toBe(picker);
  expect(screen.queryByLabelText('New room or lab name')).toBeNull();
});

test('a duplicate room name shows under the new room field', async () => {
  fakeApi((method, path) =>
    method === 'POST' && path === '/rooms'
      ? {
          status: 409,
          body: apiError('DUPLICATE_VALUE', 'A room named "CL-201" already exists.', {
            fields: { name: ['A room named "CL-201" already exists.'] },
          }),
        }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/checkout');
  await user.click(await screen.findByRole('button', { name: '+ Add a new room or lab' }));
  await user.keyboard('cl-201{Enter}');
  expect(await screen.findByText('A room named "CL-201" already exists.')).toBeTruthy();
  expect(screen.getByLabelText('New room or lab name').getAttribute('aria-invalid')).toBe('true');
});

test('TC-BRW-37: item results show what is available; an item with none cannot be added (BR 1)', async () => {
  fakeApi();
  const user = userEvent.setup();
  renderApp('/checkout');
  await user.type(await screen.findByLabelText('Search by name or asset tag'), 'la');
  const results = await screen.findByRole('list', { name: 'Search results' });
  const rows = within(results)
    .getAllByRole('listitem')
    .map((row) => row.textContent);
  expect(rows).toEqual([
    'Laptop, Dell Latitude 5440Asset tag LT-0013AvailableAdd',
    'Laptop, Dell Latitude 5440Asset tag LT-0012OutAdd',
    'Laptop, Dell Latitude 5440Asset tag LT-0009Under repairAdd',
    'Extension cord, 5 mQuantity item · 8 in total3 availableAdd',
  ]);
  const add = (name: string) => within(results).getByRole('button', { name: `Add ${name}` });
  expect(add('Laptop, Dell Latitude 5440 LT-0012')).toHaveProperty('disabled', true);
  expect(add('Laptop, Dell Latitude 5440 LT-0013')).toHaveProperty('disabled', false);
  expect(add('Extension cord, 5 m')).toHaveProperty('disabled', false);
});

test('TC-BRW-38: the closing time comes from settings (rule 3)', async () => {
  setManilaClock('2026-11-05T06:20:00.000Z'); // 14:20 in Manila, before closing
  fakeApi((method, path) =>
    method === 'GET' && path === '/closing-time'
      ? { status: 200, body: { closingTime: '18:30' } }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/checkout');
  expect(
    await within(await screen.findByRole('complementary')).findByText('Today by 18:30'),
  ).toBeTruthy();
  await fillCheckout(user);
  expect(screen.getByText(/Lines still out at 18:30 are flagged anyway\./)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Confirm checkout' }));
  expect((await screen.findByRole('status')).textContent).toContain('Due back by 18:30 today.');
});

test('TC-BRW-40: after closing time the screen says the items are due back tomorrow (BR 8, S10)', async () => {
  setManilaClock('2026-11-05T09:30:00.000Z'); // 17:30 in Manila, closing is 17:00
  const late = { ...SAVED.body.transaction, issuedAt: '2026-11-05T09:30:00.000Z' };
  fakeApi((method, path) =>
    method === 'POST' && path === '/transactions'
      ? { status: 201, body: { transaction: late } }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/checkout');
  expect(
    await within(await screen.findByRole('complementary')).findByText('Tomorrow by 17:00'),
  ).toBeTruthy();
  await fillCheckout(user);
  await user.click(screen.getByRole('button', { name: 'Confirm checkout' }));
  expect((await screen.findByRole('status')).textContent).toContain('Due back by 17:00 tomorrow.');
});

test('TC-BRW-16: search items, enter a quantity for a quantity item, and add a note and expected return date', async () => {
  fakeApi();
  const user = userEvent.setup();
  renderApp('/checkout');
  await fillCheckout(user);

  // Only ACTIVE items can be issued (BR 1), and an item already on a line cannot be added twice.
  expect(
    screen.getByRole('button', { name: 'Add Laptop, Dell Latitude 5440 LT-0009' }),
  ).toHaveProperty('disabled', true);
  const cordLine = within(screen.getByRole('table', { name: 'Items to check out' })).getByText(
    'Quantity item · 3 available',
  );
  expect(cordLine).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Add Extension cord, 5 m' })).toHaveProperty(
    'disabled',
    true,
  );

  const table = screen.getByRole('table', { name: 'Items to check out' });
  const laptopRow = within(table).getByRole('row', { name: /LT-0013 · unit item/ });
  // A unit item line is always quantity 1, so it has no quantity field.
  expect(within(laptopRow).queryByRole('spinbutton')).toBeNull();

  const quantity = screen.getByLabelText('Quantity of Extension cord, 5 m');
  await user.clear(quantity);
  await user.type(quantity, '2');
  await user.type(
    screen.getByLabelText('Note for Extension cord, 5 m'),
    'Returning tomorrow, 08:00',
  );
  const date = screen.getByLabelText<HTMLInputElement>('Expected return for Extension cord, 5 m');
  await user.type(date, '2099-01-31');
  expect(date.min).toMatch(/^\d{4}-\d{2}-\d{2}$/); // today in the app timezone (BR 7)

  expect(quantity).toHaveProperty('value', '2');
  expect(screen.getByLabelText('Note for Extension cord, 5 m')).toHaveProperty(
    'value',
    'Returning tomorrow, 08:00',
  );
  expect(date.value).toBe('2099-01-31');
  const summary = screen.getByRole('complementary');
  expect(within(summary).getByText('1 × Laptop, Dell Latitude 5440 LT-0013')).toBeTruthy();
  expect(within(summary).getByText('2 × Extension cord, 5 m')).toBeTruthy();

  await user.click(
    within(laptopRow).getByRole('button', { name: 'Remove Laptop, Dell Latitude 5440 LT-0013' }),
  );
  expect(within(table).queryByText('Laptop, Dell Latitude 5440')).toBeNull();
});

test('TC-BRW-17: the summary shows what will be sent, and a double click sends one request', async () => {
  const fetchMock = fakeApi();
  const user = userEvent.setup();
  renderApp('/checkout');
  await fillCheckout(user);
  await user.type(screen.getByLabelText('Note for Extension cord, 5 m'), 'For the exhibit');

  const summary = screen.getByRole('complementary');
  expect(within(summary).getByText('Paolo Garcia')).toBeTruthy();
  expect(within(summary).getByText('CL-201')).toBeTruthy();
  expect(within(summary).getByText('Juan dela Cruz (you)')).toBeTruthy();

  // Two clicks in the same moment, before the page can re-render and disable the button.
  const confirm = screen.getByRole('button', { name: 'Confirm checkout' });
  fireEvent.click(confirm);
  fireEvent.click(confirm);

  expect((await screen.findByRole('status')).textContent).toContain(
    'Checkout saved. 2 items issued to Paolo Garcia for CL-201 at 14:20.',
  );
  // The issuing handler and semester are never sent (BR 2); empty notes and dates are left out.
  expect(posts(fetchMock, '/transactions')).toEqual([
    {
      borrowerId: 'b0000000-0000-4000-8000-000000000001',
      locationId: 'c0000000-0000-4000-8000-000000000001',
      lines: [
        { itemId: 'd0000000-0000-4000-8000-000000000001', quantity: 1 },
        { itemId: 'd0000000-0000-4000-8000-000000000003', quantity: 1, note: 'For the exhibit' },
      ],
    },
  ]);
  expect(screen.getByRole('button', { name: 'Saved' })).toHaveProperty('disabled', true);

  const startOver = screen.getByRole('button', { name: 'Start a new checkout' });
  await waitFor(() => expect(document.activeElement).toBe(startOver));
  await user.click(startOver);
  expect(document.activeElement).toBe(screen.getByLabelText('Find by name or school ID'));
  expect(screen.queryByRole('group', { name: 'Chosen borrower' })).toBeNull();
  expect(within(screen.getByRole('complementary')).getByText('None')).toBeTruthy();
});

test('nothing is sent until a borrower, a room, and an item are chosen', async () => {
  const fetchMock = fakeApi();
  const user = userEvent.setup();
  renderApp('/checkout');
  await screen.findByRole('option', { name: 'CL-201' });

  await user.click(screen.getByRole('button', { name: 'Confirm checkout' }));
  expect(await screen.findByText('Choose a borrower.')).toBeTruthy();
  expect(screen.getByText('Choose a room or lab.')).toBeTruthy();
  expect(screen.getByText('Add at least one item.')).toBeTruthy();
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByLabelText('Find by name or school ID')),
  );
  expect(posts(fetchMock, '/transactions')).toEqual([]);
});

test('TC-BRW-18: a refused line shows the API message and is marked, with focus on its field', async () => {
  fakeApi((method, path) =>
    method === 'POST' && path === '/transactions'
      ? {
          status: 409,
          body: apiError(
            'INSUFFICIENT_QUANTITY',
            'Only 3 of Extension cord, 5 m available, 4 requested.',
            {
              itemId: 'd0000000-0000-4000-8000-000000000003',
              available: 3,
            },
          ),
        }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/checkout');
  await fillCheckout(user);
  const quantity = screen.getByLabelText('Quantity of Extension cord, 5 m');
  await user.clear(quantity);
  await user.type(quantity, '4');
  await user.click(screen.getByRole('button', { name: 'Confirm checkout' }));

  expect(
    await screen.findByText(/Only 3 of Extension cord, 5 m available, 4 requested\./),
  ).toBeTruthy();
  expect(topMessage().textContent).toContain('Nothing was issued.');
  expect(screen.getByText('Only 3 available')).toBeTruthy();
  expect(quantity.getAttribute('aria-invalid')).toBe('true');
  expect(document.activeElement).toBe(quantity);
});

test('TC-BRW-18: an unavailable item is marked on its line and focus goes to its Remove button', async () => {
  fakeApi((method, path) =>
    method === 'POST' && path === '/transactions'
      ? {
          status: 409,
          body: apiError(
            'ITEM_UNAVAILABLE',
            'Laptop, Dell Latitude 5440 LT-0013 is already borrowed.',
            {
              itemId: 'd0000000-0000-4000-8000-000000000001',
            },
          ),
        }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/checkout');
  await fillCheckout(user);
  await user.click(screen.getByRole('button', { name: 'Confirm checkout' }));

  const row = await screen.findByRole('row', { name: /LT-0013 · unit item/ });
  expect(within(row).getByRole('alert').textContent).toBe(
    'Laptop, Dell Latitude 5440 LT-0013 is already borrowed.',
  );
  expect(document.activeElement).toBe(within(row).getByRole('button', { name: /Remove/ }));
});

test('TC-BRW-18: a date before today (lines.N.expectedReturnDate) shows on that line', async () => {
  const message = 'Choose today or a later date.';
  fakeApi((method, path) =>
    method === 'POST' && path === '/transactions'
      ? {
          status: 400,
          body: apiError('VALIDATION_ERROR', message, {
            fields: { 'lines.1.expectedReturnDate': [message] },
          }),
        }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/checkout');
  await fillCheckout(user);
  const date = screen.getByLabelText('Expected return for Extension cord, 5 m');
  await user.type(date, '2020-01-01');
  await user.click(screen.getByRole('button', { name: 'Confirm checkout' }));

  expect((await findTopMessage()).textContent).toContain(message);
  expect(date.getAttribute('aria-invalid')).toBe('true');
  expect(document.activeElement).toBe(date);
});

test('TC-BRW-18: a schema error under fields.lines and a room refusal show at the top', async () => {
  let refusal = apiError('VALIDATION_ERROR', 'Some fields are invalid.', {
    fields: { lines: ['Each item can appear only once. Change its quantity instead.'] },
  });
  fakeApi((method, path) =>
    method === 'POST' && path === '/transactions' ? { status: 400, body: refusal } : undefined,
  );
  const user = userEvent.setup();
  renderApp('/checkout');
  await fillCheckout(user);
  await user.click(screen.getByRole('button', { name: 'Confirm checkout' }));
  expect((await findTopMessage()).textContent).toBe(
    'Checkout not saved. Some fields are invalid. Each item can appear only once. Change its quantity instead. Nothing was issued.',
  );

  refusal = apiError(
    'LOCATION_INACTIVE',
    'This room is no longer in use. Ask an admin to reactivate it.',
  );
  await user.click(screen.getByRole('button', { name: 'Confirm checkout' }));
  expect(await screen.findByText(/This room is no longer in use\./)).toBeTruthy();
});

test('a view-only user cannot open Checkout, and it is not in their menu', async () => {
  mockApi((_method, path) => {
    if (path === '/auth/me') return signedInAs({ ...HANDLER, role: 'VIEWER' });
    throw new Error(`unexpected ${path}`);
  });
  renderApp('/checkout');
  expect(await screen.findByRole('heading', { name: "You can't open this page" })).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Checkout' })).toBeNull();
});
