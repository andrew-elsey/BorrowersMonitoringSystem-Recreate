import {
  type APIRequestContext,
  type BrowserContext,
  expect,
  type Page,
  request,
  test,
} from '@playwright/test';

// HRD-2 (TC-HRD-60 to 68): checkout, partial return, end-of-day flagging, strike, block, override
// against the real Docker stack. Data is created through the API as admin (the containers seed only
// the admin and the settings). Flagging is triggered as the owner decided (D11): closing time is
// moved to just after the checkouts, which runs flagging at once (S22). Thresholds are lowered to
// 1/2/3 so three flagged transactions block a borrower. Setup and most checkouts are API calls; one
// checkout, the partial return, the blocked-borrower screen and the override are done in the browser,
// which shares the single API login through its cookies.

const baseURL = process.env.BASE_URL ?? 'http://web:8080';
let api: APIRequestContext;
let context: BrowserContext;
let page: Page;

const ids = {} as Record<string, string>; // borrower, room, item, and line ids by name
let lastIssuedAt = 0; // upper bound of every checkout time, in ms

async function call(method: 'get' | 'post' | 'put', path: string, data?: object) {
  const res = await api[method](`/api${path}`, { data });
  return { status: res.status(), body: res.status() === 204 ? null : await res.json() };
}
async function create(path: string, data: object) {
  const res = await call('post', path, data);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}
const checkout = (borrower: string, lines: { item: string; quantity: number }[]) =>
  call('post', '/transactions', {
    borrowerId: ids[borrower],
    locationId: ids.room,
    lines: lines.map((l) => ({ itemId: ids[l.item], quantity: l.quantity })),
  });
const strikes = async (borrower: string) =>
  (await call('get', `/borrowers/${ids[borrower]}/strikes`)).body.strikes;
const flaggedLines = async () => (await call('get', '/flags?pageSize=100')).body.data;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  // nginx allows 5 logins a minute per address: sign in once for the whole flow.
  api = await request.newContext({
    baseURL,
    extraHTTPHeaders: { 'X-Requested-With': 'fetch' },
  });
  const login = await call('post', '/auth/login', {
    username: process.env.ADMIN_USERNAME,
    password: process.env.ADMIN_PASSWORD,
  });
  expect(login.status).toBe(200);
  context = await browser.newContext({ baseURL, storageState: await api.storageState() });
  page = await context.newPage();
});
test.afterAll(async () => {
  await context.close();
  await api.dispose();
});

test('TC-HRD-60 checkout: admin sets up and three borrowers check out items', async () => {
  const semester = (
    await create('/semesters', { name: 'E2E', startDate: '2020-01-01', endDate: '2099-12-31' })
  ).semester;
  expect((await call('post', `/semesters/${semester.id}/current`)).status).toBe(200);
  ids.room = (await create('/rooms', { name: 'E2E Lab' })).room.id;
  const category = (await create('/categories', { name: 'E2E Equipment' })).category.id;
  const item = async (name: string, extra: object) =>
    (
      await create('/items', {
        name,
        categoryId: category,
        condition: 'GOOD',
        status: 'ACTIVE',
        ...extra,
      })
    ).item.id;
  ids.projector = await item('Projector', { trackingType: 'UNIT', assetTag: 'E2E-PJ-1' });
  ids.cords = await item('Extension cord', { trackingType: 'QUANTITY', totalQuantity: 5 });
  for (const n of [1, 2, 3]) {
    ids[`laptop${n}`] = await item(`Laptop ${n}`, {
      trackingType: 'UNIT',
      assetTag: `E2E-LT-${n}`,
    });
  }
  for (const [key, name, schoolId] of [
    ['ana', 'Ana Same-day', 'E2E-1'],
    ['cara', 'Cara Partial', 'E2E-2'],
    ['fil', 'Fil Student', 'E2E-3'],
  ]) {
    ids[key] = (
      await create('/borrowers', { schoolId, name, type: 'STUDENT', department: 'IT' })
    ).borrower.id;
  }

  const checkouts = [await checkout('ana', [{ item: 'projector', quantity: 1 }])];
  // S6: three separate transactions for Fil, one laptop each.
  for (const n of [1, 2, 3])
    checkouts.push(await checkout('fil', [{ item: `laptop${n}`, quantity: 1 }]));
  for (const res of checkouts) expect(res.status, JSON.stringify(res.body)).toBe(201);
  ids.anaLine = checkouts[0].body.transaction.lines[0].id;
  for (const n of [1, 2, 3]) ids[`filLine${n}`] = checkouts[n].body.transaction.lines[0].id;
  // The projector is out now, so a second checkout of it is refused.
  const again = await checkout('cara', [{ item: 'projector', quantity: 1 }]);
  expect(again.body.error.code).toBe('ITEM_UNAVAILABLE');

  // Cara borrows all 5 cords on the Checkout screen: borrower, room, item, quantity, confirm.
  await page.goto('/checkout');
  await page.getByLabel('Find by name or school ID').fill('Cara');
  await page.getByRole('button', { name: 'Choose Cara Partial' }).click();
  await page.getByLabel('Where will the items be used?').selectOption({ label: 'E2E Lab' });
  await page.getByLabel('Search by name or asset tag').fill('Extension');
  await page.getByRole('button', { name: 'Add Extension cord' }).click();
  await page.getByLabel('Quantity of Extension cord').fill('5');
  await page.getByRole('button', { name: 'Confirm checkout' }).click();
  await expect(page.getByText('Checkout saved.')).toBeVisible();
  lastIssuedAt = Date.now();
  const open = await call('get', '/returns/open?q=Cara');
  expect(open.body.data).toHaveLength(1);
  ids.caraLine = open.body.data[0].lineId;
});

test('TC-HRD-61 return: full same-day return and a partial return of 3 of 5 cords', async () => {
  const same = await call('post', '/returns', {
    lines: [{ lineId: ids.anaLine, quantity: 1, condition: 'GOOD' }],
  });
  expect(same.status, JSON.stringify(same.body)).toBe(201);
  // Cara returns 3 of her 5 cords on the Return screen.
  await page.goto('/return');
  await page.getByLabel('Search', { exact: true }).fill('Cara');
  await page.getByRole('button', { name: 'Find open borrowings' }).click();
  await page.getByLabel('Quantity to return for Extension cord').fill('3');
  await page.getByRole('button', { name: 'Return quantity' }).click();
  await expect
    .poll(async () => (await call('get', '/returns/open?q=Cara')).body.data[0].outstanding)
    .toBe(2);
  // S15: only 2 cords are still out.
  const tooMany = await call('post', '/returns', {
    lines: [{ lineId: ids.caraLine, quantity: 3, condition: 'GOOD' }],
  });
  expect(tooMany.body.error.code).toBe('RETURN_EXCEEDS_OUTSTANDING');
});

test('TC-HRD-62 flagging: moving closing time just past the checkouts flags the open lines', async () => {
  // A line is flagged when it was issued before closing HH:mm:00, so closing must be a later minute
  // than the last checkout. Wait for that minute to pass, then the settings save runs flagging.
  const closesAt = (Math.floor(lastIssuedAt / 60_000) + 1) * 60_000;
  const closingTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(closesAt);
  await new Promise((done) => setTimeout(done, Math.max(0, closesAt - Date.now()) + 1500));
  const saved = await call('put', '/settings', {
    closingTime,
    warningThreshold: 1,
    noticeThreshold: 2,
    blockThreshold: 3,
  });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  await expect.poll(async () => (await flaggedLines()).length).toBe(4);
  const lines = await flaggedLines();
  const byBorrower = (name: string) =>
    lines.filter((l: { borrower: { name: string } }) => l.borrower.name.startsWith(name));
  expect(byBorrower('Ana')).toHaveLength(0); // S1: returned the same day
  expect(byBorrower('Fil')).toHaveLength(3);
  const cara = byBorrower('Cara');
  expect(cara).toHaveLength(1);
  expect(cara[0].outstanding).toBe(2); // S3: only the unreturned part is outstanding
});

test('TC-HRD-63 strike: one per flagged transaction, not per line', async () => {
  expect(await strikes('ana')).toBe(0);
  expect(await strikes('cara')).toBe(1);
  expect(await strikes('fil')).toBe(3);
});

test('TC-HRD-64 block: Fil is blocked from borrowing but can still return', async () => {
  // The Checkout screen shows the block and will not let the checkout be confirmed.
  await page.goto('/checkout');
  await page.getByLabel('Find by name or school ID').fill('Fil');
  await page.getByRole('button', { name: 'Choose Fil Student' }).click();
  await expect(page.getByText('Blocked: 3 strikes.')).toBeVisible();
  await expect(page.getByText('Checkout is blocked for this borrower')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm checkout' })).toBeDisabled();
  // The server refuses it too (rule 2).
  const blocked = await checkout('fil', [{ item: 'projector', quantity: 1 }]);
  expect(blocked.status).toBe(409);
  expect(blocked.body.error.code).toBe('BORROWER_BLOCKED');
  const late = await call('post', '/returns', {
    lines: [{ lineId: ids.filLine2, quantity: 1, condition: 'GOOD' }],
  });
  expect(late.status, JSON.stringify(late.body)).toBe(201);
  expect(await strikes('fil')).toBe(3); // BR 6: returning never removes a flag
});

test('TC-HRD-65 and 66 flag review screen shows the last run and the flagged lines, then the admin overrides one', async () => {
  await page.goto('/flags');
  await expect(page.getByText(/Last flagging run: .*4 lines flagged/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Override flag for Fil Student, Laptop 1/ }),
  ).toBeVisible();

  // TC-HRD-66 override: the admin overrides Fil's first laptop with a reason (BR 13).
  await page.getByRole('button', { name: /Override flag for Fil Student, Laptop 1/ }).click();
  await page.getByLabel(/Reason/).fill('Approved by the department head');
  await page.getByRole('button', { name: 'Override flag', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /Override flag for Fil Student, Laptop 1/ }),
  ).toHaveCount(0);
  expect(await strikes('fil')).toBe(2);
});

test('TC-HRD-67 unblock: after the override Fil can borrow again', async () => {
  const res = await checkout('fil', [{ item: 'projector', quantity: 1 }]);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
});

test('TC-HRD-68 late return: Cara returns the last 2 cords and keeps the flag and the strike', async () => {
  const res = await call('post', '/returns', {
    lines: [{ lineId: ids.caraLine, quantity: 2, condition: 'GOOD' }],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  expect(await strikes('cara')).toBe(1); // S3
  const cara = (await flaggedLines()).filter((l: { lineId: string }) => l.lineId === ids.caraLine);
  expect(cara[0].outstanding).toBe(0);
});
