import type { Semester, Settings } from '@bms/shared';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import type { SignedInUser } from '../auth';
import { emulateModalDialogs, mockApi, renderApp, signedInAs } from '../test-utils';

// QA (automated) round 2 gap tests for MD-7: where focus goes after confirming Set as current
// (TC-MD-33) when the semester's row moves to another page, when the semester is on page 2, when
// a second semester is set current after the first, and when the user pages away during the reload.

beforeAll(emulateModalDialogs);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ADMIN: SignedInUser = { id: 'u0', name: 'Test Admin', username: 'qa-admin', role: 'ADMIN' };
const SETTINGS: Settings = {
  closingTime: '17:00',
  warningThreshold: 3,
  noticeThreshold: 4,
  blockThreshold: 5,
  timezone: 'Asia/Manila',
};
const PAGE_SIZE = 25;

// Semester n starts in year 2000 + n, so the dates never overlap.
const semester = (n: number, isCurrent = false): Semester => ({
  id: `s${n}`,
  name: `QA Semester ${n}`,
  startDate: `${2000 + n}-01-10`,
  endDate: `${2000 + n}-05-20`,
  isCurrent,
});

// A paged fake API over `list`; Set as current marks the semester current in `list`.
function fakeApi(list: Semester[]) {
  return mockApi((method, path) => {
    if (path === '/auth/me') return signedInAs(ADMIN);
    if (path === '/settings') return { status: 200, body: { settings: SETTINGS } };
    const setCurrent = /^\/semesters\/(\w+)\/current$/.exec(path);
    if (method === 'POST' && setCurrent) {
      list.forEach((s, i) => (list[i] = { ...s, isCurrent: s.id === setCurrent[1] }));
      return { status: 200, body: { semester: list.find((s) => s.id === setCurrent[1]) } };
    }
    if (method === 'GET' && path.startsWith('/semesters?')) {
      const page = Number(new URLSearchParams(path.split('?')[1]).get('page'));
      return {
        status: 200,
        body: {
          data: list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
          page,
          pageSize: PAGE_SIZE,
          total: list.length,
          current: list.find((s) => s.isCurrent) ?? null,
        },
      };
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
}

async function setAsCurrent(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('button', { name: `Set ${name} as current` }));
  const dialog = screen.getByRole('dialog', { name: 'Change the current semester?' });
  await user.click(within(dialog).getByRole('button', { name: 'Set as current' }));
}

const nameInList = (name: string) =>
  within(screen.getByRole('row', { name: new RegExp(name) })).getByText(name);

test('TC-MD-33: when the semester moves to another page on reload, focus goes to the new semester name', async () => {
  const list = Array.from({ length: PAGE_SIZE }, (_, i) => semester(i + 1));
  fakeApi(list);
  const user = userEvent.setup();
  renderApp('/settings');

  await user.click(await screen.findByRole('button', { name: 'Set QA Semester 25 as current' }));
  // Someone else adds a semester meanwhile, which pushes QA Semester 25 (last on page 1) to page 2.
  list.unshift(semester(99));
  await user.click(
    within(screen.getByRole('dialog', { name: 'Change the current semester?' })).getByRole(
      'button',
      { name: 'Set as current' },
    ),
  );

  expect(await screen.findByText('QA Semester 99')).toBeTruthy();
  expect(screen.queryByText('QA Semester 25')).toBeNull();
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(screen.getByLabelText('New semester name')),
  );
});

test('TC-MD-33: setting a semester on page 2 current keeps page 2 and focuses its name', async () => {
  const list = Array.from({ length: PAGE_SIZE + 2 }, (_, i) => semester(i + 1));
  fakeApi(list);
  const user = userEvent.setup();
  renderApp('/settings');

  await screen.findByText('QA Semester 1');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await setAsCurrent(user, 'QA Semester 27');

  await vi.waitFor(() => expect(document.activeElement).toBe(nameInList('QA Semester 27')));
  expect(screen.getByText('Page 2 of 2')).toBeTruthy();
  expect(
    within(screen.getByRole('row', { name: /QA Semester 27/ })).getByText('Current'),
  ).toBeTruthy();
});

test('TC-MD-33: a second Set as current focuses the second semester and leaves exactly one current', async () => {
  const list = [semester(1), semester(2)];
  const fetchMock = fakeApi(list);
  const user = userEvent.setup();
  renderApp('/settings');

  await setAsCurrent(user, 'QA Semester 1');
  await vi.waitFor(() => expect(document.activeElement).toBe(nameInList('QA Semester 1')));

  await setAsCurrent(user, 'QA Semester 2');
  await vi.waitFor(() => expect(document.activeElement).toBe(nameInList('QA Semester 2')));
  expect(screen.getAllByText('Current', { selector: 'span' })).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Set QA Semester 1 as current' })).toBeTruthy();
  expect(
    fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').map(([url]) => url),
  ).toEqual(['/api/semesters/s1/current', '/api/semesters/s2/current']);
});

test('TC-MD-33: paging away while the list reloads does not focus a row of the old page; focus goes to the new semester name', async () => {
  const list = Array.from({ length: PAGE_SIZE + 2 }, (_, i) => semester(i + 1));
  const fetchMock = fakeApi(list);
  // Hold the page 1 reload that follows Set as current until the test releases it.
  let posted = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (init.method === 'POST') posted = true;
    else if (posted && url.includes('page=1&')) await held;
    return fetchMock(url, init);
  });
  const user = userEvent.setup();
  renderApp('/settings');

  await setAsCurrent(user, 'QA Semester 1');
  // The reload of page 1 is still running; the user goes to page 2.
  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByText('QA Semester 27')).toBeTruthy();
  expect(document.activeElement).not.toBe(screen.getByLabelText('New semester name'));

  release();
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(screen.getByLabelText('New semester name')),
  );
  expect(screen.getByText('Page 2 of 2')).toBeTruthy();
});
