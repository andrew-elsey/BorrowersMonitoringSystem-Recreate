import request from 'supertest';
import { expect, test } from 'vitest';
import { createApp } from '../src/app.js';

test('GET /api/health answers ok', async () => {
  const response = await request(createApp()).get('/api/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'ok' });
});

test('trust proxy is configured from TRUST_PROXY_HOPS (default 1)', () => {
  expect(createApp().get('trust proxy')).toBe(1);
});
