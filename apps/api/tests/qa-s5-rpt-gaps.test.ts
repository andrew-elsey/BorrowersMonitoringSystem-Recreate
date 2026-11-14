import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { prisma } from '../src/lib/prisma.ts';
import { countStrikes } from '../src/services/strikes.ts';
import {
  type Agent,
  borrower,
  lend,
  seedWorld,
  signIn,
  type World,
} from './setup/qa-sprint5-fixtures.ts';

// QA gap tests for RPT-1 (dashboard), RPT-2 and RPT-3 (histories), RPT-4 (usage summary):
// strike counting on the dashboard (BR 10, 12, S5, S7, S9), thresholds from settings (rule 3),
// SPEC 7 bounds, Manila day edges, and the shared 30 a minute reports limit (ARCH 12.3).

let world: World;

beforeEach(async () => {
  world = await seedWorld();
});

const get = (agent: Agent, path: string, ip?: string) => {
  const req = agent.get(path).set('X-Requested-With', 'fetch');
  return ip ? req.set('X-Forwarded-For', ip) : req;
};
type FlaggedRow = { borrower: { id: string }; strikes: number };
const strikesOnDashboard = async (agent: Agent) =>
  Object.fromEntries(
    (await get(agent, '/api/dashboard/flagged-borrowers').expect(200)).body.data.map(
      (row: FlaggedRow) => [row.borrower.id, row.strikes],
    ),
  );

// ---------- RPT-1 dashboard ----------

test('RPT-1, BR 10, S5, S7: the dashboard strike count matches the strike service (one per transaction)', async () => {
  // S5: three flagged lines in one transaction are one strike.
  await lend(world, [
    { itemId: world.laptopId, flagStatus: 'FLAGGED' },
    { itemId: world.cordId, flagStatus: 'FLAGGED' },
    { itemId: world.cordId, flagStatus: 'FLAGGED' },
  ]);
  // S7: one flagged and one overridden line still count once.
  await lend(world, [
    { itemId: world.cordId, flagStatus: 'FLAGGED' },
    { itemId: world.cordId, flagStatus: 'OVERRIDDEN' },
  ]);
  // Every flagged line overridden: no strike.
  await lend(world, [{ itemId: world.cordId, flagStatus: 'OVERRIDDEN' }]);

  const dashboard = await strikesOnDashboard(await signIn('vic'));
  expect(dashboard).toEqual({ [world.borrowerId]: 2 });
  expect(await countStrikes(world.borrowerId)).toBe(2);
});

test('RPT-1, BR 12, S9: switching the current semester switches the dashboard strikes, and back again', async () => {
  for (let i = 0; i < 4; i++) {
    await lend(world, [{ itemId: world.cordId, flagStatus: 'FLAGGED' }], {
      semesterId: world.olderSemesterId,
    });
  }
  const ana = await signIn('ana');
  expect(await strikesOnDashboard(ana)).toEqual({});

  await ana
    .post(`/api/semesters/${world.olderSemesterId}/current`)
    .set('X-Requested-With', 'fetch')
    .expect(200);
  expect(await strikesOnDashboard(ana)).toEqual({ [world.borrowerId]: 4 });

  await ana
    .post(`/api/semesters/${world.currentSemesterId}/current`)
    .set('X-Requested-With', 'fetch')
    .expect(200);
  expect(await strikesOnDashboard(ana)).toEqual({});
});

test('RPT-1, rule 3: the dashboard reports the thresholds from settings, not the defaults', async () => {
  await prisma.setting.update({
    where: { id: 1 },
    data: { warningThreshold: 2, noticeThreshold: 6, blockThreshold: 9 },
  });
  const body = (await get(await signIn('vic'), '/api/dashboard/flagged-borrowers').expect(200))
    .body;
  expect(body).toMatchObject({ warningThreshold: 2, noticeThreshold: 6, blockThreshold: 9 });
});

test('RPT-1: an inactive borrower with strikes still shows on the dashboard', async () => {
  const gone = await borrower('QA-0002', 'Inactive Borrower', false);
  await lend(world, [{ itemId: world.cordId, flagStatus: 'FLAGGED' }], { borrowerId: gone });
  expect(await strikesOnDashboard(await signIn('vic'))).toEqual({ [gone]: 1 });
});

test('RPT-1: unreturned shows a partly returned line with its outstanding quantity and leaves out a returned one', async () => {
  const [partial] = await lend(world, [{ itemId: world.cordId, quantity: 5, returned: 3 }]);
  await lend(world, [{ itemId: world.laptopId, returned: 1 }]);
  const rows = (await get(await signIn('vic'), '/api/dashboard/unreturned').expect(200)).body.data;
  expect(
    rows.map((r: { lineId: string; outstanding: number }) => [r.lineId, r.outstanding]),
  ).toEqual([[partial, 2]]);
});

test('SPEC 7: a huge page number on every Sprint 5 list is answered, never INTERNAL_ERROR', async () => {
  const ana = await signIn('ana');
  const huge = Number.MAX_SAFE_INTEGER;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const paths = [
    `/api/dashboard/unreturned?page=${huge}`,
    `/api/dashboard/flagged-borrowers?page=${huge}`,
    `/api/users?page=${huge}`,
    `/api/reports/borrowers/${world.borrowerId}/history?from=${today}&to=${today}&page=${huge}`,
    `/api/reports/items/${world.cordId}/history?from=${today}&to=${today}&page=${huge}`,
  ];
  const results: Record<string, string> = {};
  for (const path of paths) {
    const res = await get(ana, path);
    results[path.split('?')[0]!] = `${res.status} ${res.body.error?.code ?? ''}`.trim();
  }
  // Either an empty page (200) or a VALIDATION_ERROR is fine; a 500 is not.
  for (const [path, outcome] of Object.entries(results)) {
    expect(outcome, path).not.toMatch(/^500/);
  }
});

// ---------- RPT-2 and RPT-3 histories ----------

test('RPT-2: two partial returns by different handlers are listed in order with each receiving handler', async () => {
  const [id] = await lend(world, [{ itemId: world.cordId, quantity: 5 }]);
  const hal = await signIn('hal');
  const ana = await signIn('ana');
  const giveBack = (agent: Agent, quantity: number, condition: string) =>
    agent
      .post('/api/returns')
      .set('X-Requested-With', 'fetch')
      .send({ lines: [{ lineId: id, quantity, condition }] })
      .expect(201);
  await giveBack(hal, 2, 'GOOD');
  await giveBack(ana, 3, 'DAMAGED');

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const line = (
    await get(
      await signIn('vic'),
      `/api/reports/borrowers/${world.borrowerId}/history?from=${today}&to=${today}`,
    ).expect(200)
  ).body.data[0];
  expect(line.outstanding).toBe(0);
  expect(
    line.returns.map((r: { quantity: number; condition: string; receivedBy: { name: string } }) => [
      r.quantity,
      r.condition,
      r.receivedBy.name,
    ]),
  ).toEqual([
    [2, 'GOOD', 'Hal Handler'],
    [3, 'DAMAGED', 'Ana Admin'],
  ]);
  expect(line.issuedBy.name).toBe('Hal Handler');
  expect(line.room.name).toBe('CL-201');
});

test('RPT-2, S9, BR 13: an older semester line keeps its flag in history; an override shows who, when, and why', async () => {
  const issuedAt = new Date('2026-03-02T02:00:00Z'); // 10:00 Manila
  const [flagged] = await lend(world, [{ itemId: world.cordId, flagStatus: 'FLAGGED' }], {
    semesterId: world.olderSemesterId,
    issuedAt,
  });
  const [overridden] = await lend(world, [{ itemId: world.laptopId, flagStatus: 'FLAGGED' }], {
    semesterId: world.olderSemesterId,
    issuedAt,
  });
  await prisma.transactionItem.update({
    where: { id: overridden! },
    data: {
      flagStatus: 'OVERRIDDEN',
      overrideById: world.adminId,
      overrideAt: new Date('2026-03-03T01:00:00Z'),
      overrideReason: 'Lab ran late',
    },
  });

  const rows = (
    await get(
      await signIn('vic'),
      `/api/reports/borrowers/${world.borrowerId}/history?from=2026-03-02&to=2026-03-02`,
    ).expect(200)
  ).body.data;
  const byId = Object.fromEntries(rows.map((r: { lineId: string }) => [r.lineId, r]));
  expect(byId[flagged!]).toMatchObject({ flagStatus: 'FLAGGED', override: null });
  expect(byId[overridden!]).toMatchObject({
    flagStatus: 'OVERRIDDEN',
    override: { by: { name: 'Ana Admin' }, at: '2026-03-03T01:00:00.000Z', reason: 'Lab ran late' },
  });
});

test('RPT-2, RPT-3, BR 15: an inactive borrower, a retired item, and a deactivated handler still show in history', async () => {
  const [id] = await lend(world, [{ itemId: world.laptopId, returned: 1 }]);
  await prisma.borrower.update({ where: { id: world.borrowerId }, data: { active: false } });
  await prisma.item.update({ where: { id: world.laptopId }, data: { status: 'RETIRED' } });
  await prisma.user.update({ where: { id: world.halId }, data: { active: false } });

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const vic = await signIn('vic');
  for (const path of [
    `/api/reports/borrowers/${world.borrowerId}/history?from=${today}&to=${today}`,
    `/api/reports/items/${world.laptopId}/history?from=${today}&to=${today}`,
  ]) {
    const rows = (await get(vic, path).expect(200)).body.data;
    expect(
      rows.map((r: { lineId: string; issuedBy: { name: string } }) => [r.lineId, r.issuedBy.name]),
    ).toEqual([[id, 'Hal Handler']]);
  }
});

test('RPT-2, RPT-3: an id in upper case finds the same borrower and item', async () => {
  await lend(world, [{ itemId: world.laptopId }]);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const vic = await signIn('vic');
  const range = `from=${today}&to=${today}`;
  const b = await get(
    vic,
    `/api/reports/borrowers/${world.borrowerId.toUpperCase()}/history?${range}`,
  );
  const i = await get(vic, `/api/reports/items/${world.laptopId.toUpperCase()}/history?${range}`);
  expect([b.status, b.body.total, i.status, i.body.total]).toEqual([200, 1, 200, 1]);
});

test('SPEC 7: history page size 101 is VALIDATION_ERROR; 100 is accepted', async () => {
  const vic = await signIn('vic');
  const base = `/api/reports/items/${world.cordId}/history?from=2026-11-01&to=2026-11-01`;
  expect((await get(vic, `${base}&pageSize=101`)).body.error.code).toBe('VALIDATION_ERROR');
  await get(vic, `${base}&pageSize=100`).expect(200);
});

// ---------- RPT-4 usage summary ----------

test('RPT-4: one line is one time borrowed, whatever its quantity', async () => {
  await lend(world, [{ itemId: world.cordId, quantity: 7 }]);
  await lend(world, [{ itemId: world.cordId, quantity: 1 }]);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const body = (
    await get(await signIn('vic'), `/api/reports/usage?from=${today}&to=${today}`).expect(200)
  ).body;
  expect(body.items).toEqual([
    { id: world.cordId, name: 'Extension cord', assetTag: null, timesBorrowed: 2 },
  ]);
  expect(body.categories[0].timesBorrowed).toBe(2);
  expect(body.rooms[0].timesBorrowed).toBe(2);
});

test('RPT-4, rule 4: the period is whole Manila days (a 00:30 Manila checkout belongs to that Manila day)', async () => {
  // 16:30 UTC on 9 Nov is 00:30 on 10 Nov in Manila.
  await lend(world, [{ itemId: world.cordId }], { issuedAt: new Date('2026-11-09T16:30:00Z') });
  const vic = await signIn('vic');
  const on = async (day: string) =>
    (await get(vic, `/api/reports/usage?from=${day}&to=${day}`).expect(200)).body.items.length;
  expect([await on('2026-11-09'), await on('2026-11-10')]).toEqual([0, 1]);
});

test('RPT-4, SPEC 7: a leap year of 366 days is accepted, 367 days is refused', async () => {
  const vic = await signIn('vic');
  await get(vic, '/api/reports/usage?from=2028-01-01&to=2028-12-31').expect(200);
  const over = await get(vic, '/api/reports/usage?from=2027-12-31&to=2028-12-31');
  expect(over.status).toBe(400);
  expect(over.body.error.code).toBe('VALIDATION_ERROR');
});

test('RPT-2 to RPT-4: the last representable day (9999-12-31) is answered, not INTERNAL_ERROR', async () => {
  const vic = await signIn('vic');
  const range = 'from=9999-12-31&to=9999-12-31';
  for (const path of [
    `/api/reports/usage?${range}`,
    `/api/reports/borrowers/${world.borrowerId}/history?${range}`,
    `/api/reports/items/${world.cordId}/history?${range}`,
  ]) {
    expect((await get(vic, path)).status, path).toBe(200);
  }
});

// ---------- shared reports limiter (ARCH 12.3, owner decision 2026-11-12) ----------

test('ARCH 12.3: after 30 report requests the dashboard and the CSV import still answer (outside the reports count)', async () => {
  const ana = await signIn('ana', createApp());
  const ip = '10.9.5.1';
  for (let i = 0; i < 30; i++) {
    await get(ana, '/api/reports/usage?from=2026-11-01&to=2026-11-01', ip).expect(200);
  }
  expect(
    (
      await get(
        ana,
        `/api/reports/borrowers/${world.borrowerId}/history?from=2026-11-01&to=2026-11-01`,
        ip,
      )
    ).status,
  ).toBe(429);
  await get(ana, '/api/dashboard/unreturned', ip).expect(200);
  await get(ana, '/api/dashboard/flagged-borrowers', ip).expect(200);
  const imported = await ana
    .post('/api/borrowers/import')
    .set('X-Requested-With', 'fetch')
    .set('X-Forwarded-For', ip)
    .attach('file', Buffer.from('school_id,name,type,department,active\n'), 'b.csv');
  expect(imported.status).toBe(200);
});

test('ARCH 12.3: refused report requests (bad range) still count toward the shared 30 a minute', async () => {
  const vic = await signIn('vic', createApp());
  const ip = '10.9.5.2';
  for (let i = 0; i < 30; i++) {
    expect((await get(vic, '/api/reports/usage?from=2026-11-02&to=2026-11-01', ip)).status).toBe(
      400,
    );
  }
  expect((await get(vic, '/api/reports/usage?from=2026-11-01&to=2026-11-01', ip)).status).toBe(429);
});
