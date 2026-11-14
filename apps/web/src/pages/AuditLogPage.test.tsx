import type { AuditEntryView, AuditPage } from '@bms/shared';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { SignedInUser } from '../auth';
import { HANDLER, mockApi, renderApp, signedInAs } from '../test-utils';

// HRD-1: the Audit log screen (TC-HRD-19). The filtering itself is tested in api/audit-log.test.ts.

const ADMIN: SignedInUser = { id: 'u0', name: 'Ma. Teresa Lim', username: 'mtl', role: 'ADMIN' };
const ENTRIES: AuditEntryView[] = [
  {
    id: 'a1',
    createdAt: '2026-11-03T06:32:00.000Z', // 14:32 in Manila
    actor: { id: 'u1', name: 'Juan dela Cruz' },
    action: 'RETURN',
    entity: 'return',
    entityId: 'ret-1',
    before: null,
    after: { quantity: 1 },
  },
  {
    id: 'a2',
    createdAt: '2026-11-02T09:00:00.000Z',
    actor: null,
    action: 'LINE_FLAGGED',
    entity: 'transaction_item',
    entityId: 'line-1',
    before: { flagStatus: 'NONE' },
    after: { flagStatus: 'FLAGGED' },
  },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-03T08:00:00.000Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fakeApi(data: AuditEntryView[] = ENTRIES) {
  return mockApi((method, path) => {
    if (path === '/auth/me') return signedInAs(ADMIN);
    if (method === 'GET' && path.startsWith('/users'))
      return {
        status: 200,
        body: { data: [{ ...HANDLER, active: true }], page: 1, pageSize: 100, total: 1 },
      };
    if (method === 'GET' && path.startsWith('/audit')) {
      const body: AuditPage = { data, page: 1, pageSize: 25, total: data.length };
      return { status: 200, body };
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
}

const auditRequests = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.map(([url]) => url as string).filter((url) => url.startsWith('/api/audit'));

test('TC-HRD-19: the admin opens Audit log from the menu and sees the last 7 days, in Manila time', async () => {
  const fetchMock = fakeApi();
  renderApp('/');
  await userEvent.click(await screen.findByRole('link', { name: 'Audit log' }));

  const table = await screen.findByRole('table', { name: 'Audit log entries' });
  expect(auditRequests(fetchMock)).toEqual([
    '/api/audit?from=2026-10-28&to=2026-11-03&page=1&pageSize=25',
  ]);
  await within(table).findByText('Juan dela Cruz');
  const rows = within(table).getAllByRole('row');
  expect(rows[1]!.textContent).toContain('3 Nov 2026, 14:32:00');
  expect(rows[1]!.textContent).toContain('Juan dela Cruz');
  expect(rows[1]!.textContent).toContain('Return');
  // An entry with no actor is the system.
  expect(within(rows[2]!).getByText('System')).toBeTruthy();
  expect(within(rows[2]!).getByText('Transaction line')).toBeTruthy();
  // Before and after are in the row's details; a missing before is a dash.
  expect(rows[1]!.textContent).toContain('"quantity": 1');
});

test('TC-HRD-19: Actor offers staff and System; Filter sends the chosen actor and entity', async () => {
  const fetchMock = fakeApi();
  const user = userEvent.setup();
  renderApp('/audit');
  await screen.findByRole('table', { name: 'Audit log entries' });

  const actor = screen.getByLabelText('Actor');
  await vi.waitFor(() =>
    expect(
      within(actor)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['All staff and system', 'Juan dela Cruz', 'System']),
  );
  await user.selectOptions(actor, 'system');
  await user.selectOptions(screen.getByLabelText('Entity'), 'flagging_run');
  await user.click(screen.getByRole('button', { name: 'Filter' }));
  await vi.waitFor(() =>
    expect(auditRequests(fetchMock)).toContain(
      '/api/audit?from=2026-10-28&to=2026-11-03&page=1&pageSize=25&actor=system&entity=flagging_run',
    ),
  );
});

test('TC-HRD-19: a range over 366 days is refused in the form and no request is sent', async () => {
  const fetchMock = fakeApi();
  const user = userEvent.setup();
  renderApp('/audit');
  await screen.findByRole('table', { name: 'Audit log entries' });

  const from = screen.getByLabelText('From (required)');
  await user.clear(from);
  await user.type(from, '2025-01-01');
  await user.click(screen.getByRole('button', { name: 'Filter' }));
  expect((await screen.findByRole('alert')).textContent).toBe(
    'The date range can be at most 366 days.',
  );
  expect(auditRequests(fetchMock)).toHaveLength(1);
});

test('TC-HRD-19: no entries says so with the range', async () => {
  fakeApi([]);
  renderApp('/audit');
  await screen.findByText('No audit entries match these filters in 2026-10-28 to 2026-11-03.');
});

test('TC-HRD-19: a handler has no Audit log in the menu and is told it is not allowed', async () => {
  mockApi((_method, path) => {
    if (path === '/auth/me') return signedInAs(HANDLER);
    throw new Error(`unexpected ${path}`);
  });
  renderApp('/audit');
  await screen.findByRole('heading', { name: "You can't open this page" });
  expect(screen.queryByRole('link', { name: 'Audit log' })).toBeNull();
});

test('TC-HRD-19: when the user list fails to load, the page says so with a Retry button', async () => {
  mockApi((_method, path) => {
    if (path === '/auth/me') return signedInAs(ADMIN);
    if (path.startsWith('/users'))
      return {
        status: 500,
        body: { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } },
      };
    return { status: 200, body: { data: [], page: 1, pageSize: 25, total: 0 } };
  });
  renderApp('/audit');
  const alert = await screen.findByRole('alert');
  expect(within(alert).getByRole('button', { name: 'Retry' })).toBeTruthy();
});
