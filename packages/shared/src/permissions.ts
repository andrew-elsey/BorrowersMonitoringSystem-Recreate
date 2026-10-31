import { Role } from './enums.ts';

const ALL_STAFF = [Role.ADMIN, Role.HANDLER, Role.VIEWER] as const;
const ADMIN_AND_HANDLER = [Role.ADMIN, Role.HANDLER] as const;
const ADMIN_ONLY = [Role.ADMIN] as const;

// The permission table in SPEC.md 3: which roles may use each capability.
// The api passes these to requireRole; the web uses them to hide navigation (FND-5).
export const PERMISSIONS = {
  checkoutAndReturn: ADMIN_AND_HANDLER,
  addLocationAtCheckout: ADMIN_AND_HANDLER,
  editLineNote: ADMIN_AND_HANDLER,
  viewDashboardAndReports: ALL_STAFF,
  manageMasterData: ADMIN_ONLY, // inventory, categories, borrowers, rooms
  manageUsers: ADMIN_ONLY,
  manageSettingsAndSemesters: ADMIN_ONLY,
  overrideFlags: ADMIN_ONLY,
  runFlaggingJob: ADMIN_ONLY,
  viewAuditLog: ADMIN_ONLY,
  changeOwnPassword: ALL_STAFF,
} as const satisfies Record<string, readonly Role[]>;
export type Permission = keyof typeof PERMISSIONS;
