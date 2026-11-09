import { flagListQuerySchema, overrideSchema, PERMISSIONS } from '@bms/shared';
import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.ts';
import { listFlaggedLines, overrideFlag } from '../services/flags.ts';

// HTTP only: parse, authorize, call the service (ARCHITECTURE.md 4). Rules live in services/flags.ts.
// Admins only (SPEC.md 3: override flags).
const admin = requireRole(...PERMISSIONS.overrideFlags);
const idParams = z.object({ id: z.guid().toLowerCase() });

export function createFlagsRouter() {
  const router = Router();

  router.get('/flags', admin, async (req, res) => {
    res.json(await listFlaggedLines(flagListQuerySchema.parse(req.query)));
  });

  router.post('/flags/:id/override', admin, async (req, res) => {
    const { id } = idParams.parse(req.params);
    const input = overrideSchema.parse(req.body);
    res.json({ line: await overrideFlag(req.session.userId!, id, input) });
  });

  return router;
}
