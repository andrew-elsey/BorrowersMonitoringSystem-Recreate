import type { FlaggedBorrowerPage, OpenLine } from '@bms/shared';
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { HANDLER, mockApi, renderApp, signedInAs } from '../test-utils';

const VIEWER = { ...HANDLER, role: 'VIEWER' as const };

// RPT-1: the Dashboard screen (and the BRW-6 notes on it). What the lists hold is tested in
// api/dashboard.test.ts; these tests check what the screen shows.

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const LAPTOP: OpenLine = {
  lineId: 'l1',
  transactionId: 't1',
  borrower: { id: 'b1', schoolId: '2021-10457', name: 'Miguel Bautista' },
  item: { id: 'i1', name: 'Laptop, Dell Latitude 5440', assetTag: 'LT-0012', trackingType: 'UNIT' },
  location: 'CL-201',
  issuedBy: 'Juan dela Cruz',
  issuedAt: '2026-11-02T01:12:00.000Z', // 09:12 in Manila
  expectedReturnDate: '2026-11-03',
  note: 'Says he will return it tomorrow morning.',
  quantityBorrowed: 1,
  outstanding: 1,
  flagStatus: 'FLAGGED',
  flaggedAt: '2026-11-02T09:00:00.000Z', // 17:00 in Manila
  strikes: 3,
};
const CORDS: OpenLine = {
  ...LAPTOP,
  lineId: 'l2',
  transactionId: 't2',
  borrower: { id: 'b2', schoolId: '2023-20981', name: 'Kristine Mendoza' },
  item: { id: 'i2', name: 'Extension cord, 5 m', assetTag: null, trackingType: 'QUANTITY' },
  issuedAt: '2026-11-03T00:40:00.000Z', // 08:40 on 3 Nov in Manila
  note: null,
  expectedReturnDate: null,
  quantityBorrowed: 5,
  outstanding: 2,
  flagStatus: 'NONE',
  flaggedAt: null,
  strikes: 0,
};
const THRESHOLDS = { warningThreshold: 3, noticeThreshold: 4, blockThreshold: 5 };
const STRUCK: FlaggedBorrowerPage = {
  data: [
    {
      borrower: { id: 'b3', schoolId: '2020-08812', name: 'Carlo Dizon', type: 'STUDENT' },
      strikes: 5,
    },
    {
      borrower: { id: 'b4', schoolId: '2022-11230', name: 'Liza Ramos', type: 'STUDENT' },
      strikes: 4,
    },
    {
      borrower: { id: 'b1', schoolId: '2021-10457', name: 'Miguel Bautista', type: 'STUDENT' },
      strikes: 3,
    },
    {
      borrower: { id: 'b5', schoolId: 'EMP-0142', name: 'Jose Reyes', type: 'FACULTY' },
      strikes: 1,
    },
  ],
  page: 1,
  pageSize: 25,
  total: 4,
  ...THRESHOLDS,
  semesterName: '1st Semester AY 2026–2027',
};

function fakeApi(
  user = HANDLER,
  lines: OpenLine[] = [LAPTOP, CORDS],
  struck: FlaggedBorrowerPage = STRUCK,
) {
  return mockApi((_method, path) => {
    if (path === '/auth/me') return signedInAs(user);
    if (path === '/closing-time') return { status: 200, body: { closingTime: '17:00' } };
    if (path.startsWith('/dashboard/unreturned')) {
      const body = { data: lines, page: 1, pageSize: 25, total: lines.length, ...THRESHOLDS };
      return { status: 200, body };
    }
    if (path.startsWith('/dashboard/flagged-borrowers')) return { status: 200, body: struck };
    throw new Error(`unexpected ${path}`);
  });
}
const rowOf = (text: string) => screen.getByText(text).closest('tr')!;

test('TC-BRW-33, TC-RPT-01: unreturned lines show their note, expected return date, and flag', async () => {
  // 3 Nov 2026, 10:00 in Manila: the cords issued this morning are due at today's closing.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-03T02:00:00.000Z'));
  const fetchMock = fakeApi();
  renderApp('/');
  expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy();
  await screen.findByText('Laptop, Dell Latitude 5440');

  expect(
    await screen.findByText(
      'Tuesday, 3 November 2026 · 1st Semester AY 2026–2027 · Closing time 17:00',
    ),
  ).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Currently unreturned (2)' })).toBeTruthy();

  const laptop = within(rowOf('Laptop, Dell Latitude 5440'));
  expect(laptop.getByText('Says he will return it tomorrow morning.')).toBeTruthy();
  expect(laptop.getByText('3 Nov 2026')).toBeTruthy();
  expect(laptop.getByText('Flagged')).toBeTruthy();
  expect(laptop.getByText('Since 2 Nov, 17:00')).toBeTruthy();
  expect(laptop.getByText('Asset tag LT-0012')).toBeTruthy();
  expect(laptop.getByText('2 Nov 2026, 09:12')).toBeTruthy();

  const cords = within(rowOf('Extension cord, 5 m'));
  expect(cords.getByText('No note')).toBeTruthy();
  expect(cords.getByText('—')).toBeTruthy();
  expect(cords.getByText('2 of 5')).toBeTruthy();
  expect(cords.getByText('Due today 17:00')).toBeTruthy();
  expect(cords.queryByText('Flagged')).toBeNull();
  // The dashboard is read-only: no note editing here (ARCHITECTURE 14.1).
  expect(screen.queryByRole('button', { name: /Edit note/ })).toBeNull();

  const urls = fetchMock.mock.calls.map(([url]) => String(url));
  expect(urls).toContain('/api/dashboard/unreturned?page=1&pageSize=25');
  expect(urls).toContain('/api/dashboard/flagged-borrowers?page=1&pageSize=25');
});

test('TC-RPT-01: flagged borrowers show strikes and the warning, notice, and blocked levels', async () => {
  fakeApi();
  renderApp('/');
  await screen.findByText('Carlo Dizon');
  expect(screen.getByRole('heading', { name: 'Flagged borrowers this semester (4)' })).toBeTruthy();
  expect(within(rowOf('Carlo Dizon')).getByText('Blocked: 5 strikes')).toBeTruthy();
  expect(within(rowOf('Liza Ramos')).getByText('Notice: 4 strikes')).toBeTruthy();
  expect(within(rowOf('Jose Reyes')).getByText('Below warning')).toBeTruthy();
  expect(within(rowOf('Jose Reyes')).getByText('Faculty')).toBeTruthy();
  expect(within(rowOf('EMP-0142')).getByText('1')).toBeTruthy();
});

test('TC-RPT-02: a view-only user gets the dashboard and its menu entry; empty lists say so', async () => {
  fakeApi(VIEWER, [], { ...STRUCK, data: [], total: 0 });
  renderApp('/');
  expect(
    await screen.findByText('Nothing is out right now. Every item has been returned.'),
  ).toBeTruthy();
  expect(screen.getByText('No borrower has a strike this semester.')).toBeTruthy();
  const menu = screen.getByRole('navigation', { name: 'Main' });
  expect(within(menu).getByRole('link', { name: 'Dashboard' })).toBeTruthy();
  expect(screen.getByText('View-only', { selector: 'span' })).toBeTruthy();
});

test('no current semester: the strikes list says so', async () => {
  fakeApi(HANDLER, [], { ...STRUCK, data: [], total: 0, semesterName: null });
  renderApp('/');
  expect(await screen.findByText('No current semester is set.')).toBeTruthy();
  expect(await screen.findByText(/No current semester · Closing time 17:00/)).toBeTruthy();
});
