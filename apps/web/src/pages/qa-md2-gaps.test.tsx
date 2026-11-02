import type { Category, Item } from '@bms/shared';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import type { SignedInUser } from '../auth';
import { apiError, emulateModalDialogs, mockApi, renderApp, signedInAs } from '../test-utils';

// QA (automated) gap tests for MD-2, Items tab: each filter and the search go back to page 1, the
// QUANTITY edit dialog, edit errors, delete Cancel, a failed Retire, and switching tabs.

beforeAll(emulateModalDialogs);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ADMIN: SignedInUser = { id: 'u0', name: 'Test Admin', username: 'qa-admin', role: 'ADMIN' };
const C1 = '11111111-1111-4111-8111-111111111111';
const CATEGORY: Category = { id: C1, name: 'QA Category', itemCount: 2 };
const UNIT_ITEM: Item = {
  id: 'i1',
  name: 'QA Laptop',
  category: { id: C1, name: 'QA Category' },
  description: null,
  trackingType: 'UNIT',
  assetTag: 'QA-0001',
  totalQuantity: 1,
  condition: 'GOOD',
  status: 'ACTIVE',
};
const SUPPLY: Item = {
  id: 'i2',
  name: 'QA Cord',
  category: { id: C1, name: 'QA Category' },
  description: 'Orange',
  trackingType: 'QUANTITY',
  assetTag: null,
  totalQuantity: 20,
  condition: 'GOOD',
  status: 'ACTIVE',
};

type Reply = { status: number; body?: unknown };

// A fake API with two items on a 60-item list (so there is a page 2). `answer` overrides any
// items request.
function fakeApi(answer?: (method: string, path: string, body: unknown) => Reply | undefined) {
  return mockApi((method, path, body) => {
    if (path === '/auth/me') return signedInAs(ADMIN);
    if (method === 'GET' && path.startsWith('/categories')) {
      return { status: 200, body: { data: [CATEGORY], page: 1, pageSize: 100, total: 1 } };
    }
    const reply = answer?.(method, path, body);
    if (reply) return reply;
    if (method === 'GET' && path.startsWith('/items')) {
      return { status: 200, body: { data: [SUPPLY, UNIT_ITEM], page: 1, pageSize: 25, total: 60 } };
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
}

const requests = (fetchMock: ReturnType<typeof mockApi>, method: string) =>
  fetchMock.mock.calls
    .filter(([url, init]) => url.startsWith('/api/items') && init?.method === method)
    .map(([url, init]) => [url, init!.body && JSON.parse(init!.body as string)]);
const lastLoad = (fetchMock: ReturnType<typeof mockApi>) => requests(fetchMock, 'GET').at(-1)![0];

async function onPage2(
  fetchMock: ReturnType<typeof mockApi>,
  user: ReturnType<typeof userEvent.setup>,
) {
  await user.click(screen.getByRole('button', { name: /Next/ }));
  await vi.waitFor(() => expect(lastLoad(fetchMock)).toMatch(/page=2&/));
}

test.each([
  ['Status', 'Lost', 'status=LOST'],
  ['Tracking', 'Unit', 'trackingType=UNIT'],
  ['Category', 'QA Category', `categoryId=${C1}`],
])('changing the %s filter on page 2 goes back to page 1', async (label, option, param) => {
  const fetchMock = fakeApi();
  const user = userEvent.setup();
  renderApp('/inventory');
  await screen.findByRole('row', { name: /QA Cord/ });
  await onPage2(fetchMock, user);
  await user.selectOptions(screen.getByLabelText(label), option);
  await vi.waitFor(() =>
    expect(lastLoad(fetchMock)).toBe(`/api/items?page=1&pageSize=25&${param}`),
  );
});

test('a new search on page 2 goes back to page 1', async () => {
  const fetchMock = fakeApi();
  const user = userEvent.setup();
  renderApp('/inventory');
  await screen.findByRole('row', { name: /QA Cord/ });
  await onPage2(fetchMock, user);
  await user.type(screen.getByLabelText('Name or asset tag'), 'qa');
  await vi.waitFor(() => expect(lastLoad(fetchMock)).toBe('/api/items?page=1&pageSize=25&q=qa'));
});

test('the QUANTITY edit dialog has a number total and no asset tag; PATCH sends the new total', async () => {
  const fetchMock = fakeApi((method, _path, body) =>
    method === 'PATCH'
      ? { status: 200, body: { item: { ...SUPPLY, ...(body as object) } } }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/inventory');
  await user.click(await screen.findByRole('button', { name: 'Edit QA Cord' }));
  const dialog = screen.getByRole('dialog', { name: 'Edit QA Cord' });
  expect(within(dialog).queryByLabelText('Asset tag')).toBeNull();
  const total = within(dialog).getByLabelText('Total quantity') as HTMLInputElement;
  expect(total.value).toBe('20');
  expect(total.disabled).toBe(false);

  await user.clear(total);
  await user.type(total, '10001');
  await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  expect(await within(dialog).findByText('Enter a whole number from 0 to 10,000.')).toBeTruthy();
  expect(requests(fetchMock, 'PATCH')).toEqual([]);

  await user.clear(total);
  await user.type(total, '0');
  await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('Changes to QA Cord saved.')).toBeTruthy();
  const [[url, body]] = requests(fetchMock, 'PATCH');
  expect(url).toBe('/api/items/i2');
  expect(body).toMatchObject({ totalQuantity: 0, description: 'Orange' });
  expect(body).not.toHaveProperty('trackingType');
  expect(body).not.toHaveProperty('assetTag');
});

test('a duplicate asset tag on edit shows under the dialog field and keeps the dialog open', async () => {
  const message = 'Asset tag QA-0002 is already used by another item.';
  fakeApi((method) =>
    method === 'PATCH'
      ? {
          status: 409,
          body: apiError('DUPLICATE_VALUE', message, { fields: { assetTag: [message] } }),
        }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/inventory');
  await user.click(await screen.findByRole('button', { name: 'Edit QA-0001' }));
  const dialog = screen.getByRole('dialog', { name: 'Edit QA-0001' });
  const assetTag = within(dialog).getByLabelText('Asset tag');
  await user.clear(assetTag);
  await user.type(assetTag, 'QA-0002');
  await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  expect(await within(dialog).findByText(message)).toBeTruthy();
  expect(assetTag.getAttribute('aria-invalid')).toBe('true');
  expect(screen.getByRole('dialog', { name: 'Edit QA-0001' })).toBeTruthy();
});

test('an edit refused with NOT_FOUND shows the message, closes the dialog, and reloads', async () => {
  const fetchMock = fakeApi((method) =>
    method === 'PATCH'
      ? { status: 404, body: apiError('NOT_FOUND', 'Item not found.') }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/inventory');
  await user.click(await screen.findByRole('button', { name: 'Edit QA-0001' }));
  const loadsBefore = requests(fetchMock, 'GET').length;
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('Item not found.')).toBeTruthy();
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await vi.waitFor(() => expect(requests(fetchMock, 'GET').length).toBeGreaterThan(loadsBefore));
});

test('Cancel in the delete confirm sends nothing', async () => {
  const fetchMock = fakeApi();
  const user = userEvent.setup();
  renderApp('/inventory');
  await user.click(await screen.findByRole('button', { name: 'Delete QA-0001' }));
  const confirm = screen.getByRole('dialog', { name: 'Delete item?' });
  await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(requests(fetchMock, 'DELETE')).toEqual([]);
});

test('a failed Retire shows the error and keeps the "Cannot delete" message with its Retire button', async () => {
  fakeApi((method) => {
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
      return { status: 500, body: apiError('INTERNAL_ERROR', 'Something went wrong.') };
  });
  const user = userEvent.setup();
  renderApp('/inventory');
  await user.click(await screen.findByRole('button', { name: 'Delete QA-0001' }));
  await user.click(screen.getByRole('button', { name: 'Delete item' }));
  await user.click(await screen.findByRole('button', { name: 'Retire QA-0001' }));
  expect(await screen.findByText('Something went wrong.')).toBeTruthy();
  expect(screen.getByText('Cannot delete QA-0001.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Retire QA-0001' })).toBeTruthy();
});

test('the Categories tab at /inventory?tab=categories loads no items; the Items tab link goes back', async () => {
  const fetchMock = fakeApi();
  const user = userEvent.setup();
  renderApp('/inventory?tab=categories');
  const tabs = await screen.findByRole('navigation', { name: 'Inventory sections' });
  expect(within(tabs).getByRole('link', { name: 'Categories' }).getAttribute('aria-current')).toBe(
    'page',
  );
  expect(await screen.findByLabelText('New category')).toBeTruthy();
  expect(requests(fetchMock, 'GET')).toEqual([]);

  await user.click(within(tabs).getByRole('link', { name: 'Items' }));
  expect(await screen.findByRole('table', { name: 'Items' })).toBeTruthy();
  expect(within(tabs).getByRole('link', { name: 'Items' }).getAttribute('aria-current')).toBe(
    'page',
  );
});
