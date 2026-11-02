import type { Category } from '@bms/shared';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import type { SignedInUser } from '../auth';
import { apiError, emulateModalDialogs, mockApi, renderApp, signedInAs } from '../test-utils';

// QA round 5 gap tests for MD-1 (head 4531e59): notifications in the page flow inside AppShell,
// the same-name rename rule, error reloads, and Retry focus.

beforeAll(emulateModalDialogs);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ADMIN: SignedInUser = { id: 'u0', name: 'Ma. Teresa Lim', username: 'tlim', role: 'ADMIN' };
const AUDIO: Category = { id: 'c1', name: 'Audio', itemCount: 0 };

const page = (data: Category[]) => ({
  status: 200,
  body: { data, page: 1, pageSize: 25, total: data.length },
});

const listLoads = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => url.startsWith('/api/categories') && init?.method === 'GET',
  ).length;

test('a delete refused with HAS_HISTORY reloads the list, and the row then shows it is in use', async () => {
  let audio = AUDIO;
  const fetchMock = mockApi((method, path) => {
    if (path === '/auth/me') return signedInAs(ADMIN);
    if (method === 'GET') return page([audio]);
    // Someone added an item to Audio after the list loaded (BR 15).
    audio = { ...AUDIO, itemCount: 1 };
    return {
      status: 409,
      body: apiError('HAS_HISTORY', 'This category is used by items, so it cannot be deleted.'),
    };
  });
  const user = userEvent.setup();
  renderApp('/inventory');

  await user.click(await screen.findByRole('button', { name: 'Delete Audio' }));
  const loadsBefore = listLoads(fetchMock);
  await user.click(screen.getByRole('button', { name: 'Delete category' }));

  expect(await screen.findByRole('alert')).toBeTruthy();
  await vi.waitFor(() => expect(listLoads(fetchMock)).toBeGreaterThan(loadsBefore));
  expect(await screen.findByText('Used by 1 item')).toBeTruthy();
});

test('an error notification sits in <main> above the heading, outside the table, and not fixed', async () => {
  mockApi((method, path) => {
    if (path === '/auth/me') return signedInAs(ADMIN);
    if (method === 'GET') return page([AUDIO]);
    return { status: 500, body: apiError('INTERNAL', 'Something went wrong.') };
  });
  const user = userEvent.setup();
  renderApp('/inventory');

  await user.click(await screen.findByRole('button', { name: 'Delete Audio' }));
  await user.click(screen.getByRole('button', { name: 'Delete category' }));

  const message = await within(screen.getByRole('main')).findByRole('alert');
  const region = message.closest('[aria-live="polite"]') as HTMLElement;
  expect(region.className).not.toMatch(/\b(fixed|absolute|sticky)\b/);
  expect(region.contains(screen.getByRole('table', { name: 'Categories' }))).toBe(false);
  const heading = screen.getByRole('heading', { level: 1 });
  expect(region.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // The row buttons are still on the page and reachable.
  expect(screen.getByRole('button', { name: 'Rename Audio' })).toBeTruthy();
});

test('a notification raised just before navigating to another signed-in page is not lost', async () => {
  mockApi((method, path) => {
    if (path === '/auth/me') return signedInAs(ADMIN);
    if (method === 'GET') return page([AUDIO]);
    return { status: 201, body: { category: { id: 'c9', name: 'Projectors', itemCount: 0 } } };
  });
  const user = userEvent.setup();
  renderApp('/inventory');
  await screen.findByRole('row', { name: /Audio/ });

  await user.type(screen.getByLabelText('New category'), 'Projectors');
  await user.click(screen.getByRole('button', { name: 'Add category' }));
  await user.click(screen.getByRole('link', { name: 'Home' }));

  expect(await screen.findByRole('heading', { name: 'Home' })).toBeTruthy();
  expect(within(screen.getByRole('main')).getByRole('status').textContent).toContain('Projectors');
});

test('a 401 on an Inventory action returns to login without crashing, and signing in returns to Inventory', async () => {
  let signedIn = true;
  mockApi((method, path) => {
    if (path === '/auth/me')
      return signedIn
        ? signedInAs(ADMIN)
        : { status: 401, body: apiError('UNAUTHENTICATED', 'Please sign in.') };
    if (path === '/auth/login') {
      signedIn = true;
      return signedInAs(ADMIN);
    }
    if (method === 'GET') return page([AUDIO]);
    signedIn = false;
    return { status: 401, body: apiError('UNAUTHENTICATED', 'Please sign in.') };
  });
  const user = userEvent.setup();
  const router = renderApp('/inventory');
  await screen.findByRole('row', { name: /Audio/ });

  await user.type(screen.getByLabelText('New category'), 'Projectors');
  await user.click(screen.getByRole('button', { name: 'Add category' }));

  expect(await screen.findByLabelText('Username')).toBeTruthy();
  await user.type(screen.getByLabelText('Username'), 'tlim');
  await user.type(screen.getByLabelText('Password'), 'not-a-real-password');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));

  expect(await screen.findByRole('table', { name: 'Categories' })).toBeTruthy();
  expect(router.state.location.pathname).toBe('/inventory');
});

test('TC-MD-24: changing only the case of a name is a real rename and shows the confirmation', async () => {
  mockApi((method, path) => {
    if (path === '/auth/me') return signedInAs(ADMIN);
    if (method === 'GET') return page([AUDIO]);
    return { status: 200, body: { category: { ...AUDIO, name: 'AUDIO' } } };
  });
  const user = userEvent.setup();
  renderApp('/inventory');

  await user.click(await screen.findByRole('button', { name: 'Rename Audio' }));
  const field = within(screen.getByRole('dialog')).getByRole('textbox');
  await user.clear(field);
  await user.type(field, 'AUDIO{Enter}');

  expect(await screen.findByText('Category "Audio" renamed to "AUDIO".')).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('a rename that fails with a server error keeps the dialog open with the typed name', async () => {
  mockApi((method, path) => {
    if (path === '/auth/me') return signedInAs(ADMIN);
    if (method === 'GET') return page([AUDIO]);
    return { status: 500, body: apiError('INTERNAL', 'Something went wrong.') };
  });
  const user = userEvent.setup();
  renderApp('/inventory');

  await user.click(await screen.findByRole('button', { name: 'Rename Audio' }));
  const field = within(screen.getByRole('dialog')).getByRole('textbox') as HTMLInputElement;
  await user.clear(field);
  await user.type(field, 'Sound{Enter}');

  expect(await screen.findByText('Something went wrong.')).toBeTruthy();
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(field.value).toBe('Sound');
});

test('TC-MD-25: a Retry that fails again keeps focus on Retry instead of jumping to "New category"', async () => {
  mockApi((_method, path) => {
    if (path === '/auth/me') return signedInAs(ADMIN);
    return { status: 500, body: apiError('INTERNAL', 'Something went wrong.') };
  });
  const user = userEvent.setup();
  renderApp('/inventory');

  const retry = await screen.findByRole('button', { name: 'Retry' });
  retry.focus();
  await user.keyboard('{Enter}');

  await vi.waitFor(() =>
    expect((screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  expect(document.activeElement).not.toBe(screen.getByLabelText('New category'));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Retry' }));
});
