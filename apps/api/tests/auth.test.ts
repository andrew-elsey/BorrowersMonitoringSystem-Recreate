import argon2 from 'argon2';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/lib/password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { resetDatabase } from './setup/reset-database.ts';

const PASSWORD = 'correct-horse-battery';
let passwordHash: string;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  await resetDatabase();
  await prisma.user.createMany({
    data: [
      { name: 'Ana Admin', username: 'ana', passwordHash, role: 'ADMIN' },
      { name: 'Old Staff', username: 'old', passwordHash, role: 'HANDLER', active: false },
    ],
  });
  // A fresh app per test, so the login throttle counters start empty.
  app = createApp();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Every state-changing request needs this header (ARCHITECTURE.md 5).
function login(
  agent: ReturnType<typeof request.agent> | ReturnType<typeof request>,
  username: string,
  password: string,
  ip = '10.0.0.1',
) {
  return agent
    .post('/api/auth/login')
    .set('X-Requested-With', 'fetch')
    .set('X-Forwarded-For', ip)
    .send({ username, password });
}

const sessionCount = () => prisma.session.count();

test('valid login returns the user and sets a session cookie per ARCHITECTURE.md 5', async () => {
  const response = await login(request(app), 'ana', PASSWORD);

  expect(response.status).toBe(200);
  expect(response.body.user).toMatchObject({ username: 'ana', name: 'Ana Admin', role: 'ADMIN' });
  expect(response.body.user.passwordHash).toBeUndefined();
  const cookie = response.headers['set-cookie']?.[0] ?? '';
  expect(cookie).toMatch(/^bms\.sid=/);
  expect(cookie).toMatch(/HttpOnly/);
  expect(cookie).toMatch(/SameSite=Lax/);
  expect(cookie).not.toMatch(/Secure/); // COOKIE_SECURE defaults to false
  expect(await sessionCount()).toBe(1);
});

test('wrong password, unknown username, and inactive user all get the same generic error', async () => {
  const responses = [
    await login(request(app), 'ana', 'wrong-password'),
    await login(request(app), 'nobody', PASSWORD),
    await login(request(app), 'old', PASSWORD),
  ];
  for (const response of responses) {
    expect(response.status).toBe(401);
    expect(response.body.error).toEqual({
      code: 'UNAUTHENTICATED',
      message: 'Incorrect username or password.',
      details: {},
    });
  }
});

test('no session is stored for anonymous visitors or failed logins', async () => {
  await request(app).get('/api/health');
  const failed = await login(request(app), 'ana', 'wrong-password');

  expect(failed.headers['set-cookie']).toBeUndefined();
  expect(await sessionCount()).toBe(0);
});

test('logging in again gives a new session ID and drops the old one', async () => {
  const agent = request.agent(app);
  const first = await login(agent, 'ana', PASSWORD);
  const second = await login(agent, 'ana', PASSWORD);

  expect(second.headers['set-cookie']?.[0]).not.toBe(first.headers['set-cookie']?.[0]);
  expect(await sessionCount()).toBe(1);
});

test('logout ends the session', async () => {
  const agent = request.agent(app);
  await login(agent, 'ana', PASSWORD);

  const logout = await agent.post('/api/auth/logout').set('X-Requested-With', 'fetch');
  expect(logout.status).toBe(204);
  expect(await sessionCount()).toBe(0);

  const afterLogout = await agent
    .put('/api/auth/password')
    .set('X-Requested-With', 'fetch')
    .send({ currentPassword: PASSWORD, newPassword: 'another-long-password' });
  expect(afterLogout.status).toBe(401);
  expect(afterLogout.body.error.code).toBe('UNAUTHENTICATED');
});

test('a signed-in user changes their own password, and the change is audited', async () => {
  const agent = request.agent(app);
  await login(agent, 'ana', PASSWORD);

  const response = await agent
    .put('/api/auth/password')
    .set('X-Requested-With', 'fetch')
    .send({ currentPassword: PASSWORD, newPassword: 'a-brand-new-password' });

  expect(response.status).toBe(204);
  expect((await login(request(app), 'ana', PASSWORD)).status).toBe(401);
  expect((await login(request(app), 'ana', 'a-brand-new-password')).status).toBe(200);
  const entry = await prisma.auditLog.findFirstOrThrow({
    where: { action: 'USER_PASSWORD_CHANGED' },
  });
  expect(JSON.stringify(entry)).not.toContain('argon2');
});

test('changing the password needs the right current password and a long enough new one', async () => {
  const agent = request.agent(app);
  await login(agent, 'ana', PASSWORD);
  const change = (body: object) =>
    agent.put('/api/auth/password').set('X-Requested-With', 'fetch').send(body);

  const wrongCurrent = await change({
    currentPassword: 'not-it-at-all',
    newPassword: 'a-brand-new-password',
  });
  expect(wrongCurrent.status).toBe(400);
  expect(wrongCurrent.body.error.code).toBe('VALIDATION_ERROR');

  const tooShort = await change({ currentPassword: PASSWORD, newPassword: 'short' });
  expect(tooShort.status).toBe(400);
  expect(tooShort.body.error.details.fields.newPassword).toBeDefined();

  expect(await prisma.auditLog.count()).toBe(0);
});

test('changing the password requires a signed-in user', async () => {
  const response = await request(app)
    .put('/api/auth/password')
    .set('X-Requested-With', 'fetch')
    .send({ currentPassword: PASSWORD, newPassword: 'a-brand-new-password' });
  expect(response.status).toBe(401);
});

test('state-changing requests without X-Requested-With: fetch are refused (CSRF)', async () => {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ username: 'ana', password: PASSWORD });
  expect(response.status).toBe(403);
  expect(response.body.error.code).toBe('FORBIDDEN');
});

test('an unknown username runs one password verify, the same as a wrong password', async () => {
  // Warm up the dummy hash so only the verify is counted.
  await login(request(app), 'nobody', PASSWORD);
  const verify = vi.spyOn(argon2, 'verify');

  await login(request(app), 'nobody', PASSWORD);
  expect(verify).toHaveBeenCalledTimes(1);
  await login(request(app), 'ana', 'wrong-password');
  expect(verify).toHaveBeenCalledTimes(2);
});

test('S20: failed logins are throttled per IP and username, without hashing, never locking the account', async () => {
  for (let attempt = 0; attempt < 10; attempt++) {
    expect((await login(request(app), 'ana', 'wrong-password', '10.0.0.66')).status).toBe(401);
  }
  const verify = vi.spyOn(argon2, 'verify');

  const throttled = await login(request(app), 'ana', PASSWORD, '10.0.0.66');
  expect(throttled.status).toBe(429);
  expect(throttled.body.error.code).toBe('RATE_LIMITED');
  expect(Number(throttled.headers['retry-after'])).toBeGreaterThan(0);
  expect(verify).not.toHaveBeenCalled();

  // The admin signs in normally from another machine.
  expect((await login(request(app), 'ana', PASSWORD, '10.0.0.2')).status).toBe(200);
});

test('failed logins are throttled per IP across usernames', async () => {
  for (let attempt = 0; attempt < 30; attempt++) {
    await login(request(app), `user${attempt}`, 'wrong-password', '10.0.0.77');
  }
  const response = await login(request(app), 'ana', PASSWORD, '10.0.0.77');
  expect(response.status).toBe(429);
  expect(response.body.error.code).toBe('RATE_LIMITED');
});

test('successful logins do not count toward the throttle', async () => {
  for (let attempt = 0; attempt < 12; attempt++) {
    expect((await login(request(app), 'ana', PASSWORD)).status).toBe(200);
  }
});

test('a full hashing queue answers 503 SERVER_BUSY with Retry-After', async () => {
  // HASH_CONCURRENCY 2 + HASH_QUEUE_MAX 10 = 12 at most; send more at once, each from its own IP.
  const responses = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      login(request(app), 'ana', 'wrong-password', `10.1.0.${index}`),
    ),
  );

  const busy = responses.filter((response) => response.status === 503);
  expect(busy.length).toBeGreaterThan(0);
  expect(busy[0]!.body.error.code).toBe('SERVER_BUSY');
  expect(Number(busy[0]!.headers['retry-after'])).toBeGreaterThan(0);
});

test('an oversized body is refused with PAYLOAD_TOO_LARGE', async () => {
  const response = await login(request(app), 'ana', 'x'.repeat(200 * 1024));
  expect(response.status).toBe(413);
  expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
});
