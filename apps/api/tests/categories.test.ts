import request from 'supertest';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { resetDatabase } from './setup/reset-database.ts';

// MD-1: categories CRUD. Test cases TC-MD-01 to TC-MD-03 in TEST_CASES.md.

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

// Every state-changing request needs the CSRF header (ARCHITECTURE.md 5).
const post = (agent: typeof admin, body: object) =>
  agent.post('/api/categories').set('X-Requested-With', 'fetch').send(body);
const put = (agent: typeof admin, id: string, body: object) =>
  agent.put(`/api/categories/${id}`).set('X-Requested-With', 'fetch').send(body);
const del = (agent: typeof admin, id: string) =>
  agent.delete(`/api/categories/${id}`).set('X-Requested-With', 'fetch');

const auditFor = (entityId: string) =>
  prisma.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } });

const itemIn = (categoryId: string, status: 'ACTIVE' | 'RETIRED' = 'ACTIVE') =>
  prisma.item.create({
    data: {
      name: 'Speaker',
      categoryId,
      trackingType: 'QUANTITY',
      totalQuantity: 2,
      condition: 'GOOD',
      status,
    },
  });

test('TC-MD-01: admin creates and renames a category; both are saved and audited (BR 14)', async () => {
  const created = await post(admin, { name: '  Cameras  ' }).expect(201);
  const { id } = created.body.category;
  expect(created.body.category).toEqual({ id, name: 'Cameras', itemCount: 0 });

  const renamed = await put(admin, id, { name: 'Cameras and tripods' }).expect(200);
  expect(renamed.body.category).toEqual({ id, name: 'Cameras and tripods', itemCount: 0 });
  expect(await prisma.category.findUnique({ where: { id } })).toMatchObject({
    name: 'Cameras and tripods',
  });

  expect(await auditFor(id)).toMatchObject([
    {
      actorId: adminId,
      action: 'CATEGORY_CREATED',
      entity: 'category',
      after: { name: 'Cameras' },
    },
    {
      actorId: adminId,
      action: 'CATEGORY_RENAMED',
      entity: 'category',
      before: { name: 'Cameras' },
      after: { name: 'Cameras and tripods' },
    },
  ]);
});

test('TC-MD-02: an unused category is deleted; one in use gets HAS_HISTORY (BR 15)', async () => {
  const unused = await prisma.category.create({ data: { name: 'Audio' } });
  const used = await prisma.category.create({ data: { name: 'Laptops' } });
  // A retired item still counts: the category is part of its history.
  await itemIn(used.id, 'RETIRED');

  await del(admin, unused.id).expect(204);
  expect(await prisma.category.findUnique({ where: { id: unused.id } })).toBeNull();
  expect(await auditFor(unused.id)).toMatchObject([
    { actorId: adminId, action: 'CATEGORY_DELETED', entity: 'category', before: { name: 'Audio' } },
  ]);

  const refused = await del(admin, used.id).expect(409);
  expect(refused.body.error.code).toBe('HAS_HISTORY');
  expect(await prisma.category.findUnique({ where: { id: used.id } })).not.toBeNull();
  expect(await auditFor(used.id)).toEqual([]); // the audit entry rolled back with the delete
});

test('TC-MD-03: a handler or viewer cannot list, create, rename, or delete categories (SPEC 3)', async () => {
  const category = await prisma.category.create({ data: { name: 'Audio' } });
  for (const username of ['hal', 'vic']) {
    const agent = await signIn(username);
    for (const response of [
      await agent.get('/api/categories'),
      await post(agent, { name: 'Projectors' }),
      await put(agent, category.id, { name: 'Sound' }),
      await del(agent, category.id),
    ]) {
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    }
  }
  expect(await prisma.category.findMany()).toMatchObject([{ name: 'Audio' }]);
  await request(createApp()).get('/api/categories').expect(401);
});

test('the list is sorted by name, paginated, and counts the items in each category', async () => {
  const audio = await prisma.category.create({ data: { name: 'Audio' } });
  await prisma.category.createMany({ data: [{ name: 'Cables' }, { name: 'Bags' }] });
  await itemIn(audio.id);

  const first = await admin.get('/api/categories?page=1&pageSize=2').expect(200);
  expect(first.body).toEqual({
    data: [
      { id: audio.id, name: 'Audio', itemCount: 1 },
      expect.objectContaining({ name: 'Bags', itemCount: 0 }),
    ],
    page: 1,
    pageSize: 2,
    total: 3,
  });
  const second = await admin.get('/api/categories?page=2&pageSize=2').expect(200);
  expect(second.body.data.map((row: { name: string }) => row.name)).toEqual(['Cables']);
});

test('SPEC 7 bounds: page size 100 is allowed and 101 is not; names are 1 to 200 characters', async () => {
  await admin.get('/api/categories?pageSize=100').expect(200);
  const tooMany = await admin.get('/api/categories?pageSize=101').expect(400);
  expect(tooMany.body.error.code).toBe('VALIDATION_ERROR');

  await post(admin, { name: 'x'.repeat(200) }).expect(201);
  for (const name of ['', '   ', 'x'.repeat(201)]) {
    const response = await post(admin, { name }).expect(400);
    expect(response.body.error.details.fields.name).toHaveLength(1);
  }
});

test('a duplicate name gets DUPLICATE_VALUE on the name field, on create and on rename', async () => {
  await prisma.category.create({ data: { name: 'Audio' } });
  const video = await prisma.category.create({ data: { name: 'Video' } });

  for (const response of [
    await post(admin, { name: 'Audio' }),
    await put(admin, video.id, { name: 'Audio' }),
  ]) {
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('DUPLICATE_VALUE');
    expect(response.body.error.details.fields.name).toEqual([
      'A category named "Audio" already exists.',
    ]);
  }
  expect(await prisma.auditLog.count()).toBe(0);
});

test('an unknown id gets NOT_FOUND and a malformed id gets VALIDATION_ERROR', async () => {
  const unknown = '00000000-0000-4000-8000-000000000000';
  expect((await put(admin, unknown, { name: 'Audio' })).body.error.code).toBe('NOT_FOUND');
  expect((await del(admin, unknown)).body.error.code).toBe('NOT_FOUND');
  expect((await del(admin, 'not-a-uuid')).body.error.code).toBe('VALIDATION_ERROR');
});
