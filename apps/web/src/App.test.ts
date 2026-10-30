import { expect, test } from 'vitest';
import { pageTitle } from './App';

test('web can import the shared package', () => {
  expect(pageTitle()).toBe('Borrowers Monitoring System');
});
