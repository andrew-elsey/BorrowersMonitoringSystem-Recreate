import { describe, expect, test } from 'vitest';
import type { z } from 'zod';
import {
  borrowerListQuerySchema,
  categorySchema,
  checkoutSchema,
  itemListQuerySchema,
  itemSchema,
  settingsSchema,
} from './index.ts';

// TC-SEC-10: every SPEC.md 7 limit that has a schema today, checked at the limit and just over it.
// Override reasons, report date ranges, and CSV rows get theirs with FLG-4, RPT-*, and MD-6.

const ID = '7d3f8a2e-1b4c-4d5e-8f6a-9b0c1d2e3f4a';
const otherId = (n: number) => ID.slice(0, -4) + String(n).padStart(4, '0');

function accepts(schema: z.ZodType, value: unknown) {
  expect(schema.safeParse(value).success).toBe(true);
}
function rejects(schema: z.ZodType, value: unknown) {
  expect(schema.safeParse(value).success).toBe(false);
}

const line = (quantity: number, extra = {}) => ({ itemId: ID, quantity, ...extra });
const checkout = (lines: object[]) => ({ borrowerId: ID, locationId: ID, lines });
const quantityItem = (totalQuantity: number, extra = {}) => ({
  trackingType: 'QUANTITY',
  name: 'Extension cord',
  categoryId: ID,
  totalQuantity,
  condition: 'GOOD',
  status: 'ACTIVE',
  ...extra,
});
const settings = (extra = {}) => ({
  closingTime: '17:00',
  warningThreshold: 3,
  noticeThreshold: 4,
  blockThreshold: 5,
  ...extra,
});

describe.each([
  ['items', itemListQuerySchema],
  ['borrowers', borrowerListQuerySchema],
])('%s list query', (_name, schema) => {
  test('page size is at most 100', () => {
    accepts(schema, { pageSize: '100' });
    rejects(schema, { pageSize: '101' });
  });
  test('search text is 2 to 100 characters', () => {
    accepts(schema, { q: 'ab' });
    accepts(schema, { q: 'a'.repeat(100) });
    rejects(schema, { q: 'a' });
    rejects(schema, { q: 'a'.repeat(101) });
  });
});

test('checkout has at most 50 lines', () => {
  const lines = (count: number) =>
    Array.from({ length: count }, (_, n) => ({ itemId: otherId(n), quantity: 1 }));
  accepts(checkoutSchema, checkout(lines(50)));
  rejects(checkoutSchema, checkout(lines(51)));
});

test('checkout quantity per line is a whole number from 1 to 10,000', () => {
  accepts(checkoutSchema, checkout([line(1)]));
  accepts(checkoutSchema, checkout([line(10_000)]));
  rejects(checkoutSchema, checkout([line(0)]));
  rejects(checkoutSchema, checkout([line(10_001)]));
  rejects(checkoutSchema, checkout([line(1.5)]));
});

test('a checkout note is at most 500 characters', () => {
  accepts(checkoutSchema, checkout([line(1, { note: 'a'.repeat(500) })]));
  rejects(checkoutSchema, checkout([line(1, { note: 'a'.repeat(501) })]));
});

test('item total quantity is a whole number from 0 to 10,000', () => {
  accepts(itemSchema, quantityItem(0));
  accepts(itemSchema, quantityItem(10_000));
  rejects(itemSchema, quantityItem(-1));
  rejects(itemSchema, quantityItem(10_001));
});

test('names are at most 200 characters and descriptions at most 1,000', () => {
  accepts(categorySchema, { name: 'a'.repeat(200) });
  rejects(categorySchema, { name: 'a'.repeat(201) });
  accepts(itemSchema, quantityItem(1, { description: 'a'.repeat(1000) }));
  rejects(itemSchema, quantityItem(1, { description: 'a'.repeat(1001) }));
});

test('closing time is HH:mm from 00:00 to 23:59', () => {
  accepts(settingsSchema, settings({ closingTime: '00:00' }));
  accepts(settingsSchema, settings({ closingTime: '23:59' }));
  rejects(settingsSchema, settings({ closingTime: '24:00' }));
  rejects(settingsSchema, settings({ closingTime: '9:00' }));
});

test('strike thresholds are whole numbers from 1 to 100', () => {
  accepts(settingsSchema, settings({ warningThreshold: 1 }));
  accepts(
    settingsSchema,
    settings({ warningThreshold: 98, noticeThreshold: 99, blockThreshold: 100 }),
  );
  rejects(settingsSchema, settings({ warningThreshold: 0 }));
  rejects(
    settingsSchema,
    settings({ warningThreshold: 99, noticeThreshold: 100, blockThreshold: 101 }),
  );
});
