import * as shared from '@bms/shared';
import { expect, test } from 'vitest';
import * as prismaEnums from '../src/generated/prisma/enums.ts';

// Enums are defined in packages/shared and mirrored in schema.prisma (ARCHITECTURE.md 8).
const enumNames = [
  'Role',
  'BorrowerType',
  'TrackingType',
  'ItemCondition',
  'ItemStatus',
  'ReturnCondition',
  'FlagStatus',
] as const;

test.each(enumNames)('%s matches between packages/shared and the Prisma schema', (name) => {
  expect(shared[name]).toEqual(prismaEnums[name]);
});
