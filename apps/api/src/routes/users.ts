import {
  pageQuerySchema,
  PERMISSIONS,
  resetPasswordSchema,
  userSchema,
  userUpdateSchema,
} from '@bms/shared';
import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.ts';
import { createUser, listUsers, resetUserPassword, updateUser } from '../services/users.ts';

// HTTP only: parse, authorize, call the service (ARCHITECTURE.md 4). Rules live in services/users.ts.
// Lowered, so the self-deactivation check sees the same id in any case.
const idParams = z.object({ id: z.guid().transform((id) => id.toLowerCase()) });

export function createUsersRouter() {
  const router = Router();
  // Every route here is admin only (SPEC.md 3: manage users).
  router.use('/users', requireRole(...PERMISSIONS.manageUsers));

  router.get('/users', async (req, res) => {
    const { page, pageSize } = pageQuerySchema.parse(req.query);
    res.json(await listUsers(page, pageSize));
  });

  router.post('/users', async (req, res) => {
    const input = userSchema.parse(req.body);
    res.status(201).json({ user: await createUser(req.session.userId!, input) });
  });

  // Edit, deactivate, or reactivate. There is no DELETE: users are never deleted (BR 15).
  router.patch('/users/:id', async (req, res) => {
    const { id } = idParams.parse(req.params);
    const changes = userUpdateSchema.parse(req.body);
    res.json({ user: await updateUser(req.session.userId!, id, changes) });
  });

  router.put('/users/:id/password', async (req, res) => {
    const { id } = idParams.parse(req.params);
    const { password } = resetPasswordSchema.parse(req.body);
    await resetUserPassword(req.session.userId!, req.sessionID, id, password);
    res.status(204).end();
  });

  return router;
}
