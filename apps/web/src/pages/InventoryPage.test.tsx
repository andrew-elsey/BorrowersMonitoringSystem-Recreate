import type { Category } from '@bms/shared';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import type { SignedInUser } from '../auth';
import { apiError, HANDLER, mockApi, renderApp, signedInAs } from '../test-utils';

// MD-1: the categories part of the Inventory and categories screen.

// jsdom has no modal dialogs. Browsers provide these; here they only toggle `open`.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false;
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ADMIN: SignedInUser = { id: 'u0', name: 'Ma. Teresa Lim', username: 'tlim', role: 'ADMIN' };
const AUDIO: Category = { id: 'c1', name: 'Audio', itemCount: 0 };
const LAPTOPS: Category = { id: 'c2', name: 'Laptops', itemCount: 14 };

// A fake API holding the categories list. `answer` overrides the reply to a change request.
function fakeApi(answer?: (method: string, path: string, body: unknown) => object | undefined) {
  return mockApi((method, path, body) => {
    if (path === '/auth/me') return signedInAs(ADMIN);
    if (method === 'GET' && path.startsWith('/categories')) {
      return { status: 200, body: { data: [AUDIO, LAPTOPS], page: 1, pageSize: 25, total: 2 } };
    }
    const reply = answer?.(method, path, body);
    if (reply) return reply as { status: number; body?: unknown };
    throw new Error(`unexpected ${method} ${path}`);
  });
}

const changeRequests = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls
    .filter(([url, init]) => url.startsWith('/api/categories') && init?.method !== 'GET')
    .map(([url, init]) => [init!.method, url, init!.body && JSON.parse(init!.body as string)]);

const categoryListLoads = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => url.startsWith('/api/categories') && init?.method === 'GET',
  ).length;

test('lists categories with their item counts; a category in use cannot be deleted (BR 15)', async () => {
  fakeApi();
  renderApp('/inventory');

  const table = await screen.findByRole('table', { name: 'Categories' });
  const laptops = await within(table).findByRole('row', { name: /Laptops 14/ });
  expect(
    (within(laptops).getByRole('button', { name: 'Delete Laptops' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(within(laptops).getByText('In use, cannot delete')).toBeTruthy();
  const audio = within(table).getByRole('row', { name: /Audio 0/ });
  expect(
    (within(audio).getByRole('button', { name: 'Delete Audio' }) as HTMLButtonElement).disabled,
  ).toBe(false);
});

test('the screen is in the admin menu only; other roles get the not-allowed page (SPEC 3)', async () => {
  fakeApi();
  renderApp('/');
  const menu = await screen.findByRole('navigation', { name: 'Main' });
  expect(within(menu).getByRole('link', { name: 'Inventory and categories' })).toBeTruthy();
  cleanup();

  mockApi(() => signedInAs(HANDLER));
  renderApp('/inventory');
  expect(await screen.findByRole('heading', { name: "You can't open this page" })).toBeTruthy();
  expect(screen.queryByRole('table', { name: 'Categories' })).toBeNull();
  expect(
    within(screen.getByRole('navigation', { name: 'Main' })).queryByRole('link', {
      name: 'Inventory and categories',
    }),
  ).toBeNull();
});

test('adding a category sends the name, confirms, clears the field, and reloads the list', async () => {
  const fetchMock = fakeApi((method) =>
    method === 'POST' ? { status: 201, body: { category: AUDIO } } : undefined,
  );
  const user = userEvent.setup();
  renderApp('/inventory');
  await screen.findByRole('row', { name: /Audio/ });
  const loadsBefore = categoryListLoads(fetchMock);

  await user.type(screen.getByLabelText('New category'), 'Projectors');
  await user.click(screen.getByRole('button', { name: 'Add category' }));

  expect(await screen.findByText('Category added.')).toBeTruthy();
  expect(changeRequests(fetchMock)).toEqual([['POST', '/api/categories', { name: 'Projectors' }]]);
  expect((screen.getByLabelText('New category') as HTMLInputElement).value).toBe('');
  expect(categoryListLoads(fetchMock)).toBeGreaterThan(loadsBefore);
});

test('an empty name is refused in the browser; a duplicate name shows the API error under the field', async () => {
  const message = 'A category named "Audio" already exists.';
  const fetchMock = fakeApi(() => ({
    status: 409,
    body: apiError('DUPLICATE_VALUE', message, { fields: { name: [message] } }),
  }));
  const user = userEvent.setup();
  renderApp('/inventory');
  await screen.findByRole('row', { name: /Audio/ });

  await user.click(screen.getByRole('button', { name: 'Add category' }));
  expect(await screen.findByText('Enter a category name.')).toBeTruthy();
  expect(changeRequests(fetchMock)).toEqual([]);

  await user.type(screen.getByLabelText('New category'), 'Audio');
  await user.click(screen.getByRole('button', { name: 'Add category' }));
  const field = screen.getByLabelText('New category');
  expect(await screen.findByText(message, { selector: `#name-message` })).toBeTruthy();
  expect(field.getAttribute('aria-invalid')).toBe('true');
});

test('renaming fills the field with the current name, sends PUT, and returns to adding', async () => {
  const fetchMock = fakeApi((method) =>
    method === 'PUT' ? { status: 200, body: { category: { ...AUDIO, name: 'Sound' } } } : undefined,
  );
  const user = userEvent.setup();
  renderApp('/inventory');

  await user.click(await screen.findByRole('button', { name: 'Rename Audio' }));
  const field = screen.getByLabelText('New name for Audio') as HTMLInputElement;
  expect(field.value).toBe('Audio');
  expect(document.activeElement).toBe(field);

  await user.clear(field);
  await user.type(field, 'Sound');
  await user.click(screen.getByRole('button', { name: 'Save name' }));

  expect(await screen.findByText('Category renamed.')).toBeTruthy();
  expect(changeRequests(fetchMock)).toEqual([['PUT', '/api/categories/c1', { name: 'Sound' }]]);
  expect(screen.getByLabelText('New category')).toBeTruthy();
});

test('clicking Rename again on the same category moves focus back to the field and keeps the typing', async () => {
  fakeApi();
  const user = userEvent.setup();
  renderApp('/inventory');

  await user.click(await screen.findByRole('button', { name: 'Rename Audio' }));
  const field = screen.getByLabelText('New name for Audio') as HTMLInputElement;
  await user.type(field, ' gear');
  await user.click(screen.getByRole('button', { name: 'Rename Audio' }));

  expect(document.activeElement).toBe(field);
  expect(field.value).toBe('Audio gear');
});

test('Cancel stops renaming without sending anything', async () => {
  const fetchMock = fakeApi();
  const user = userEvent.setup();
  renderApp('/inventory');

  await user.click(await screen.findByRole('button', { name: 'Rename Audio' }));
  await user.click(screen.getByRole('button', { name: 'Cancel' }));

  expect((screen.getByLabelText('New category') as HTMLInputElement).value).toBe('');
  expect(changeRequests(fetchMock)).toEqual([]);
});

test('delete asks first, then deletes; a HAS_HISTORY refusal is shown as a notification', async () => {
  let refuse = false;
  const fetchMock = fakeApi((method) => {
    if (method !== 'DELETE') return undefined;
    if (!refuse) return { status: 204 };
    return {
      status: 409,
      body: apiError('HAS_HISTORY', 'This category is used by items, so it cannot be deleted.'),
    };
  });
  const user = userEvent.setup();
  renderApp('/inventory');

  await user.click(await screen.findByRole('button', { name: 'Delete Audio' }));
  const dialog = screen.getByRole('dialog', { name: 'Delete category?' });
  expect(within(dialog).getByText('Audio will be deleted. This cannot be undone.')).toBeTruthy();
  await user.click(within(dialog).getByRole('button', { name: 'Delete category' }));
  expect(await screen.findByText('Category deleted.')).toBeTruthy();
  expect(changeRequests(fetchMock)).toEqual([['DELETE', '/api/categories/c1', undefined]]);

  // Someone added an item to it after the list loaded: the server refuses (BR 15).
  refuse = true;
  await user.click(screen.getByRole('button', { name: 'Delete Audio' }));
  await user.click(screen.getByRole('button', { name: 'Delete category' }));
  expect(
    await screen.findByText('This category is used by items, so it cannot be deleted.'),
  ).toBeTruthy();
});
