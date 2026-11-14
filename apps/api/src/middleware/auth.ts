import type { Role } from '@bms/shared';
import type { RequestHandler } from 'express';
import { ApiError } from '../lib/errors.ts';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// CSRF protection (ARCHITECTURE.md 5): SameSite=Lax cookies plus this header on every state-changing
// request. A cross-site form cannot set custom headers, so it cannot pass this check.
export const requireFetchHeader: RequestHandler = (req, _res, next) => {
  if (STATE_CHANGING_METHODS.has(req.method) && req.get('X-Requested-With') !== 'fetch') {
    throw new ApiError(403, 'FORBIDDEN', 'Missing the X-Requested-With: fetch header.');
  }
  next();
};

// Goes on every signed-in route: rejects signed-out requests (401) and roles not listed (403)
// before any other database work (ARCHITECTURE.md 5, 12.3). Pass an entry of PERMISSIONS
// (SPEC.md 3), e.g. requireRole(...PERMISSIONS.overrideFlags).
// Trusts the role stored in the session at login. That stays true: deactivating a user or changing
// their role signs them out everywhere (services/users.ts, AUTH-3).
export function requireRole(...roles: readonly Role[]): RequestHandler {
  return (req, _res, next) => {
    const { userId, role } = req.session;
    if (!userId) throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in.');
    if (!role || !roles.includes(role)) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to do this.');
    }
    next();
  };
}
