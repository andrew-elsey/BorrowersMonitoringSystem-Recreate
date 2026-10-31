import express from 'express';
import type { RateLimitRequestHandler } from 'express-rate-limit';
import request from 'supertest';
import { expect, test } from 'vitest';
import { createLoginRateLimiters } from '../src/middleware/login-rate-limit.ts';

// AUTH-5: once an IP is blocked, its requests must not store anything more in the limiters.
// Each stored key used to hold the raw username (up to the 100 KB body limit), so a blocked
// machine could still fill the API's memory.

const IP = '10.9.9.9';

function createLoginApp() {
  const limiters = createLoginRateLimiters();
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '100kb' }));
  app.post('/login', ...limiters, (_req, res) => {
    res.status(401).end(); // every login fails
  });
  return { app, limiters };
}

const fail = (app: express.Express, username: string) =>
  request(app).post('/login').set('X-Forwarded-For', IP).send({ username, password: 'wrong' });

// The limiter that keys on IP and username, found by asking each limiter for a known key.
async function perUsernameLimiter(limiters: RateLimitRequestHandler[], username: string) {
  for (const limiter of limiters) {
    if (await limiter.getKey(`${IP}|${username}`)) return limiter;
  }
  throw new Error('no limiter stored the IP and username key');
}

test('after an IP is blocked, failed logins from it store no new usernames', async () => {
  const { app, limiters } = createLoginApp();
  for (let attempt = 0; attempt < 30; attempt++) await fail(app, `user${attempt}`);
  const perUsername = await perUsernameLimiter(limiters, 'user0');

  // The IP is now over its limit of 30 failures, so it gets 429 without anything new stored.
  expect((await fail(app, 'new-user')).status).toBe(429);
  expect(await perUsername.getKey(`${IP}|new-user`)).toBeUndefined();
});

test('the username part of a limiter key is at most 200 characters', async () => {
  const { app, limiters } = createLoginApp();
  const longName = 'a'.repeat(90_000);
  await fail(app, longName);

  const perUsername = await perUsernameLimiter(limiters, 'a'.repeat(200));
  expect(await perUsername.getKey(`${IP}|${longName}`)).toBeUndefined();
});
