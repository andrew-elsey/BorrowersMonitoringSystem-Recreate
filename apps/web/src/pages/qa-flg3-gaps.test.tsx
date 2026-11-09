import type { Borrower, OpenLine, StrikeStatus } from '@bms/shared';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { apiError, HANDLER, mockApi, renderApp, signedInAs } from '../test-utils';

// QA (automated) gap tests for FLG-3 on the web (BR 11, SPEC 5, 8). Covers what
// strike-banners.test.tsx leaves open: banners at the exact edges of non-default thresholds, the
// singular "1 strike", the locked Confirm button, a blocked borrower who is also inactive, Retry
// recovering the blocked state, the server's BORROWER_BLOCKED message when the screen thought the
// borrower could borrow, and Return badges for several borrowers taken only from the open-lines
// reply (its thresholds, with no /strikes request).

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const BORROWER: Borrower = {
  id: 'b0000000-0000-4000-8000-000000000001',
  schoolId: 'QA-0001',
  name: 'Test Borrower',
  type: 'STUDENT',
  department: 'IT',
  active: true,
};
const ROOM = {
  id: 'c0000000-0000-4000-8000-000000000001',
  name: 'QA Lab',
  active: true,
  createdBy: { id: 'u0', name: 'QA Admin' },
  createdAt: '2026-08-01T00:00:00.000Z',
  transactionCount: 0,
};
const LAPTOP = {
  id: 'd0000000-0000-4000-8000-000000000001',
  name: 'QA Laptop',
  category: { id: 'c1', name: 'Laptops' },
  description: null,
  trackingType: 'UNIT',
  assetTag: 'QA-LT-1',
  totalQuantity: 1,
  condition: 'GOOD',
  status: 'ACTIVE',
  available: 1,
};
const BLOCKED_MESSAGE =
  'This borrower is blocked from borrowing this semester because of too many strikes. An admin can override a flag to unblock them.';

const status = (strikes: number, thresholds = [3, 4, 5]): StrikeStatus => ({
  strikes,
  warningThreshold: thresholds[0]!,
  noticeThreshold: thresholds[1]!,
  blockThreshold: thresholds[2]!,
  semesterName: 'QA Semester',
});
const page = <T,>(data: T[]) => ({
  status: 200,
  body: { data, page: 1, pageSize: 10, total: data.length },
});

type Reply = { status: number; body?: unknown };
type Options = {
  borrower?: Borrower;
  // Called once per strikes request, with the request number (1, 2, ...).
  strikes: (call: number) => Reply;
  postTransaction?: Reply;
};

function fakeCheckoutApi(options: Options) {
  let strikeCalls = 0;
  const borrower = options.borrower ?? BORROWER;
  return mockApi((method, path) => {
    if (path === '/auth/me') return signedInAs(HANDLER);
    if (path.startsWith('/borrowers/lookup?q=')) return page([borrower]);
    if (path === `/borrowers/${borrower.id}/strikes`) return options.strikes(++strikeCalls);
    if (path.startsWith('/rooms')) return page([ROOM]);
    if (path.startsWith('/items?q=')) return page([LAPTOP]);
    if (path === '/closing-time') return { status: 200, body: { closingTime: '17:00' } };
    if (method === 'POST' && path === '/transactions' && options.postTransaction) {
      return options.postTransaction;
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
}

async function chooseBorrower(options: Options) {
  const fetchMock = fakeCheckoutApi(options);
  const user = userEvent.setup();
  renderApp('/checkout');
  await user.type(await screen.findByLabelText('Find by name or school ID'), 'qa');
  await user.click(
    await screen.findByRole('button', { name: `Choose ${(options.borrower ?? BORROWER).name}` }),
  );
  return { user, fetchMock };
}

const ok = (s: StrikeStatus) => () => ({ status: 200, body: s });
const roomPicker = () => screen.getByLabelText('Where will the items be used?');
const confirmButton = () =>
  screen.getByRole<HTMLButtonElement>('button', { name: 'Confirm checkout' });

// --- Banners at the exact edges of thresholds changed in settings (rule 3) ---

test('one strike below a raised warning threshold shows the count and no banner', async () => {
  await chooseBorrower({ strikes: ok(status(3, [4, 5, 6])) });
  expect(await screen.findByText('3 strikes')).toBeTruthy();
  expect(screen.queryByText(/Warning:|Notice:|Blocked:/)).toBeNull();
});

test('at a raised notice threshold of 5, 5 strikes is a notice naming the block at 6, and the form stays open', async () => {
  await chooseBorrower({ strikes: ok(status(5, [4, 5, 6])) });
  expect(await screen.findByText('Notice: 5 strikes.')).toBeTruthy();
  expect(screen.getByText(/at 6 strikes Test Borrower will be blocked/)).toBeTruthy();
  expect(screen.queryByText(/Blocked:/)).toBeNull();
  expect(roomPicker().matches(':disabled')).toBe(false);
});

test('at a block threshold of 6, 6 strikes is blocked and the form is locked', async () => {
  await chooseBorrower({ strikes: ok(status(6, [4, 5, 6])) });
  expect(await screen.findByText('Blocked: 6 strikes.')).toBeTruthy();
  expect(screen.getByText('Checkout is blocked for this borrower (6 strikes).')).toBeTruthy();
  expect(roomPicker().matches(':disabled')).toBe(true);
});

test('above the block threshold the borrower is still shown as blocked', async () => {
  await chooseBorrower({ strikes: ok(status(8)) });
  expect(await screen.findByText('Blocked: 8 strikes.')).toBeTruthy();
});

test('a single strike reads "1 strike", not "1 strikes"', async () => {
  await chooseBorrower({ strikes: ok(status(1)) });
  expect(await screen.findByText('1 strike')).toBeTruthy();
  expect(screen.queryByText('1 strikes')).toBeNull();
});

test('the strike count shows the semester name the API gives', async () => {
  await chooseBorrower({ strikes: ok(status(2)) });
  const chosen = await screen.findByRole('group', { name: 'Chosen borrower' });
  expect(await within(chosen).findByText('QA Semester')).toBeTruthy();
});

// --- The locked form ---

test('a blocked borrower cannot be confirmed: the Confirm checkout button is disabled', async () => {
  await chooseBorrower({ strikes: ok(status(5)) });
  await screen.findByText('Blocked: 5 strikes.');
  expect(confirmButton().disabled).toBe(true);
  expect(screen.getByLabelText('Search by name or asset tag').matches(':disabled')).toBe(true);
});

test('a blocked borrower who is also inactive shows the inactive message, not the blocked footer', async () => {
  await chooseBorrower({ borrower: { ...BORROWER, active: false }, strikes: ok(status(5)) });
  expect(await screen.findByText('Inactive borrower.')).toBeTruthy();
  expect(screen.getByText('Inactive borrowers cannot borrow.')).toBeTruthy();
  expect(screen.queryByText(/Checkout is blocked for this borrower/)).toBeNull();
});

test('the warning banner alone never locks the form or disables Confirm because of strikes', async () => {
  await chooseBorrower({ strikes: ok(status(3)) });
  await screen.findByText('Warning: 3 strikes.');
  expect(screen.queryByText(/Checkout is blocked for this borrower/)).toBeNull();
  expect(roomPicker().matches(':disabled')).toBe(false);
});

// --- Retry when the strikes request fails (SPEC 8) ---

test('Retry after a failed strikes load fetches again and then shows the blocked state', async () => {
  const { user } = await chooseBorrower({
    strikes: (call) =>
      call === 1
        ? { status: 500, body: apiError('INTERNAL_ERROR', 'Something went wrong.') }
        : { status: 200, body: status(5) },
  });
  await user.click(await screen.findByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Blocked: 5 strikes.')).toBeTruthy();
  expect(roomPicker().matches(':disabled')).toBe(true);
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
});

test('a failed strikes load shows no warning, notice, or blocked banner', async () => {
  await chooseBorrower({
    strikes: () => ({ status: 500, body: apiError('INTERNAL_ERROR', 'Something went wrong.') }),
  });
  await screen.findByRole('button', { name: 'Retry' });
  expect(screen.queryByText(/Warning:|Notice:|Blocked:/)).toBeNull();
  expect(screen.queryByText(/\d+ strikes?$/)).toBeNull();
});

// --- The server enforces the block even when the screen allowed the checkout ---

test("a BORROWER_BLOCKED refusal on Confirm shows the server's message", async () => {
  const { user } = await chooseBorrower({
    strikes: ok(status(4)),
    postTransaction: { status: 409, body: apiError('BORROWER_BLOCKED', BLOCKED_MESSAGE) },
  });
  await screen.findByText('Notice: 4 strikes.');
  await user.selectOptions(roomPicker(), 'QA Lab');
  await user.type(screen.getByLabelText('Search by name or asset tag'), 'qa');
  await user.click(await screen.findByRole('button', { name: 'Add QA Laptop QA-LT-1' }));
  await user.click(confirmButton());
  const alert = (await screen.findByText('Checkout not saved.')).closest('[role=alert]')!;
  expect(alert.textContent).toContain(BLOCKED_MESSAGE);
});

// --- Return badges from the open-lines reply ---

const line = (n: number, strikes: number): OpenLine => ({
  lineId: `a0000000-0000-4000-8000-00000000000${n}`,
  transactionId: `qa-t${n}`,
  borrower: { id: `qa-b${n}`, schoolId: `QA-000${n}`, name: `Borrower ${n}` },
  item: { id: `qa-i${n}`, name: `QA Laptop ${n}`, assetTag: `QA-LT-${n}`, trackingType: 'UNIT' },
  location: 'QA Lab',
  issuedBy: 'QA Handler',
  issuedAt: `2026-11-10T0${n}:00:00.000Z`,
  expectedReturnDate: null,
  note: null,
  quantityBorrowed: 1,
  outstanding: 1,
  flagStatus: 'NONE',
  flaggedAt: null,
  strikes,
});

function fakeReturnApi(lines: OpenLine[], thresholds: [number, number, number]) {
  return mockApi((method, path) => {
    if (path === '/auth/me') return signedInAs(HANDLER);
    if (path.startsWith('/returns/open')) {
      return {
        status: 200,
        body: {
          data: lines,
          page: 1,
          pageSize: 50,
          total: lines.length,
          warningThreshold: thresholds[0],
          noticeThreshold: thresholds[1],
          blockThreshold: thresholds[2],
        },
      };
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
}

test('Return shows a badge for every borrower at each level, with no /strikes requests', async () => {
  const fetchMock = fakeReturnApi([line(1, 0), line(2, 3), line(3, 4), line(4, 5)], [3, 4, 5]);
  renderApp('/return');
  expect(await screen.findByText('Blocked: 5 strikes')).toBeTruthy();
  expect(screen.getByText('0 strikes')).toBeTruthy();
  expect(screen.getByText('Warning: 3 strikes')).toBeTruthy();
  expect(screen.getByText('Notice: 4 strikes')).toBeTruthy();
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/strikes'))).toBe(false);
  // Returns are never blocked: every row keeps its Return button.
  const buttons = screen.getAllByRole<HTMLButtonElement>('button', { name: 'Return' });
  expect(buttons).toHaveLength(4);
  expect(buttons.every((button) => !button.disabled)).toBe(true);
});

test('Return badges use the thresholds in the open-lines reply, not 3, 4, 5', async () => {
  fakeReturnApi([line(1, 3), line(2, 5), line(3, 6)], [4, 5, 6]);
  renderApp('/return');
  expect(await screen.findByText('Blocked: 6 strikes')).toBeTruthy();
  expect(screen.getByText('3 strikes')).toBeTruthy();
  expect(screen.getByText('Notice: 5 strikes')).toBeTruthy();
  expect(screen.queryByText('Warning: 3 strikes')).toBeNull();
});
