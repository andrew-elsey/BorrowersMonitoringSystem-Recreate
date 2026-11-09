import type { Category, Item } from '@bms/shared';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import type { SignedInUser } from '../auth';
import { apiError, emulateModalDialogs, mockApi, renderApp, signedInAs } from '../test-utils';

// MD-2: the Items tab of the Inventory and categories screen. API rules are in api/items.test.ts
// (TC-MD-04 to TC-MD-08, TC-MD-29); these check the screen sends and shows them.

beforeAll(emulateModalDialogs);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ADMIN: SignedInUser = { id: 'u0', name: 'Ma. Teresa Lim', username: 'tlim', role: 'ADMIN' };
// Real uuids: the form checks the category id like the API does.
const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';
const COMPUTERS: Category = { id: C1, name: 'Computers', itemCount: 2 };
const CABLES: Category = { id: C2, name: 'Cables and power', itemCount: 1 };
const LAPTOP: Item = {
  id: 'i1',
  name: 'Laptop, Dell Latitude 5440',
  category: { id: C1, name: 'Computers' },
  description: 'i5, 16 GB RAM',
  trackingType: 'UNIT',
  assetTag: 'LT-0009',
  totalQuantity: 1,
  condition: 'DAMAGED',
  status: 'UNDER_REPAIR',
};
const CORD: Item = {
  id: 'i2',
  name: 'Extension cord, 5 m',
  category: { id: C2, name: 'Cables and power' },
  description: null,
  trackingType: 'QUANTITY',
  assetTag: null,
  totalQuantity: 20,
  condition: 'GOOD',
  status: 'ACTIVE',
};

type Reply = { status: number; body?: unknown };

// A fake API with two items and two categories. `answer` overrides any items request.
function fakeApi(answer?: (method: string, path: string, body: unknown) => Reply | undefined) {
  return mockApi((method, path, body) => {
    if (path === '/auth/me') return signedInAs(ADMIN);
    if (method === 'GET' && path.startsWith('/categories')) {
      return { status: 200, body: { data: [CABLES, COMPUTERS], page: 1, pageSize: 100, total: 2 } };
    }
    const reply = answer?.(method, path, body);
    if (reply) return reply;
    if (method === 'GET' && path.startsWith('/items')) {
      return {
        status: 200,
        body: {
          data: [
            { ...CORD, available: 8 },
            { ...LAPTOP, available: 0 },
          ],
          page: 1,
          pageSize: 25,
          total: 2,
        },
      };
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
}

const requests = (fetchMock: ReturnType<typeof mockApi>, method: string) =>
  fetchMock.mock.calls
    .filter(([url, init]) => url.startsWith('/api/items') && init?.method === method)
    .map(([url, init]) => [url, init!.body && JSON.parse(init!.body as string)]);
const lastLoad = (fetchMock: ReturnType<typeof mockApi>) => requests(fetchMock, 'GET').at(-1)![0];

test('Items is the first tab and lists items as in the mockup', async () => {
  fakeApi();
  renderApp('/inventory');
  const tabs = await screen.findByRole('navigation', { name: 'Inventory sections' });
  expect(within(tabs).getByRole('link', { name: 'Items' }).getAttribute('aria-current')).toBe(
    'page',
  );
  const table = await screen.findByRole('table', { name: 'Items' });
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent),
  ).toEqual([
    'Name',
    'Category',
    'Tracking',
    'Asset tag',
    'Available',
    'Condition',
    'Status',
    'Actions',
  ]);
  expect(
    await within(table).findByRole('row', {
      name: /Laptop, Dell Latitude 5440 Computers Unit LT-0009 — Damaged Under repair/,
    }),
  ).toBeTruthy();
  expect(
    within(table).getByRole('row', {
      name: /Extension cord, 5 m Cables and power Quantity — 8 of 20 Good Active/,
    }),
  ).toBeTruthy();

  // The Categories tab is one click away.
  await userEvent.setup().click(within(tabs).getByRole('link', { name: 'Categories' }));
  expect(await screen.findByLabelText('New category')).toBeTruthy();
});

test('search and the Category, Status, and Tracking filters send their values and go back to page 1', async () => {
  const fetchMock = fakeApi((method, path) =>
    method === 'GET' && path.startsWith('/items')
      ? { status: 200, body: { data: [CORD], page: 1, pageSize: 25, total: 60 } }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/inventory');
  await screen.findByRole('row', { name: /Extension cord/ });
  expect(lastLoad(fetchMock)).toBe('/api/items?page=1&pageSize=25');

  await user.click(screen.getByRole('button', { name: /Next/ }));
  await vi.waitFor(() => expect(lastLoad(fetchMock)).toBe('/api/items?page=2&pageSize=25'));
  expect(
    within(screen.getByLabelText('Category'))
      .getAllByRole('option')
      .map((option) => option.textContent),
  ).toEqual(['All categories', 'Cables and power', 'Computers']);
  await user.selectOptions(screen.getByLabelText('Category'), 'Computers');
  await vi.waitFor(() =>
    expect(lastLoad(fetchMock)).toBe(`/api/items?page=1&pageSize=25&categoryId=${C1}`),
  );
  await user.selectOptions(screen.getByLabelText('Status'), 'Retired');
  await user.selectOptions(screen.getByLabelText('Tracking'), 'Quantity');
  // One letter does not search (SPEC 7); two do.
  await user.type(screen.getByLabelText('Name or asset tag'), 'l');
  expect(await screen.findByText('Type at least 2 characters.')).toBeTruthy();
  await user.type(screen.getByLabelText('Name or asset tag'), 't');
  await vi.waitFor(() =>
    expect(lastLoad(fetchMock)).toBe(
      `/api/items?page=1&pageSize=25&q=lt&categoryId=${C1}&status=RETIRED&trackingType=QUANTITY`,
    ),
  );
  expect(
    within(screen.getByLabelText('Tracking'))
      .getAllByRole('option')
      .map((option) => option.textContent),
  ).toEqual(['Unit and quantity', 'Unit', 'Quantity']);
});

test('adding a UNIT item sends quantity-free fields; a duplicate asset tag shows under the field', async () => {
  const fetchMock = fakeApi((method) =>
    method === 'POST'
      ? {
          status: 409,
          body: apiError('DUPLICATE_VALUE', 'Asset tag LT-0012 is already used by another item.', {
            fields: { assetTag: ['Asset tag LT-0012 is already used by another item.'] },
          }),
        }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/inventory');
  await user.click(await screen.findByRole('button', { name: '+ Add item' }));

  const form = screen.getByRole('form', { name: 'Add item' });
  expect(screen.queryByRole('table', { name: 'Items' })).toBeNull();
  expect(document.activeElement).toBe(within(form).getByLabelText('Unit (one asset tag per item)'));
  // Browser-side checks first: nothing is sent.
  await user.click(within(form).getByRole('button', { name: 'Save item' }));
  expect(await within(form).findByText('Fix 3 fields below.')).toBeTruthy();
  expect(requests(fetchMock, 'POST')).toEqual([]);

  const quantity = within(form).getByLabelText('Total quantity') as HTMLInputElement;
  expect(quantity.disabled).toBe(true);
  expect(quantity.value).toBe('1');
  await user.type(within(form).getByLabelText('Name'), 'Laptop, Dell Latitude 5440');
  await user.selectOptions(within(form).getByLabelText('Category'), 'Computers');
  await user.type(within(form).getByLabelText('Asset tag'), 'LT-0012');
  await user.click(within(form).getByRole('button', { name: 'Save item' }));

  await vi.waitFor(() =>
    expect(requests(fetchMock, 'POST')).toEqual([
      [
        '/api/items',
        {
          trackingType: 'UNIT',
          name: 'Laptop, Dell Latitude 5440',
          categoryId: C1,
          assetTag: 'LT-0012',
          condition: 'NEW',
          status: 'ACTIVE',
          description: '',
        },
      ],
    ]),
  );
  const assetTag = within(form).getByLabelText('Asset tag');
  expect(
    await within(form).findByText('Asset tag LT-0012 is already used by another item.'),
  ).toBeTruthy();
  expect(assetTag.getAttribute('aria-invalid')).toBe('true');
  expect(document.activeElement).toBe(assetTag);
});

test('adding a QUANTITY item sends the quantity and no asset tag, confirms, and returns to the list', async () => {
  const fetchMock = fakeApi((method, _path, body) =>
    method === 'POST'
      ? { status: 201, body: { item: { ...CORD, ...(body as object), id: 'i9' } } }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/inventory');
  await user.click(await screen.findByRole('button', { name: '+ Add item' }));
  const form = screen.getByRole('form', { name: 'Add item' });
  // An asset tag typed before switching to Quantity is not sent.
  await user.type(within(form).getByLabelText('Asset tag'), 'X-1');
  await user.click(within(form).getByLabelText('Quantity (supplies counted, returned)'));
  expect(within(form).queryByLabelText('Asset tag')).toBeNull();
  await user.type(within(form).getByLabelText('Name'), 'HDMI cable, 3 m');
  await user.selectOptions(within(form).getByLabelText('Category'), 'Cables and power');
  await user.type(within(form).getByLabelText('Total quantity'), '10001');
  await user.click(within(form).getByRole('button', { name: 'Save item' }));
  expect(await within(form).findByText('Enter a whole number from 0 to 10,000.')).toBeTruthy();

  await user.clear(within(form).getByLabelText('Total quantity'));
  await user.type(within(form).getByLabelText('Total quantity'), '0');
  await user.selectOptions(within(form).getByLabelText('Condition'), 'Good');
  await user.click(within(form).getByRole('button', { name: 'Save item' }));

  expect(await screen.findByText('Item HDMI cable, 3 m added.')).toBeTruthy();
  expect(requests(fetchMock, 'POST')).toEqual([
    [
      '/api/items',
      {
        trackingType: 'QUANTITY',
        name: 'HDMI cable, 3 m',
        categoryId: C2,
        totalQuantity: 0,
        condition: 'GOOD',
        status: 'ACTIVE',
        description: '',
      },
    ],
  ]);
  expect(await screen.findByRole('table', { name: 'Items' })).toBeTruthy();
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '+ Add item' })),
  );
});

test('Cancel closes the add form and focus returns to "+ Add item"', async () => {
  fakeApi();
  const user = userEvent.setup();
  renderApp('/inventory');
  await user.click(await screen.findByRole('button', { name: '+ Add item' }));
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(await screen.findByRole('table', { name: 'Items' })).toBeTruthy();
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '+ Add item' })),
  );
});

test('Edit opens a dialog filled from the row, without the tracking type; saving sends PATCH', async () => {
  const fetchMock = fakeApi((method, _path, body) =>
    method === 'PATCH'
      ? { status: 200, body: { item: { ...LAPTOP, ...(body as object) } } }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/inventory');
  await user.click(await screen.findByRole('button', { name: 'Edit LT-0009' }));

  const dialog = screen.getByRole('dialog', { name: 'Edit LT-0009' });
  expect(within(dialog).queryByText(/Tracking type/)).toBeNull();
  expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe(LAPTOP.name);
  expect((within(dialog).getByLabelText('Category') as HTMLSelectElement).value).toBe(C1);
  expect((within(dialog).getByLabelText('Asset tag') as HTMLInputElement).value).toBe('LT-0009');
  expect(
    (within(dialog).getByLabelText('Description (optional)') as HTMLTextAreaElement).value,
  ).toBe('i5, 16 GB RAM');
  await user.selectOptions(within(dialog).getByLabelText('Status'), 'Active');
  await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

  expect(await screen.findByText('Changes to LT-0009 saved.')).toBeTruthy();
  expect(requests(fetchMock, 'PATCH')).toEqual([
    [
      '/api/items/i1',
      {
        name: LAPTOP.name,
        categoryId: C1,
        description: 'i5, 16 GB RAM',
        assetTag: 'LT-0009',
        totalQuantity: 1,
        condition: 'DAMAGED',
        status: 'ACTIVE',
      },
    ],
  ]);
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('S19: deleting an item with history explains why and offers to retire it instead (BR 15)', async () => {
  const fetchMock = fakeApi((method) => {
    if (method === 'DELETE') {
      return {
        status: 409,
        body: apiError(
          'HAS_HISTORY',
          'This item appears in past transactions. Set its status to Retired instead.',
        ),
      };
    }
    if (method === 'PATCH')
      return { status: 200, body: { item: { ...LAPTOP, status: 'RETIRED' } } };
  });
  const user = userEvent.setup();
  renderApp('/inventory');
  await user.click(await screen.findByRole('button', { name: 'Delete LT-0009' }));
  const confirm = screen.getByRole('dialog', { name: 'Delete item?' });
  expect(within(confirm).getByText('LT-0009 will be deleted. This cannot be undone.')).toBeTruthy();
  await user.click(within(confirm).getByRole('button', { name: 'Delete item' }));

  const alert = await screen.findByText('Cannot delete LT-0009.');
  expect(alert.parentElement!.textContent).toMatch(
    'This item appears in past transactions. Set its status to Retired instead.',
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Retire LT-0009' }));

  expect(await screen.findByText('Item LT-0009 retired.')).toBeTruthy();
  expect(requests(fetchMock, 'DELETE')).toEqual([['/api/items/i1', undefined]]);
  expect(requests(fetchMock, 'PATCH')).toEqual([['/api/items/i1', { status: 'RETIRED' }]]);
  expect(screen.queryByText('Cannot delete LT-0009.')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '+ Add item' }));
});

test('deleting an item with no history confirms, deletes, and reloads', async () => {
  const fetchMock = fakeApi((method) => (method === 'DELETE' ? { status: 204 } : undefined));
  const user = userEvent.setup();
  renderApp('/inventory');
  await user.click(await screen.findByRole('button', { name: 'Delete Extension cord, 5 m' }));
  const loadsBefore = requests(fetchMock, 'GET').length;
  await user.click(screen.getByRole('button', { name: 'Delete item' }));
  expect(await screen.findByText('Item Extension cord, 5 m deleted.')).toBeTruthy();
  expect(requests(fetchMock, 'DELETE')).toEqual([['/api/items/i2', undefined]]);
  await vi.waitFor(() => expect(requests(fetchMock, 'GET').length).toBe(loadsBefore + 1));
});

test('a failed list load shows the error and a Retry button, not the empty state', async () => {
  let fail = true;
  fakeApi((method, path) =>
    method === 'GET' && path.startsWith('/items') && fail
      ? { status: 500, body: apiError('INTERNAL_ERROR', 'Something went wrong.') }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/inventory');
  expect(await screen.findByText('Something went wrong.')).toBeTruthy();
  expect(screen.queryByText('No items yet.')).toBeNull();
  fail = false;
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('table', { name: 'Items' })).toBeTruthy();
});
