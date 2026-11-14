import { act, cleanup, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { SignedInUser } from '../auth';
import { HANDLER, mockApi, renderApp, signedInAs, signedOut } from '../test-utils';

// QA (automated) gap tests for HRD-6: the Suspense fallback shows inside the app shell while a lazy
// page's chunk loads (TC-HRD-11), the sign-in screen needs no page chunk, and a page the role may
// not open never downloads its chunk. Each screen page module is replaced by a stub that loads
// only when its gate opens, so a test controls how long the "chunk download" takes.

const gates = vi.hoisted(() => {
  const requested = new Set<string>();
  const open = new Map<string, () => void>();
  // Resolves when the test opens the gate for `page`; records that the app asked for the chunk.
  const waitFor = (page: string) => {
    requested.add(page);
    return new Promise<void>((resolve) => open.set(page, resolve));
  };
  return { requested, open, waitFor };
});

// Each stub keeps the page's named export, so App.tsx's `.then((m) => m.XPage)` mapping is exercised.
const stub = (page: string) => ({ [page]: () => <h1>{page} stub</h1> });
vi.mock(
  './DashboardPage',
  async () => (await gates.waitFor('DashboardPage'), stub('DashboardPage')),
);
vi.mock(
  './InventoryPage',
  async () => (await gates.waitFor('InventoryPage'), stub('InventoryPage')),
);
vi.mock(
  './BorrowersPage',
  async () => (await gates.waitFor('BorrowersPage'), stub('BorrowersPage')),
);
vi.mock('./RoomsPage', async () => (await gates.waitFor('RoomsPage'), stub('RoomsPage')));
vi.mock('./SettingsPage', async () => (await gates.waitFor('SettingsPage'), stub('SettingsPage')));
vi.mock(
  './ChangePasswordPage',
  async () => (await gates.waitFor('ChangePasswordPage'), stub('ChangePasswordPage')),
);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ADMIN: SignedInUser = { id: 'u0', name: 'Test Admin', username: 'qa-admin', role: 'ADMIN' };

const meAs = (me: typeof signedOut | ReturnType<typeof signedInAs>) =>
  mockApi((method, path) => {
    if (path === '/auth/me') return me;
    throw new Error(`unexpected ${method} ${path}`);
  });

test('shows "Loading…" inside the visible app shell until the page chunk arrives, then the page', async () => {
  meAs(signedInAs(ADMIN));
  renderApp('/rooms');

  const loading = await screen.findByRole('status');
  expect(loading.textContent).toBe('Loading…');
  expect(within(screen.getByRole('main')).getByRole('status')).toBe(loading);
  expect(screen.getByText('Borrowers Monitoring System')).toBeTruthy();
  expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'RoomsPage stub' })).toBeNull();

  await act(async () => gates.open.get('RoomsPage')!());

  expect(await screen.findByRole('heading', { name: 'RoomsPage stub' })).toBeTruthy();
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
});

test('renders the sign-in screen without requesting any screen page chunk', async () => {
  meAs(signedOut);
  const before = new Set(gates.requested);
  renderApp('/login');

  expect(await screen.findByLabelText('Username')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  expect(screen.queryByText('Loading…')).toBeNull();
  expect([...gates.requested].filter((page) => !before.has(page))).toEqual([]);
});

test('does not download the chunk of a page the role may not open', async () => {
  meAs(signedInAs(HANDLER));
  renderApp('/settings');

  expect(await screen.findByRole('heading', { name: "You can't open this page" })).toBeTruthy();
  expect(screen.queryByText('Loading…')).toBeNull();
  expect(gates.requested.has('SettingsPage')).toBe(false);
});
