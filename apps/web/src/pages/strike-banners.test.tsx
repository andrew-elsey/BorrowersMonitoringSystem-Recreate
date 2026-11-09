import type { Borrower, StrikeStatus } from '@bms/shared';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { apiError, HANDLER, mockApi, renderApp, signedInAs } from '../test-utils';

// FLG-3: strike banners on Checkout and the strike badge on Return (BR 11, TC-FLG-21). The count
// and thresholds come from the API; these tests check what the screen shows for them.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const FIL: Borrower = {
  id: 'b0000000-0000-4000-8000-000000000001',
  schoolId: '2022-15530',
  name: 'Fil Garcia',
  type: 'STUDENT',
  department: 'Multimedia Arts',
  active: true,
};
const status = (strikes: number, thresholds = [3, 4, 5]): StrikeStatus => ({
  strikes,
  warningThreshold: thresholds[0]!,
  noticeThreshold: thresholds[1]!,
  blockThreshold: thresholds[2]!,
  semesterName: '1st Semester AY 2026-2027',
});

function fakeApi(strikes: StrikeStatus, strikesFail = false) {
  return mockApi((method, path) => {
    if (path === '/auth/me') return signedInAs(HANDLER);
    if (path.startsWith('/borrowers/lookup?q=')) {
      return { status: 200, body: { data: [FIL], page: 1, pageSize: 10, total: 1 } };
    }
    if (path === `/borrowers/${FIL.id}/strikes`) {
      return strikesFail
        ? { status: 500, body: apiError('INTERNAL_ERROR', 'Something went wrong.') }
        : { status: 200, body: strikes };
    }
    if (path.startsWith('/rooms'))
      return { status: 200, body: { data: [], page: 1, pageSize: 100, total: 0 } };
    if (path === '/closing-time') return { status: 200, body: { closingTime: '17:00' } };
    if (path.startsWith('/returns/open')) {
      return {
        status: 200,
        body: {
          data: [
            {
              lineId: 'a0000000-0000-4000-8000-000000000001',
              transactionId: 't1',
              borrower: { id: FIL.id, schoolId: FIL.schoolId, name: FIL.name },
              item: { id: 'i1', name: 'Laptop', assetTag: 'LT-1', trackingType: 'UNIT' },
              location: 'CL-201',
              issuedBy: 'Hal',
              issuedAt: '2026-11-02T01:12:00.000Z',
              expectedReturnDate: null,
              note: null,
              quantityBorrowed: 1,
              outstanding: 1,
              flagStatus: 'NONE',
              flaggedAt: null,
              strikes: strikes.strikes,
            },
          ],
          page: 1,
          pageSize: 50,
          total: 1,
          warningThreshold: strikes.warningThreshold,
          noticeThreshold: strikes.noticeThreshold,
          blockThreshold: strikes.blockThreshold,
        },
      };
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
}

async function openCheckout(strikes: StrikeStatus, strikesFail = false) {
  fakeApi(strikes, strikesFail);
  const user = userEvent.setup();
  renderApp('/checkout');
  await user.type(await screen.findByLabelText('Find by name or school ID'), 'fi');
  await user.click(await screen.findByRole('button', { name: 'Choose Fil Garcia' }));
}

test('TC-FLG-21: 2 strikes show the count and no banner', async () => {
  await openCheckout(status(2));
  expect(await screen.findByText('2 strikes')).toBeTruthy();
  expect(screen.queryByText(/Warning:|Notice:|Blocked:/)).toBeNull();
});

test('TC-FLG-21: 3 strikes show the warning and checkout stays open', async () => {
  await openCheckout(status(3));
  expect(await screen.findByText('Warning: 3 strikes.')).toBeTruthy();
  // The full name, so "Ma. Teresa Lim" is never cut to "Ma." (owner decision 2026-11-10).
  expect(
    screen.getByText(/Fil Garcia has 3 flagged checkouts this semester\. Checkout is allowed\./),
  ).toBeTruthy();
  expect(screen.getByLabelText('Where will the items be used?').matches(':disabled')).toBe(false);
});

test('TC-FLG-21: 4 strikes show the stricter notice with the block threshold from settings', async () => {
  await openCheckout(status(4));
  expect(await screen.findByText('Notice: 4 strikes.')).toBeTruthy();
  expect(screen.getByText(/at 5 strikes Fil Garcia will be blocked/)).toBeTruthy();
});

test('TC-FLG-21: 5 strikes show the blocked message and lock the form', async () => {
  await openCheckout(status(5));
  expect(await screen.findByText('Blocked: 5 strikes.')).toBeTruthy();
  expect(screen.getByText('Checkout is blocked for this borrower (5 strikes).')).toBeTruthy();
  // The borrower is active: the inactive message must not show (it names reactivating the record).
  expect(screen.queryByText(/Inactive borrower/)).toBeNull();
  expect(screen.getByLabelText('Where will the items be used?').matches(':disabled')).toBe(true);
});

test('TC-FLG-21 (rule 3): the thresholds are the ones the API gives, not 3, 4, 5', async () => {
  await openCheckout(status(2, [2, 3, 4]));
  expect(await screen.findByText('Warning: 2 strikes.')).toBeTruthy();
});

test('TC-FLG-57: a failed strikes load shows a Retry message, not 0 strikes', async () => {
  await openCheckout(status(5), true);
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
  expect(screen.queryByText('0 strikes')).toBeNull();
});

test('TC-FLG-56: the Return screen shows the strike badge, and returns stay open at the block', async () => {
  const fetchMock = fakeApi(status(5));
  renderApp('/return');
  expect(await screen.findByText('Blocked: 5 strikes')).toBeTruthy();
  expect(screen.getByText(/Returns are always allowed/)).toBeTruthy();
  // The badge comes with GET /api/returns/open: no request per borrower (nginx rate limit).
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/strikes'))).toBe(false);
  expect((screen.getByRole('button', { name: 'Return' }) as HTMLButtonElement).disabled).toBe(
    false,
  );
});
