import request from 'supertest';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../src/app.ts';
import { prisma } from '../src/lib/prisma.ts';
import { countStrikes } from '../src/services/strikes.ts';
import {
  type Agent,
  auditCount,
  lend,
  seedWorld,
  signIn,
  type World,
} from './setup/qa-sprint5-fixtures.ts';

// QA gap tests for BRW-6 (line notes, BR 7, SPEC 7) and its cross-ticket effects: notes show in
// the dashboard (RPT-1) and both histories (RPT-2, RPT-3), and never touch flags or strikes (S4).

let world: World;

beforeEach(async () => {
  world = await seedWorld();
});

afterEach(() => {
  vi.useRealTimers();
});

const patch = (agent: Agent, id: string, body: unknown) =>
  agent
    .patch(`/api/lines/${id}`)
    .set('X-Requested-With', 'fetch')
    .send(body as object);
const notesAudited = () => auditCount('LINE_NOTE_UPDATED');

test('BR 7: "today" is the Manila date, so just after midnight Manila the UTC date is already past', async () => {
  // 16:30 UTC on 14 Nov is 00:30 on 15 Nov in Manila.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-14T16:30:00Z'));
  const [id] = await lend(world, [{ itemId: world.cordId, quantity: 2 }]);
  const hal = await signIn('hal');

  const yesterday = await patch(hal, id!, { note: '', expectedReturnDate: '2026-11-14' });
  expect(yesterday.status).toBe(400);
  expect(yesterday.body.error.details.fields.expectedReturnDate).toEqual([
    'Choose today or a later date.',
  ]);
  await patch(hal, id!, { note: '', expectedReturnDate: '2026-11-15' }).expect(200);
});

test('BR 7: at 23:59 Manila the same Manila date is still today', async () => {
  // 15:59 UTC on 14 Nov is 23:59 on 14 Nov in Manila.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-14T15:59:00Z'));
  const [id] = await lend(world, [{ itemId: world.cordId, quantity: 2 }]);
  await patch(await signIn('hal'), id!, { note: '', expectedReturnDate: '2026-11-14' }).expect(200);
});

test('BR 7: a partly returned line is still open and takes a note', async () => {
  const [id] = await lend(world, [{ itemId: world.cordId, quantity: 5, returned: 3 }]);
  const res = await patch(await signIn('hal'), id!, {
    note: 'two more at 3pm',
    expectedReturnDate: null,
  });
  expect(res.status).toBe(200);
  expect(res.body.line.note).toBe('two more at 3pm');
});

test('BR 7, S4: editing the note of a FLAGGED or OVERRIDDEN line keeps its flag and the strike count', async () => {
  const [flagged] = await lend(world, [
    { itemId: world.cordId, quantity: 2, flagStatus: 'FLAGGED' },
  ]);
  const [overridden] = await lend(world, [{ itemId: world.laptopId, flagStatus: 'OVERRIDDEN' }]);
  expect(await countStrikes(world.borrowerId)).toBe(1);

  const hal = await signIn('hal');
  await patch(hal, flagged!, { note: 'back tomorrow', expectedReturnDate: '2099-01-01' }).expect(
    200,
  );
  await patch(hal, overridden!, { note: 'still out', expectedReturnDate: null }).expect(200);

  const lines = await prisma.transactionItem.findMany({
    where: { id: { in: [flagged!, overridden!] } },
  });
  expect(Object.fromEntries(lines.map((l) => [l.id, l.flagStatus]))).toEqual({
    [flagged!]: 'FLAGGED',
    [overridden!]: 'OVERRIDDEN',
  });
  expect(await countStrikes(world.borrowerId)).toBe(1);
});

test('SPEC 7: a note with control characters is refused and nothing is saved or audited', async () => {
  const [id] = await lend(world, [{ itemId: world.cordId }]);
  const res = await patch(await signIn('hal'), id!, {
    note: 'bad\u0000note',
    expectedReturnDate: null,
  });
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('VALIDATION_ERROR');
  expect((await prisma.transactionItem.findUniqueOrThrow({ where: { id: id! } })).note).toBeNull();
  expect(await notesAudited()).toBe(0);
});

test('SPEC 7: a note request body over 100 KB is PAYLOAD_TOO_LARGE before any work', async () => {
  const [id] = await lend(world, [{ itemId: world.cordId }]);
  const res = await patch(await signIn('hal'), id!, {
    note: 'x'.repeat(101 * 1024),
    expectedReturnDate: null,
  });
  expect(res.status).toBe(413);
  expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  expect(await notesAudited()).toBe(0);
});

test('ARCH 5: a note edit without the X-Requested-With header is refused (CSRF)', async () => {
  const [id] = await lend(world, [{ itemId: world.cordId }]);
  const hal = await signIn('hal');
  const res = await hal.patch(`/api/lines/${id}`).send({ note: 'x', expectedReturnDate: null });
  expect(res.status).toBe(403);
  expect(await notesAudited()).toBe(0);
});

test('BR 7: an invalid calendar date and a datetime are refused as VALIDATION_ERROR', async () => {
  const [id] = await lend(world, [{ itemId: world.cordId }]);
  const hal = await signIn('hal');
  for (const expectedReturnDate of ['2099-02-30', '2099-01-01T00:00:00Z', '0000-01-01', 20990101]) {
    const res = await patch(hal, id!, { note: '', expectedReturnDate });
    expect(res.status, String(expectedReturnDate)).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  }
  expect(await notesAudited()).toBe(0);
});

test('BR 7 -> RPT-1, RPT-2, RPT-3: a saved note and date show on the dashboard and in both histories', async () => {
  const [id] = await lend(world, [{ itemId: world.laptopId }]);
  const hal = await signIn('hal');
  await patch(hal, id!, { note: 'returning tomorrow', expectedReturnDate: '2099-03-04' }).expect(
    200,
  );
  const expected = { note: 'returning tomorrow', expectedReturnDate: '2099-03-04' };

  const vic = await signIn('vic');
  const dashboard = await vic.get('/api/dashboard/unreturned').expect(200);
  expect(dashboard.body.data.find((l: { lineId: string }) => l.lineId === id)).toMatchObject(
    expected,
  );

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const range = `from=${today}&to=${today}`;
  const byBorrower = await vic
    .get(`/api/reports/borrowers/${world.borrowerId}/history?${range}`)
    .expect(200);
  expect(byBorrower.body.data[0]).toMatchObject({ lineId: id, ...expected });
  const byItem = await vic.get(`/api/reports/items/${world.laptopId}/history?${range}`).expect(200);
  expect(byItem.body.data[0]).toMatchObject({ lineId: id, ...expected });
});

test('BR 7: a line that was returned after a note was saved can no longer be edited, but keeps the note', async () => {
  const [id] = await lend(world, [{ itemId: world.cordId, quantity: 2 }]);
  const hal = await signIn('hal');
  await patch(hal, id!, { note: 'later', expectedReturnDate: null }).expect(200);
  await hal
    .post('/api/returns')
    .set('X-Requested-With', 'fetch')
    .send({ lines: [{ lineId: id, quantity: 2, condition: 'GOOD' }] })
    .expect(201);

  const refused = await patch(hal, id!, { note: 'changed', expectedReturnDate: null });
  expect(refused.status).toBe(409);
  expect(refused.body.error.code).toBe('LINE_NOT_OPEN');
  expect((await prisma.transactionItem.findUniqueOrThrow({ where: { id: id! } })).note).toBe(
    'later',
  );
});

test('SPEC 3: a signed-out note edit is 401 before any database work, with no session created', async () => {
  const [id] = await lend(world, [{ itemId: world.cordId }]);
  const res = await request(createApp())
    .patch(`/api/lines/${id}`)
    .set('X-Requested-With', 'fetch')
    .send({ note: 'x', expectedReturnDate: null });
  expect(res.status).toBe(401);
  expect(res.headers['set-cookie']).toBeUndefined();
});
