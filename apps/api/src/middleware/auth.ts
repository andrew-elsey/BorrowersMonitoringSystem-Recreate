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

// Rejects requests without a signed-in session before any other database work (ARCHITECTURE.md 12.3).
export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.session.userId) throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in.');
  next();
};
