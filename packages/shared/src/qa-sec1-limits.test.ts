import { describe, expect, test } from 'vitest';
import type { z } from 'zod';
import {
  borrowerListQuerySchema,
  borrowerSchema,
  checkoutSchema,
  itemListQuerySchema,
  roomSchema,
} from './index.ts';

// QA automation gaps for SEC-1 (TC-SEC-10, SPEC.md 7), beyond limits.test.ts.

const ID = '7d3f8a2e-1b4c-4d5e-8f6a-9b0c1d2e3f4a';
const ok = (schema: z.ZodType, value: unknown) => schema.safeParse(value).success;

const borrower = (extra = {}) => ({
  schoolId: '2026-A01',
  name: 'Test Borrower',
  type: 'STUDENT',
  department: 'IT',
  ...extra,
});

test.each(['schoolId', 'name', 'department'])('borrower %s is at most 200 characters', (field) => {
  expect(ok(borrowerSchema, borrower({ [field]: 'a'.repeat(200) }))).toBe(true);
  expect(ok(borrowerSchema, borrower({ [field]: 'a'.repeat(201) }))).toBe(false);
});

test('a room name is at most 200 characters', () => {
  expect(ok(roomSchema, { name: 'a'.repeat(200) })).toBe(true);
  expect(ok(roomSchema, { name: 'a'.repeat(201) })).toBe(false);
});

describe.each([
  ['items', itemListQuerySchema],
  ['borrowers', borrowerListQuerySchema],
])('%s list query', (_name, schema) => {
  test('search text is measured after trimming spaces', () => {
    expect(ok(schema, { q: '  a  ' })).toBe(false);
    expect(ok(schema, { q: ` ${'a'.repeat(100)} ` })).toBe(true);
  });
  test('page size is at least 1 and page is at least 1', () => {
    expect(ok(schema, { pageSize: '0' })).toBe(false);
    expect(ok(schema, { page: '0' })).toBe(false);
  });
});

test('a checkout needs at least one line and each item on one line only', () => {
  const checkout = (lines: object[]) => ({ borrowerId: ID, locationId: ID, lines });
  expect(ok(checkoutSchema, checkout([]))).toBe(false);
  const line = { itemId: ID, quantity: 1 };
  expect(ok(checkoutSchema, checkout([line, line]))).toBe(false);
});
