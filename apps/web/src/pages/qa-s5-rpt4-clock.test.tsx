import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { SignedInUser } from '../auth';
import { mockApi, renderApp, signedInAs } from '../test-utils';

// QA (RPT-2, RPT-4): the reports' default To date is "today" in Asia/Manila, read from the clock.
// The clock is faked to a fixed day far from any real date, so these fail every day, not only
// on days other than the one a test was written on.

const VIEWER: SignedInUser = { id: 'u9', name: 'Test Viewer', username: 'tv', role: 'VIEWER' };

beforeEach(() => {
  // 16:30 UTC on 14 Jun 2030 is 00:30 on 15 Jun 2030 in Manila.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2030-06-14T16:30:00.000Z'));
  mockApi((method, path) => {
    if (path === '/auth/me') return signedInAs(VIEWER);
    if (method === 'GET' && path.startsWith('/reports/usage'))
      return {
        status: 200,
        body: { from: '2030-05-17', to: '2030-06-15', items: [], categories: [], rooms: [] },
      };
    return { status: 200, body: { data: [], page: 1, pageSize: 25, total: 0 } };
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const toField = () => screen.getByLabelText('To') as HTMLInputElement;

test('RPT-2: the history report defaults To to the Manila date of the clock', async () => {
  renderApp('/reports');
  await screen.findByRole('tab', { name: 'Usage summary' });
  expect(toField().value).toBe('2030-06-15');
});

// BUG (RPT-4): UsageReport.tsx todayInAppZone() calls Intl.DateTimeFormat#format() with no date,
// which reads the real system clock instead of Date, so the default period ignores the app's
// clock. This is also why UsageReport.test.tsx fails on any day but 12 Nov 2026. Kept as
// test.fails so the suite stays green; remove .fails when fixed.
test.fails('BUG RPT-4: the usage summary defaults To to the Manila date of the clock', async () => {
  renderApp('/reports');
  await userEvent.click(await screen.findByRole('tab', { name: 'Usage summary' }));
  await screen.findByRole('button', { name: 'Show report' });
  expect(toField().value).toBe('2030-06-15');
});
