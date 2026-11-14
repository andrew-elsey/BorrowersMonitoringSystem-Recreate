import request from 'supertest';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { resetDatabase } from './setup/reset-database.ts';

// QA (automated) gap tests for MD-5: PATCH body edge cases, bounds, CSRF, races on the
// case-insensitive school ID index, and exact audit contents. TC-MD-15, 16, 27 in TEST_CASES.md.

const PASSWORD = 'qa-md5-password-123';
let passwordHash: string;
let admin: ReturnType<typeof request.agent>;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  await resetDatabase();
  await prisma.user.create({
    data: { name: 'Test Admin', username: 'qa-admin', passwordHash, role: 'ADMIN' },
  });
  admin = request.agent(createApp());
  await admin
    .post('/api/auth/login')
    .set('X-Requested-With', 'fetch')
    .send({ username: 'qa-admin', password: PASSWORD })
    .expect(200);
});

const SAMPLE = { schoolId: 'QA-0001', name: 'Test Borrower', type: 'STUDENT', department: 'QA' };

const post = (body: unknown) =>
  admin
    .post('/api/borrowers')
    .set('X-Requested-With', 'fetch')
    .send(body as object);
const patch = (id: string, body: unknown) =>
  admin
    .patch(`/api/borrowers/${id}`)
    .set('X-Requested-With', 'fetch')
    .send(body as object);
const create = async (overrides: object = {}) =>
  (await post({ ...SAMPLE, ...overrides }).expect(201)).body.borrower as { id: string };
const auditFor = (entityId: string) =>
  prisma.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } });
const stored = (id: string) => prisma.borrower.findUniqueOrThrow({ where: { id } });

// --- PATCH body edge cases ---

test('an empty PATCH body is refused and writes no audit entry', async () => {
  const { id } = await create();
  await patch(id, {}).expect(400);
  expect(await auditFor(id)).toHaveLength(1);
});

test('a PATCH body of only unknown keys (id, createdAt, foo) is refused and never written', async () => {
  const { id } = await create();
  const before = await stored(id);
  await patch(id, {
    id: '00000000-0000-4000-8000-000000000000',
    createdAt: '2000-01-01T00:00:00Z',
    foo: 'bar',
  }).expect(400);
  expect(await stored(id)).toEqual(before);
  expect(await auditFor(id)).toHaveLength(1);
});

test('active together with other fields saves both in one audit entry with only those fields', async () => {
  const { id } = await create();
  const response = await patch(id, { active: false, name: 'Renamed Borrower', type: 'STUDENT' });
  expect(response.status).toBe(200);
  expect(response.body.borrower).toMatchObject({ name: 'Renamed Borrower', active: false });
  const entries = await auditFor(id);
  expect(entries).toHaveLength(2);
  // Exact: type did not change, so it is not in the entry.
  expect(entries[1]!.before).toEqual({ name: 'Test Borrower', active: true });
  expect(entries[1]!.after).toEqual({ name: 'Renamed Borrower', active: false });
});

test('a duplicate school ID in a PATCH that also deactivates rolls back the whole edit', async () => {
  await create({ schoolId: '2026-A01' });
  const { id } = await create({ schoolId: 'QA-0002' });
  const response = await patch(id, { schoolId: '2026-a01', active: false });
  expect(response.status).toBe(409);
  expect(response.body.error.details.fields.schoolId).toHaveLength(1);
  expect(await stored(id)).toMatchObject({ schoolId: 'QA-0002', active: true });
  expect(await auditFor(id)).toHaveLength(1);
});

test('PATCH with a null, array, or missing JSON body is a VALIDATION_ERROR, not a 500', async () => {
  const { id } = await create();
  for (const send of [
    () => admin.patch(`/api/borrowers/${id}`).set('X-Requested-With', 'fetch'),
    () =>
      admin
        .patch(`/api/borrowers/${id}`)
        .set('X-Requested-With', 'fetch')
        .set('Content-Type', 'application/json')
        .send('null'),
    () => patch(id, [{ active: false }]),
    () => patch(id, { name: null }),
    () => patch(id, { active: 'false' }),
  ]) {
    const response = await send();
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  }
  expect(await auditFor(id)).toHaveLength(1);
});

test('PATCH refuses control characters and over-long fields on edit too', async () => {
  const { id } = await create();
  for (const [field, value] of [
    ['schoolId', 'QA\t01'],
    ['department', 'Q\u007fA'],
    ['name', 'Test\u0085Borrower'],
    ['name', 'x'.repeat(201)],
    ['department', ''],
  ] as const) {
    const response = await patch(id, { [field]: value });
    expect(response.status).toBe(400);
    expect(response.body.error.details.fields[field]).toHaveLength(1);
  }
  expect(await stored(id)).toMatchObject(SAMPLE);
});

// --- Create ---

test('a new borrower is always active and gets a server id, whatever the body says', async () => {
  const response = await post({ ...SAMPLE, active: false, id: 'not-a-uuid' }).expect(201);
  expect(response.body.borrower.active).toBe(true);
  expect(response.body.borrower.id).toMatch(/^[0-9a-f-]{36}$/);
});

test('create audit entry holds exactly the trimmed fields and active, no extras', async () => {
  const { id } = await create({ schoolId: '  QA-0009 ', active: false, extra: 'x' });
  const [entry] = await auditFor(id);
  expect(entry!.before).toBeNull();
  expect(entry!.after).toEqual({ ...SAMPLE, schoolId: 'QA-0009', active: true });
});

test('a padded, differently cased school ID is still a DUPLICATE_VALUE (TC-MD-27)', async () => {
  await create({ schoolId: '2026-A01' });
  const response = await post({ ...SAMPLE, schoolId: '  2026-a01  ' });
  expect(response.status).toBe(409);
  expect(response.body.error.code).toBe('DUPLICATE_VALUE');
  expect(await prisma.borrower.count()).toBe(1);
});

test('two creates racing with case-only different school IDs: exactly one wins (TC-MD-27)', async () => {
  const results = await Promise.all([
    post({ ...SAMPLE, schoolId: '2026-B07' }),
    post({ ...SAMPLE, schoolId: '2026-b07' }),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  expect(await prisma.borrower.count()).toBe(1);
  expect(await prisma.auditLog.count({ where: { action: 'BORROWER_CREATED' } })).toBe(1);
});

test('the case-insensitive unique index is in place and the old case-sensitive one is gone', async () => {
  const indexes = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
    SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'borrowers'`;
  const names = indexes.map((index) => index.indexname);
  expect(names).toContain('borrowers_school_id_lower_key');
  expect(names).not.toContain('borrowers_school_id_key');
  const lower = indexes.find((index) => index.indexname === 'borrowers_school_id_lower_key')!;
  expect(lower.indexdef).toMatch(/UNIQUE INDEX .*lower\(school_id\)/);
});

// --- Search and list bounds (SPEC 7) ---

test('q bounds apply after trimming; tabs inside and whitespace-only q are refused', async () => {
  await create();
  const padded = encodeURIComponent(` ${'a'.repeat(100)} `);
  await admin.get(`/api/borrowers?q=${padded}`).expect(200);
  for (const q of ['%20%20%20', 'a%09b', 'a%0Ab', 'ab%7F']) {
    const response = await admin.get(`/api/borrowers?q=${q}`);
    expect(response.status).toBe(400);
    expect(response.body.error.details.fields.q).toHaveLength(1);
  }
});

test('repeated query parameters are a VALIDATION_ERROR, not a 500', async () => {
  for (const query of ['q=ab&q=cd', 'type=STUDENT&type=FACULTY', 'active=true&active=false']) {
    const response = await admin.get(`/api/borrowers?${query}`);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  }
});

test('page and pageSize must be whole numbers; a huge page is answered without a 500', async () => {
  for (const query of ['pageSize=1.5', 'pageSize=abc', 'page=-1', 'page=1.5', 'pageSize=0']) {
    const response = await admin.get(`/api/borrowers?${query}`);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  }
  for (const page of ['100000', '1e20', '9007199254740993']) {
    const response = await admin.get(`/api/borrowers?page=${page}`);
    expect(response.status, `page=${page}`).not.toBe(500);
  }
});

test('% and _ in the search match as plain text through the route', async () => {
  await create({ schoolId: 'QA_100', name: 'Percent 50% Borrower' });
  await create({ schoolId: 'QAX100', name: 'Other Person' });
  const names = async (q: string) =>
    (await admin.get(`/api/borrowers?q=${encodeURIComponent(q)}`).expect(200)).body.data.map(
      (b: { name: string }) => b.name,
    );
  expect(await names('A_1')).toEqual(['Percent 50% Borrower']);
  expect(await names('0%')).toEqual(['Percent 50% Borrower']);
});

// --- Request guards ---

test('POST and PATCH without the CSRF header are refused and write nothing', async () => {
  const { id } = await create();
  await admin
    .post('/api/borrowers')
    .send({ ...SAMPLE, schoolId: 'QA-0003' })
    .expect(403);
  await admin.patch(`/api/borrowers/${id}`).send({ active: false }).expect(403);
  expect(await prisma.borrower.count()).toBe(1);
  expect((await stored(id)).active).toBe(true);
});

test('a body over 100 KB gets PAYLOAD_TOO_LARGE', async () => {
  const response = await post({ ...SAMPLE, name: 'x'.repeat(110 * 1024) });
  expect(response.status).toBe(413);
  expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
});

test('PATCH on an unknown id writes no audit entry', async () => {
  await patch('00000000-0000-4000-8000-000000000000', { name: 'Ghost Name' }).expect(404);
  expect(await prisma.auditLog.count()).toBe(0);
});
