import type { OpenLine } from '@bms/shared';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { apiError, HANDLER, mockApi, renderApp, signedInAs } from '../test-utils';

// QA (automated) gap tests for BRW-5, the Return screen: overridden and flagged marking, the
// confirmation text per flag state, a partial return of a flagged line, search text trimming and
// clearing, NOT_FOUND and line-less errors, a double click, the "showing N of M" note, an admin
// opening the page, and focus after a refusal whose reload rebuilds the row.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const UNIT_LINE: OpenLine = {
  lineId: 'b0000000-0000-4000-8000-000000000001',
  transactionId: 'qa-t1',
  borrower: { id: 'qa-b1', schoolId: 'QA-0001', name: 'Test Borrower' },
  item: { id: 'qa-i1', name: 'QA Laptop', assetTag: 'QA-LT-1', trackingType: 'UNIT' },
  location: 'QA Lab',
  issuedBy: 'QA Handler',
  issuedAt: '2026-11-10T01:00:00.000Z',
  expectedReturnDate: null,
  note: null,
  quantityBorrowed: 1,
  outstanding: 1,
  flagStatus: 'NONE',
  flaggedAt: null,
};
const CORD_LINE: OpenLine = {
  ...UNIT_LINE,
  lineId: 'b0000000-0000-4000-8000-000000000002',
  transactionId: 'qa-t2',
  item: { id: 'qa-i2', name: 'QA cord', assetTag: null, trackingType: 'QUANTITY' },
  quantityBorrowed: 5,
  outstanding: 5,
};
const SEARCH_BUTTON = 'Find open borrowings';
const page = (data: OpenLine[], total = data.length) => ({
  status: 200,
  body: { data, page: 1, pageSize: 50, total },
});
const recorded = (body: unknown, outstanding = 0) => {
  const line = (body as { lines: { lineId: string; quantity: number; condition: string }[] })
    .lines[0]!;
  return {
    status: 201,
    body: {
      returns: [
        {
          id: 'qa-r1',
          ...line,
          receivedById: 'u1',
          returnedAt: '2026-11-10T06:00:00.000Z',
          outstanding,
        },
      ],
    },
  };
};

// `lines` is read on every GET, so a test can change what the reload returns.
function fakeApi(
  state: { lines: OpenLine[]; total?: number },
  onPost?: (body: unknown) => { status: number; body?: unknown },
  role: 'HANDLER' | 'ADMIN' = 'HANDLER',
) {
  return mockApi((method, path, body) => {
    if (path === '/auth/me') return signedInAs({ ...HANDLER, role });
    if (method === 'GET' && path.startsWith('/returns/open')) return page(state.lines, state.total);
    if (method === 'POST' && path === '/returns' && onPost) return onPost(body);
    throw new Error(`unexpected ${method} ${path}`);
  });
}
const openUrls = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.startsWith('/api/returns/open'));
const posts = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.filter(([url, init]) => url === '/api/returns' && init?.method === 'POST');

test('an overridden line says "Flag overridden", has no Flagged badge and no tint', async () => {
  fakeApi({ lines: [{ ...UNIT_LINE, flagStatus: 'OVERRIDDEN', flaggedAt: UNIT_LINE.issuedAt }] });
  renderApp('/return');
  const label = await screen.findByText('Flag overridden');
  expect(screen.queryByText('Flagged')).toBeNull();
  expect(label.closest('div')!.parentElement!.className).not.toContain('bg-danger-tint');
});

test.each(['NONE', 'OVERRIDDEN'] as const)(
  'the confirmation for a %s line does not say a flag stays',
  async (flagStatus) => {
    fakeApi({ lines: [{ ...UNIT_LINE, flagStatus }] }, (body) => recorded(body));
    const user = userEvent.setup();
    renderApp('/return');
    await screen.findByText('QA Laptop');
    await user.click(screen.getByRole('button', { name: 'Return' }));
    await screen.findByText('Return recorded.');
    expect(screen.getByRole('status').textContent).not.toContain('flag');
  },
);

test('a partial return of a flagged line: the message says the flag stays, and the reload keeps it flagged', async () => {
  const state = { lines: [{ ...CORD_LINE, flagStatus: 'FLAGGED' as const }] };
  fakeApi(state, (body) => {
    state.lines = [{ ...state.lines[0]!, outstanding: 3 }];
    return recorded(body, 3);
  });
  const user = userEvent.setup();
  renderApp('/return');
  const quantity = await screen.findByLabelText('Quantity to return for QA cord');
  await user.clear(quantity);
  await user.type(quantity, '2');
  await user.click(screen.getByRole('button', { name: 'Return quantity' }));

  await screen.findByText('Return recorded.');
  expect(screen.getByRole('status').textContent).toContain(
    'The flag on this line stays until an admin overrides it.',
  );
  expect(await screen.findByText('Out: 3 of 5')).toBeTruthy();
  expect(screen.getByText('Flagged')).toBeTruthy();
  expect((screen.getByLabelText('Quantity to return for QA cord') as HTMLInputElement).value).toBe(
    '3',
  );
});

test('search text is trimmed; spaces only list every open line; a cleared search lists all again', async () => {
  const fetchMock = fakeApi({ lines: [UNIT_LINE] });
  const user = userEvent.setup();
  renderApp('/return');
  await screen.findByText('QA Laptop');
  const search = screen.getByLabelText('Search');

  await user.type(search, '  laptop  ');
  await user.click(screen.getByRole('button', { name: SEARCH_BUTTON }));
  await waitFor(() =>
    expect(openUrls(fetchMock)).toContain(
      '/api/returns/open?by=borrower&page=1&pageSize=50&q=laptop',
    ),
  );

  await user.clear(search);
  await user.type(search, '   ');
  await user.click(screen.getByRole('button', { name: SEARCH_BUTTON }));
  expect(screen.queryByText('Search text must be 2 to 100 characters.')).toBeNull();
  // Back to the first load's query (no q), so every open line shows again.
  expect(openUrls(fetchMock).filter((url) => url.includes('q='))).toHaveLength(1);
  await waitFor(() => expect(screen.getByText('QA Laptop')).toBeTruthy());

  await user.clear(search);
  await user.type(search, ' a ');
  await user.click(screen.getByRole('button', { name: SEARCH_BUTTON }));
  expect(screen.getByText('Search text must be 2 to 100 characters.')).toBeTruthy();
});

test('a NOT_FOUND refusal naming the line marks and focuses that row', async () => {
  fakeApi({ lines: [CORD_LINE] }, () => ({
    status: 404,
    body: apiError('NOT_FOUND', 'Line not found.', { lineId: CORD_LINE.lineId }),
  }));
  const user = userEvent.setup();
  renderApp('/return');
  const quantity = await screen.findByLabelText('Quantity to return for QA cord');
  await user.click(screen.getByRole('button', { name: 'Return quantity' }));
  await screen.findByText('Return not saved.');
  await waitFor(() => expect(document.activeElement).toBe(quantity));
  expect(quantity.getAttribute('aria-invalid')).toBe('true');
});

test('an error that names no line shows only at the top and marks no row', async () => {
  fakeApi({ lines: [CORD_LINE] }, () => ({
    status: 500,
    body: apiError('INTERNAL_ERROR', 'Something went wrong.'),
  }));
  const user = userEvent.setup();
  renderApp('/return');
  const quantity = await screen.findByLabelText('Quantity to return for QA cord');
  await user.click(screen.getByRole('button', { name: 'Return quantity' }));
  const top = (await screen.findByText('Return not saved.')).closest('[role=alert]')!;
  expect(top.textContent).toContain('Nothing was recorded.');
  expect(quantity.getAttribute('aria-invalid')).toBeNull();
});

test('a double click on Return sends one return', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const fetchMock = fakeApi({ lines: [UNIT_LINE] }, (body) => recorded(body));
  const realFetch = fetch;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url === '/api/returns') await gate;
    return realFetch(url, init);
  });
  const user = userEvent.setup();
  renderApp('/return');
  await screen.findByText('QA Laptop');
  await user.dblClick(screen.getByRole('button', { name: 'Return' }));
  release();
  await screen.findByText('Return recorded.');
  expect(posts(fetchMock)).toHaveLength(1);
});

test('when more lines match than one page holds, the list says how many are shown', async () => {
  fakeApi({ lines: [UNIT_LINE], total: 120 });
  renderApp('/return');
  expect(
    await screen.findByText(
      /Showing 1 of 120 open lines\. Search for a borrower, item, or asset tag/,
    ),
  ).toBeTruthy();
});

test('Find after a refusal clears the row mark and the "not saved" message', async () => {
  fakeApi({ lines: [CORD_LINE] }, () => ({
    status: 409,
    body: apiError('RETURN_EXCEEDS_OUTSTANDING', 'Only 5 of QA cord still out, 6 returned.', {
      lineId: CORD_LINE.lineId,
      outstanding: 5,
    }),
  }));
  const user = userEvent.setup();
  renderApp('/return');
  await screen.findByText('QA cord');
  await user.click(screen.getByRole('button', { name: 'Return quantity' }));
  await screen.findByText('Return not saved.');
  await user.click(screen.getByRole('button', { name: SEARCH_BUTTON }));
  await waitFor(() => expect(screen.queryByText('Return not saved.')).toBeNull());
  expect(
    screen.getByLabelText('Quantity to return for QA cord').getAttribute('aria-invalid'),
  ).toBeNull();
});

test('a refused quantity line whose reload rebuilds the row gets focus back on the new quantity box', async () => {
  const state = { lines: [CORD_LINE] };
  fakeApi(state, () => {
    // Someone else returned 4 meanwhile: the reload shows 1 out (a new row key).
    state.lines = [{ ...CORD_LINE, outstanding: 1 }];
    return {
      status: 409,
      body: apiError('RETURN_EXCEEDS_OUTSTANDING', 'Only 1 of QA cord still out, 5 returned.', {
        lineId: CORD_LINE.lineId,
        outstanding: 1,
      }),
    };
  });
  const user = userEvent.setup();
  renderApp('/return');
  await screen.findByText('QA cord');
  await user.click(screen.getByRole('button', { name: 'Return quantity' }));
  expect(await screen.findByText('Out: 1 of 5')).toBeTruthy();
  const rebuilt = screen.getByLabelText('Quantity to return for QA cord') as HTMLInputElement;
  expect(rebuilt.value).toBe('1');
  await waitFor(() => expect(document.activeElement).toBe(rebuilt));
  expect(rebuilt.getAttribute('aria-invalid')).toBe('true');
});

test('an admin can open Return', async () => {
  fakeApi({ lines: [UNIT_LINE] }, undefined, 'ADMIN');
  renderApp('/return');
  expect(await screen.findByRole('heading', { name: 'Return' })).toBeTruthy();
  expect(await screen.findByText('QA Laptop')).toBeTruthy();
});
