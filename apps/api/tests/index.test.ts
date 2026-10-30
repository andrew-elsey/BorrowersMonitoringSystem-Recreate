import { expect, test } from 'vitest';
import { startupMessage } from '../src/index';

test('api can import the shared package', () => {
  expect(startupMessage()).toBe('Borrowers Monitoring System API');
});
