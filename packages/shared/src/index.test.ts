import { expect, test } from 'vitest';
import { APP_NAME } from './index';

test('shared package exports values', () => {
  expect(APP_NAME).toBe('Borrowers Monitoring System');
});
