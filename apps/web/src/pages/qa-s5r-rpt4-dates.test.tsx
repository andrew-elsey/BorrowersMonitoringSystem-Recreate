import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import type { SignedInUser } from '../auth';
import { mockApi, renderApp, signedInAs } from '../test-utils';

// QA rerun gap tests for the RPT-4 default-dates fix (ae0ab2f): the Usage summary's default period
// runs from 30 days before today to today in Asia/Manila, read from the app clock, on any date. Also
// TC-RPT-07 after the owner decision of 2026-11-14: Reports has three tabs, the Dashboard is the
// fourth report.

const VIEWER: SignedInUser = { id: 'u9', name: 'Test Viewer', username: 'tv', role: 'VIEWER' };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fakeApiAt(instant: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(instant));
  return mockApi((method, path) => {
    if (path === '/auth/me') return signedInAs(VIEWER);
    if (method === 'GET' && path.startsWith('/reports/usage')) {
      const query = new URLSearchParams(path.split('?')[1]);
      return {
        status: 200,
        body: {
          from: query.get('from'),
          to: query.get('to'),
          items: [],
          categories: [],
          rooms: [],
        },
      };
    }
    return { status: 200, body: { data: [], page: 1, pageSize: 25, total: 0 } };
  });
}

const usageRequests = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.map(([url]) => url).filter((url) => url.startsWith('/api/reports/usage'));

test.each([
  // [clock in UTC, expected From, expected To (Manila date)]
  ['2027-01-01T16:30:00.000Z', '2026-12-03', '2027-01-02'], // just after midnight in Manila, new year
  ['2028-02-29T03:00:00.000Z', '2028-01-30', '2028-02-29'], // leap day
  ['2028-03-01T15:59:59.000Z', '2028-01-31', '2028-03-01'], // 23:59:59 in Manila, leap year
  ['2026-03-30T00:00:00.000Z', '2026-02-28', '2026-03-30'], // 30 days back crosses February
])('RPT-4: with the clock at %s the default period is %s to %s', async (instant, from, to) => {
  const fetchMock = fakeApiAt(instant);
  renderApp('/reports');
  await userEvent.click(await screen.findByRole('tab', { name: 'Usage summary' }));
  await screen.findByRole('button', { name: 'Show report' });
  expect((screen.getByLabelText('From') as HTMLInputElement).value).toBe(from);
  expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe(to);
  await vi.waitFor(() =>
    expect(usageRequests(fetchMock)).toEqual([`/api/reports/usage?from=${from}&to=${to}`]),
  );
});

test('TC-RPT-07: a view-only user sees exactly three Reports tabs; no separate unreturned tab', async () => {
  fakeApiAt('2026-11-14T02:00:00.000Z');
  renderApp('/reports');
  const tablist = await screen.findByRole('tablist');
  expect(
    within(tablist)
      .getAllByRole('tab')
      .map((tab) => tab.textContent),
  ).toEqual(['History per borrower', 'History per item', 'Usage summary']);
});
