import { PERMISSIONS } from '@bms/shared';
import { Router } from 'express';
import { runFlagging } from '../jobs/flagging.ts';
import { requireRole } from '../middleware/auth.ts';
import { createFlaggingRunRateLimiter } from '../middleware/request-rate-limit.ts';

export function createFlaggingRouter() {
  const router = Router();

  // Admin only, once a minute (SPEC.md 3, ARCHITECTURE.md 12.5). Role check first, so refused
  // callers do not use up the minute.
  router.post(
    '/flagging/run',
    requireRole(...PERMISSIONS.runFlaggingJob),
    createFlaggingRunRateLimiter(),
    async (req, res) => {
      res.json({ run: await runFlagging(new Date(), req.session.userId!) });
    },
  );

  return router;
}
