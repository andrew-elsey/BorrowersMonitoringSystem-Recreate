import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { resetDatabase } from './setup/reset-database.ts';

// HRD-5a: TC-HRD-51 to 54 (api and database).

const PASSWORD = 'hrd5-password-123';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
let passwordHash: string;
let admin: ReturnType<typeof request.agent>;
let handler: ReturnType<typeof request.agent>;
let adminId: string;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
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

beforeEach(async () => {
  await resetDatabase();
  const users = await prisma.user.createManyAndReturn({
    data: [
      { name: 'Test Admin', username: 'hrd5-admin', passwordHash, role: 'ADMIN' },
      { name: 'Test Handler', username: 'hrd5-handler', passwordHash, role: 'HANDLER' },
    ],
  });
  adminId = users.find((user) => user.role === 'ADMIN')!.id;
  admin = await signIn('hrd5-admin');
  handler = await signIn('hrd5-handler');
});

describe('TC-HRD-51: empty PATCH', () => {
  test.each(['items', 'rooms', 'borrowers', 'users'])('PATCH /api/%s/:id', async (path) => {
    for (const body of [{}, { foo: 1 }]) {
      const response = await admin
        .patch(`/api/${path}/${MISSING_ID}`)
        .set('X-Requested-With', 'fetch')
        .send(body);
      expect(response.status).toBe(400);
      expect(response.body.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Nothing to update.',
      });
    }
  });
});

test('TC-HRD-52: handlers get only id and name for rooms; admins get everything', async () => {
  await prisma.location.create({ data: { name: 'CL-1', createdById: adminId } });
  const asHandler = await handler.get('/api/rooms');
  expect(Object.keys(asHandler.body.data[0]).sort()).toEqual(['id', 'name']);
  const asAdmin = await admin.get('/api/rooms');
  expect(asAdmin.body.data[0]).toHaveProperty('createdBy');
  expect(asAdmin.body.data[0]).toHaveProperty('transactionCount');
});

test('TC-HRD-51: a QUANTITY item edit with the same name and a blank tag changes nothing and writes no audit', async () => {
  const category = await prisma.category.create({ data: { name: 'Cables' } });
  const item = await prisma.item.create({
    data: {
      name: 'Cord',
      categoryId: category.id,
      trackingType: 'QUANTITY',
      totalQuantity: 5,
      condition: 'GOOD',
    },
  });
  await admin
    .patch(`/api/items/${item.id}`)
    .set('X-Requested-With', 'fetch')
    .send({ name: 'Cord', assetTag: '' })
    .expect(200);
  expect(await prisma.auditLog.count({ where: { entityId: item.id } })).toBe(0);
});

describe('TC-HRD-53: friendly validation messages over HTTP', () => {
  test('?page=abc and a semester starting in year 0', async () => {
    const page = await admin.get('/api/rooms?page=abc');
    expect(page.status).toBe(400);
    expect(page.body.error.details.fields.page[0]).not.toMatch(/Invalid input|expected|NaN/);
    const semester = await admin
      .post('/api/semesters')
      .set('X-Requested-With', 'fetch')
      .send({ name: 'Old', startDate: '0000-01-01', endDate: '2026-01-01' });
    expect(semester.status).toBe(400);
    expect(semester.body.error.details.fields.startDate).toEqual(['Enter a real date.']);
  });
});

describe('TC-HRD-54: settings thresholds in the database', () => {
  test('warning < notice < block is a CHECK constraint', async () => {
    await prisma.setting.create({ data: {} });
    await expect(
      prisma.setting.update({ where: { id: 1 }, data: { noticeThreshold: 3 } }),
    ).rejects.toThrow(/settings_threshold_order/);
    await expect(
      prisma.setting.update({ where: { id: 1 }, data: { blockThreshold: 4 } }),
    ).rejects.toThrow(/settings_threshold_order/);
  });
});
