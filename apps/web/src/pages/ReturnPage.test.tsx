import type { OpenLine } from '@bms/shared';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import {
  apiError,
  emulateModalDialogs,
  HANDLER,
  mockApi,
  renderApp,
  signedInAs,
} from '../test-utils';

beforeAll(emulateModalDialogs);

// BRW-5: the Return screen. The rules (BR 5, 6) are tested in api/returns.test.ts and
// api/open-lines.test.ts; these tests check what the screen sends and shows.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const LAPTOP: OpenLine = {
  lineId: 'a0000000-0000-4000-8000-000000000001',
  transactionId: 't1',
  borrower: { id: 'b1', schoolId: '2021-10457', name: 'Miguel Bautista' },
  item: { id: 'i1', name: 'Laptop, Dell Latitude 5440', assetTag: 'LT-0012', trackingType: 'UNIT' },
  location: 'CL-201',
  issuedBy: 'Juan dela Cruz',
  issuedAt: '2026-11-02T01:12:00.000Z',
  expectedReturnDate: '2026-11-03',
  note: 'Says he will return it tomorrow morning.',
  quantityBorrowed: 1,
  outstanding: 1,
  flagStatus: 'FLAGGED',
  flaggedAt: '2026-11-02T09:00:00.000Z',
  strikes: 0,
};
const CORDS: OpenLine = {
  ...LAPTOP,
  lineId: 'a0000000-0000-4000-8000-000000000002',
  transactionId: 't2',
  item: { id: 'i2', name: 'Extension cord, 5 m', assetTag: null, trackingType: 'QUANTITY' },
  note: null,
  expectedReturnDate: null,
  quantityBorrowed: 5,
  outstanding: 2,
  flagStatus: 'NONE',
  flaggedAt: null,
};
const LAPTOP_NAME = 'Laptop, Dell Latitude 5440 LT-0012';
const SEARCH_BUTTON = 'Find open borrowings';

type Answer = (method: string, path: string, body: unknown) => object | undefined;
function fakeApi(answer?: Answer, lines = [LAPTOP, CORDS]) {
  return mockApi((method, path, body) => {
    if (path === '/auth/me') return signedInAs(HANDLER);
    const reply = answer?.(method, path, body);
    if (reply) return reply as { status: number; body?: unknown };
    if (method === 'GET' && path.startsWith('/returns/open')) {
      return { status: 200, body: { data: lines, page: 1, pageSize: 50, total: lines.length } };
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
}
const calls = (fetchMock: ReturnType<typeof mockApi>, method: string, path: string) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => String(url).startsWith(`/api${path}`) && (init?.method ?? 'GET') === method,
  );
const sent = (fetchMock: ReturnType<typeof mockApi>) =>
  calls(fetchMock, 'POST', '/returns').map(([, init]) => JSON.parse(init!.body as string));
const recorded = (body: unknown) => {
  const line = (body as { lines: { lineId: string; quantity: number; condition: string }[] })
    .lines[0]!;
  return {
    status: 201,
    body: {
      returns: [
        {
          id: 'r1',
          ...line,
          receivedById: 'u1',
          returnedAt: '2026-11-10T06:32:00.000Z', // 14:32 in Manila
          outstanding: 0,
        },
      ],
    },
  };
};
const refuse = (status: number, code: string, message: string, details = {}) => ({
  status,
  body: apiError(code, message, details),
});

test('TC-BRW-27: finds open lines by borrower, by item, and by asset tag', async () => {
  const fetchMock = fakeApi();
  const user = userEvent.setup();
  renderApp('/return');
  await screen.findByText('Laptop, Dell Latitude 5440');

  for (const [by, text] of [
    ['Borrower', 'miguel'],
    ['Item', 'cord'],
    ['Asset tag', 'LT-0012'],
  ]) {
    await user.selectOptions(screen.getByLabelText('Find by'), by!);
    await user.clear(screen.getByLabelText('Search'));
    await user.type(screen.getByLabelText('Search'), text!);
    await user.click(screen.getByRole('button', { name: SEARCH_BUTTON }));
  }

  await waitFor(() =>
    expect(
      calls(fetchMock, 'GET', '/returns/open?by=assetTag&page=1&pageSize=50&q=LT-0012'),
    ).toHaveLength(1),
  );
  const urls = calls(fetchMock, 'GET', '/returns/open').map(([url]) => url);
  expect(urls).toContain('/api/returns/open?by=borrower&page=1&pageSize=50'); // the first load, no q
  expect(
    calls(fetchMock, 'GET', '/returns/open?by=borrower&page=1&pageSize=50&q=miguel'),
  ).toHaveLength(1);
  expect(calls(fetchMock, 'GET', '/returns/open?by=item&page=1&pageSize=50&q=cord')).toHaveLength(
    1,
  );
  // The rows show borrower, item, tag, room, quantity out, and the expected date.
  expect(screen.getAllByText(/Miguel Bautista 2021-10457/)).toHaveLength(2);
  expect(screen.getByText('Asset tag LT-0012')).toBeTruthy();
  expect(screen.getAllByText('Room: CL-201')).toHaveLength(2);
  expect(screen.getByText('Out: 2 of 5')).toBeTruthy();
  expect(screen.getByText('Expected 3 Nov 2026')).toBeTruthy();
});

test('a one-letter search is refused on the field and nothing is sent', async () => {
  const fetchMock = fakeApi();
  const user = userEvent.setup();
  renderApp('/return');
  await screen.findByText('Laptop, Dell Latitude 5440');
  await user.type(screen.getByLabelText('Search'), 'm');
  await user.click(screen.getByRole('button', { name: SEARCH_BUTTON }));
  expect(screen.getByText('Search text must be 2 to 100 characters.')).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByLabelText('Search'));
  expect(calls(fetchMock, 'GET', '/returns/open')).toHaveLength(1);
});

test('no match shows a message', async () => {
  fakeApi(undefined, []);
  const user = userEvent.setup();
  renderApp('/return');
  await screen.findByText('Nothing is out right now.');
  await user.type(screen.getByLabelText('Search'), 'PJ-0099');
  await user.click(screen.getByRole('button', { name: SEARCH_BUTTON }));
  expect(await screen.findByText(/No open borrowings match "PJ-0099"/)).toBeTruthy();
});

test('TC-BRW-28: return all of one line and part of another, choosing the condition', async () => {
  // The list the fake API answers with; it shrinks as returns are recorded (the reload).
  const cords = { ...CORDS, outstanding: 4 };
  const current = [LAPTOP, cords];
  const fetchMock = fakeApi((method, path, body) => {
    if (method !== 'POST' || path !== '/returns') return undefined;
    const { lineId, quantity } = (body as { lines: { lineId: string; quantity: number }[] })
      .lines[0]!;
    if (lineId === LAPTOP.lineId) current.splice(0, 1);
    else current[current.length - 1] = { ...cords, outstanding: cords.outstanding - quantity };
    return recorded(body);
  }, current);
  const user = userEvent.setup();
  renderApp('/return');
  await screen.findByText('Laptop, Dell Latitude 5440');

  // A unit line: quantity fixed at 1; GOOD is the default condition.
  const condition = screen.getByLabelText(`Condition for ${LAPTOP_NAME}`) as HTMLSelectElement;
  expect(screen.getByLabelText(`Quantity to return for ${LAPTOP_NAME}`)).toHaveProperty(
    'disabled',
    true,
  );
  expect(condition.value).toBe('GOOD');
  await user.selectOptions(condition, 'Damaged');
  await user.click(screen.getByRole('button', { name: 'Return' }));
  await screen.findByText('Return recorded.');
  expect(sent(fetchMock)).toEqual([
    { lines: [{ lineId: LAPTOP.lineId, quantity: 1, condition: 'DAMAGED' }] },
  ]);
  // BR 6: the confirmation says the flag stays. Focus goes to the search (the button may be gone).
  const status = screen.getByRole('status').textContent;
  expect(status).toContain('received from Miguel Bautista at 14:32 (condition: damaged)');
  expect(status).toContain('The flag on this line stays');
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Search')));
  // The list reloads: the returned line is gone.
  await waitFor(() => expect(screen.queryByText('Laptop, Dell Latitude 5440')).toBeNull());

  // A quantity line: part of what is out, as Fair.
  const quantity = screen.getByLabelText('Quantity to return for Extension cord, 5 m');
  await user.clear(quantity);
  await user.type(quantity, '1');
  await user.selectOptions(screen.getByLabelText('Condition for Extension cord, 5 m'), 'Fair');
  await user.click(screen.getByRole('button', { name: 'Return quantity' }));
  await waitFor(() => expect(sent(fetchMock)).toHaveLength(2));
  expect(sent(fetchMock)[1]).toEqual({
    lines: [{ lineId: CORDS.lineId, quantity: 1, condition: 'FAIR' }],
  });
  // After the reload the line shows what is left, and the quantity box starts again from it.
  expect(await screen.findByText('Out: 3 of 5')).toBeTruthy();
  expect(
    (screen.getByLabelText('Quantity to return for Extension cord, 5 m') as HTMLInputElement).value,
  ).toBe('3');
});

test('TC-BRW-47: a refused unit line focuses its Return button; a line that left the list focuses the search', async () => {
  let gone = false;
  fakeApi((method, path) => {
    if (method === 'POST' && path === '/returns') {
      return refuse(409, 'RETURN_EXCEEDS_OUTSTANDING', 'Nothing of Laptop is still out.', {
        lineId: LAPTOP.lineId,
        outstanding: 0,
      });
    }
    // After the refusal the reload no longer has the line (someone else returned it).
    if (gone && method === 'GET' && path.startsWith('/returns/open')) {
      return { status: 200, body: { data: [CORDS], page: 1, pageSize: 50, total: 1 } };
    }
  });
  const user = userEvent.setup();
  renderApp('/return');
  await screen.findByText('Laptop, Dell Latitude 5440');
  await user.click(screen.getByRole('button', { name: 'Return' }));
  await screen.findByText('Return not saved.');
  // The quantity box of a unit line is disabled, so focus goes to its Return button.
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Return' })),
  );

  gone = true;
  await user.click(screen.getByRole('button', { name: 'Return' }));
  await waitFor(() => expect(screen.queryByText('Laptop, Dell Latitude 5440')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Search')));
});

test('TC-BRW-29: a flagged line is clearly marked; an unflagged one is not', async () => {
  fakeApi();
  renderApp('/return');
  await screen.findByText('Laptop, Dell Latitude 5440');
  const flag = screen.getByText('Flagged');
  expect(screen.getAllByText('Flagged')).toHaveLength(1);
  expect(flag.className).toContain('text-danger'); // colour is paired with the word and an icon
  expect(flag.querySelector('svg')).not.toBeNull();
  expect(flag.closest('div')!.parentElement!.className).toContain('bg-danger-tint'); // the row too
  expect(screen.getByText('Not flagged')).toBeTruthy();
});

test('TC-BRW-44: a refused line is marked and focused; the message says nothing was recorded', async () => {
  const message = 'You entered 3 of Extension cord, but the amount still out on this line is 2.';
  fakeApi((method, path) =>
    method === 'POST' && path === '/returns'
      ? refuse(409, 'RETURN_EXCEEDS_OUTSTANDING', message, { lineId: CORDS.lineId, outstanding: 2 })
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/return');
  await screen.findByText('Laptop, Dell Latitude 5440');
  const quantity = screen.getByLabelText('Quantity to return for Extension cord, 5 m');
  await user.clear(quantity);
  await user.type(quantity, '3');
  await user.click(screen.getByRole('button', { name: 'Return quantity' }));

  const top = (await screen.findByText('Return not saved.')).closest('[role=alert]')!;
  expect(top.textContent).toContain(message);
  // The screen adds it once; the API message does not repeat it.
  expect(top.textContent!.split('Nothing was recorded.')).toHaveLength(2);
  await waitFor(() => expect(document.activeElement).toBe(quantity));
  expect(quantity.getAttribute('aria-invalid')).toBe('true');
  expect(screen.getByText(message).id).toBe(quantity.getAttribute('aria-describedby')); // on the row too
});

test('a schema error under lines shows at the top; a bad quantity is stopped on the row', async () => {
  const fetchMock = fakeApi((method, path) =>
    method === 'POST' && path === '/returns'
      ? refuse(400, 'VALIDATION_ERROR', 'Invalid input.', { fields: { lines: ['Choose a line.'] } })
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/return');
  await screen.findByText('Laptop, Dell Latitude 5440');
  await user.click(screen.getByRole('button', { name: 'Return' }));
  const top = (await screen.findByText('Return not saved.')).closest('[role=alert]')!;
  expect(top.textContent).toContain('Choose a line.');

  const quantity = screen.getByLabelText('Quantity to return for Extension cord, 5 m');
  await user.clear(quantity);
  await user.click(screen.getByRole('button', { name: 'Return quantity' }));
  expect(await screen.findByText('Enter a whole number from 1 to 10,000.')).toBeTruthy();
  expect(sent(fetchMock)).toHaveLength(1);
});

test('TC-BRW-45: the layout can shrink to the window (jsdom has no layout; widths are checked by hand)', async () => {
  fakeApi();
  renderApp('/return');
  await screen.findByText('Laptop, Dell Latitude 5440');
  const list = screen.getByRole('region', { name: 'Open borrowings' });
  expect(list.className.split(' ')).toEqual(
    expect.arrayContaining(['min-w-0', 'max-w-full', 'w-full']),
  );
  // Under 640 px the Search field takes a full line (basis-full); flex-1 alone made it collapse.
  const searchField = screen.getByLabelText('Search').parentElement!.parentElement!;
  expect(searchField.className.split(' ')).toEqual(
    expect.arrayContaining(['basis-full', 'sm:flex-1', 'min-w-0']),
  );
  const findBy = screen.getByLabelText('Find by').parentElement!.parentElement!;
  expect(findBy.className.split(' ')).toEqual(
    expect.arrayContaining(['w-full', 'max-w-full', 'min-w-0']),
  );
});

test('a view-only user cannot open Return, and it is not in their menu', async () => {
  mockApi((_method, path) => {
    if (path === '/auth/me') return signedInAs({ ...HANDLER, role: 'VIEWER' });
    throw new Error(`unexpected ${path}`);
  });
  renderApp('/return');
  expect(await screen.findByRole('heading', { name: "You can't open this page" })).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Return' })).toBeNull();
});

test('TC-BRW-47: a reload with changed data does not pull focus away from the search box', async () => {
  let reloaded = false;
  fakeApi((method, path) => {
    if (method === 'POST' && path === '/returns') {
      return refuse(
        409,
        'RETURN_EXCEEDS_OUTSTANDING',
        'You entered 2 of Extension cord, but the amount still out on this line is 1.',
        {
          lineId: CORDS.lineId,
          outstanding: 1,
        },
      );
    }
    // The reload after the refusal shows a changed outstanding count (a new row key).
    if (reloaded && method === 'GET' && path.startsWith('/returns/open')) {
      return {
        status: 200,
        body: { data: [{ ...CORDS, outstanding: 1 }], page: 1, pageSize: 50, total: 1 },
      };
    }
  });
  // Hold the reload until the user has moved to the search box.
  const realFetch = fetch;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (reloaded && String(url).startsWith('/api/returns/open')) await gate;
    return realFetch(url, init);
  });
  const user = userEvent.setup();
  renderApp('/return');
  await screen.findByText('Laptop, Dell Latitude 5440');
  reloaded = true;
  await user.click(screen.getAllByRole('button', { name: 'Return quantity' })[0]!);
  await screen.findByText('Return not saved.');

  await user.click(screen.getByLabelText('Search'));
  release();
  expect(await screen.findByText('Out: 1 of 5')).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByLabelText('Search'));
});

test('TC-BRW-48: a too-broad borrower search shows the API message', async () => {
  fakeApi((method, path) =>
    method === 'GET' && path.includes('q=')
      ? refuse(
          422,
          'SEARCH_TOO_BROAD',
          'Too many borrowers have items out; search by item or asset tag.',
        )
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/return');
  await screen.findByText('Laptop, Dell Latitude 5440');
  await user.type(screen.getByLabelText('Search'), 'mi');
  await user.click(screen.getByRole('button', { name: SEARCH_BUTTON }));
  expect(
    await screen.findByText(/Too many borrowers have items out; search by item or asset tag\./),
  ).toBeTruthy();
});

// BRW-6: the note dialog. The rules (BR 7) are tested in api/line-notes.test.ts.
const patched = (fetchMock: ReturnType<typeof mockApi>) =>
  calls(fetchMock, 'PATCH', '/lines/').map(([url, init]) => [
    url,
    JSON.parse(init!.body as string),
  ]);
const editNoteButton = (name: string) =>
  screen.findByRole('button', { name: `Edit note and date for ${name}` });

test('TC-BRW-30: edit a line note and expected return date from the row', async () => {
  const fetchMock = fakeApi((method, path, body) =>
    method === 'PATCH'
      ? { status: 200, body: { line: { lineId: path, ...(body as object) } } }
      : undefined,
  );
  const user = userEvent.setup();
  renderApp('/return');
  await user.click(await editNoteButton(LAPTOP_NAME));
  const note = screen.getByLabelText('Note') as HTMLTextAreaElement;
  expect(note.value).toBe('Says he will return it tomorrow morning.');
  expect(note.getAttribute('maxlength')).toBe('500');
  expect((screen.getByLabelText('Expected return date') as HTMLInputElement).value).toBe(
    '2026-11-03',
  );
  await user.clear(note);
  await user.type(note, 'Back at 9');
  await user.click(screen.getByRole('button', { name: 'Save note' }));
  expect(await screen.findByText(`Note saved for ${LAPTOP_NAME}.`)).toBeTruthy();

  // The cords line has no date: an empty date is sent as null, not an empty string.
  await user.click(await editNoteButton('Extension cord, 5 m'));
  await user.type(screen.getByLabelText('Note'), 'Tomorrow');
  await user.click(screen.getByRole('button', { name: 'Save note' }));
  await screen.findByText('Note saved for Extension cord, 5 m.');

  expect(patched(fetchMock)).toEqual([
    [`/api/lines/${LAPTOP.lineId}`, { note: 'Back at 9', expectedReturnDate: '2026-11-03' }],
    [`/api/lines/${CORDS.lineId}`, { note: 'Tomorrow', expectedReturnDate: null }],
  ]);
});

test('TC-BRW-31: a refused date shows on its field; a closed line closes the dialog with the message', async () => {
  const closedMessage = 'This line is fully returned, so its note can no longer be changed.';
  let answer = refuse(400, 'VALIDATION_ERROR', 'Choose today or a later date.', {
    fields: { expectedReturnDate: ['Choose today or a later date.'] },
  });
  fakeApi((method) => (method === 'PATCH' ? answer : undefined));
  const user = userEvent.setup();
  renderApp('/return');
  await user.click(await editNoteButton(LAPTOP_NAME));
  await user.click(screen.getByRole('button', { name: 'Save note' }));
  const date = screen.getByLabelText('Expected return date');
  await waitFor(() => expect(date.getAttribute('aria-invalid')).toBe('true'));
  expect(document.activeElement).toBe(date);

  answer = refuse(409, 'LINE_NOT_OPEN', closedMessage);
  await user.click(screen.getByRole('button', { name: 'Save note' }));
  expect(await screen.findByText(closedMessage)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Save note' })).toBeNull();
});
