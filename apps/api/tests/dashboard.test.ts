import request from 'supertest';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { resetDatabase } from './setup/reset-database.ts';

// RPT-1: GET /api/dashboard/unreturned and /api/dashboard/flagged-borrowers (BR section 4, BR 10,
// SPEC 3, 7). Test cases TC-RPT-01, TC-RPT-02, and the dashboard part of TC-RPT-07.

const PASSWORD = 'correct-horse-battery';
let passwordHash: string;
let halId: string;
let locationId: string;
let current: string;
let older: string;
let categoryId: string;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  await resetDatabase();
  await prisma.setting.create({ data: { id: 1 } });
  const users = await prisma.user.createManyAndReturn({
    data: [
      { name: 'Ana Admin', username: 'ana', passwordHash, role: 'ADMIN' },
      { name: 'Hal Handler', username: 'hal', passwordHash, role: 'HANDLER' },
      { name: 'Vic Viewer', username: 'vic', passwordHash, role: 'VIEWER' },
    ],
  });
  halId = users.find((user) => user.username === 'hal')!.id;
  locationId = (await prisma.location.create({ data: { name: 'CL-201', createdById: halId } })).id;
  const semesters = await prisma.semester.createManyAndReturn({
    data: [
      {
        name: 'S1',
        startDate: new Date('2026-01-05'),
        endDate: new Date('2026-05-30'),
        isCurrent: false,
      },
      {
        name: 'S2',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-12-15'),
        isCurrent: true,
      },
    ],
  });
  older = semesters.find((s) => s.name === 'S1')!.id;
  current = semesters.find((s) => s.name === 'S2')!.id;
  categoryId = (await prisma.category.create({ data: { name: 'Equipment' } })).id;
});

async function signIn(username: string) {
  const agent = request.agent(createApp());
  await agent
    .post('/api/auth/login')
    .set('X-Requested-With', 'fetch')
    .send({ username, password: PASSWORD })
    .expect(200);
  return agent;
}
const get = (agent: Awaited<ReturnType<typeof signIn>>, path: string) =>
  agent.get(`/api/dashboard/${path}`).set('X-Requested-With', 'fetch');

async function borrower(name: string) {
  return (
    await prisma.borrower.create({
      data: { schoolId: `ID-${name}`, name, type: 'STUDENT', department: 'IT' },
    })
  ).id;
}
// One transaction with one 1-piece line. Returns the line id.
async function lend(
  borrowerId: string,
  extra: {
    returned?: boolean;
    flagStatus?: 'FLAGGED' | 'OVERRIDDEN';
    semesterId?: string;
    note?: string;
  } = {},
) {
  const item = await prisma.item.create({
    data: {
      name: `Item for ${borrowerId.slice(0, 8)} ${Math.random()}`,
      categoryId,
      trackingType: 'QUANTITY',
      totalQuantity: 1,
      condition: 'GOOD',
    },
  });
  const transaction = await prisma.transaction.create({
    data: {
      borrowerId,
      locationId,
      issuedById: halId,
      semesterId: extra.semesterId ?? current,
      lines: {
        create: {
          itemId: item.id,
          quantityBorrowed: 1,
          quantityReturned: extra.returned ? 1 : 0,
          flagStatus: extra.flagStatus,
          flaggedAt: extra.flagStatus ? new Date() : undefined,
          note: extra.note,
          expectedReturnDate: extra.note ? new Date('2099-01-02T00:00:00Z') : undefined,
        },
      },
    },
    include: { lines: true },
  });
  return transaction.lines[0]!.id;
}

test('TC-RPT-01: only unreturned lines, with notes and expected return dates', async () => {
  const cara = await borrower('Cara');
  const dan = await borrower('Dan');
  const open = await lend(cara, { note: 'returning tomorrow' });
  const flaggedOpen = await lend(dan, { flagStatus: 'FLAGGED' });
  await lend(cara, { returned: true });
  await lend(dan, { returned: true, flagStatus: 'FLAGGED' });

  const reply = await get(await signIn('vic'), 'unreturned').expect(200);
  expect(reply.body.total).toBe(2);
  const byId = new Map(reply.body.data.map((line: { lineId: string }) => [line.lineId, line]));
  expect([...byId.keys()].sort()).toEqual([open, flaggedOpen].sort());
  expect(byId.get(open)).toMatchObject({
    borrower: { name: 'Cara', schoolId: 'ID-Cara' },
    location: 'CL-201',
    issuedBy: 'Hal Handler',
    note: 'returning tomorrow',
    expectedReturnDate: '2099-01-02',
    outstanding: 1,
    flagStatus: 'NONE',
  });
  expect(byId.get(flaggedOpen)).toMatchObject({ flagStatus: 'FLAGGED', strikes: 2 });
});

test('TC-RPT-01 (BR 10, 12): flagged borrowers are those with strikes in the current semester, most first', async () => {
  const cara = await borrower('Cara');
  const dan = await borrower('Dan');
  const eve = await borrower('Eve');
  const fay = await borrower('Fay');
  await lend(cara, { flagStatus: 'FLAGGED' });
  await lend(dan, { flagStatus: 'FLAGGED', returned: true }); // returned, still a strike (BR 6)
  await lend(dan, { flagStatus: 'FLAGGED' });
  await lend(eve, { flagStatus: 'OVERRIDDEN' }); // overridden: no strike (BR 13)
  await lend(fay, { flagStatus: 'FLAGGED', semesterId: older }); // older semester (BR 12)
  await lend(fay);

  const reply = await get(await signIn('vic'), 'flagged-borrowers').expect(200);
  expect(reply.body).toMatchObject({
    page: 1,
    pageSize: 25,
    total: 2,
    warningThreshold: 3,
    noticeThreshold: 4,
    blockThreshold: 5,
    semesterName: 'S2',
  });
  expect(reply.body.data).toEqual([
    { borrower: { id: dan, schoolId: 'ID-Dan', name: 'Dan', type: 'STUDENT' }, strikes: 2 },
    { borrower: { id: cara, schoolId: 'ID-Cara', name: 'Cara', type: 'STUDENT' }, strikes: 1 },
  ]);

  // Paged in SQL: page 2 of size 1 is Cara.
  const second = await get(await signIn('vic'), 'flagged-borrowers?page=2&pageSize=1').expect(200);
  expect(second.body.total).toBe(2);
  expect(second.body.data.map((row: { strikes: number }) => row.strikes)).toEqual([1]);

  // No current semester: nobody has a strike, and the screen can say why.
  await prisma.semester.updateMany({ data: { isCurrent: false } });
  const none = await get(await signIn('vic'), 'flagged-borrowers').expect(200);
  expect(none.body).toMatchObject({ data: [], total: 0, semesterName: null });
});

test('TC-RPT-02, TC-RPT-07 (S18): admin, handler, and view-only load the dashboard; signed out 401', async () => {
  for (const username of ['ana', 'hal', 'vic']) {
    const agent = await signIn(username);
    await get(agent, 'unreturned').expect(200);
    await get(agent, 'flagged-borrowers').expect(200);
  }
  for (const path of ['unreturned', 'flagged-borrowers']) {
    await request(createApp())
      .get(`/api/dashboard/${path}`)
      .set('X-Requested-With', 'fetch')
      .expect(401);
  }
});

test('SPEC 7: page size above 100 and page 0 are refused', async () => {
  const vic = await signIn('vic');
  for (const path of ['unreturned', 'flagged-borrowers']) {
    for (const query of ['pageSize=101', 'page=0']) {
      const reply = await get(vic, `${path}?${query}`).expect(400);
      expect(reply.body.error.code).toBe('VALIDATION_ERROR');
    }
  }
});
