import type { Borrower, Category, Item, Room, Semester, Settings } from '@bms/shared';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import type { SignedInUser } from '../auth';
import {
  apiError,
  emulateModalDialogs,
  HANDLER,
  mockApi,
  renderApp,
  signedInAs,
} from '../test-utils';

// REG-1 QA gap tests: edges of the session-expired message, titles on every route and role,
// the Available column for every status, and cellTextClass on every name-like table cell.

beforeAll(emulateModalDialogs);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ADMIN: SignedInUser = { id: 'u0', name: 'Ma. Teresa Lim', username: 'tlim', role: 'ADMIN' };
const VIEWER: SignedInUser = { id: 'u2', name: 'Lea Ramos', username: 'lramos', role: 'VIEWER' };
const EXPIRED = 'Your session has expired. Please sign in again.';
const TITLE = (page: string) => `${page} · Borrowers Monitoring System`;
const emptyPage = { status: 200, body: { data: [], page: 1, pageSize: 25, total: 0 } };
const unauthenticated = { status: 401, body: apiError('UNAUTHENTICATED', 'Please sign in.') };

async function signInAgain(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Username'), 'tlim');
  await user.type(screen.getByLabelText('Password'), 'a long passphrase');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('session-expired message (TC-AUTH-37 edges)', () => {
  // `api.expired` makes every data request answer 401, as the server does once the session is gone.
  // `api.loginFails` makes the next sign-in a wrong password.
  function sessionApi(api: { expired: boolean; loginFails?: boolean }) {
    return mockApi((method, path) => {
      if (path === '/auth/me') return signedInAs(ADMIN);
      if (path === '/auth/login' && api.loginFails) {
        return {
          status: 401,
          body: apiError('INVALID_CREDENTIALS', 'Wrong username or password.'),
        };
      }
      if (path === '/auth/login') return { status: 200, body: { user: ADMIN } };
      if (path === '/auth/logout') return { status: 204 };
      if (api.expired) return unauthenticated;
      return emptyPage;
    });
  }

  test('a 401 from a mutation (Change password) also shows the expiry message', async () => {
    mockApi((method, path) => (path === '/auth/me' ? signedInAs(HANDLER) : unauthenticated));
    const user = userEvent.setup();
    renderApp('/password');
    await user.type(await screen.findByLabelText('Current password'), 'old-password-1');
    await user.type(screen.getByLabelText('New password'), 'a longer phrase');
    await user.type(screen.getByLabelText('Confirm new password'), 'a longer phrase');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText(EXPIRED)).toBeTruthy();
  });

  test('a 400 from Change password does not set the expiry flag', async () => {
    mockApi((method, path) => {
      if (path === '/auth/me') return signedInAs(HANDLER);
      if (path === '/auth/logout') return { status: 204 };
      return {
        status: 400,
        body: apiError('VALIDATION_ERROR', 'The current password is incorrect.', {
          fields: { currentPassword: ['The current password is incorrect.'] },
        }),
      };
    });
    const user = userEvent.setup();
    renderApp('/password');
    await user.type(await screen.findByLabelText('Current password'), 'wrong-password');
    await user.type(screen.getByLabelText('New password'), 'a longer phrase');
    await user.type(screen.getByLabelText('Confirm new password'), 'a longer phrase');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    await screen.findAllByText('The current password is incorrect.');
    // Still signed in; signing out now must not carry a hidden expiry flag to the login page.
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByLabelText('Username');
    expect(screen.queryByText(EXPIRED)).toBeNull();
  });

  test('a successful sign-in clears the flag, so a later Sign out and sign-in show no message', async () => {
    const api = { expired: true };
    sessionApi(api);
    const user = userEvent.setup();
    renderApp('/rooms');
    expect(await screen.findByText(EXPIRED)).toBeTruthy();

    api.expired = false;
    await signInAgain(user);
    await screen.findByRole('heading', { name: 'Rooms and labs' });

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByLabelText('Username');
    expect(screen.queryByText(EXPIRED)).toBeNull();

    await signInAgain(user);
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    await screen.findByLabelText('Username');
    expect(screen.queryByText(EXPIRED)).toBeNull();
  });

  test('a second expiry after signing in again shows the message again', async () => {
    const api = { expired: true };
    sessionApi(api);
    const user = userEvent.setup();
    const router = renderApp('/rooms');
    expect(await screen.findByText(EXPIRED)).toBeTruthy();

    api.expired = false;
    await signInAgain(user);
    await screen.findByRole('heading', { name: 'Rooms and labs' });
    expect(screen.queryByText(EXPIRED)).toBeNull();

    api.expired = true;
    await router.navigate('/borrowers');
    expect(await screen.findByText(EXPIRED)).toBeTruthy();
  });

  test('a failed login after an expiry, then a sign-in and a later expiry, shows the message again', async () => {
    const api = { expired: true, loginFails: true };
    sessionApi(api);
    const user = userEvent.setup();
    const router = renderApp('/rooms');
    expect(await screen.findByText(EXPIRED)).toBeTruthy();

    api.expired = false;
    await signInAgain(user);
    await screen.findByText('Wrong username or password.');
    expect(screen.queryByText(EXPIRED)).toBeNull();

    api.loginFails = false;
    await signInAgain(user);
    await screen.findByRole('heading', { name: 'Rooms and labs' });

    api.expired = true;
    await router.navigate('/borrowers');
    expect(await screen.findByText(EXPIRED)).toBeTruthy();
    expect(screen.queryByText('Wrong username or password.')).toBeNull();
  });
});

describe('every select is capped at its box width (TC-MD-35 automated part)', () => {
  // SelectField holds the app's only <select>, so these list screens cover every filter and inline form select.
  function expectCapped(select: HTMLElement) {
    for (const token of ['w-full', 'max-w-full']) {
      expect(select.classList.contains(token), `${select.id}: ${token}`).toBe(true);
    }
  }

  test.each([
    ['/inventory', 3],
    ['/borrowers', 3], // Type and Status filters, and Type in the add form
  ])('every filter select on %s has w-full max-w-full', async (path, count) => {
    mockApi((method, p) => (p === '/auth/me' ? signedInAs(ADMIN) : emptyPage));
    renderApp(path);
    await screen.findByRole('heading', { level: 1 });
    const selects = await screen.findAllByRole('combobox');
    expect(selects).toHaveLength(count);
    selects.forEach(expectCapped);
  });
});

describe('tab titles on every route and role (TC-FND-31 edges)', () => {
  function signedInApi(who: SignedInUser) {
    mockApi((method, path) => {
      if (path === '/auth/me') return signedInAs(who);
      if (path === '/settings') return { status: 200, body: { settings: SETTINGS } };
      if (path.startsWith('/semesters')) {
        return { status: 200, body: { ...emptyPage.body, current: null } };
      }
      return emptyPage;
    });
  }

  test.each([
    ['/inventory', 'Inventory and categories'],
    ['/inventory?tab=categories', 'Inventory and categories'],
    ['/borrowers', 'Borrowers'],
    ['/rooms', 'Rooms and labs'],
    ['/settings', 'Settings and semesters'],
    ['/rooms/', 'Rooms and labs'],
  ])('an admin on %s sees the title "%s · …"', async (path, page) => {
    signedInApi(ADMIN);
    renderApp(path);
    await waitFor(() => expect(document.title).toBe(TITLE(page)));
  });

  test.each([
    ['/', 'Dashboard'],
    ['/password', 'Change password'],
    ['/checkout', 'Not allowed'],
    ['/inventory', 'Not allowed'],
    ['/borrowers', 'Not allowed'],
    ['/rooms', 'Not allowed'],
    ['/settings', 'Not allowed'],
  ])('a viewer on %s sees the title "%s · …"', async (path, page) => {
    signedInApi(VIEWER);
    renderApp(path);
    await waitFor(() => expect(document.title).toBe(TITLE(page)));
  });

  test.each([['/borrowers'], ['/rooms'], ['/settings']])(
    'a handler on %s sees the title "Not allowed · …"',
    async (path) => {
      signedInApi(HANDLER);
      renderApp(path);
      await waitFor(() => expect(document.title).toBe(TITLE('Not allowed')));
    },
  );
});

// --- fixtures for the tables ---

const SETTINGS: Settings = {
  closingTime: '17:00',
  warningThreshold: 3,
  noticeThreshold: 4,
  blockThreshold: 5,
  timezone: 'Asia/Manila',
};
type ListedItem = Item & { available: number };
const baseItem: ListedItem = {
  id: 'i',
  name: 'x',
  category: { id: 'c', name: 'Cables and power' },
  description: null,
  trackingType: 'UNIT',
  assetTag: 'LT-9',
  totalQuantity: 1,
  condition: 'GOOD',
  status: 'ACTIVE',
  available: 1,
};
const quantity = { trackingType: 'QUANTITY', assetTag: null } as const;

function itemsApi(items: ListedItem[]) {
  mockApi((method, path) => {
    if (path === '/auth/me') return signedInAs(ADMIN);
    if (path.startsWith('/items')) {
      return { status: 200, body: { data: items, page: 1, pageSize: 25, total: items.length } };
    }
    return emptyPage;
  });
}

async function availableCells(items: ListedItem[]) {
  itemsApi(items);
  renderApp('/inventory');
  const table = await screen.findByRole('table', { name: 'Items' });
  await within(table).findByText(items[0]!.name);
  const column = within(table)
    .getAllByRole('columnheader')
    .findIndex((h) => h.textContent === 'Available');
  return (name: string) =>
    within(within(table).getByText(name).closest('tr')!).getAllByRole('cell')[column]!.textContent;
}

describe('the Available column for every status (TC-MD-34 edges)', () => {
  test('unit and quantity items that are not ACTIVE show "—" (BR 1)', async () => {
    const cell = await availableCells([
      { ...baseItem, id: '1', name: 'Laptop lost', status: 'LOST', available: 0 },
      { ...baseItem, id: '2', name: 'Laptop retired', status: 'RETIRED', available: 0 },
      {
        ...baseItem,
        ...quantity,
        id: '3',
        name: 'Cord repair',
        totalQuantity: 5,
        status: 'UNDER_REPAIR',
        available: 0,
      },
      {
        ...baseItem,
        ...quantity,
        id: '4',
        name: 'Cord lost',
        totalQuantity: 5,
        status: 'LOST',
        available: 0,
      },
      {
        ...baseItem,
        ...quantity,
        id: '5',
        name: 'Cord retired',
        totalQuantity: 5,
        status: 'RETIRED',
        available: 0,
      },
    ] as ListedItem[]);
    for (const name of [
      'Laptop lost',
      'Laptop retired',
      'Cord repair',
      'Cord lost',
      'Cord retired',
    ]) {
      expect(cell(name), name).toBe('—');
    }
  });

  test('a quantity item with total 0 shows "0 of 0"', async () => {
    const cell = await availableCells([
      { ...baseItem, ...quantity, id: '1', name: 'Empty stock', totalQuantity: 0, available: 0 },
    ] as ListedItem[]);
    expect(cell('Empty stock')).toBe('0 of 0');
  });

  test('a total lowered below what is checked out shows 0 of the new total (owner decision 2026-11-05)', async () => {
    // The API never answers below 0 here (api/availability.test.ts); the page shows its number.
    const cell = await availableCells([
      { ...baseItem, ...quantity, id: '1', name: 'HDMI cable', totalQuantity: 3, available: 0 },
    ] as ListedItem[]);
    expect(cell('HDMI cable')).toBe('0 of 3');
  });
});

describe('every name-like table cell uses cellTextClass (TC-MD-35 automated part)', () => {
  const LONG = 'Extension cord, 5 m';
  function expectCellText(element: HTMLElement) {
    for (const token of ['block', 'max-w-64', 'break-words']) {
      expect(element.classList.contains(token), `${element.textContent}: ${token}`).toBe(true);
    }
    expect(element.closest('td')).not.toBeNull();
  }

  test('Items: name, category and asset tag', async () => {
    itemsApi([{ ...baseItem, name: LONG }]);
    renderApp('/inventory');
    const table = await screen.findByRole('table', { name: 'Items' });
    expectCellText(await within(table).findByText(LONG));
    expectCellText(within(table).getByText('Cables and power'));
    expectCellText(within(table).getByText('LT-9'));
  });

  test('Categories: name', async () => {
    const category: Category = { id: 'c1', name: 'Audio and video', itemCount: 2 };
    mockApi((method, path) => {
      if (path === '/auth/me') return signedInAs(ADMIN);
      if (path.startsWith('/categories')) {
        return { status: 200, body: { data: [category], page: 1, pageSize: 25, total: 1 } };
      }
      return emptyPage;
    });
    renderApp('/inventory?tab=categories');
    expectCellText(await screen.findByText('Audio and video'));
  });

  test('Borrowers: school ID, name and department', async () => {
    const borrower: Borrower = {
      id: 'b1',
      schoolId: '2020-08812',
      name: 'Carlo Dizon',
      type: 'STUDENT',
      department: 'Visual Communication',
      active: true,
    };
    mockApi((method, path) => {
      if (path === '/auth/me') return signedInAs(ADMIN);
      if (path.startsWith('/borrowers')) {
        return { status: 200, body: { data: [borrower], page: 1, pageSize: 25, total: 1 } };
      }
      return emptyPage;
    });
    renderApp('/borrowers');
    const table = await screen.findByRole('table');
    expectCellText(await within(table).findByText('Carlo Dizon'));
    expectCellText(within(table).getByText('2020-08812'));
    expectCellText(within(table).getByText('Visual Communication'));
  });

  test('Rooms: name', async () => {
    const room: Room = {
      id: 'r1',
      name: 'Computer Lab 201',
      active: true,
      createdBy: { id: 'u0', name: 'Ma. Teresa Lim' },
      createdAt: '2026-08-09T16:30:00.000Z',
      transactionCount: 0,
    };
    mockApi((method, path) => {
      if (path === '/auth/me') return signedInAs(ADMIN);
      if (path.startsWith('/rooms')) {
        return { status: 200, body: { data: [room], page: 1, pageSize: 25, total: 1 } };
      }
      return emptyPage;
    });
    renderApp('/rooms');
    const table = await screen.findByRole('table', { name: 'Rooms and labs' });
    expectCellText(await within(table).findByText('Computer Lab 201'));
  });

  test('Semesters: name', async () => {
    const semester: Semester = {
      id: 's1',
      name: '1st Semester AY 2026-2027',
      startDate: '2026-08-10',
      endDate: '2026-12-18',
      isCurrent: true,
    };
    mockApi((method, path) => {
      if (path === '/auth/me') return signedInAs(ADMIN);
      if (path === '/settings') return { status: 200, body: { settings: SETTINGS } };
      if (path.startsWith('/semesters')) {
        return {
          status: 200,
          body: { data: [semester], page: 1, pageSize: 25, total: 1, current: semester },
        };
      }
      return emptyPage;
    });
    renderApp('/settings');
    const name = (await screen.findAllByText('1st Semester AY 2026-2027')).find((el) =>
      el.closest('td'),
    );
    expect(name, 'semester name in the table').toBeDefined();
    expectCellText(name!);
  });
});
