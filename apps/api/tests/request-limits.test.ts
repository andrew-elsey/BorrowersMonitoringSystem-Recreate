import { spawnSync } from 'node:child_process';
import request from 'supertest';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { startServer } from '../src/server.ts';
import { resetDatabase } from './setup/reset-database.ts';

// SEC-1: Express request limits and server settings (ARCHITECTURE.md 12.3).
// Test cases TC-SEC-05 to TC-SEC-08 in TEST_CASES.md. nginx is tested in apps/web/scripts/check-nginx.ts.

const PASSWORD = 'correct-horse-battery';

beforeEach(async () => {
  await resetDatabase();
  const passwordHash = await hashPassword(PASSWORD);
  await prisma.user.create({
    data: { name: 'Ana Admin', username: 'ana', passwordHash, role: 'ADMIN' },
  });
});

// trust proxy is 1, so X-Forwarded-For (set by nginx in production) is the client address.
const from = (app: ReturnType<typeof createApp>, ip: string) =>
  request(app).get('/api/no-such-path').set('X-Forwarded-For', ip);

function expectRateLimited(response: request.Response) {
  expect(response.status).toBe(429);
  expect(response.body.error.code).toBe('RATE_LIMITED');
  expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
}

test('TC-SEC-05, TC-SEC-06: the global limit is 600 a minute per client address', async () => {
  const app = createApp();
  for (let batch = 0; batch < 6; batch++) {
    const responses = await Promise.all(Array.from({ length: 100 }, () => from(app, '10.0.0.1')));
    expect(responses.every((response) => response.status === 404)).toBe(true);
  }
  expectRateLimited(await from(app, '10.0.0.1'));
  // Another address has its own count.
  expect((await from(app, '10.0.0.2')).status).toBe(404);
});

test('the health check is never rate limited', async () => {
  const app = createApp();
  for (let i = 0; i < 601; i++) await from(app, '10.0.0.3');
  const health = await request(app).get('/api/health').set('X-Forwarded-For', '10.0.0.3');
  expect(health.status).toBe(200);
});

async function signIn(app: ReturnType<typeof createApp>, ip: string) {
  const agent = request.agent(app);
  await agent
    .post('/api/auth/login')
    .set('X-Requested-With', 'fetch')
    .set('X-Forwarded-For', ip)
    .send({ username: 'ana', password: PASSWORD })
    .expect(200);
  return agent;
}

test.each(['/api/items', '/api/borrowers'])(
  'TC-SEC-05: search on %s is limited to 60 a minute per client address',
  async (path) => {
    const app = createApp();
    const agent = await signIn(app, '10.0.1.1');
    const search = (ip: string, query = '?q=lap') =>
      agent
        .get(path + query)
        .set('X-Requested-With', 'fetch')
        .set('X-Forwarded-For', ip);

    for (let i = 0; i < 60; i++) expect((await search('10.0.1.1')).status).toBe(200);
    expectRateLimited(await search('10.0.1.1'));
    // A plain list (no search text) is not an expensive request.
    expect((await search('10.0.1.1', '')).status).toBe(200);
    // The same session from another address has its own count.
    expect((await search('10.0.1.2')).status).toBe(200);
  },
);

test('TC-SEC-07: the Node server timeouts are set', async () => {
  const server = startServer(createApp(), 0);
  try {
    expect(server.headersTimeout).toBe(15_000);
    expect(server.requestTimeout).toBe(30_000);
    expect(server.keepAliveTimeout).toBe(5_000);
  } finally {
    server.close();
  }
});

test.each([
  ['unhandled rejection', "Promise.reject(new Error('boom'))"],
  ['uncaught exception', "setTimeout(() => { throw new Error('boom'); })"],
])('TC-SEC-08: an %s is logged and the process exits for Docker to restart', (_name, crash) => {
  const script = `import('./src/server.ts').then((m) => { m.exitOnUnhandledErrors(); ${crash}; setTimeout(() => {}, 5000); });`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    timeout: 10_000,
  });
  expect(child.status).toBe(1);
  expect(child.stderr).toContain('Unhandled error, exiting');
  expect(child.stderr).toContain('boom');
});
