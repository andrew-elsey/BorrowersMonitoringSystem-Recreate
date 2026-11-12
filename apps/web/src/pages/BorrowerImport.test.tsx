import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import type { SignedInUser } from '../auth';
import { apiError, mockApi, renderApp, signedInAs } from '../test-utils';

// MD-6: Import CSV on the Borrowers screen. The import itself is tested in
// api/borrower-import.test.ts (TC-MD-18 to TC-MD-20).

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ADMIN: SignedInUser = { id: 'u0', name: 'Ma. Teresa Lim', username: 'tlim', role: 'ADMIN' };
const EMPTY_PAGE = { data: [], page: 1, pageSize: 25, total: 0 };

function fakeApi(importReply: { status: number; body: unknown }) {
  return mockApi((method, path) => {
    if (path === '/auth/me') return signedInAs(ADMIN);
    if (method === 'POST' && path === '/borrowers/import') return importReply;
    if (method === 'GET' && path.startsWith('/borrowers')) return { status: 200, body: EMPTY_PAGE };
    throw new Error(`unexpected ${method} ${path}`);
  });
}

const csvFile = () =>
  new File(['school_id,name,type,department,active\n'], 'borrowers-1st-sem-2026.csv', {
    type: 'text/csv',
  });

test('Import CSV uploads the file and shows the counts and rejected rows, then reloads the list', async () => {
  const fetchMock = fakeApi({
    status: 200,
    body: {
      created: 412,
      updated: 38,
      unchanged: 0,
      rejected: [{ row: 17, schoolId: '2024-0x881', reason: 'name is empty' }],
    },
  });
  renderApp('/borrowers');
  await screen.findByRole('button', { name: 'Import CSV' });
  const listLoads = () =>
    fetchMock.mock.calls.filter(
      ([url, init]) => url.startsWith('/api/borrowers?') && !init?.method?.startsWith('P'),
    ).length;
  const loadsBefore = listLoads();

  await userEvent.upload(screen.getByLabelText('CSV file to import'), csvFile());

  const heading = await screen.findByRole('heading', {
    name: 'Import result: borrowers-1st-sem-2026.csv',
  });
  expect(document.activeElement).toBe(heading);
  expect(screen.getByRole('status').textContent).toBe('412 created38 updated1 rejected');
  const rejected = screen.getByRole('table', { name: 'Rejected rows' });
  expect(within(rejected).getByRole('row', { name: '17 2024-0x881 name is empty' })).toBeTruthy();
  expect(listLoads()).toBeGreaterThan(loadsBefore);

  const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/borrowers/import')!;
  expect(init!.method).toBe('POST');
  // The browser sets the multipart Content-Type itself; the CSRF header is still sent.
  expect(init!.headers).toEqual({ 'X-Requested-With': 'fetch' });
  expect((init!.body as FormData).get('file')).toBeInstanceOf(File);
});

test('unchanged rows get their own count only when there are some', async () => {
  fakeApi({ status: 200, body: { created: 0, updated: 0, unchanged: 3, rejected: [] } });
  renderApp('/borrowers');
  await userEvent.upload(await screen.findByLabelText('CSV file to import'), csvFile());
  const status = await screen.findByRole('status');
  expect(status.textContent).toBe('0 created0 updated3 unchanged0 rejected');
  expect(screen.queryByRole('table', { name: 'Rejected rows' })).toBeNull();
});

test('a refused file shows the API message and no result', async () => {
  fakeApi({
    status: 413,
    body: apiError('PAYLOAD_TOO_LARGE', 'Upload one CSV file of at most 2 MB.'),
  });
  renderApp('/borrowers');
  await userEvent.upload(await screen.findByLabelText('CSV file to import'), csvFile());
  expect(await screen.findByText('Upload one CSV file of at most 2 MB.')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: /Import result/ })).toBeNull();
});
