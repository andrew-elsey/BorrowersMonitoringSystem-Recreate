import request from 'supertest';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { getCurrentSemester, requireCurrentSemester } from '../src/services/semesters.ts';
import { getSettings } from '../src/services/settings.ts';
import { resetDatabase } from './setup/reset-database.ts';

// MD-7: semesters and settings. Test cases TC-MD-21 to TC-MD-23, TC-MD-31, and TC-MD-32 in TEST_CASES.md.

const PASSWORD = 'correct-horse-battery';
let passwordHash: string;
let admin: ReturnType<typeof request.agent>;
let adminId: string;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  await resetDatabase();
  const users = await prisma.user.createManyAndReturn({
    data: [
      { name: 'Ana Admin', username: 'ana', passwordHash, role: 'ADMIN' },
      { name: 'Hal Handler', username: 'hal', passwordHash, role: 'HANDLER' },
      { name: 'Vic Viewer', username: 'vic', passwordHash, role: 'VIEWER' },
    ],
  });
  adminId = users.find((user) => user.role === 'ADMIN')!.id;
  // The seed creates the settings row with the SPEC.md 4 defaults.
  await prisma.setting.create({ data: { id: 1 } });
  admin = await signIn('ana');
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

type Agent = typeof admin;
// Every state-changing request needs the CSRF header (ARCHITECTURE.md 5).
const send = (agent: Agent, method: 'post' | 'put', path: string, body: object = {}) =>
  agent[method](`/api${path}`).set('X-Requested-With', 'fetch').send(body);
const createSemester = (body: object) => send(admin, 'post', '/semesters', body);
const setCurrent = (agent: Agent, id: string) => send(agent, 'post', `/semesters/${id}/current`);
const saveSettings = (body: object) => send(admin, 'put', '/settings', body);

test('TC-BRW-38: every staff role can read the closing time; only admins can change it (rule 3)', async () => {
  await saveSettings({
    closingTime: '18:30',
    warningThreshold: 3,
    noticeThreshold: 4,
    blockThreshold: 5,
  }).expect(200);
  for (const username of ['ana', 'hal', 'vic']) {
    const staff = await signIn(username);
    expect((await staff.get('/api/closing-time').expect(200)).body).toEqual({
      closingTime: '18:30',
    });
  }
  const handler = await signIn('hal');
  expect((await handler.get('/api/settings')).status).toBe(403);
  expect((await send(handler, 'put', '/settings', { closingTime: '19:00' })).status).toBe(403);
  expect((await request(createApp()).get('/api/closing-time')).status).toBe(401);
});

const auditFor = (entity: string) =>
  prisma.auditLog.findMany({ where: { entity }, orderBy: { createdAt: 'asc' } });

const FIRST = { name: '1st Semester AY 2026-2027', startDate: '2026-08-10', endDate: '2026-12-18' };
const SECOND = {
  name: '2nd Semester AY 2026-2027',
  startDate: '2027-01-11',
  endDate: '2027-05-28',
};

test('TC-MD-21: admin creates semesters and sets one current, then another; exactly one is current and every change is audited', async () => {
  const first = (await createSemester(FIRST).expect(201)).body.semester;
  const second = (await createSemester(SECOND).expect(201)).body.semester;
  expect(first).toEqual({ id: first.id, ...FIRST, isCurrent: false });

  await setCurrent(admin, first.id).expect(200);
  const switched = await setCurrent(admin, second.id).expect(200);
  expect(switched.body.semester).toEqual({ ...second, isCurrent: true });

  const list = await admin.get('/api/semesters').expect(200);
  // Newest start date first.
  expect(list.body).toMatchObject({ page: 1, pageSize: 25, total: 2, current: { id: second.id } });
  expect(
    list.body.data.map((s: { name: string; isCurrent: boolean }) => [s.name, s.isCurrent]),
  ).toEqual([
    [SECOND.name, true],
    [FIRST.name, false],
  ]);
  expect((await getCurrentSemester())?.id).toBe(second.id);

  expect(await auditFor('semester')).toMatchObject([
    { actorId: adminId, action: 'SEMESTER_CREATED', entityId: first.id, after: FIRST },
    { actorId: adminId, action: 'SEMESTER_CREATED', entityId: second.id, after: SECOND },
    {
      action: 'SEMESTER_SET_CURRENT',
      entityId: first.id,
      before: { currentSemester: null },
      after: { currentSemester: { id: first.id, name: FIRST.name } },
    },
    {
      action: 'SEMESTER_SET_CURRENT',
      entityId: second.id,
      before: { currentSemester: { id: first.id, name: FIRST.name } },
      after: { currentSemester: { id: second.id, name: SECOND.name } },
    },
  ]);

  // Setting the current one again changes nothing and writes nothing.
  await setCurrent(admin, second.id).expect(200);
  expect(await auditFor('semester')).toHaveLength(4);
});

test('TC-MD-21: two admins setting different semesters current at once still leave exactly one current', async () => {
  const ids = await Promise.all(
    [FIRST, SECOND, { name: 'Summer', startDate: '2027-06-01', endDate: '2027-07-15' }].map(
      async (body) => (await createSemester(body).expect(201)).body.semester.id as string,
    ),
  );
  const other = await signIn('ana');
  const replies = await Promise.all(ids.map((id, i) => setCurrent(i % 2 ? other : admin, id)));
  expect(replies.map((reply) => reply.status)).toEqual([200, 200, 200]);
  expect(await prisma.semester.count({ where: { isCurrent: true } })).toBe(1);
});

test('TC-MD-21: admin edits a semester from its row; the change is audited and a no-change save is not', async () => {
  const { id } = (await createSemester(FIRST).expect(201)).body.semester;
  const edited = { name: '  1st Semester  ', startDate: '2026-08-03', endDate: '2026-12-18' };
  const reply = await send(admin, 'put', `/semesters/${id}`, edited).expect(200);
  expect(reply.body.semester).toEqual({ id, ...edited, name: '1st Semester', isCurrent: false });
  await send(admin, 'put', `/semesters/${id}`, edited).expect(200);

  expect((await auditFor('semester')).slice(1)).toMatchObject([
    {
      action: 'SEMESTER_UPDATED',
      before: FIRST,
      after: { name: '1st Semester', startDate: '2026-08-03', endDate: '2026-12-18' },
    },
  ]);
});

test('semester input is validated: name, real YYYY-MM-DD dates, and the end not before the start', async () => {
  const bad = await createSemester({
    name: ' ',
    startDate: '2026-02-30',
    endDate: '18/12/2026',
  }).expect(400);
  expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  expect(Object.keys(bad.body.error.details.fields).sort()).toEqual([
    'endDate',
    'name',
    'startDate',
  ]);

  const backwards = await createSemester({ ...FIRST, endDate: '2026-08-09' }).expect(400);
  expect(backwards.body.error.details.fields).toEqual({
    endDate: ['The end date cannot be before the start date.'],
  });
  // A one-day semester is allowed, as the database CHECK (start_date <= end_date) is.
  await createSemester({ ...FIRST, endDate: FIRST.startDate }).expect(201);
  expect(await auditFor('semester')).toHaveLength(1);
});

test('unknown semesters answer NOT_FOUND and there is no delete (BR 15)', async () => {
  const missing = '00000000-0000-4000-8000-000000000000';
  expect((await setCurrent(admin, missing).expect(404)).body.error.code).toBe('NOT_FOUND');
  await send(admin, 'put', `/semesters/${missing}`, FIRST).expect(404);
  const { id } = (await createSemester(FIRST).expect(201)).body.semester;
  await admin.delete(`/api/semesters/${id}`).set('X-Requested-With', 'fetch').expect(404);
  expect(await prisma.semester.count()).toBe(1);
});

test('BR 2: checkout reads the current semester and is rejected with NO_CURRENT_SEMESTER without one', async () => {
  await expect(requireCurrentSemester()).rejects.toMatchObject({
    status: 409,
    code: 'NO_CURRENT_SEMESTER',
  });
  const { id } = (await createSemester(FIRST).expect(201)).body.semester;
  await setCurrent(admin, id).expect(200);
  expect(await requireCurrentSemester()).toEqual({ id, ...FIRST, isCurrent: true });
});

test('TC-MD-31: a semester whose dates overlap another is refused on create and edit, start and end included', async () => {
  const first = (await createSemester(FIRST).expect(201)).body.semester;
  const overlap = `These dates overlap "${FIRST.name}" (2026-08-10 to 2026-12-18).`;

  // Starts on the day FIRST ends: inclusive dates, so it overlaps.
  const touching = await createSemester({
    name: 'Touching',
    startDate: '2026-12-18',
    endDate: '2027-01-05',
  }).expect(409);
  expect(touching.body.error).toEqual({
    code: 'SEMESTER_OVERLAP',
    message: overlap,
    details: { fields: { startDate: [overlap] } },
  });
  // Contains FIRST entirely.
  await createSemester({ name: 'Around', startDate: '2026-08-01', endDate: '2026-12-31' }).expect(
    409,
  );
  // Starts the day after FIRST ends: no overlap.
  const second = (await createSemester({ ...SECOND, startDate: '2026-12-19' }).expect(201)).body
    .semester;

  // Editing SECOND to reach back into FIRST is refused; editing a semester within its own dates is not.
  const edit = await send(admin, 'put', `/semesters/${second.id}`, {
    ...SECOND,
    startDate: '2026-12-01',
  }).expect(409);
  expect(edit.body.error.details.fields).toEqual({ startDate: [overlap] });
  await send(admin, 'put', `/semesters/${first.id}`, { ...FIRST, endDate: '2026-12-17' }).expect(
    200,
  );

  expect(await prisma.semester.count()).toBe(2);
  expect((await auditFor('semester')).map((entry) => entry.action)).toEqual([
    'SEMESTER_CREATED',
    'SEMESTER_CREATED',
    'SEMESTER_UPDATED',
  ]);
});

test('TC-MD-31: two overlapping semesters created at once: exactly one is saved', async () => {
  const replies = await Promise.all([
    createSemester(FIRST),
    createSemester({ ...FIRST, name: 'Same dates' }),
  ]);
  expect(replies.map((reply) => reply.status).sort()).toEqual([201, 409]);
  expect(replies.find((reply) => reply.status === 409)!.body.error.code).toBe('SEMESTER_OVERLAP');
  expect(await prisma.semester.count()).toBe(1);
  expect(await auditFor('semester')).toHaveLength(1);
});

test('TC-MD-32: semester names are unique regardless of case on create and edit; a semester may change its own case', async () => {
  const first = (await createSemester(FIRST).expect(201)).body.semester;
  const second = (await createSemester(SECOND).expect(201)).body.semester;
  const message = `A semester named "${FIRST.name.toUpperCase()}" already exists.`;

  const created = await createSemester({
    name: FIRST.name.toUpperCase(),
    startDate: '2027-06-01',
    endDate: '2027-07-15',
  }).expect(409);
  expect(created.body.error).toEqual({
    code: 'DUPLICATE_VALUE',
    message,
    details: { fields: { name: [message] } },
  });
  const edited = await send(admin, 'put', `/semesters/${second.id}`, {
    ...SECOND,
    name: FIRST.name.toUpperCase(),
  }).expect(409);
  expect(edited.body.error.details.fields).toEqual({ name: [message] });

  const ownCase = await send(admin, 'put', `/semesters/${first.id}`, {
    ...FIRST,
    name: FIRST.name.toLowerCase(),
  }).expect(200);
  expect(ownCase.body.semester.name).toBe(FIRST.name.toLowerCase());
  expect(await auditFor('semester')).toHaveLength(3);
});

test('TC-MD-22: thresholds out of order (4, 3, 5 and 3, 3, 5) are rejected and nothing changes', async () => {
  const outOfOrder = await saveSettings({
    closingTime: '17:00',
    warningThreshold: 4,
    noticeThreshold: 3,
    blockThreshold: 5,
  }).expect(400);
  expect(outOfOrder.body.error.code).toBe('VALIDATION_ERROR');
  expect(outOfOrder.body.error.details.fields).toEqual({
    noticeThreshold: [
      'Thresholds must go up: warning, then notice, then block. The warning threshold (4) must be lower than the notice threshold (3).',
    ],
  });

  const equal = await saveSettings({
    closingTime: '17:00',
    warningThreshold: 3,
    noticeThreshold: 3,
    blockThreshold: 5,
  }).expect(400);
  expect(Object.keys(equal.body.error.details.fields)).toEqual(['noticeThreshold']);

  const noticeAtBlock = await saveSettings({
    closingTime: '17:00',
    warningThreshold: 3,
    noticeThreshold: 5,
    blockThreshold: 5,
  }).expect(400);
  expect(noticeAtBlock.body.error.details.fields).toEqual({
    blockThreshold: [
      'Thresholds must go up: warning, then notice, then block. The notice threshold (5) must be lower than the block threshold (5).',
    ],
  });

  // Bounds and format.
  for (const body of [
    { closingTime: '24:00', warningThreshold: 3, noticeThreshold: 4, blockThreshold: 5 },
    { closingTime: '5:00', warningThreshold: 3, noticeThreshold: 4, blockThreshold: 5 },
    { closingTime: '17:00', warningThreshold: 0, noticeThreshold: 4, blockThreshold: 5 },
    { closingTime: '17:00', warningThreshold: 3, noticeThreshold: 4.5, blockThreshold: 5 },
    { closingTime: '17:00', warningThreshold: 3, noticeThreshold: 4, blockThreshold: 101 },
    { closingTime: '17:00', warningThreshold: '3', noticeThreshold: 4, blockThreshold: 5 },
  ]) {
    await saveSettings(body).expect(400);
  }

  expect(await getSettings()).toMatchObject({
    warningThreshold: 3,
    noticeThreshold: 4,
    blockThreshold: 5,
  });
  expect(await auditFor('setting')).toHaveLength(0);
});

test('TC-MD-23: changed closing time and thresholds are saved, audited, and read fresh by the services checkout and flagging use', async () => {
  const defaults = await admin.get('/api/settings').expect(200);
  expect(defaults.body.settings).toEqual({
    closingTime: '17:00',
    warningThreshold: 3,
    noticeThreshold: 4,
    blockThreshold: 5,
    timezone: 'Asia/Manila',
  });

  const changed = {
    closingTime: '18:30',
    warningThreshold: 2,
    noticeThreshold: 4,
    blockThreshold: 6,
  };
  const reply = await saveSettings(changed).expect(200);
  expect(reply.body.settings).toEqual({ ...changed, timezone: 'Asia/Manila' });
  // getSettings is what checkout (BRW-2, FLG-3) and the flagging job (FLG-2) will call.
  expect(await getSettings()).toEqual({ ...changed, timezone: 'Asia/Manila' });

  // Saving the same values again writes nothing.
  await saveSettings(changed).expect(200);
  expect(await auditFor('setting')).toMatchObject([
    {
      actorId: adminId,
      action: 'SETTINGS_UPDATED',
      entityId: '1',
      before: { closingTime: '17:00', warningThreshold: 3, noticeThreshold: 4, blockThreshold: 5 },
      after: changed,
    },
  ]);
});

test('SPEC 3: only admins manage settings and semesters', async () => {
  for (const username of ['hal', 'vic']) {
    const agent = await signIn(username);
    await agent.get('/api/settings').expect(403);
    await agent.get('/api/semesters').expect(403);
    await send(agent, 'put', '/settings', {}).expect(403);
    await send(agent, 'post', '/semesters', FIRST).expect(403);
  }
  await request(createApp()).get('/api/settings').set('X-Requested-With', 'fetch').expect(401);
  expect(await prisma.semester.count()).toBe(0);
});
