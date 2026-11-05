import { afterEach, expect, test } from 'vitest';
import { readTimezone } from '../src/lib/config.ts';

// APP_TIMEZONE is checked at startup: an unknown zone would quietly switch off date rules (BR 7).

const original = process.env.APP_TIMEZONE;
afterEach(() => {
  if (original === undefined) delete process.env.APP_TIMEZONE;
  else process.env.APP_TIMEZONE = original;
});

test('APP_TIMEZONE defaults to Asia/Manila and accepts any IANA zone', () => {
  delete process.env.APP_TIMEZONE;
  expect(readTimezone()).toBe('Asia/Manila');
  process.env.APP_TIMEZONE = 'Europe/Berlin';
  expect(readTimezone()).toBe('Europe/Berlin');
});

test('an unknown APP_TIMEZONE stops startup with a clear error', () => {
  process.env.APP_TIMEZONE = 'Mars/Olympus';
  expect(() => readTimezone()).toThrow(
    'APP_TIMEZONE must be an IANA time zone such as Asia/Manila, got "Mars/Olympus"',
  );
});
