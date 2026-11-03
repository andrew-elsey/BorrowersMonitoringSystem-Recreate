import type { Semester, Settings } from '@bms/shared';
import { focusManager } from '@tanstack/react-query';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import type { SignedInUser } from '../auth';
import {
  apiError,
  emulateModalDialogs,
  HANDLER,
  mockApi,
  renderApp,
  signedInAs,
} from '../test-utils';

// MD-7: the Settings and semesters screen.

beforeAll(emulateModalDialogs);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ADMIN: SignedInUser = { id: 'u0', name: 'Ma. Teresa Lim', username: 'tlim', role: 'ADMIN' };
const SETTINGS: Settings = {
  closingTime: '17:00',
  warningThreshold: 3,
  noticeThreshold: 4,
  blockThreshold: 5,
  timezone: 'Asia/Manila',
};
const FIRST: Semester = {
  id: 's1',
  name: '1st Semester AY 2026-2027',
  startDate: '2026-08-10',
  endDate: '2026-12-18',
  isCurrent: false,
};
const SECOND: Semester = {
  id: 's2',
  name: '2nd Semester AY 2026-2027',
  startDate: '2027-01-11',
  endDate: '2027-05-28',
  isCurrent: false,
};

// A fake API. `semesters` is the list; changes are recorded and answered by `answer`.
function fakeApi(
  semesters: Semester[],
  answer: (method: string, path: string, body: unknown) => { status: number; body?: unknown },
) {
  return mockApi((method, path, body) => {
    if (path === '/auth/me') return signedInAs(ADMIN);
    if (method === 'GET' && path === '/settings')
      return { status: 200, body: { settings: SETTINGS } };
    if (method === 'GET' && path.startsWith('/semesters')) {
      const current = semesters.find((s) => s.isCurrent) ?? null;
      return {
        status: 200,
        body: { data: semesters, page: 1, pageSize: 25, total: semesters.length, current },
      };
    }
    return answer(method, path, body);
  });
}

const changeRequests = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method !== 'GET')
    .map(([url, init]) => [init!.method, url, init!.body && JSON.parse(init!.body as string)]);

test('TC-MD-33: shows the settings and semesters, warns with no current semester, and sets one current after confirming', async () => {
  const semesters = [SECOND, FIRST];
  const fetchMock = fakeApi(semesters, (method, path) => {
    if (method === 'POST' && path === '/semesters/s1/current') {
      semesters[1] = { ...FIRST, isCurrent: true };
      return { status: 200, body: { semester: semesters[1] } };
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
  const user = userEvent.setup();
  renderApp('/settings');

  expect(await screen.findByRole('heading', { name: 'Settings and semesters' })).toBeTruthy();
  expect(((await screen.findByLabelText('Closing time')) as HTMLInputElement).value).toBe('17:00');
  expect(screen.getByText('Asia/Manila')).toBeTruthy();
  expect((screen.getByLabelText('Block at') as HTMLInputElement).value).toBe('5');
  expect(await screen.findByText('No current semester.')).toBeTruthy();
  const row = screen.getByRole('row', { name: /1st Semester/ });
  // Calendar dates are shown as they are, never shifted by a timezone.
  expect(within(row).getByText('10 Aug 2026')).toBeTruthy();
  expect(within(row).getByText('18 Dec 2026')).toBeTruthy();

  // Cancel has focus when it opens (ConfirmDialog pattern); cancelling sends nothing.
  const setFirst = screen.getByRole('button', { name: 'Set 1st Semester AY 2026-2027 as current' });
  await user.click(setFirst);
  let dialog = screen.getByRole('dialog', { name: 'Change the current semester?' });
  expect(
    within(dialog).getByText(
      'Only flags from transactions in 1st Semester AY 2026-2027 will count as strikes. Flags from other semesters stay in history.',
    ),
  ).toBeTruthy();
  expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }));
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(changeRequests(fetchMock)).toEqual([]);

  // Confirm: the switch is sent once.
  await user.click(setFirst);
  dialog = screen.getByRole('dialog', { name: 'Change the current semester?' });
  await user.click(within(dialog).getByRole('button', { name: 'Set as current' }));
  expect(
    await screen.findByText('"1st Semester AY 2026-2027" is now the current semester.'),
  ).toBeTruthy();
  expect(
    await within(screen.getByRole('row', { name: /1st Semester/ })).findByText('Current'),
  ).toBeTruthy();
  expect(screen.queryByText('No current semester.')).toBeNull();
  expect(screen.queryByRole('button', { name: /Set 1st Semester.* as current/ })).toBeNull();
  // Its button is gone, so focus goes to the new semester name.
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(screen.getByLabelText('New semester name')),
  );
  expect(changeRequests(fetchMock)).toEqual([['POST', '/api/semesters/s1/current', undefined]]);
});

test('BR 11: thresholds out of order are shown under the field and not sent; valid ones are saved', async () => {
  const fetchMock = fakeApi([{ ...FIRST, isCurrent: true }], (method, path, body) => {
    if (method === 'PUT' && path === '/settings') {
      return { status: 200, body: { settings: { ...(body as object), timezone: 'Asia/Manila' } } };
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
  const user = userEvent.setup();
  renderApp('/settings');

  const notice = await screen.findByLabelText('Notice at');
  await user.clear(notice);
  await user.type(notice, '5');
  await user.click(screen.getByRole('button', { name: 'Save settings' }));
  expect(
    await screen.findByText(
      'Thresholds must go up: warning, then notice, then block. The notice threshold (5) must be lower than the block threshold (5).',
    ),
  ).toBeTruthy();
  expect(screen.getByLabelText('Block at').getAttribute('aria-invalid')).toBe('true');
  expect(changeRequests(fetchMock)).toEqual([]);

  await user.clear(notice);
  await user.type(notice, '4');
  const closing = screen.getByLabelText('Closing time');
  await user.clear(closing);
  await user.type(closing, '18:30');
  await user.click(screen.getByRole('button', { name: 'Save settings' }));
  expect(await screen.findByText('Settings saved.')).toBeTruthy();
  expect(changeRequests(fetchMock)).toEqual([
    [
      'PUT',
      '/api/settings',
      { closingTime: '18:30', warningThreshold: 3, noticeThreshold: 4, blockThreshold: 5 },
    ],
  ]);
});

test('adds a semester from the form and edits one in a dialog opened from its row', async () => {
  const fetchMock = fakeApi([FIRST], (method, path, body) => {
    if (method === 'POST' && path === '/semesters') {
      return { status: 201, body: { semester: { ...SECOND, ...(body as object) } } };
    }
    if (method === 'PUT' && path === '/semesters/s1') {
      return { status: 200, body: { semester: { ...FIRST, ...(body as object) } } };
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
  const user = userEvent.setup();
  renderApp('/settings');

  await user.type(await screen.findByLabelText('New semester name'), SECOND.name);
  await user.type(screen.getAllByLabelText('Start date')[0], SECOND.startDate);
  await user.type(screen.getAllByLabelText('End date')[0], '2027-01-10');
  await user.click(screen.getByRole('button', { name: 'Add semester' }));
  expect(await screen.findByText('The end date cannot be before the start date.')).toBeTruthy();

  await user.clear(screen.getAllByLabelText('End date')[0]);
  await user.type(screen.getAllByLabelText('End date')[0], SECOND.endDate);
  await user.click(screen.getByRole('button', { name: 'Add semester' }));
  expect(await screen.findByText(`Semester "${SECOND.name}" added.`)).toBeTruthy();

  await user.click(screen.getByRole('button', { name: `Edit ${FIRST.name}` }));
  const dialog = screen.getByRole('dialog', { name: `Edit ${FIRST.name}` });
  const name = within(dialog).getByLabelText('Name');
  expect((name as HTMLInputElement).value).toBe(FIRST.name);
  expect(document.activeElement).toBe(name);
  await user.clear(name);
  await user.type(name, '1st Semester{Enter}');
  expect(await screen.findByText('Semester "1st Semester" saved.')).toBeTruthy();

  expect(changeRequests(fetchMock)).toEqual([
    [
      'POST',
      '/api/semesters',
      { name: SECOND.name, startDate: SECOND.startDate, endDate: SECOND.endDate },
    ],
    [
      'PUT',
      '/api/semesters/s1',
      { name: '1st Semester', startDate: FIRST.startDate, endDate: FIRST.endDate },
    ],
  ]);
});

test('TC-MD-31, TC-MD-32: an overlap and a duplicate name from the API show under their fields', async () => {
  const overlap = `These dates overlap "${FIRST.name}" (2026-08-10 to 2026-12-18).`;
  const duplicate = `A semester named "${FIRST.name}" already exists.`;
  fakeApi([FIRST], (method, path, body) => {
    const fields = method === 'POST' ? { startDate: [overlap] } : { name: [duplicate] };
    if (path.startsWith('/semesters')) {
      const code = method === 'POST' ? 'SEMESTER_OVERLAP' : 'DUPLICATE_VALUE';
      return { status: 409, body: apiError(code, fields.startDate?.[0] ?? duplicate, { fields }) };
    }
    throw new Error(`unexpected ${method} ${path} ${JSON.stringify(body)}`);
  });
  const user = userEvent.setup();
  renderApp('/settings');

  await user.type(await screen.findByLabelText('New semester name'), 'Summer');
  await user.type(screen.getAllByLabelText('Start date')[0], '2026-12-18');
  await user.type(screen.getAllByLabelText('End date')[0], '2027-01-05');
  await user.click(screen.getByRole('button', { name: 'Add semester' }));
  expect(await screen.findByText(overlap)).toBeTruthy();
  expect(document.activeElement).toBe(screen.getAllByLabelText('Start date')[0]);

  await user.click(screen.getByRole('button', { name: `Edit ${FIRST.name}` }));
  const dialog = screen.getByRole('dialog', { name: `Edit ${FIRST.name}` });
  await user.click(within(dialog).getByRole('button', { name: 'Save semester' }));
  expect(await within(dialog).findByText(duplicate)).toBeTruthy();
  expect(document.activeElement).toBe(within(dialog).getByLabelText('Name'));
});

test('SPEC 3: handlers do not see Settings and semesters', async () => {
  mockApi((_method, path) => {
    if (path === '/auth/me') return signedInAs(HANDLER);
    throw new Error(`unexpected ${path}`);
  });
  renderApp('/settings');
  expect(await screen.findByRole('heading', { name: "You can't open this page" })).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Settings and semesters' })).toBeNull();
});

test('TC-MD-25 / SPEC 8: after a failed load, a working Retry moves focus to the first field', async () => {
  let fail = true;
  mockApi((method, path) => {
    if (path === '/auth/me') return signedInAs(ADMIN);
    if (fail) return { status: 500, body: apiError('INTERNAL_ERROR', 'Something went wrong.') };
    if (path === '/settings') return { status: 200, body: { settings: SETTINGS } };
    return {
      status: 200,
      body: { data: [FIRST], page: 1, pageSize: 25, total: 1, current: null },
    };
  });
  const user = userEvent.setup();
  renderApp('/settings');

  const [settingsRetry, semestersRetry] = await screen.findAllByRole('button', { name: 'Retry' });
  fail = false;
  await user.click(semestersRetry);
  expect(await screen.findByRole('table', { name: 'Semesters' })).toBeTruthy();
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(screen.getByLabelText('New semester name')),
  );

  await user.click(settingsRetry);
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(screen.getByLabelText('Closing time')),
  );

  // The focus move happens once. A background reload (window focus) fails and hides the form;
  // the next one works and shows it again, without taking focus from where the admin is.
  const newName = screen.getByLabelText('New semester name');
  await user.click(newName);
  const refocusWindow = () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  };
  fail = true;
  refocusWindow();
  expect(await screen.findAllByRole('button', { name: 'Retry' })).toHaveLength(2);
  fail = false;
  refocusWindow();
  expect(await screen.findByLabelText('Closing time')).toBeTruthy();
  expect(document.activeElement).toBe(newName);
  focusManager.setFocused(undefined);
});
