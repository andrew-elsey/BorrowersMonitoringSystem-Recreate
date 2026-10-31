import { changePasswordSchema, loginSchema, PERMISSIONS, Role } from '@bms/shared';
import { Router } from 'express';
import { ApiError } from '../lib/errors.ts';
import { SESSION_COOKIE_NAME } from '../lib/session.ts';
import { requireRole } from '../middleware/auth.ts';
import { createLoginRateLimiters } from '../middleware/login-rate-limit.ts';
import { authenticate, changePassword, getSignedInUser } from '../services/auth.ts';

const ALL_ROLES = Object.values(Role);

export function createAuthRouter() {
  const router = Router();

  // Rate limiters run first, so a throttled client never reaches password hashing (ARCHITECTURE.md 12.4).
  router.post('/auth/login', ...createLoginRateLimiters(), async (req, res) => {
    const { username, password } = loginSchema.parse(req.body);
    const user = await authenticate(username, password);
    if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'Incorrect username or password.');

    // A fresh session ID at login, so an ID planted before login is worthless (session fixation).
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((error) => (error ? reject(error) : resolve())),
    );
    req.session.userId = user.id;
    req.session.role = user.role;
    res.json({ user });
  });

  router.post('/auth/logout', async (req, res) => {
    await new Promise<void>((resolve, reject) =>
      req.session.destroy((error) => (error ? reject(error) : resolve())),
    );
    res.clearCookie(SESSION_COOKIE_NAME);
    res.status(204).end();
  });

  // Lets the web app restore the signed-in user after a reload (AUTH-4). Same `{ user }` shape as login.
  router.get('/auth/me', requireRole(...ALL_ROLES), async (req, res) => {
    const user = await getSignedInUser(req.session.userId!);
    if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in.');
    res.json({ user });
  });

  // shortcut: no rate limit of its own (signed-in staff only, still behind the hash limiter); add one in SEC-1 if staff accounts are shared or exposed.
  router.put('/auth/password', requireRole(...PERMISSIONS.changeOwnPassword), async (req, res) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    await changePassword(req.session.userId!, currentPassword, newPassword);
    res.status(204).end();
  });

  return router;
}
