import type { Semester, Settings } from '@bms/shared';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import type { SignedInUser } from '../auth';
import { apiError, emulateModalDialogs, mockApi, renderApp, signedInAs } from '../test-utils';

// QA (automated) gap tests for MD-7, Settings and semesters screen: a viewer is refused, the admin
// menu order after the MD-3 merge, thresholds 4, 3, 5 marked under Notice, a server field error
// under Closing time, and a failed Set as current. TC-MD-21, 22 and 33 in TEST_CASES.md.

beforeAll(emulateModalDialogs);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ADMIN: SignedInUser = { id: 'u0', name: 'Test Admin', username: 'qa-admin', role: 'ADMIN' };
const VIEWER: SignedInUser = {
  id: 'u2',
  name: 'Test Viewer',
  username: 'qa-viewer',
  role: 'VIEWER',
};
const SETTINGS: Settings = {
  closingTime: '17:00',
  warningThreshold: 3,
  noticeThreshold: 4,
  blockThreshold: 5,
  timezone: 'Asia/Manila',
};
const CURRENT: Semester = {
  id: 's1',
  name: 'QA Semester A',
  startDate: '2026-08-10',
  endDate: '2026-12-18',
  isCurrent: true,
};
const NEXT: Semester = {
  id: 's2',
  name: 'QA Semester B',
  startDate: '2027-01-11',
  endDate: '2027-05-28',
  isCurrent: false,
};

function fakeApi(answer: (method: string, path: string, body: unknown) => object | undefined) {
  return mockApi((method, path, body) => {
    if (path === '/auth/me') return signedInAs(ADMIN);
    const reply = answer(method, path, body);
    if (reply) return reply as { status: number; body?: unknown };
    if (method === 'GET' && path === '/settings')
      return { status: 200, body: { settings: SETTINGS } };
    if (method === 'GET' && path.startsWith('/semesters')) {
      return {
        status: 200,
        body: { data: [NEXT, CURRENT], page: 1, pageSize: 25, total: 2, current: CURRENT },
      };
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
}

const changeRequests = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.filter(([, init]) => (init?.method ?? 'GET') !== 'GET');

test('SPEC 3: a viewer gets the not-allowed page and no Settings and semesters link', async () => {
  const fetchMock = mockApi((_method, path) => {
    if (path === '/auth/me') return signedInAs(VIEWER);
    throw new Error(`unexpected ${path}`);
  });
  renderApp('/settings');
  expect(await screen.findByRole('heading', { name: "You can't open this page" })).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Settings and semesters' })).toBeNull();
  // The page never asked the API for settings or semesters.
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/auth/me']);
});

test('the admin menu lists Rooms and labs, then Settings and semesters, last', async () => {
  fakeApi(() => undefined);
  renderApp('/settings');
  await screen.findByRole('heading', { name: 'Settings and semesters' });
  const links = screen
    .getAllByRole('link')
    .map((link) => link.textContent?.trim())
    .filter((name) => name === 'Rooms and labs' || name === 'Settings and semesters');
  expect(links).toEqual(['Rooms and labs', 'Settings and semesters']);
});

test('TC-MD-22: thresholds 4, 3, 5 are marked under Notice and not sent', async () => {
  const fetchMock = fakeApi(() => undefined);
  const user = userEvent.setup();
  renderApp('/settings');

  const warning = await screen.findByLabelText('Warning at');
  await user.clear(warning);
  await user.type(warning, '4');
  const notice = screen.getByLabelText('Notice at');
  await user.clear(notice);
  await user.type(notice, '3');
  await user.click(screen.getByRole('button', { name: 'Save settings' }));

  expect(
    await screen.findByText(
      'Thresholds must go up: warning, then notice, then block. The warning threshold (4) must be lower than the notice threshold (3).',
    ),
  ).toBeTruthy();
  expect(notice.getAttribute('aria-invalid')).toBe('true');
  expect(changeRequests(fetchMock)).toEqual([]);
});

test('TC-MD-22: a field error from the server shows under Closing time', async () => {
  const message = 'Enter a time as HH:mm.';
  fakeApi((method, path) =>
    method === 'PUT' && path === '/settings'
      ? {
          status: 400,
          body: apiError('VALIDATION_ERROR', 'Check the highlighted fields.', {
            fields: { closingTime: [message] },
          }),
        }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/settings');

  await screen.findByLabelText('Closing time');
  await user.click(screen.getByRole('button', { name: 'Save settings' }));
  expect(await screen.findByText(message)).toBeTruthy();
  expect(screen.getByLabelText('Closing time').getAttribute('aria-invalid')).toBe('true');
  expect(screen.queryByText('Settings saved.')).toBeNull();
});

test('TC-MD-33: a failed Set as current shows the API message, closes the dialog, and keeps the old current semester', async () => {
  const message = 'Semester not found.';
  fakeApi((method, path) =>
    method === 'POST' && path === '/semesters/s2/current'
      ? { status: 404, body: apiError('NOT_FOUND', message) }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/settings');

  await user.click(await screen.findByRole('button', { name: `Set ${NEXT.name} as current` }));
  const dialog = screen.getByRole('dialog', { name: 'Change the current semester?' });
  await user.click(within(dialog).getByRole('button', { name: 'Set as current' }));

  expect(await screen.findByText(message)).toBeTruthy();
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.queryByText(`"${NEXT.name}" is now the current semester.`)).toBeNull();
  expect(
    within(screen.getByRole('row', { name: /QA Semester A/ })).getByText('Current'),
  ).toBeTruthy();
});
