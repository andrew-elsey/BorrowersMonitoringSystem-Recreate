import type { FlaggedLine, FlaggedLinePage } from '@bms/shared';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import type { SignedInUser } from '../auth';
import { apiError, emulateModalDialogs, mockApi, renderApp, signedInAs } from '../test-utils';

// QA (automated) gap tests for the FLG-4 Flag review screen (SPEC 5, 7, 8; BR 13). Adds what
// FlagReviewPage.test.tsx does not cover: 501-character and blank reasons on screen, an API field
// error on the reason, Cancel, a NOT_FOUND refusal, the search length check, the Returned filter
// request, the Run flagging refusal without Retry-After and for 1 second, a skipped run, the list
// reload after a run, the viewer's not-allowed page, and the row text for each line state.

beforeAll(emulateModalDialogs);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ADMIN: SignedInUser = { id: 'u0', name: 'QA Admin', username: 'qa-admin', role: 'ADMIN' };
const VIEWER: SignedInUser = { id: 'u2', name: 'QA Viewer', username: 'qa-viewer', role: 'VIEWER' };
const LINE: FlaggedLine = {
  lineId: 'l1',
  transactionId: 't1',
  borrower: { id: 'b1', schoolId: 'QA-0001', name: 'Rhea Quality' },
  item: { id: 'i1', name: 'QA Projector', assetTag: 'QA-PJ-77' },
  issuedAt: '2026-11-02T01:12:00.000Z',
  flaggedAt: '2026-11-02T09:00:00.000Z',
  quantityBorrowed: 1,
  outstanding: 1,
  strikes: 1,
  note: null,
  expectedReturnDate: null,
};
const page = (data: FlaggedLine[]): FlaggedLinePage => ({
  data,
  page: 1,
  pageSize: 25,
  total: data.length,
  blockThreshold: 5,
  hasCurrentSemester: true,
  borrowerSearchSkipped: false,
});

// The admin's fake API: `answer` may reply first; otherwise GET /flags returns `rows`.
function fakeApi(
  answer?: (method: string, path: string, body: unknown) => object | undefined,
  rows: FlaggedLine[] = [LINE],
) {
  return mockApi((method, path, body) => {
    if (path === '/auth/me') return signedInAs(ADMIN);
    const reply = answer?.(method, path, body);
    if (reply) return reply as { status: number; body?: unknown };
    if (method === 'GET' && path.startsWith('/flags')) return { status: 200, body: page(rows) };
    throw new Error(`unexpected ${method} ${path}`);
  });
}
const posts = (fetchMock: ReturnType<typeof fakeApi>) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
const flagGets = (fetchMock: ReturnType<typeof fakeApi>) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => (init?.method ?? 'GET') === 'GET' && String(url).startsWith('/api/flags'),
  );

async function openOverride() {
  const user = userEvent.setup();
  renderApp('/flags');
  await user.click(await screen.findByRole('button', { name: /Override flag for Rhea Quality/ }));
  const dialog = await screen.findByRole('dialog');
  return { user, dialog, reason: within(dialog).getByLabelText(/Reason/) };
}

test('TC-FLG-23: a 501-character reason is refused on screen and nothing is sent', async () => {
  const fetchMock = fakeApi();
  const { user, dialog, reason } = await openOverride();
  await user.click(reason);
  await user.paste('r'.repeat(501));
  await user.click(within(dialog).getByRole('button', { name: 'Override flag' }));
  expect(await within(dialog).findByText('Too long: at most 500 characters.')).toBeTruthy();
  expect(posts(fetchMock)).toHaveLength(0);
});

test('TC-FLG-23: a reason of only spaces is refused on screen', async () => {
  const fetchMock = fakeApi();
  const { user, dialog, reason } = await openOverride();
  await user.type(reason, '          ');
  await user.click(within(dialog).getByRole('button', { name: 'Override flag' }));
  expect(await within(dialog).findByText('Enter a reason of at least 5 characters.')).toBeTruthy();
  expect(posts(fetchMock)).toHaveLength(0);
});

test('the reason is sent trimmed', async () => {
  let sent: unknown;
  fakeApi((method, _path, body) => {
    if (method !== 'POST') return undefined;
    sent = body;
    return { status: 200, body: { line: { strikes: 0 } } };
  });
  const { user, dialog, reason } = await openOverride();
  await user.type(reason, '   valid reason   ');
  await user.click(within(dialog).getByRole('button', { name: 'Override flag' }));
  await screen.findByText(/Flag overridden/);
  expect(sent).toEqual({ reason: 'valid reason' });
});

test('an API field error on the reason shows under the field and keeps the dialog open', async () => {
  fakeApi((method) =>
    method === 'POST'
      ? {
          status: 400,
          body: apiError('VALIDATION_ERROR', 'Check the highlighted fields.', {
            fields: { reason: ['Remove the control characters.'] },
          }),
        }
      : undefined,
  );
  const { user, dialog, reason } = await openOverride();
  await user.type(reason, 'valid reason');
  await user.click(within(dialog).getByRole('button', { name: 'Override flag' }));
  expect(await within(dialog).findByText('Remove the control characters.')).toBeTruthy();
  expect(screen.getByRole('dialog')).toBeTruthy();
  await vi.waitFor(() => expect(document.activeElement).toBe(reason));
});

test('Cancel closes the override dialog and sends nothing', async () => {
  const fetchMock = fakeApi();
  const { user, dialog, reason } = await openOverride();
  await user.type(reason, 'valid reason');
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(posts(fetchMock)).toHaveLength(0);
});

test('reopening the dialog for another line starts with an empty reason', async () => {
  fakeApi();
  const { user, dialog, reason } = await openOverride();
  await user.type(reason, 'leftover text');
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await user.click(screen.getByRole('button', { name: /Override flag for Rhea Quality/ }));
  const again = await screen.findByRole('dialog');
  expect((within(again).getByLabelText(/Reason/) as HTMLTextAreaElement).value).toBe('');
});

test('a NOT_FOUND refusal shows the message, closes the dialog, and reloads the list', async () => {
  const fetchMock = fakeApi((method) =>
    method === 'POST' ? { status: 404, body: apiError('NOT_FOUND', 'Line not found.') } : undefined,
  );
  const { user, dialog, reason } = await openOverride();
  const before = flagGets(fetchMock).length;
  await user.type(reason, 'valid reason');
  await user.click(within(dialog).getByRole('button', { name: 'Override flag' }));
  expect(await screen.findByText('Line not found.')).toBeTruthy();
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await vi.waitFor(() => expect(flagGets(fetchMock).length).toBeGreaterThan(before));
});

test('LINE_NOT_FLAGGED closes the dialog and moves focus to the search field (TC-FLG-33)', async () => {
  // Someone else overrode the line, so after the reload it is no longer listed, as in real use.
  let refused = false;
  fakeApi((method) => {
    if (method === 'POST') {
      refused = true;
      return {
        status: 409,
        body: apiError('LINE_NOT_FLAGGED', 'Only a flagged line can be overridden.'),
      };
    }
    return refused ? { status: 200, body: page([]) } : undefined;
  });
  const { user, dialog, reason } = await openOverride();
  await user.type(reason, 'valid reason');
  await user.click(within(dialog).getByRole('button', { name: 'Override flag' }));
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(await screen.findByText('No flagged lines. Nothing needs review.')).toBeTruthy();
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(screen.getByLabelText('Borrower or item')),
  );
});

test('search text of one character is refused on screen and not sent', async () => {
  const fetchMock = fakeApi();
  const user = userEvent.setup();
  renderApp('/flags');
  await user.type(await screen.findByLabelText('Borrower or item'), 'a');
  await user.click(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findByText('Search text must be 2 to 100 characters.')).toBeTruthy();
  expect(flagGets(fetchMock).some(([url]) => String(url).includes('q='))).toBe(false);
});

test('the search sends trimmed text, and the Returned filter sends returned=out', async () => {
  const fetchMock = fakeApi();
  const user = userEvent.setup();
  renderApp('/flags');
  await user.type(await screen.findByLabelText('Borrower or item'), '  Rhea  ');
  await user.click(screen.getByRole('button', { name: 'Search' }));
  await vi.waitFor(() =>
    expect(flagGets(fetchMock).some(([url]) => /[?&]q=Rhea(&|$)/.test(String(url)))).toBe(true),
  );
  await user.selectOptions(screen.getByLabelText('Returned?'), 'out');
  await vi.waitFor(() =>
    expect(
      flagGets(fetchMock).some(
        ([url]) => /returned=out/.test(String(url)) && /page=1/.test(String(url)),
      ),
    ).toBe(true),
  );
});

test('the row shows Returned, No note, a dash for no expected date, and "1 strike"', async () => {
  fakeApi(undefined, [{ ...LINE, outstanding: 0 }]);
  renderApp('/flags');
  const row = await screen.findByRole('row', { name: /Rhea Quality/ });
  expect(row.textContent).toMatch(/Returned/);
  expect(row.textContent).toMatch(/No note/);
  expect(row.textContent).toMatch(/—/);
  expect(row.textContent).toMatch(/1 strike(?!s)/);
});

test('a partly returned supply line shows the quantity and how many are still out', async () => {
  fakeApi(undefined, [
    {
      ...LINE,
      item: { id: 'i2', name: 'QA Cable', assetTag: null },
      quantityBorrowed: 5,
      outstanding: 2,
      strikes: 4,
    },
  ]);
  renderApp('/flags');
  const row = await screen.findByRole('row', { name: /Rhea Quality/ });
  expect(row.textContent).toMatch(/Quantity 5/);
  expect(row.textContent).toMatch(/2 still out/);
  expect(row.textContent).toMatch(/4 strikes(?! · blocked)/);
});

test('a viewer sees the not-allowed page, no Flag review link, and the list is never fetched', async () => {
  const fetchMock = mockApi((method, path) => {
    if (path === '/auth/me') return signedInAs(VIEWER);
    throw new Error(`unexpected ${method} ${path}`);
  });
  renderApp('/flags');
  expect(await screen.findByText("You can't open this page")).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Flag review' })).toBeNull();
  expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/flags'))).toBe(false);
});

test('an admin sees the Flag review link in the menu', async () => {
  fakeApi();
  renderApp('/flags');
  expect(await screen.findByRole('link', { name: 'Flag review' })).toBeTruthy();
});

async function runOnce() {
  const user = userEvent.setup();
  renderApp('/flags');
  await user.click(await screen.findByRole('button', { name: 'Run flagging now' }));
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Run flagging' }),
  );
  return user;
}

test('TC-FLG-41: a refusal without Retry-After says "Try again shortly."', async () => {
  fakeApi((_method, path) =>
    path === '/flagging/run'
      ? { status: 429, body: apiError('RATE_LIMITED', 'Too many requests. Try again later.') }
      : undefined,
  );
  await runOnce();
  expect(
    await screen.findByText('Flagging was run less than a minute ago. Try again shortly.'),
  ).toBeTruthy();
});

test('TC-FLG-41: a refusal with 1 second left says "1 second"', async () => {
  fakeApi((_method, path) =>
    path === '/flagging/run'
      ? {
          status: 429,
          body: apiError('RATE_LIMITED', 'Too many requests. Try again later.'),
          headers: { 'Retry-After': '1' },
        }
      : undefined,
  );
  await runOnce();
  expect(
    await screen.findByText('Flagging was run less than a minute ago. Try again in 1 second.'),
  ).toBeTruthy();
});

test('TC-FLG-41: a successful run after a refusal clears the refusal and reloads the list', async () => {
  let runs = 0;
  const fetchMock = fakeApi((_method, path) => {
    if (path !== '/flagging/run') return undefined;
    runs += 1;
    return runs === 1
      ? {
          status: 429,
          body: apiError('RATE_LIMITED', 'Too many requests. Try again later.'),
          headers: { 'Retry-After': '5' },
        }
      : { status: 200, body: { run: { flagged: 1, skipped: false } } };
  });
  const user = await runOnce();
  const refusal = 'Flagging was run less than a minute ago. Try again in 5 seconds.';
  expect(await screen.findByText(refusal)).toBeTruthy();
  const before = flagGets(fetchMock).length;
  await user.click(screen.getByRole('button', { name: 'Run flagging now' }));
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Run flagging' }),
  );
  expect(await screen.findByText('Flagging run finished. 1 line flagged.')).toBeTruthy();
  expect(screen.queryByText(refusal)).toBeNull();
  await vi.waitFor(() => expect(flagGets(fetchMock).length).toBeGreaterThan(before));
});

test('TC-FLG-41: a run skipped because another is in progress says nothing changed', async () => {
  fakeApi((_method, path) =>
    path === '/flagging/run'
      ? { status: 200, body: { run: { flagged: 0, skipped: true } } }
      : undefined,
  );
  await runOnce();
  expect(
    await screen.findByText('Another flagging run is in progress. Nothing was changed.'),
  ).toBeTruthy();
});

test('TC-FLG-41: any other run error is shown as a notification, not as the once-a-minute refusal', async () => {
  fakeApi((_method, path) =>
    path === '/flagging/run'
      ? { status: 500, body: apiError('INTERNAL', 'Something went wrong. Try again.') }
      : undefined,
  );
  await runOnce();
  expect(await screen.findByText('Something went wrong. Try again.')).toBeTruthy();
  expect(screen.queryByText(/Flagging was run less than a minute ago/)).toBeNull();
});
