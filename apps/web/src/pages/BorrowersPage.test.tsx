import type { Borrower } from '@bms/shared';
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

// MD-5: the Borrowers screen. TC-MD-15 to TC-MD-17 and TC-MD-28 in TEST_CASES.md.

beforeAll(emulateModalDialogs);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ADMIN: SignedInUser = { id: 'u0', name: 'Ma. Teresa Lim', username: 'tlim', role: 'ADMIN' };
const CARLO: Borrower = {
  id: 'b1',
  schoolId: '2020-08812',
  name: 'Carlo Dizon',
  type: 'STUDENT',
  department: 'Visual Communication',
  active: true,
};
const RHEA: Borrower = {
  id: 'b2',
  schoolId: '2018-03321',
  name: 'Rhea Soriano',
  type: 'FACULTY',
  department: 'Painting',
  active: false,
};

type Reply = { status: number; body?: unknown };

// A fake API holding the borrowers list. `answer` overrides any borrowers request.
function fakeApi(answer?: (method: string, path: string, body: unknown) => Reply | undefined) {
  return mockApi((method, path, body) => {
    if (path === '/auth/me') return signedInAs(ADMIN);
    const reply = answer?.(method, path, body);
    if (reply) return reply;
    if (method === 'GET' && path.startsWith('/borrowers')) {
      return { status: 200, body: { data: [CARLO, RHEA], page: 1, pageSize: 25, total: 2 } };
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
}

const requests = (fetchMock: ReturnType<typeof mockApi>, method: string) =>
  fetchMock.mock.calls
    .filter(([url, init]) => url.startsWith('/api/borrowers') && init?.method === method)
    .map(([url, init]) => [url, init!.body && JSON.parse(init!.body as string)]);

test('lists borrowers with type, department, and a clear Active or Inactive status', async () => {
  fakeApi();
  renderApp('/borrowers');
  const table = await screen.findByRole('table', { name: 'Borrowers' });
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent),
  ).toEqual(['School ID', 'Name', 'Type', 'Department', 'Status', 'Actions']);
  const carlo = await within(table).findByRole('row', { name: /2020-08812 Carlo Dizon Student/ });
  expect(within(carlo).getByText('Active')).toBeTruthy();
  expect(within(carlo).getByRole('button', { name: 'Deactivate Carlo Dizon' })).toBeTruthy();
  const rhea = within(table).getByRole('row', { name: /Rhea Soriano Faculty Painting/ });
  expect(within(rhea).getByText('Inactive')).toBeTruthy();
  expect(within(rhea).getByRole('button', { name: 'Reactivate Rhea Soriano' })).toBeTruthy();
});

test('adding sends the four fields, confirms, clears the form, and reloads', async () => {
  const fetchMock = fakeApi((method, _path, body) =>
    method === 'POST'
      ? { status: 201, body: { borrower: { ...(body as object), id: 'b9', active: true } } }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/borrowers');
  const form = await screen.findByRole('form', { name: 'Add borrower' });
  await user.type(within(form).getByLabelText('School ID'), 'EMP-0142');
  await user.type(within(form).getByLabelText('Name'), 'Jose Reyes');
  await user.selectOptions(within(form).getByLabelText('Type'), 'Faculty');
  await user.type(within(form).getByLabelText('Department'), 'Fine Arts');
  const loadsBefore = requests(fetchMock, 'GET').length;
  await user.click(within(form).getByRole('button', { name: 'Add borrower' }));

  expect(await screen.findByText('Borrower Jose Reyes added.')).toBeTruthy();
  expect(requests(fetchMock, 'POST')).toEqual([
    [
      '/api/borrowers',
      { schoolId: 'EMP-0142', name: 'Jose Reyes', type: 'FACULTY', department: 'Fine Arts' },
    ],
  ]);
  expect((within(form).getByLabelText('Name') as HTMLInputElement).value).toBe('');
  await vi.waitFor(() => expect(requests(fetchMock, 'GET').length).toBe(loadsBefore + 1));
});

test('empty fields are refused in the browser; a duplicate school ID shows under the field', async () => {
  const fetchMock = fakeApi((method) =>
    method === 'POST'
      ? {
          status: 409,
          body: apiError('DUPLICATE_VALUE', 'Already exists.', {
            fields: { schoolId: ['A borrower with school ID "2020-08812" already exists.'] },
          }),
        }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/borrowers');
  const form = await screen.findByRole('form', { name: 'Add borrower' });
  await user.click(within(form).getByRole('button', { name: 'Add borrower' }));
  expect(await within(form).findByText('Enter a school ID.')).toBeTruthy();
  expect(within(form).getByText('Choose a type.')).toBeTruthy();
  expect(requests(fetchMock, 'POST')).toEqual([]);

  await user.type(within(form).getByLabelText('School ID'), '2020-08812');
  await user.type(within(form).getByLabelText('Name'), 'Carlo');
  await user.selectOptions(within(form).getByLabelText('Type'), 'Student');
  await user.type(within(form).getByLabelText('Department'), 'VC');
  await user.click(within(form).getByRole('button', { name: 'Add borrower' }));
  expect(
    await within(form).findByText('A borrower with school ID "2020-08812" already exists.'),
  ).toBeTruthy();
  expect(document.activeElement).toBe(within(form).getByLabelText('School ID'));
});

test('Edit opens a dialog filled from the row; saving sends PATCH and closes it', async () => {
  const fetchMock = fakeApi((method, _path, body) =>
    method === 'PATCH'
      ? { status: 200, body: { borrower: { ...CARLO, ...(body as object) } } }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/borrowers');
  await user.click(await screen.findByRole('button', { name: 'Edit Carlo Dizon' }));
  const dialog = screen.getByRole('dialog', { name: 'Edit Carlo Dizon' });
  expect((within(dialog).getByLabelText('Type') as HTMLSelectElement).value).toBe('STUDENT');
  const department = within(dialog).getByLabelText('Department');
  await user.clear(department);
  await user.type(department, 'Industrial Design');
  await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

  expect(await screen.findByText('Changes to Carlo Dizon saved.')).toBeTruthy();
  expect(requests(fetchMock, 'PATCH')).toEqual([
    [
      '/api/borrowers/b1',
      {
        schoolId: '2020-08812',
        name: 'Carlo Dizon',
        type: 'STUDENT',
        department: 'Industrial Design',
      },
    ],
  ]);
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('Deactivate and Reactivate send only the new active state (BR 3, BR 15)', async () => {
  const fetchMock = fakeApi((method, path, body) => {
    if (method !== 'PATCH') return undefined;
    const borrower = path.endsWith('b1') ? CARLO : RHEA;
    return { status: 200, body: { borrower: { ...borrower, ...(body as object) } } };
  });
  const user = userEvent.setup();
  renderApp('/borrowers');
  await user.click(await screen.findByRole('button', { name: 'Deactivate Carlo Dizon' }));
  expect(await screen.findByText('Carlo Dizon deactivated.')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Reactivate Rhea Soriano' }));
  expect(await screen.findByText('Rhea Soriano reactivated.')).toBeTruthy();
  expect(requests(fetchMock, 'PATCH')).toEqual([
    ['/api/borrowers/b1', { active: false }],
    ['/api/borrowers/b2', { active: true }],
  ]);
});

test('search waits for 2 characters, sends q, and shows the no-match message (SPEC 7)', async () => {
  const fetchMock = fakeApi((method, path) =>
    method === 'GET' && path.includes('q=')
      ? { status: 200, body: { data: [], page: 1, pageSize: 25, total: 0 } }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/borrowers');
  await screen.findByRole('table', { name: 'Borrowers' });
  const search = screen.getByLabelText('Name or school ID');
  expect(search.getAttribute('maxlength')).toBe('100');

  await user.type(search, 'D');
  expect(await screen.findByText('Type at least 2 characters.')).toBeTruthy();
  expect(requests(fetchMock, 'GET').some(([url]) => url.includes('q='))).toBe(false);

  await user.type(search, 'ela Paz');
  expect(
    await screen.findByText(
      'No borrower matches "Dela Paz". Check the spelling or search by school ID.',
    ),
  ).toBeTruthy();
  const searches = requests(fetchMock, 'GET').filter(([url]) => url.includes('q='));
  // One request after typing stops, not one per letter.
  expect(searches).toEqual([['/api/borrowers?page=1&pageSize=25&q=Dela%20Paz', undefined]]);
});

test('a failed load shows the error and a Retry button, not the empty state', async () => {
  let fail = true;
  fakeApi((method) =>
    method === 'GET' && fail
      ? { status: 500, body: apiError('INTERNAL_ERROR', 'Something went wrong.') }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/borrowers');
  expect(await screen.findByText('Something went wrong.')).toBeTruthy();
  expect(screen.queryByText('No borrowers yet.')).toBeNull();
  fail = false;
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('table', { name: 'Borrowers' })).toBeTruthy();
});

test('the screen is in the admin menu only; other roles get the not-allowed page (SPEC 3)', async () => {
  fakeApi();
  renderApp('/');
  const menu = await screen.findByRole('navigation', { name: 'Main' });
  expect(within(menu).getByRole('link', { name: 'Borrowers' })).toBeTruthy();
  cleanup();

  mockApi(() => signedInAs(HANDLER));
  renderApp('/borrowers');
  expect(await screen.findByRole('heading', { name: "You can't open this page" })).toBeTruthy();
  expect(
    within(screen.getByRole('navigation', { name: 'Main' })).queryByRole('link', {
      name: 'Borrowers',
    }),
  ).toBeNull();
});

// A list of 60, so there is a page 2 to leave.
const sixty = (method: string) =>
  method === 'GET'
    ? { status: 200, body: { data: [CARLO, RHEA], page: 1, pageSize: 25, total: 60 } }
    : undefined;
const lastLoad = (fetchMock: ReturnType<typeof mockApi>) => requests(fetchMock, 'GET').at(-1)![0];
const optionTexts = (select: HTMLElement) =>
  within(select)
    .getAllByRole('option')
    .map((option) => option.textContent);

test('TC-MD-28: Type and Status filters as in the mockup send type and active and go back to page 1', async () => {
  const fetchMock = fakeApi(sixty);
  const user = userEvent.setup();
  renderApp('/borrowers');
  await screen.findByRole('table', { name: 'Borrowers' });
  const form = screen.getByRole('form', { name: 'Add borrower' });
  const type = screen
    .getAllByRole('combobox', { name: 'Type' })
    .find((select) => !form.contains(select))!;
  const status = screen.getByRole('combobox', { name: 'Status' });
  expect(optionTexts(type)).toEqual(['All types', 'Student', 'Faculty', 'Employee']);
  expect(optionTexts(status)).toEqual(['Active and inactive', 'Active', 'Inactive']);
  // Defaults match everyone, so nothing is sent.
  expect(lastLoad(fetchMock)).toBe('/api/borrowers?page=1&pageSize=25');

  await user.click(await screen.findByRole('button', { name: 'Next' }));
  await vi.waitFor(() => expect(lastLoad(fetchMock)).toBe('/api/borrowers?page=2&pageSize=25'));
  await user.selectOptions(type, 'Faculty');
  await vi.waitFor(() =>
    expect(lastLoad(fetchMock)).toBe('/api/borrowers?page=1&pageSize=25&type=FACULTY'),
  );

  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.selectOptions(status, 'Inactive');
  await vi.waitFor(() =>
    expect(lastLoad(fetchMock)).toBe('/api/borrowers?page=1&pageSize=25&type=FACULTY&active=false'),
  );
});

test('with filters and no rows, the empty state names the filters, not "No borrowers yet."', async () => {
  fakeApi((method, path) =>
    method === 'GET' && path.includes('active=')
      ? { status: 200, body: { data: [], page: 1, pageSize: 25, total: 0 } }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/borrowers');
  await screen.findByRole('table', { name: 'Borrowers' });
  await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Inactive');
  expect(await screen.findByText('No borrowers match these filters.')).toBeTruthy();
});

test('Deactivate keeps focus while the request runs and after its label flips to Reactivate', async () => {
  let active = true;
  const fetchMock = fakeApi((method, _path, body) => {
    if (method === 'PATCH') active = (body as { active: boolean }).active;
    const carlo = { ...CARLO, active };
    return method === 'PATCH'
      ? { status: 200, body: { borrower: carlo } }
      : { status: 200, body: { data: [carlo], page: 1, pageSize: 25, total: 1 } };
  });
  const user = userEvent.setup();
  renderApp('/borrowers');
  const button = await screen.findByRole('button', { name: 'Deactivate Carlo Dizon' });

  // Hold the PATCH until the test lets it go.
  let release!: () => void;
  const answer = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementationOnce(async (url, init) => {
    await new Promise<void>((resolve) => (release = resolve));
    return answer(url, init);
  });
  await user.click(button);
  await vi.waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('true'));
  expect(document.activeElement).toBe(button);
  // A second click while it runs sends nothing.
  await user.click(button);
  release();

  expect(await screen.findByRole('button', { name: 'Reactivate Carlo Dizon' })).toBe(button);
  expect(document.activeElement).toBe(button);
  expect(button.getAttribute('aria-disabled')).toBeNull();
  expect(requests(fetchMock, 'PATCH')).toEqual([['/api/borrowers/b1', { active: false }]]);
});

test('when the Status filter hides the row just deactivated, focus moves to that filter', async () => {
  let active = true;
  fakeApi((method, path) => {
    if (method === 'PATCH') {
      active = false;
      return { status: 200, body: { borrower: { ...CARLO, active } } };
    }
    const rows = path.includes('active=true') && !active ? [] : [{ ...CARLO, active }];
    return { status: 200, body: { data: rows, page: 1, pageSize: 25, total: rows.length } };
  });
  const user = userEvent.setup();
  renderApp('/borrowers');
  await screen.findByRole('table', { name: 'Borrowers' });
  const status = screen.getByRole('combobox', { name: 'Status' });
  await user.selectOptions(status, 'Active');
  await user.click(await screen.findByRole('button', { name: 'Deactivate Carlo Dizon' }));
  expect(await screen.findByText('Carlo Dizon deactivated.')).toBeTruthy();
  await vi.waitFor(() => expect(screen.queryByRole('button', { name: /Carlo Dizon/ })).toBeNull());
  expect(document.activeElement).toBe(status);
});

test('the search goes back to page 1 only when the search sent changes (not a space or one letter)', async () => {
  const fetchMock = fakeApi(sixty);
  const user = userEvent.setup();
  renderApp('/borrowers');
  await screen.findByRole('table', { name: 'Borrowers' });
  await user.click(await screen.findByRole('button', { name: 'Next' }));
  const search = screen.getByLabelText('Name or school ID');
  // A space alone trims to the same (empty) search: still page 2 after the typing pause.
  await user.type(search, ' ');
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(screen.getByText('Page 2 of 3')).toBeTruthy();
  expect(lastLoad(fetchMock)).toBe('/api/borrowers?page=2&pageSize=25');

  // One letter is too short to search, so the list and the page stay as they are.
  await user.type(search, 'C');
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(screen.getByText('Page 2 of 3')).toBeTruthy();
  expect(lastLoad(fetchMock)).toBe('/api/borrowers?page=2&pageSize=25');

  await user.type(search, 'a');
  await vi.waitFor(() =>
    expect(lastLoad(fetchMock)).toBe('/api/borrowers?page=1&pageSize=25&q=Ca'),
  );
});
