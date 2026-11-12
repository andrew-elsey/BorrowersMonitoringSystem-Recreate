import type { UsageSummary } from '@bms/shared';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { SignedInUser } from '../auth';
import { mockApi, renderApp, signedInAs } from '../test-utils';

// RPT-4: the Usage summary tab of Reports. The counting itself is tested in api/usage-report.test.ts.

const VIEWER: SignedInUser = { id: 'u9', name: 'Rafael Castillo', username: 'rc', role: 'VIEWER' };
const SUMMARY: UsageSummary = {
  from: '2026-10-14',
  to: '2026-11-12',
  items: [
    { id: 'i1', name: 'Extension cord', assetTag: null, timesBorrowed: 12 },
    { id: 'i2', name: 'Laptop', assetTag: 'LT-0012', timesBorrowed: 3 },
  ],
  categories: [{ id: 'c1', name: 'Cables', timesBorrowed: 12 }],
  rooms: [{ id: 'r1', name: 'CL-201', timesBorrowed: 15 }],
};

beforeEach(() => {
  // 20:00 UTC on 11 Nov is 04:00 on 12 Nov in Manila: "today" is the app timezone's date.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-11T20:00:00.000Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fakeApi(summary = SUMMARY) {
  return mockApi((method, path) => {
    if (path === '/auth/me') return signedInAs(VIEWER);
    if (method === 'GET' && path.startsWith('/reports/usage'))
      return { status: 200, body: summary };
    throw new Error(`unexpected ${method} ${path}`);
  });
}

const usageRequests = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls
    .map(([url]) => url as string)
    .filter((url) => url.includes('/reports/usage'));

const text = (element: HTMLElement) => element.textContent;

// Usage summary is the third tab of Reports, after the two history reports.
async function openUsageTab() {
  renderApp('/reports');
  await userEvent.click(await screen.findByRole('tab', { name: 'Usage summary' }));
}

test('TC-RPT-07: a view-only user opens Reports and sees the last 30 days as bar charts and tables', async () => {
  const fetchMock = fakeApi();
  await openUsageTab();

  const items = await screen.findByRole('region', { name: 'Most borrowed items' });
  expect(screen.getByRole('link', { name: 'Reports' }).getAttribute('aria-current')).toBe('page');
  expect(usageRequests(fetchMock)).toEqual(['/api/reports/usage?from=2026-10-14&to=2026-11-12']);
  within(items).getByText('Times borrowed, 14 Oct 2026 – 12 Nov 2026');
  const list = within(items).getByRole('list', { name: 'Most borrowed items' });
  expect(within(list).getAllByRole('listitem').map(text)).toEqual([
    'Extension cord12',
    'Laptop LT-00123',
  ]);
  // The same numbers as a table.
  within(within(items).getByRole('table')).getByRole('row', { name: 'Laptop LT-0012 3' });
  expect(text(screen.getByRole('region', { name: 'By category' }))).toContain('Cables12');
  expect(text(screen.getByRole('region', { name: 'By room or lab' }))).toContain('CL-20115');
});

test('a range over 366 days is refused in the form with its length, and no request is sent', async () => {
  const fetchMock = fakeApi();
  const user = userEvent.setup();
  await openUsageTab();
  await screen.findByRole('region', { name: 'Most borrowed items' });

  const from = screen.getByLabelText('From');
  await user.clear(from);
  await user.type(from, '2025-07-02');
  await user.click(screen.getByRole('button', { name: 'Show report' }));

  expect(text(await screen.findByRole('alert'))).toBe(
    'The date range can be at most 366 days. You chose 499 days.',
  );
  expect(document.activeElement).toBe(from);
  expect(usageRequests(fetchMock)).toHaveLength(1);

  // A valid range is sent.
  await user.clear(from);
  await user.type(from, '2026-11-01');
  await user.click(screen.getByRole('button', { name: 'Show report' }));
  expect(screen.queryByRole('alert')).toBeNull();
  await vi.waitFor(() =>
    expect(usageRequests(fetchMock)).toContain('/api/reports/usage?from=2026-11-01&to=2026-11-12'),
  );
});

test('a period with nothing borrowed says so', async () => {
  fakeApi({ ...SUMMARY, items: [], categories: [], rooms: [] });
  await openUsageTab();
  await screen.findByText('Nothing was borrowed from 14 Oct 2026 – 12 Nov 2026.');
});
