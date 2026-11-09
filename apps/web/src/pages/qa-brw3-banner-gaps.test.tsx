import type { Borrower, Item, Room } from '@bms/shared';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { afterEach, expect, test, vi } from 'vitest';
import { NotificationProvider, useMessageArea, useNotify } from '../components/Notifications';
import { apiError, HANDLER, mockApi, renderApp, signedInAs } from '../test-utils';

// QA (automated) gap tests for the BRW-3 fix "checkout saved / not saved banners stay in the
// sticky message area" (136ea34..dee4469, ARCHITECTURE 14.1, TC-BRW-39): the scroll padding follows
// messages a page portals in and out (MutationObserver path), the checkout result leaves the area on
// "Start a new checkout" and on navigating away, it shares the area with a notify() notice, and the
// refused field (Remove button for an unavailable item) is scrolled back into view below it.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
});

const messageArea = () => document.querySelector<HTMLElement>('[aria-live="polite"].sticky')!;
const scrollPadding = () => document.documentElement.style.scrollPaddingTop;

// --- Notifications: the page's own messages in the area (useMessageArea) ---

// A page message put into the area through a portal, the way CheckoutPage does it.
function PortalMessage() {
  const area = useMessageArea();
  const notify = useNotify();
  const [shown, setShown] = useState(false);
  return (
    <>
      <button onClick={() => setShown((s) => !s)}>Toggle</button>
      <button onClick={() => notify.success('QA notice.')}>Notify</button>
      {area && shown && createPortal(<p>QA page message</p>, area)}
    </>
  );
}

test('the scroll padding follows a message a page portals into and out of the area', async () => {
  render(
    <NotificationProvider>
      <PortalMessage />
    </NotificationProvider>,
  );
  const user = userEvent.setup();
  const area = messageArea();
  // jsdom has no layout, so the height is faked (as in TC-BRW-39, Notifications.test.tsx).
  Object.defineProperty(area, 'offsetHeight', { configurable: true, value: 48 });
  expect(scrollPadding()).toBe('0px');

  await user.click(screen.getByRole('button', { name: 'Toggle' }));
  expect(within(area).getByText('QA page message')).toBeTruthy();
  await waitFor(() => expect(scrollPadding()).toBe('48px'));

  await user.click(screen.getByRole('button', { name: 'Toggle' }));
  expect(within(area).queryByText('QA page message')).toBeNull();
  await waitFor(() => expect(scrollPadding()).toBe('0px'));
});

test('the scroll padding stays while a portaled message remains after a notice is dismissed', async () => {
  render(
    <NotificationProvider>
      <PortalMessage />
    </NotificationProvider>,
  );
  const user = userEvent.setup();
  Object.defineProperty(messageArea(), 'offsetHeight', { configurable: true, value: 48 });
  await user.click(screen.getByRole('button', { name: 'Notify' }));
  await user.click(screen.getByRole('button', { name: 'Toggle' }));
  await user.click(screen.getByRole('button', { name: 'Dismiss' }));
  await waitFor(() => expect(scrollPadding()).toBe('48px'));
});

test('useMessageArea returns null outside a NotificationProvider', () => {
  let area: HTMLDivElement | null | undefined;
  function Probe() {
    area = useMessageArea();
    return null;
  }
  render(<Probe />);
  expect(area).toBeNull();
});

// --- CheckoutPage: the pinned results ---

const BORROWER: Borrower = {
  id: 'b0000000-0000-4000-8000-0000000000c1',
  schoolId: 'QA-0003',
  name: 'Test Borrower',
  type: 'STUDENT',
  department: 'QA Dept',
  active: true,
};
const room = (id: string, name: string): Room => ({
  id,
  name,
  active: true,
  createdBy: { id: 'u0', name: 'QA Admin' },
  createdAt: '2026-08-01T00:00:00.000Z',
  transactionCount: 0,
});
const ROOM = room('c0000000-0000-4000-8000-0000000000c1', 'QA Lab');
type ListedItem = Item & { available: number };
const CORD: ListedItem = {
  id: 'd0000000-0000-4000-8000-0000000000c1',
  name: 'QA Cord',
  category: { id: 'k1', name: 'QA Category' },
  description: null,
  trackingType: 'QUANTITY',
  assetTag: null,
  totalQuantity: 5,
  condition: 'GOOD',
  status: 'ACTIVE',
  available: 5,
};
const page = <T,>(data: T[]) => ({
  status: 200,
  body: { data, page: 1, pageSize: 10, total: data.length },
});
const SAVED = {
  status: 201,
  body: {
    transaction: {
      id: 't1',
      borrowerId: BORROWER.id,
      locationId: ROOM.id,
      issuedById: 'u1',
      issuedAt: '2026-11-05T02:00:00.000Z',
      semesterId: 's1',
      lines: [{ id: 'l1' }],
    },
  },
};
const INSUFFICIENT = {
  status: 409,
  body: apiError('INSUFFICIENT_QUANTITY', 'Only 1 of QA Cord available, 4 requested.', {
    itemId: CORD.id,
    available: 1,
  }),
};
const UNAVAILABLE = {
  status: 409,
  body: apiError('ITEM_UNAVAILABLE', 'QA Cord is already borrowed.', { itemId: CORD.id }),
};

type Reply = { status: number; body?: unknown };
// `checkout` answers each POST /transactions in turn (the last one repeats).
function fakeApi(...checkout: Reply[]) {
  let rooms = [ROOM];
  return mockApi((method, path, body) => {
    if (path === '/auth/me') return signedInAs(HANDLER);
    if (method === 'GET' && path.startsWith('/borrowers/lookup?')) return page([BORROWER]);
    if (method === 'GET' && path.startsWith('/rooms')) return page(rooms);
    if (method === 'GET' && path.startsWith('/items?')) return page([CORD]);
    // FLG-3: Checkout loads the chosen borrower's strikes.
    if (method === 'GET' && path.endsWith('/strikes')) {
      return {
        status: 200,
        body: {
          strikes: 0,
          warningThreshold: 3,
          noticeThreshold: 4,
          blockThreshold: 5,
          semesterName: null,
        },
      };
    }
    if (method === 'GET' && path === '/closing-time') {
      return { status: 200, body: { closingTime: '17:00' } };
    }
    if (method === 'POST' && path === '/rooms') {
      const added = room('c0000000-0000-4000-8000-0000000000c9', (body as { name: string }).name);
      rooms = [...rooms, added];
      return { status: 201, body: { room: added } };
    }
    if (method === 'POST' && path === '/transactions') {
      return (checkout.length > 1 ? checkout.shift() : checkout[0]) ?? SAVED;
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
}

type User = ReturnType<typeof userEvent.setup>;
async function fillCheckout(user: User) {
  await screen.findByRole('heading', { name: 'Checkout' });
  await user.type(screen.getByLabelText('Find by name or school ID'), 'te');
  await user.click(await screen.findByRole('button', { name: 'Choose Test Borrower' }));
  await screen.findByRole('option', { name: 'QA Lab' });
  await user.selectOptions(screen.getByLabelText('Where will the items be used?'), 'QA Lab');
  await user.type(screen.getByLabelText('Search by name or asset tag'), 'qa');
  await user.click(await screen.findByRole('button', { name: 'Add QA Cord' }));
}
const confirm = (user: User) =>
  user.click(screen.getByRole('button', { name: 'Confirm checkout' }));
async function setQuantity(user: User, value: string) {
  const quantity = screen.getByLabelText('Quantity of QA Cord');
  await user.clear(quantity);
  await user.type(quantity, value);
}

test('"Start a new checkout" removes the saved message and leaves the area truly empty', async () => {
  fakeApi(SAVED);
  const user = userEvent.setup();
  renderApp('/checkout');
  await fillCheckout(user);
  Object.defineProperty(messageArea(), 'offsetHeight', { configurable: true, value: 64 });
  await confirm(user);
  expect(await within(messageArea()).findByText('Checkout saved.')).toBeTruthy();
  await waitFor(() => expect(scrollPadding()).toBe('64px'));

  await user.click(screen.getByRole('button', { name: 'Start a new checkout' }));
  expect(screen.queryByText('Checkout saved.')).toBeNull();
  // No nodes at all (not even whitespace text), so the CSS :empty rule removes the gap.
  expect(messageArea().childNodes).toHaveLength(0);
  await waitFor(() => expect(scrollPadding()).toBe('0px'));
});

test('navigating away after a save removes the saved message from the area', async () => {
  fakeApi(SAVED);
  const user = userEvent.setup();
  const router = renderApp('/checkout');
  await fillCheckout(user);
  await confirm(user);
  await within(messageArea()).findByText('Checkout saved.');

  await router.navigate('/password');
  await screen.findByRole('heading', { name: /password/i });
  expect(screen.queryByText('Checkout saved.')).toBeNull();
  expect(messageArea().childNodes).toHaveLength(0);
  await waitFor(() => expect(scrollPadding()).toBe('0px'));
});

test('navigating away after a refusal removes the not-saved message from the area', async () => {
  fakeApi(INSUFFICIENT);
  const user = userEvent.setup();
  const router = renderApp('/checkout');
  await fillCheckout(user);
  await setQuantity(user, '4');
  await confirm(user);
  await within(messageArea()).findByText('Checkout not saved.');

  await router.navigate('/password');
  await screen.findByRole('heading', { name: /password/i });
  expect(screen.queryByText('Checkout not saved.')).toBeNull();
  expect(messageArea().childNodes).toHaveLength(0);
});

test('a quick-add room notice and the checkout refusal are both shown in the pinned area', async () => {
  fakeApi(INSUFFICIENT);
  const user = userEvent.setup();
  renderApp('/checkout');
  await screen.findByRole('heading', { name: 'Checkout' });
  await user.click(await screen.findByRole('button', { name: '+ Add a new room or lab' }));
  await user.keyboard('QA Room 2{Enter}');
  await within(messageArea()).findByText('Room "QA Room 2" added.');

  await fillCheckout(user);
  await setQuantity(user, '4');
  await confirm(user);
  const area = messageArea();
  await within(area).findByText('Checkout not saved.');
  expect(within(area).getByText('Room "QA Room 2" added.')).toBeTruthy();
  expect(within(area).getByRole('status')).toBeTruthy();
  expect(within(area).getByText('Checkout not saved.').closest('[role=alert]')).toBeTruthy();

  // Dismissing the room notice leaves the refusal pinned.
  await user.click(within(area).getByRole('button', { name: 'Dismiss' }));
  expect(within(area).queryByText('Room "QA Room 2" added.')).toBeNull();
  expect(within(area).getByText('Checkout not saved.')).toBeTruthy();
});

test('a refusal for an unavailable item scrolls its focused Remove button into view', async () => {
  fakeApi(UNAVAILABLE);
  const user = userEvent.setup();
  renderApp('/checkout');
  await fillCheckout(user);
  const scrolled: Element[] = [];
  HTMLElement.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
  await confirm(user);

  await within(messageArea()).findByText('Checkout not saved.');
  const remove = screen.getByRole('button', { name: /Remove QA Cord/ });
  await waitFor(() => expect(document.activeElement).toBe(remove));
  await waitFor(() => expect(scrolled).toContain(remove));
});

test('a save after a refusal replaces the not-saved message with the saved one', async () => {
  fakeApi(INSUFFICIENT, SAVED);
  const user = userEvent.setup();
  renderApp('/checkout');
  await fillCheckout(user);
  await setQuantity(user, '4');
  await confirm(user);
  await within(messageArea()).findByText('Checkout not saved.');

  await setQuantity(user, '1');
  await confirm(user);
  const area = messageArea();
  await within(area).findByText('Checkout saved.');
  expect(within(area).queryByText('Checkout not saved.')).toBeNull();
  await waitFor(() =>
    expect(document.activeElement).toBe(
      within(area).getByRole('button', { name: 'Start a new checkout' }),
    ),
  );
});
