import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { resetDatabase } from './setup/reset-database.ts';

// QA gap tests for MD-1 (categories). Cover what categories.test.ts leaves out:
// 401 and CSRF on every endpoint, page bounds, trimmed length, no audit on failure, and the
// delete-vs-new-item race (BR 15, enforced by the items foreign key).

const PASSWORD = 'correct-horse-battery';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
let passwordHash: string;
let admin: ReturnType<typeof request.agent>;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  await resetDatabase();
  await prisma.user.create({
    data: { name: 'Ana Admin', username: 'ana', passwordHash, role: 'ADMIN' },
  });
  admin = request.agent(createApp());
  await admin
    .post('/api/auth/login')
    .set('X-Requested-With', 'fetch')
    .send({ username: 'ana', password: PASSWORD })
    .expect(200);
});

const csrf = { 'X-Requested-With': 'fetch' };
const newItemIn = (categoryId: string) => ({
  name: 'Speaker',
  categoryId,
  trackingType: 'QUANTITY' as const,
  totalQuantity: 1,
  condition: 'GOOD' as const,
  status: 'ACTIVE' as const,
});

describe('authentication and CSRF', () => {
  test('a signed-out request gets 401 on every categories endpoint', async () => {
    const category = await prisma.category.create({ data: { name: 'Audio' } });
    const anon = request(createApp());
    for (const response of [
      await anon.get('/api/categories'),
      await anon.post('/api/categories').set(csrf).send({ name: 'Video' }),
      await anon.put(`/api/categories/${category.id}`).set(csrf).send({ name: 'Video' }),
      await anon.delete(`/api/categories/${category.id}`).set(csrf),
    ]) {
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
    }
    expect(await prisma.category.findMany()).toMatchObject([{ name: 'Audio' }]);
  });

  test('an admin change without the X-Requested-With header is refused and changes nothing', async () => {
    const category = await prisma.category.create({ data: { name: 'Audio' } });
    for (const response of [
      await admin.post('/api/categories').send({ name: 'Video' }),
      await admin.put(`/api/categories/${category.id}`).send({ name: 'Video' }),
      await admin.delete(`/api/categories/${category.id}`),
    ]) {
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    }
    expect(await prisma.category.findMany()).toMatchObject([{ name: 'Audio' }]);
    expect(await prisma.auditLog.count()).toBe(0);
  });
});

describe('SPEC 7 bounds', () => {
  test('a missing page defaults to page 1 and a missing page size to 25', async () => {
    const response = await admin.get('/api/categories').expect(200);
    expect(response.body).toMatchObject({ page: 1, pageSize: 25, total: 0 });
  });

  test.each(['page=0', 'page=-1', 'page=abc', 'page=1.5', 'pageSize=0', 'pageSize=abc'])(
    'an invalid query %s gets VALIDATION_ERROR',
    async (query) => {
      const response = await admin.get(`/api/categories?${query}`).expect(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    },
  );

  test('a 200-character name padded with spaces is accepted after trimming', async () => {
    const name = 'x'.repeat(200);
    const response = await admin
      .post('/api/categories')
      .set(csrf)
      .send({ name: `  ${name}  ` })
      .expect(201);
    expect(response.body.category.name).toBe(name);
  });

  test('rename enforces the same 1 to 200 character name bounds', async () => {
    const category = await prisma.category.create({ data: { name: 'Audio' } });
    for (const name of ['', '   ', 'x'.repeat(201)]) {
      const response = await admin
        .put(`/api/categories/${category.id}`)
        .set(csrf)
        .send({ name })
        .expect(400);
      expect(response.body.error.details.fields.name).toHaveLength(1);
    }
    await admin
      .put(`/api/categories/${category.id}`)
      .set(csrf)
      .send({ name: 'x'.repeat(200) })
      .expect(200);
  });

  test('a missing or non-string name gets VALIDATION_ERROR', async () => {
    for (const body of [{}, { name: 42 }, { name: null }]) {
      const response = await admin.post('/api/categories').set(csrf).send(body).expect(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('audit (BR 14)', () => {
  test('each successful change writes exactly one audit entry, including a case-only rename', async () => {
    const created = await admin
      .post('/api/categories')
      .set(csrf)
      .send({ name: 'Audio' })
      .expect(201);
    const { id } = created.body.category;
    expect(await prisma.auditLog.count()).toBe(1);
    await admin.put(`/api/categories/${id}`).set(csrf).send({ name: 'AUDIO' }).expect(200);
    expect(await prisma.auditLog.count()).toBe(2);
    await admin.delete(`/api/categories/${id}`).set(csrf).expect(204);
    expect(await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } })).toMatchObject([
      { action: 'CATEGORY_CREATED' },
      { action: 'CATEGORY_RENAMED', before: { name: 'Audio' }, after: { name: 'AUDIO' } },
      { action: 'CATEGORY_DELETED', before: { name: 'AUDIO' } },
    ]);
  });

  test('a failed change (case-insensitive duplicate, not found, in use) writes no audit entry', async () => {
    const audio = await prisma.category.create({ data: { name: 'Audio' } });
    const video = await prisma.category.create({ data: { name: 'Video' } });
    await prisma.item.create({ data: newItemIn(video.id) });

    await admin.post('/api/categories').set(csrf).send({ name: 'audio' }).expect(409);
    await admin.put(`/api/categories/${video.id}`).set(csrf).send({ name: 'AUDIO' }).expect(409);
    await admin.put(`/api/categories/${UNKNOWN_ID}`).set(csrf).send({ name: 'X' }).expect(404);
    await admin.delete(`/api/categories/${UNKNOWN_ID}`).set(csrf).expect(404);
    await admin.delete(`/api/categories/${video.id}`).set(csrf).expect(409);

    expect(await prisma.auditLog.count()).toBe(0);
    expect(await prisma.category.findMany({ orderBy: { name: 'asc' } })).toMatchObject([
      { id: audio.id, name: 'Audio' },
      { id: video.id, name: 'Video' },
    ]);
  });
});

describe('BR 15 race: delete versus a new item in the category', () => {
  test('a delete that waits on an uncommitted new item gets HAS_HISTORY once the item commits', async () => {
    const category = await prisma.category.create({ data: { name: 'Audio' } });

    let releaseItem!: () => void;
    const itemMayCommit = new Promise<void>((resolve) => (releaseItem = resolve));
    // Insert the item in an open transaction: it holds a lock on the category row (FK KEY SHARE).
    let itemInserted!: () => void;
    const itemIsInserted = new Promise<void>((resolve) => (itemInserted = resolve));
    const itemTransaction = prisma.$transaction(async (tx) => {
      await tx.item.create({ data: newItemIn(category.id) });
      itemInserted();
      await itemMayCommit;
    });
    await itemIsInserted;

    const deleteResponse = admin
      .delete(`/api/categories/${category.id}`)
      .set(csrf)
      .then((r) => r);

    // Wait (no sleep) until the DELETE is blocked on the item transaction's lock.
    await expect
      .poll(
        async () => {
          const rows = await prisma.$queryRaw<{ n: bigint }[]>`
            SELECT count(*) AS n FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND query ILIKE 'DELETE%categories%'`;
          return Number(rows[0].n);
        },
        { timeout: 5_000, interval: 25 },
      )
      .toBe(1);

    releaseItem();
    await itemTransaction;

    const response = await deleteResponse;
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('HAS_HISTORY');
    expect(await prisma.category.findUnique({ where: { id: category.id } })).not.toBeNull();
    expect(await prisma.item.count({ where: { categoryId: category.id } })).toBe(1);
    expect(await prisma.auditLog.count()).toBe(0);
  });
});
