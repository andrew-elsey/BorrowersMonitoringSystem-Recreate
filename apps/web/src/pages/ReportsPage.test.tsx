import type { Borrower, HistoryLine, ItemPage } from '@bms/shared';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import type { SignedInUser } from '../auth';
import { mockApi, renderApp, signedInAs } from '../test-utils';

// RPT-2: the Reports screen, history per borrower. The rules are tested in api/history.test.ts.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const VIEWER: SignedInUser = { id: 'u2', name: 'Rafael Castillo', username: 'rc', role: 'VIEWER' };
const page = <T,>(data: T[]) => ({
  status: 200,
  body: { data, page: 1, pageSize: 25, total: data.length },
});
const MIGUEL: Borrower = {
  id: 'b1',
  schoolId: '2026-0001',
  name: 'Miguel Bautista',
  type: 'STUDENT',
  department: 'IT',
  active: true,
};
const MIGUELA: Borrower = { ...MIGUEL, id: 'b2', schoolId: '2026-0002', name: 'Miguela Santos' };
const LINE: HistoryLine = {
  lineId: 'l1',
  transactionId: 't1',
  borrower: { id: 'b1', schoolId: '2026-0001', name: 'Miguel Bautista' },
  item: { id: 'i1', name: 'Extension cord', assetTag: null },
  room: { id: 'r1', name: 'FA-305' },
  issuedAt: '2026-10-28T00:50:00.000Z',
  issuedBy: { id: 'u0', name: 'Ma. Teresa Lim' },
  quantityBorrowed: 3,
  outstanding: 1,
  returns: [
    {
      id: 'e1',
      quantity: 2,
      returnedAt: '2026-10-28T08:10:00.000Z',
      condition: 'DAMAGED',
      receivedBy: { id: 'u1', name: 'Juan dela Cruz' },
    },
  ],
  flagStatus: 'FLAGGED',
  flaggedAt: '2026-10-28T09:00:00.000Z',
  override: null,
  note: null,
  expectedReturnDate: null,
};
const LAPTOP: ItemPage['data'][number] = {
  id: 'i9',
  name: 'Laptop',
  category: { id: 'c1', name: 'Computers' },
  description: null,
  trackingType: 'UNIT',
  assetTag: 'LT-0012',
  totalQuantity: 1,
  condition: 'GOOD',
  status: 'ACTIVE',
  available: 0,
};

function fakeApi(borrowers: Borrower[]) {
  return mockApi((method, path) => {
    if (path === '/auth/me') return signedInAs(VIEWER);
    if (path.startsWith('/reports/borrowers?')) return page(borrowers);
    if (path.startsWith('/reports/borrowers/b1/history?')) return page([LINE]);
    if (path.startsWith('/items?')) return page([LAPTOP]);
    if (path.startsWith('/reports/items/i9/history?')) return page([{ ...LINE, item: LAPTOP }]);
    throw new Error(`unexpected ${method} ${path}`);
  });
}

async function fillForm(text: string, from: string, to: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Borrower name or school ID'), text);
  fireEvent.change(screen.getByLabelText('From'), { target: { value: from } });
  fireEvent.change(screen.getByLabelText('To'), { target: { value: to } });
  await user.click(screen.getByRole('button', { name: 'Show report' }));
  return user;
}

test('TC-RPT-03, TC-RPT-07: a view-only user sees a borrower history with return and flag details', async () => {
  const fetchMock = fakeApi([MIGUEL]);
  renderApp('/reports');
  expect(await screen.findByRole('link', { name: 'Reports' })).toBeTruthy();
  await fillForm('Miguel', '2026-10-01', '2026-10-31');
  const row = await screen.findByRole('row', { name: /Extension cord/ });
  for (const text of [
    'FA-305',
    '28 Oct 2026, 08:50',
    'Ma. Teresa Lim',
    '28 Oct 2026, 16:10',
    '1 still out',
    'Juan dela Cruz',
    'Damaged',
    'Flagged',
  ]) {
    expect(row.textContent).toContain(text);
  }
  const historyCall = fetchMock.mock.calls.find(([url]) => url.includes('/history?'))![0];
  expect(historyCall).toContain('/reports/borrowers/b1/history?from=2026-10-01&to=2026-10-31');
});

test('TC-RPT-04: a range over 366 days is refused on screen and nothing is sent', async () => {
  const fetchMock = fakeApi([MIGUEL]);
  renderApp('/reports');
  await fillForm('Miguel', '2025-07-02', '2026-11-03');
  expect(await screen.findByText('The date range can be at most 366 days.')).toBeTruthy();
  expect(fetchMock.mock.calls.some(([url]) => url.startsWith('/api/reports'))).toBe(false);
});

test('RPT-2: several matching borrowers must be chosen from', async () => {
  fakeApi([MIGUEL, MIGUELA]);
  renderApp('/reports');
  const user = await fillForm('Migu', '2026-10-01', '2026-10-31');
  expect(await screen.findByText('2 borrowers match. Choose one:')).toBeTruthy();
  expect(screen.queryByRole('row', { name: /Extension cord/ })).toBeNull();
  await user.click(screen.getByRole('button', { name: /Miguel Bautista/ }));
  expect(await screen.findByRole('row', { name: /Extension cord/ })).toBeTruthy();
});

test('RPT-2: no match says so', async () => {
  fakeApi([]);
  renderApp('/reports');
  await fillForm('Nobody', '2026-10-01', '2026-10-31');
  expect((await screen.findByRole('status')).textContent).toContain('No borrower matches');
});

test('TC-RPT-05, TC-RPT-07: a view-only user finds an item by asset tag and sees who borrowed it', async () => {
  const fetchMock = fakeApi([]);
  const user = userEvent.setup();
  renderApp('/reports');
  await user.click(await screen.findByRole('tab', { name: 'History per item' }));
  expect(screen.getByRole('tab', { name: 'History per item' }).getAttribute('aria-selected')).toBe(
    'true',
  );
  await user.type(screen.getByLabelText('Item or asset tag'), 'LT-0012');
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } });
  fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-31' } });
  await user.click(screen.getByRole('button', { name: 'Show report' }));
  expect(await screen.findByRole('heading', { name: /Laptop/ })).toBeTruthy();
  const row = await screen.findByRole('row', { name: /Miguel Bautista/ });
  for (const text of ['2026-0001', 'FA-305', 'Flagged']) expect(row.textContent).toContain(text);
  const urls = fetchMock.mock.calls.map(([url]) => url);
  expect(urls).toContain('/api/items?q=LT-0012&page=1&pageSize=10');
  expect(
    urls.some((url) =>
      url.startsWith('/api/reports/items/i9/history?from=2026-10-01&to=2026-10-31'),
    ),
  ).toBe(true);
});
