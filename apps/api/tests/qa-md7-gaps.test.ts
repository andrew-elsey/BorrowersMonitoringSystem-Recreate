import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import {
  createSemester as createSemesterService,
  requireCurrentSemester,
  setCurrentSemester,
  updateSemester,
} from '../src/services/semesters.ts';
import { getSettings, updateSettings } from '../src/services/settings.ts';
import { resetDatabase } from './setup/reset-database.ts';

// QA (automated) gap tests for MD-7: roles and sign-in on every semester endpoint, the CSRF header,
// SPEC 7 bounds (name length, page size, body size, bad ids), threshold and closing-time boundary
// values, touching dates on edit, audit entries rolled back with their change (same transaction),
// two settings saves at once, and checkout reading the current semester inside a transaction.
// TC-MD-21 to 23 and TC-MD-31 in TEST_CASES.md.

const PASSWORD = 'qa-md7-password-123';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
let passwordHash: string;
let admin: ReturnType<typeof request.agent>;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  await resetDatabase();
  await prisma.user.createMany({
    data: [
      { name: 'Test Admin', username: 'qa-admin', passwordHash, role: 'ADMIN' },
      { name: 'Test Handler', username: 'qa-handler', passwordHash, role: 'HANDLER' },
      { name: 'Test Viewer', username: 'qa-viewer', passwordHash, role: 'VIEWER' },
    ],
  });
  // The seed creates the settings row with the SPEC.md 4 defaults (17:00, 3, 4, 5).
  await prisma.setting.create({ data: { id: 1 } });
  admin = await signIn('qa-admin');
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
const send = (agent: Agent, method: 'post' | 'put', path: string, body: unknown = {}) =>
  agent[method](`/api${path}`)
    .set('X-Requested-With', 'fetch')
    .send(body as object);
const createSemester = (body: unknown) => send(admin, 'post', '/semesters', body);
const saveSettings = (body: unknown) => send(admin, 'put', '/settings', body);

const FIRST = { name: 'QA Semester A', startDate: '2026-08-10', endDate: '2026-12-18' };
const SECOND = { name: 'QA Semester B', startDate: '2027-01-11', endDate: '2027-05-28' };
const VALID_SETTINGS = {
  closingTime: '17:00',
  warningThreshold: 3,
  noticeThreshold: 4,
  blockThreshold: 5,
};
const semesterSnapshot = async () => prisma.semester.findMany({ orderBy: { startDate: 'asc' } });

describe('roles and sign-in on every endpoint (SPEC 3)', () => {
  test('a handler and a viewer get 403 on editing a semester and setting one current, and nothing changes', async () => {
    const semester = (await createSemester(FIRST).expect(201)).body.semester;
    const before = await semesterSnapshot();
    for (const username of ['qa-handler', 'qa-viewer']) {
      const agent = await signIn(username);
      await send(agent, 'put', `/semesters/${semester.id}`, { ...FIRST, name: 'Hacked' }).expect(
        403,
      );
      await send(agent, 'post', `/semesters/${semester.id}/current`).expect(403);
      await send(agent, 'put', '/settings', { ...VALID_SETTINGS, blockThreshold: 9 }).expect(403);
    }
    expect(await semesterSnapshot()).toEqual(before);
    expect((await getSettings()).blockThreshold).toBe(5);
    expect(await prisma.auditLog.count()).toBe(1);
  });

  test('signed out, every settings and semester endpoint answers 401 and nothing changes', async () => {
    const semester = (await createSemester(FIRST).expect(201)).body.semester;
    const anonymous = request(createApp());
    const fetchHeader = { 'X-Requested-With': 'fetch' };
    const replies = await Promise.all([
      anonymous.get('/api/semesters').set(fetchHeader),
      anonymous.post('/api/semesters').set(fetchHeader).send(SECOND),
      anonymous.put(`/api/semesters/${semester.id}`).set(fetchHeader).send(SECOND),
      anonymous.post(`/api/semesters/${semester.id}/current`).set(fetchHeader),
      anonymous.put('/api/settings').set(fetchHeader).send(VALID_SETTINGS),
    ]);
    expect(replies.map((reply) => reply.status)).toEqual([401, 401, 401, 401, 401]);
    expect(await prisma.semester.count()).toBe(1);
    expect(await prisma.semester.count({ where: { isCurrent: true } })).toBe(0);
  });

  test('without the CSRF header, an admin cannot create, edit, set current, or save settings', async () => {
    const semester = (await createSemester(FIRST).expect(201)).body.semester;
    const replies = await Promise.all([
      admin.post('/api/semesters').send(SECOND),
      admin.put(`/api/semesters/${semester.id}`).send({ ...FIRST, name: 'Renamed' }),
      admin.post(`/api/semesters/${semester.id}/current`),
      admin.put('/api/settings').send({ ...VALID_SETTINGS, blockThreshold: 9 }),
    ]);
    expect(replies.map((reply) => reply.status)).toEqual([403, 403, 403, 403]);
    expect(await semesterSnapshot()).toMatchObject([{ name: FIRST.name, isCurrent: false }]);
    expect((await getSettings()).blockThreshold).toBe(5);
    expect(await prisma.auditLog.count()).toBe(1);
  });
});

describe('SPEC 7 bounds on semesters', () => {
  test('a name of 200 characters is saved; 201 characters or a control character is VALIDATION_ERROR', async () => {
    await createSemester({ ...FIRST, name: 'S'.repeat(200) }).expect(201);
    for (const name of ['S'.repeat(201), 'QA\tSemester', 'QA\u007fSemester']) {
      const reply = await createSemester({ ...SECOND, name }).expect(400);
      expect(Object.keys(reply.body.error.details.fields)).toEqual(['name']);
    }
    expect(await prisma.semester.count()).toBe(1);
  });

  test('an edit to a 201-character name is refused and the semester is unchanged', async () => {
    const { id } = (await createSemester(FIRST).expect(201)).body.semester;
    await send(admin, 'put', `/semesters/${id}`, { ...FIRST, name: 'S'.repeat(201) }).expect(400);
    expect((await prisma.semester.findUniqueOrThrow({ where: { id } })).name).toBe(FIRST.name);
  });

  test('page size 100 is accepted; 101, page 0, and a non-number page size are VALIDATION_ERROR', async () => {
    await admin.get('/api/semesters?pageSize=100').expect(200);
    for (const query of ['pageSize=101', 'page=0', 'pageSize=abc']) {
      const reply = await admin.get(`/api/semesters?${query}`).expect(400);
      expect(reply.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  test('the current semester is returned as `current` even when it is not on the page asked for', async () => {
    const first = (await createSemester(FIRST).expect(201)).body.semester;
    await createSemester(SECOND).expect(201);
    await send(admin, 'post', `/semesters/${first.id}/current`).expect(200);

    // Newest start date first, so page 1 of size 1 holds SECOND only.
    const reply = await admin.get('/api/semesters?page=1&pageSize=1').expect(200);
    expect(reply.body.data.map((s: { name: string }) => s.name)).toEqual([SECOND.name]);
    expect(reply.body).toMatchObject({ total: 2, current: { id: first.id, isCurrent: true } });
  });

  test('a malformed semester id is VALIDATION_ERROR on edit and set current', async () => {
    for (const reply of [
      await send(admin, 'put', '/semesters/not-a-uuid', FIRST),
      await send(admin, 'post', '/semesters/not-a-uuid/current'),
    ]) {
      expect(reply.status).toBe(400);
      expect(reply.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  test('a body over 100 KB is refused with 413 on create and on settings', async () => {
    const big = 'x'.repeat(110 * 1024);
    expect((await createSemester({ ...FIRST, name: big })).status).toBe(413);
    expect((await saveSettings({ ...VALID_SETTINGS, padding: big })).status).toBe(413);
    expect(await prisma.semester.count()).toBe(0);
  });
});

describe('TC-MD-31: overlaps on edit, from either side', () => {
  test('editing an earlier semester to end on the day a later one starts is SEMESTER_OVERLAP naming the later one', async () => {
    const first = (await createSemester(FIRST).expect(201)).body.semester;
    await createSemester(SECOND).expect(201);
    const reply = await send(admin, 'put', `/semesters/${first.id}`, {
      ...FIRST,
      endDate: SECOND.startDate,
    }).expect(409);
    const message = `These dates overlap "${SECOND.name}" (2027-01-11 to 2027-05-28).`;
    expect(reply.body.error).toEqual({
      code: 'SEMESTER_OVERLAP',
      message,
      details: { fields: { startDate: [message] } },
    });
    expect((await prisma.semester.findUniqueOrThrow({ where: { id: first.id } })).endDate).toEqual(
      new Date('2026-12-18T00:00:00Z'),
    );
  });

  test('editing an earlier semester to end the day before a later one starts is saved', async () => {
    const first = (await createSemester(FIRST).expect(201)).body.semester;
    await createSemester(SECOND).expect(201);
    const reply = await send(admin, 'put', `/semesters/${first.id}`, {
      ...FIRST,
      endDate: '2027-01-10',
    }).expect(200);
    expect(reply.body.semester.endDate).toBe('2027-01-10');
  });

  test('a semester entirely inside another is refused', async () => {
    await createSemester(FIRST).expect(201);
    const reply = await createSemester({
      name: 'Inside',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    }).expect(409);
    expect(reply.body.error.code).toBe('SEMESTER_OVERLAP');
  });
});

describe('TC-MD-22: threshold and closing-time boundaries (SPEC 7)', () => {
  test.each([
    ['the lowest values 1, 2, 3', { warningThreshold: 1, noticeThreshold: 2, blockThreshold: 3 }],
    [
      'the highest values 98, 99, 100',
      { warningThreshold: 98, noticeThreshold: 99, blockThreshold: 100 },
    ],
    ['closing time 00:00', { closingTime: '00:00' }],
    ['closing time 23:59', { closingTime: '23:59' }],
  ])('accepts %s', async (_name, change) => {
    const body = { ...VALID_SETTINGS, ...change };
    const reply = await saveSettings(body).expect(200);
    expect(reply.body.settings).toEqual({ ...body, timezone: 'Asia/Manila' });
  });

  test.each([
    ['closing time 17:60', { closingTime: '17:60' }, 'closingTime'],
    ['closing time 17:00:00', { closingTime: '17:00:00' }, 'closingTime'],
    ['closing time 5pm', { closingTime: '5pm' }, 'closingTime'],
    ['an empty closing time', { closingTime: '' }, 'closingTime'],
    ['a negative threshold', { warningThreshold: -1 }, 'warningThreshold'],
    ['a missing threshold', { blockThreshold: undefined }, 'blockThreshold'],
    ['a null threshold', { noticeThreshold: null }, 'noticeThreshold'],
  ])('refuses %s on that field', async (_name, change, field) => {
    const reply = await saveSettings({ ...VALID_SETTINGS, ...change }).expect(400);
    expect(reply.body.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(reply.body.error.details.fields)).toContain(field);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  test('warning equal to notice and notice equal to block are both reported at once', async () => {
    const reply = await saveSettings({
      ...VALID_SETTINGS,
      warningThreshold: 4,
      noticeThreshold: 4,
      blockThreshold: 4,
    }).expect(400);
    expect(Object.keys(reply.body.error.details.fields).sort()).toEqual([
      'blockThreshold',
      'noticeThreshold',
    ]);
  });

  test('the timezone in the body is ignored: it is not editable and stays Asia/Manila', async () => {
    const reply = await saveSettings({
      ...VALID_SETTINGS,
      closingTime: '18:00',
      timezone: 'UTC',
    }).expect(200);
    expect(reply.body.settings.timezone).toBe('Asia/Manila');
    expect((await getSettings()).timezone).toBe('Asia/Manila');
  });
});

describe('rule 6: audit entries are written in the same transaction as the change', () => {
  // An actor id with no user makes the audit insert fail (foreign key). If the audit ran outside
  // the change's transaction, the change would stay saved.
  test('a failed audit insert rolls back a semester create', async () => {
    await expect(createSemesterService(MISSING_ID, FIRST)).rejects.toThrow();
    expect(await prisma.semester.count()).toBe(0);
  });

  test('a failed audit insert rolls back a semester edit', async () => {
    const { id } = (await createSemester(FIRST).expect(201)).body.semester;
    await expect(updateSemester(MISSING_ID, id, { ...FIRST, name: 'Renamed' })).rejects.toThrow();
    expect((await prisma.semester.findUniqueOrThrow({ where: { id } })).name).toBe(FIRST.name);
  });

  test('a failed audit insert rolls back a set current and the old current semester stays current', async () => {
    const first = (await createSemester(FIRST).expect(201)).body.semester;
    const second = (await createSemester(SECOND).expect(201)).body.semester;
    await send(admin, 'post', `/semesters/${first.id}/current`).expect(200);
    await expect(setCurrentSemester(MISSING_ID, second.id)).rejects.toThrow();
    expect((await requireCurrentSemester()).id).toBe(first.id);
  });

  test('a failed audit insert rolls back a settings save', async () => {
    await expect(
      updateSettings(MISSING_ID, { ...VALID_SETTINGS, closingTime: '19:00' }),
    ).rejects.toThrow();
    expect((await getSettings()).closingTime).toBe('17:00');
  });
});

describe('concurrency and fresh reads (TC-MD-23)', () => {
  test('two settings saves at once both succeed and the audit entries chain: the second "before" is the first "after"', async () => {
    const other = await signIn('qa-admin');
    const a = { ...VALID_SETTINGS, closingTime: '18:00' };
    const b = { ...VALID_SETTINGS, blockThreshold: 7 };
    const replies = await Promise.all([saveSettings(a), send(other, 'put', '/settings', b)]);
    expect(replies.map((reply) => reply.status)).toEqual([200, 200]);

    const entries = await prisma.auditLog.findMany({
      where: { action: 'SETTINGS_UPDATED' },
      orderBy: { createdAt: 'asc' },
    });
    expect(entries).toHaveLength(2);
    expect(entries[0].before).toEqual(VALID_SETTINGS);
    expect(entries[1].before).toEqual(entries[0].after);
    expect(await getSettings()).toMatchObject(entries[1].after as object);
  });

  test('BR 2: inside a transaction, requireCurrentSemester and getSettings see the latest switch and save', async () => {
    const first = (await createSemester(FIRST).expect(201)).body.semester;
    const second = (await createSemester(SECOND).expect(201)).body.semester;
    await send(admin, 'post', `/semesters/${first.id}/current`).expect(200);
    const readInTransaction = () =>
      prisma.$transaction(async (tx) => ({
        semesterId: (await requireCurrentSemester(tx)).id,
        closingTime: (await getSettings(tx)).closingTime,
      }));
    expect(await readInTransaction()).toEqual({ semesterId: first.id, closingTime: '17:00' });

    await send(admin, 'post', `/semesters/${second.id}/current`).expect(200);
    await saveSettings({ ...VALID_SETTINGS, closingTime: '16:30' }).expect(200);
    expect(await readInTransaction()).toEqual({ semesterId: second.id, closingTime: '16:30' });
  });
});
