import { describe, expect, test } from 'vitest';
import type { z } from 'zod';
import {
  borrowerUpdateSchema,
  checkoutSchema,
  itemListQuerySchema,
  itemSchema,
  itemUpdateSchema,
  pageQuerySchema,
  roomUpdateSchema,
  semesterSchema,
  settingsSchema,
  usageQuerySchema,
  userUpdateSchema,
} from './index.ts';

// HRD-5a: TC-HRD-45 to 49 (shared schemas). The api checks live in apps/api/tests/hrd5-api.test.ts.

const CATEGORY = '7d3f8a2e-1b4c-4d5e-8f6a-9b0c1d2e3f4a';
const messages = (schema: z.ZodType, value: unknown) => {
  const result = schema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};
const item = (extra: object) => ({
  trackingType: 'UNIT',
  name: 'Laptop',
  categoryId: CATEGORY,
  condition: 'GOOD',
  status: 'ACTIVE',
  ...extra,
});

describe('TC-HRD-45: no raw Zod text', () => {
  test.each([
    ['settings {}', settingsSchema, {}],
    ['page=abc', pageQuerySchema, { page: 'abc' }],
    ['item {}', itemSchema, {}],
    ['item name as a number', itemSchema, item({ name: 5 })],
    ['status filter', itemListQuerySchema, { status: 'x' }],
    ['unknown tracking type', itemSchema, item({ trackingType: 'X' })],
  ])('%s', (_name, schema, value) => {
    const all = messages(schema, value);
    expect(all.length).toBeGreaterThan(0);
    for (const message of all) expect(message).not.toMatch(/Invalid input|expected|received/);
  });

  test('TC-HRD-46: a message written on the schema still wins', () => {
    expect(messages(itemSchema, item({ trackingType: 'QUANTITY', totalQuantity: 'x' }))).toEqual([
      'Enter a whole number from 0 to 10,000.',
    ]);
  });
});

describe('TC-HRD-47 and 48: asset tag on create', () => {
  test.each(['', '   '])('UNIT with tag %j gives one message', (assetTag) => {
    expect(messages(itemSchema, item({ assetTag }))).toEqual(['Enter an asset tag.']);
  });

  test('QUANTITY with a blank tag is accepted; a real tag is refused', () => {
    const quantity = { trackingType: 'QUANTITY', totalQuantity: 5 };
    expect(messages(itemSchema, item({ ...quantity, assetTag: '' }))).toEqual([]);
    // null is not text: a plain message, never Zod's raw one.
    expect(messages(itemSchema, item({ ...quantity, assetTag: null }))).toEqual([
      'Enter a valid value.',
    ]);
    expect(messages(itemSchema, item({ ...quantity, assetTag: 'X' }))).toEqual([
      'Quantity items have no asset tag.',
    ]);
  });
});

describe('TC-HRD-49: one real-date field', () => {
  const semester = { name: 'S', startDate: '0000-01-01', endDate: '2026-01-01' };
  test('semesters, report ranges and expected return dates refuse year 0', () => {
    expect(messages(semesterSchema, semester)).toContain('Enter a real date.');
    expect(messages(usageQuerySchema, { from: '0000-01-01', to: '2026-01-01' })).toContain(
      'Enter a real date.',
    );
    expect(
      messages(checkoutSchema, {
        borrowerId: CATEGORY,
        locationId: CATEGORY,
        lines: [{ itemId: CATEGORY, quantity: 1, expectedReturnDate: '0000-01-01' }],
      }),
    ).toContain('Enter a real date.');
    expect(messages(semesterSchema, { ...semester, startDate: '0001-01-01' })).toEqual([]);
  });
});

describe('TC-HRD-50: an empty PATCH body is refused', () => {
  test.each([
    ['items', itemUpdateSchema],
    ['rooms', roomUpdateSchema],
    ['borrowers', borrowerUpdateSchema],
    ['users', userUpdateSchema],
  ])('%s', (_name, schema) => {
    expect(messages(schema, {})).toEqual(['Nothing to update.']);
    expect(messages(schema, { foo: 1 })).toEqual(['Nothing to update.']);
    expect(messages(schema, { name: 'Ok' })).toEqual([]);
  });
});
