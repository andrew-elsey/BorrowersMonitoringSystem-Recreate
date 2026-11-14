import { z } from 'zod';
import { nothingToUpdate, pageQuerySchema, textField } from './categories.ts';
import { searchTextField } from './borrowers.ts';
import { ItemCondition, ItemStatus, TrackingType } from './enums.ts';

// Items (MD-2, SPEC.md 4). Limits from SPEC.md 7.
export const DESCRIPTION_MAX_LENGTH = 1000;
export const TOTAL_QUANTITY_MAX = 10_000;

// One item as the API returns it.
export type Item = {
  id: string;
  name: string;
  category: { id: string; name: string };
  description: string | null;
  trackingType: TrackingType;
  assetTag: string | null;
  totalQuantity: number;
  condition: ItemCondition;
  status: ItemStatus;
};
// One page of GET /api/items. available is what can be issued now (BR 1, BRW-1 getAvailability).
export type ItemPage = {
  data: (Item & { available: number })[];
  page: number;
  pageSize: number;
  total: number;
};

// A description may have line breaks and tabs, but no other control characters (NUL cannot be stored).
const OTHER_CONTROL_CHARACTER = /(?![\t\n\r])\p{Cc}/u;
const QUANTITY_MESSAGE = `Enter a whole number from 0 to ${TOTAL_QUANTITY_MAX.toLocaleString('en-US')}.`;

const itemFields = {
  name: textField('Enter a name.'),
  categoryId: z.guid('Choose a category.'),
  // Optional; empty means no description.
  description: z
    .string()
    .trim()
    .max(DESCRIPTION_MAX_LENGTH, `Too long: at most ${DESCRIPTION_MAX_LENGTH} characters.`)
    .refine((value) => !OTHER_CONTROL_CHARACTER.test(value), 'Remove the control characters.')
    .optional(),
  // A blank tag means "no tag" (create and edit alike): UNIT gets "Enter an asset tag." from
  // trackingErrors, QUANTITY accepts it, and an edit with only a blank tag is "Nothing to update."
  assetTag: z
    .string()
    .optional()
    .transform((value) => (value?.trim() ? value : undefined))
    .pipe(textField('Enter an asset tag.').optional()),
  totalQuantity: z
    .number({ error: QUANTITY_MESSAGE })
    .int(QUANTITY_MESSAGE)
    .min(0, QUANTITY_MESSAGE)
    .max(TOTAL_QUANTITY_MAX, QUANTITY_MESSAGE)
    .optional(),
  condition: z.enum(ItemCondition, { error: 'Choose a condition.' }),
  status: z.enum(ItemStatus, { error: 'Choose a status.' }),
};

type TrackingFields = {
  trackingType: TrackingType;
  assetTag?: string | null;
  totalQuantity?: number;
};

// SPEC.md 4: a UNIT item has an asset tag and a total quantity of 1 (left out means 1); a QUANTITY
// item has no asset tag and a total quantity. Used by the create schema and, with the stored item
// merged in, by the update in the api.
export function trackingErrors(item: TrackingFields): {
  assetTag?: string;
  totalQuantity?: string;
} {
  if (item.trackingType === TrackingType.UNIT) {
    return {
      ...(!item.assetTag && { assetTag: 'Enter an asset tag.' }),
      ...(item.totalQuantity !== undefined &&
        item.totalQuantity !== 1 && {
          totalQuantity: 'Unit items always have a total quantity of 1.',
        }),
    };
  }
  return {
    ...(item.assetTag && { assetTag: 'Quantity items have no asset tag.' }),
    ...(item.totalQuantity === undefined && { totalQuantity: 'Enter the total quantity.' }),
  };
}

// POST /api/items.
export const itemSchema = z
  .object({
    trackingType: z.enum(TrackingType, { error: 'Choose a tracking type.' }),
    ...itemFields,
  })
  .superRefine((item, ctx) => {
    for (const [field, message] of Object.entries(trackingErrors(item))) {
      // Skip a field that already has an issue, so a blank tag is not reported twice.
      if (!ctx.issues.some((issue) => issue.path?.[0] === field)) {
        ctx.addIssue({ code: 'custom', path: [field], message });
      }
    }
  });
export type ItemInput = z.infer<typeof itemSchema>;

// PATCH /api/items/:id: any of the fields. The tracking type is fixed once the item exists (owner
// decision 2026-11-03), so sending it is refused.
export const itemUpdateSchema = z
  .object(itemFields)
  .partial()
  .extend({
    trackingType: z
      .never({ error: 'The tracking type cannot be changed after the item is created.' })
      .optional(),
  })
  .refine(...nothingToUpdate);
export type ItemUpdate = z.infer<typeof itemUpdateSchema>;

// GET /api/items?q=&categoryId=&status=&trackingType=&page=&pageSize=. q matches name or asset tag.
export const itemListQuerySchema = pageQuerySchema.extend({
  q: searchTextField.optional(),
  categoryId: z.guid().optional(),
  status: z.enum(ItemStatus).optional(),
  trackingType: z.enum(TrackingType).optional(),
});
export type ItemListQuery = z.infer<typeof itemListQuerySchema>;
