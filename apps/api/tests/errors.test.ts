import request from 'supertest';
import { expect, test } from 'vitest';
import { createApp } from '../src/app.ts';

// Every error leaves in the standard format (ARCHITECTURE.md 7, CLAUDE.md rule 10).

test('an unknown API path answers 404 NOT_FOUND in the standard format', async () => {
  const response = await request(createApp()).get('/api/does-not-exist');
  expect(response.status).toBe(404);
  expect(response.body).toEqual({
    error: { code: 'NOT_FOUND', message: 'Not found.', details: {} },
  });
});

test('invalid JSON is a 400 VALIDATION_ERROR', async () => {
  const response = await request(createApp())
    .post('/api/auth/login')
    .set('X-Requested-With', 'fetch')
    .set('Content-Type', 'application/json')
    .send('{"username":');
  expect(response.status).toBe(400);
  expect(response.body.error.code).toBe('VALIDATION_ERROR');
});

test('an unsupported charset is a 400 VALIDATION_ERROR, not a server error', async () => {
  const response = await request(createApp())
    .post('/api/auth/login')
    .set('X-Requested-With', 'fetch')
    .set('Content-Type', 'application/json; charset=latin1')
    .send('{"username":"ana","password":"x"}');
  expect(response.status).toBe(400);
  expect(response.body.error.code).toBe('VALIDATION_ERROR');
});
