import request from 'supertest';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { resetDatabase } from './setup/reset-database.ts';

// QA automation gaps for SEC-1 (ARCHITECTURE.md 12.3, TC-SEC-05 and TC-SEC-06), beyond
// request-limits.test.ts. Each app is new, so each test starts with empty limiter counts.

type App = ReturnType<typeof createApp>;
const PASSWORD = 'correct-horse-battery';
const GLOBAL_LIMIT = 600;
const SEARCH_LIMIT = 60;

beforeEach(async () => {
  await resetDatabase();
  const passwordHash = await hashPassword(PASSWORD);
  await prisma.user.create({
    data: { name: 'Ana Admin', username: 'ana', passwordHash, role: 'ADMIN' },
  });
});

const from = (app: App, ip: string, path = '/api/no-such-path') =>
  request(app).get(path).set('X-Forwarded-For', ip);

// 100 at a time keeps the run short without opening hundreds of sockets at once.
async function useUpGlobalLimit(app: App, ip: string, path = '/api/no-such-path') {
  for (let sent = 0; sent < GLOBAL_LIMIT; sent += 100) {
    await Promise.all(Array.from({ length: 100 }, () => from(app, ip, path)));
  }
}

function expectStandardRateLimited(response: request.Response) {
  expect(response.status).toBe(429);
  expect(response.headers['content-type']).toMatch(/^application\/json/);
  expect(response.body).toEqual({
    error: { code: 'RATE_LIMITED', message: expect.any(String), details: {} },
  });
  // Retry-After is whole seconds within the one-minute window.
  expect(response.headers['retry-after']).toMatch(/^\d+$/);
  const seconds = Number(response.headers['retry-after']);
  expect(seconds).toBeGreaterThan(0);
  expect(seconds).toBeLessThanOrEqual(60);
}

async function signIn(app: App, ip: string) {
  const agent = request.agent(app);
  await agent
    .post('/api/auth/login')
    .set('X-Requested-With', 'fetch')
    .set('X-Forwarded-For', ip)
    .send({ username: 'ana', password: PASSWORD })
    .expect(200);
  const get = (path: string, address = ip) =>
    agent.get(path).set('X-Requested-With', 'fetch').set('X-Forwarded-For', address);
  return get;
}

test('the global limit answers with the standard JSON error and a Retry-After of at most 60 s', async () => {
  const app = createApp();
  await useUpGlobalLimit(app, '10.1.0.1');
  expectStandardRateLimited(await from(app, '10.1.0.1'));
});

test('a client over the global limit gets 429 for invalid JSON, not a body parse error', async () => {
  const app = createApp();
  await useUpGlobalLimit(app, '10.1.0.2');
  const response = await request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', '10.1.0.2')
    .set('X-Requested-With', 'fetch')
    .set('Content-Type', 'application/json')
    .send('{not json');
  expectStandardRateLimited(response);
});

test('a client over the global limit gets 429 for an oversized body, not 413', async () => {
  const app = createApp();
  await useUpGlobalLimit(app, '10.1.0.3');
  const response = await request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', '10.1.0.3')
    .set('X-Requested-With', 'fetch')
    .send({ username: 'a'.repeat(200_000), password: 'x' });
  expectStandardRateLimited(response);
});

test('health checks do not use up the global limit', async () => {
  const app = createApp();
  await useUpGlobalLimit(app, '10.1.0.4', '/api/health');
  expect((await from(app, '10.1.0.4')).status).toBe(404);
});

test('a fake address put in front of X-Forwarded-For does not get a new global count', async () => {
  const app = createApp();
  await useUpGlobalLimit(app, '10.1.0.5');
  // trust proxy 1 takes the last entry (the one nginx wrote), so the prefix is ignored.
  expectStandardRateLimited(await from(app, '6.6.6.6, 10.1.0.5'));
});

test('the search limit answers with the standard JSON error and a Retry-After of at most 60 s', async () => {
  const app = createApp();
  const get = await signIn(app, '10.1.1.1');
  for (let i = 0; i < SEARCH_LIMIT; i++) expect((await get('/api/items?q=lap')).status).toBe(200);
  expectStandardRateLimited(await get('/api/items?q=lap'));
});

test('items search and borrowers search have separate counts', async () => {
  const app = createApp();
  const get = await signIn(app, '10.1.1.2');
  for (let i = 0; i < SEARCH_LIMIT; i++) expect((await get('/api/items?q=lap')).status).toBe(200);
  expect((await get('/api/items?q=lap')).status).toBe(429);
  expect((await get('/api/borrowers?q=ana')).status).toBe(200);
});

test('plain list requests do not use up the search limit', async () => {
  const app = createApp();
  const get = await signIn(app, '10.1.1.3');
  for (let i = 0; i < SEARCH_LIMIT + 10; i++) expect((await get('/api/items')).status).toBe(200);
  for (let i = 0; i < SEARCH_LIMIT; i++) expect((await get('/api/items?q=lap')).status).toBe(200);
});

test('a fake address put in front of X-Forwarded-For does not get a new search count', async () => {
  const app = createApp();
  const get = await signIn(app, '10.1.1.4');
  for (let i = 0; i < SEARCH_LIMIT; i++) expect((await get('/api/items?q=lap')).status).toBe(200);
  expect((await get('/api/items?q=lap', '6.6.6.6, 10.1.1.4')).status).toBe(429);
});
