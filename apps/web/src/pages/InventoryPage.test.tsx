import type { Category } from '@bms/shared';
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

// MD-1: the categories part of the Inventory and categories screen.

beforeAll(emulateModalDialogs);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ADMIN: SignedInUser = { id: 'u0', name: 'Ma. Teresa Lim', username: 'tlim', role: 'ADMIN' };
const AUDIO: Category = { id: 'c1', name: 'Audio', itemCount: 0 };
const LAPTOPS: Category = { id: 'c2', name: 'Laptops', itemCount: 14 };
const CAMERAS: Category = { id: 'c3', name: 'Cameras', itemCount: 1 };

// A fake API holding the categories list. `answer` overrides the reply to a change request.
function fakeApi(answer?: (method: string, path: string, body: unknown) => object | undefined) {
  return mockApi((method, path, body) => {
    if (path === '/auth/me') return signedInAs(ADMIN);
    if (method === 'GET' && path.startsWith('/categories')) {
      const reply = answer?.(method, path, body);
      if (reply) return reply as { status: number; body?: unknown };
      return {
        status: 200,
        body: { data: [AUDIO, CAMERAS, LAPTOPS], page: 1, pageSize: 25, total: 3 },
      };
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
  const fetchMock = fakeApi();
  const user = userEvent.setup();
  renderApp('/inventory');

  const table = await screen.findByRole('table', { name: 'Categories' });
  const laptops = await within(table).findByRole('row', { name: /Laptops 14/ });
  // Still focusable, so keyboard and screen reader users hear why it does nothing.
  const deleteLaptops = within(laptops).getByRole('button', { name: 'Delete Laptops' });
  expect(deleteLaptops.getAttribute('aria-disabled')).toBe('true');
  expect(deleteLaptops.hasAttribute('disabled')).toBe(false);
  expect(
    document.getElementById(deleteLaptops.getAttribute('aria-describedby')!)!.textContent,
  ).toBe('Used by 14 items');
  expect(within(table).getByText('Used by 1 item')).toBeTruthy();
  await user.click(deleteLaptops);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(changeRequests(fetchMock)).toEqual([]);

  const audio = within(table).getByRole('row', { name: /Audio 0/ });
  expect(
    within(audio).getByRole('button', { name: 'Delete Audio' }).hasAttribute('aria-disabled'),
  ).toBe(false);
});

test('a failed list load shows the error and a Retry button, not the empty state', async () => {
  let fail = true;
  const fetchMock = fakeApi((method) =>
    method === 'GET' && fail
      ? { status: 500, body: apiError('INTERNAL', 'Something went wrong. Try again.') }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/inventory');

  expect(await screen.findByText('Something went wrong. Try again.')).toBeTruthy();
  expect(screen.queryByText('No categories yet.')).toBeNull();
  expect(screen.queryByText(/Showing/)).toBeNull();

  fail = false;
  const loadsBefore = categoryListLoads(fetchMock);
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('table', { name: 'Categories' })).toBeTruthy();
  expect(categoryListLoads(fetchMock)).toBe(loadsBefore + 1);
  // The Retry button is gone, so focus goes to the name field instead of the page start.
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(screen.getByLabelText('New category')),
  );
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

test('adding a category sends the name, names it in the confirmation, clears the field, and reloads', async () => {
  const fetchMock = fakeApi((method) =>
    method === 'POST'
      ? { status: 201, body: { category: { id: 'c9', name: 'Projectors', itemCount: 0 } } }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/inventory');
  await screen.findByRole('row', { name: /Audio/ });
  const loadsBefore = categoryListLoads(fetchMock);

  await user.type(screen.getByLabelText('New category'), 'Projectors');
  await user.click(screen.getByRole('button', { name: 'Add category' }));

  expect(await screen.findByText('Category "Projectors" added.')).toBeTruthy();
  expect(changeRequests(fetchMock)).toEqual([['POST', '/api/categories', { name: 'Projectors' }]]);
  expect((screen.getByLabelText('New category') as HTMLInputElement).value).toBe('');
  expect(categoryListLoads(fetchMock)).toBeGreaterThan(loadsBefore);
});

test('the confirmation sits in the page flow above the heading, not over the table buttons', async () => {
  fakeApi((method) =>
    method === 'POST'
      ? { status: 201, body: { category: { id: 'c9', name: 'Projectors', itemCount: 0 } } }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/inventory');
  await screen.findByRole('row', { name: /Audio/ });
  await user.type(screen.getByLabelText('New category'), 'Projectors');
  await user.click(screen.getByRole('button', { name: 'Add category' }));

  const message = await within(screen.getByRole('main')).findByRole('status');
  const region = message.closest('[aria-live="polite"]') as HTMLElement;
  expect(region.className).not.toMatch(/\b(fixed|absolute)\b/);
  const heading = screen.getByRole('heading', { level: 1 });
  expect(region.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('an empty name is refused in the browser; a duplicate name shows the API error under the field', async () => {
  const message = 'A category named "Audio" already exists.';
  const fetchMock = fakeApi((method) =>
    method === 'POST'
      ? { status: 409, body: apiError('DUPLICATE_VALUE', message, { fields: { name: [message] } }) }
      : undefined,
  );
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

test('Rename opens a dialog with the name filled in and focused; Enter saves and focus returns to Rename', async () => {
  const fetchMock = fakeApi((method) =>
    method === 'PUT' ? { status: 200, body: { category: { ...AUDIO, name: 'Sound' } } } : undefined,
  );
  const user = userEvent.setup();
  renderApp('/inventory');

  const renameButton = await screen.findByRole('button', { name: 'Rename Audio' });
  await user.click(renameButton);
  const dialog = screen.getByRole('dialog', { name: 'Rename Audio' });
  const field = within(dialog).getByLabelText('New name') as HTMLInputElement;
  expect(field.value).toBe('Audio');
  expect(document.activeElement).toBe(field);

  await user.clear(field);
  await user.type(field, 'Sound{Enter}');

  expect(await screen.findByText('Category "Audio" renamed to "Sound".')).toBeTruthy();
  expect(changeRequests(fetchMock)).toEqual([['PUT', '/api/categories/c1', { name: 'Sound' }]]);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(renameButton);
  // The top form stays for adding.
  expect(screen.getByLabelText('New category')).toBeTruthy();
});

test('a rename still succeeds when the browser closes the dialog while it is saving', async () => {
  fakeApi((method) => {
    if (method !== 'PUT') return undefined;
    // Chrome closes a modal dialog itself on a repeated Escape, even while a request runs.
    screen.getByRole('dialog').dispatchEvent(new Event('close'));
    return { status: 200, body: { category: { ...AUDIO, name: 'Sound' } } };
  });
  const user = userEvent.setup();
  renderApp('/inventory');

  await user.click(await screen.findByRole('button', { name: 'Rename Audio' }));
  const field = screen.getByLabelText('New name');
  await user.clear(field);
  await user.type(field, 'Sound{Enter}');

  expect(await screen.findByText('Category "Audio" renamed to "Sound".')).toBeTruthy();
});

test('a duplicate name on rename shows the API error under the dialog field and keeps it open', async () => {
  const message = 'A category named "Laptops" already exists.';
  fakeApi((method) =>
    method === 'PUT'
      ? { status: 409, body: apiError('DUPLICATE_VALUE', message, { fields: { name: [message] } }) }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/inventory');

  await user.click(await screen.findByRole('button', { name: 'Rename Audio' }));
  const dialog = screen.getByRole('dialog', { name: 'Rename Audio' });
  const field = within(dialog).getByLabelText('New name');
  await user.clear(field);
  await user.type(field, 'Laptops');
  await user.click(within(dialog).getByRole('button', { name: 'Save name' }));

  expect(await within(dialog).findByText(message)).toBeTruthy();
  expect(field.getAttribute('aria-invalid')).toBe('true');
  expect(screen.getByRole('dialog', { name: 'Rename Audio' })).toBeTruthy();
});

test('Cancel closes the rename dialog without sending anything and returns focus to Rename', async () => {
  const fetchMock = fakeApi();
  const user = userEvent.setup();
  renderApp('/inventory');

  const renameButton = await screen.findByRole('button', { name: 'Rename Audio' });
  await user.click(renameButton);
  await user.click(screen.getByRole('button', { name: 'Cancel' }));

  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(renameButton);
  expect(changeRequests(fetchMock)).toEqual([]);
});

test('delete asks first, then deletes and focuses the name field; a HAS_HISTORY refusal is shown as a notification', async () => {
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
  expect(await screen.findByText('Category "Audio" deleted.')).toBeTruthy();
  expect(changeRequests(fetchMock)).toEqual([['DELETE', '/api/categories/c1', undefined]]);
  // Its row is gone, so focus goes to the name field instead of the page start.
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(screen.getByLabelText('New category')),
  );

  // Someone added an item to it after the list loaded: the server refuses (BR 15).
  refuse = true;
  await user.click(screen.getByRole('button', { name: 'Delete Audio' }));
  await user.click(screen.getByRole('button', { name: 'Delete category' }));
  expect(
    await screen.findByText('This category is used by items, so it cannot be deleted.'),
  ).toBeTruthy();
});

test('a delete refused with NOT_FOUND (someone else deleted it) shows the message and reloads the list', async () => {
  const fetchMock = fakeApi((method) =>
    method === 'DELETE'
      ? { status: 404, body: apiError('NOT_FOUND', 'Category not found.') }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/inventory');

  await user.click(await screen.findByRole('button', { name: 'Delete Audio' }));
  const loadsBefore = categoryListLoads(fetchMock);
  await user.click(screen.getByRole('button', { name: 'Delete category' }));
  expect(await screen.findByText('Category not found.')).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  await vi.waitFor(() => expect(categoryListLoads(fetchMock)).toBe(loadsBefore + 1));
});

test('the first Tab reaches a "Skip to main content" link that targets the main area', async () => {
  fakeApi();
  const user = userEvent.setup();
  renderApp('/inventory');
  await screen.findByRole('table', { name: 'Categories' });

  await user.tab();
  const skip = screen.getByRole('link', { name: 'Skip to main content' });
  expect(document.activeElement).toBe(skip);
  expect(skip.getAttribute('href')).toBe('#main');
  expect(screen.getByRole('main').id).toBe('main');
});
