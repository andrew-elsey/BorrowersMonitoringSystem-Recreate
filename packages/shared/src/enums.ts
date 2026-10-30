// Enum values shared by api and web (ARCHITECTURE.md section 8).
// Mirrored in apps/api/prisma/schema.prisma; a test in apps/api checks the two stay equal.
// Each is a plain object plus a type of the same name, so it works both as a value and as a type.

export const Role = { ADMIN: 'ADMIN', HANDLER: 'HANDLER', VIEWER: 'VIEWER' } as const;
export type Role = (typeof Role)[keyof typeof Role];

export const BorrowerType = {
  STUDENT: 'STUDENT',
  FACULTY: 'FACULTY',
  EMPLOYEE: 'EMPLOYEE',
} as const;
export type BorrowerType = (typeof BorrowerType)[keyof typeof BorrowerType];

export const TrackingType = { UNIT: 'UNIT', QUANTITY: 'QUANTITY' } as const;
export type TrackingType = (typeof TrackingType)[keyof typeof TrackingType];

export const ItemCondition = {
  NEW: 'NEW',
  GOOD: 'GOOD',
  FAIR: 'FAIR',
  DAMAGED: 'DAMAGED',
} as const;
export type ItemCondition = (typeof ItemCondition)[keyof typeof ItemCondition];

export const ItemStatus = {
  ACTIVE: 'ACTIVE',
  UNDER_REPAIR: 'UNDER_REPAIR',
  LOST: 'LOST',
  RETIRED: 'RETIRED',
} as const;
export type ItemStatus = (typeof ItemStatus)[keyof typeof ItemStatus];

export const ReturnCondition = { GOOD: 'GOOD', FAIR: 'FAIR', DAMAGED: 'DAMAGED' } as const;
export type ReturnCondition = (typeof ReturnCondition)[keyof typeof ReturnCondition];

export const FlagStatus = { NONE: 'NONE', FLAGGED: 'FLAGGED', OVERRIDDEN: 'OVERRIDDEN' } as const;
export type FlagStatus = (typeof FlagStatus)[keyof typeof FlagStatus];
