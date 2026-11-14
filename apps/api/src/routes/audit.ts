import { auditQuerySchema, PERMISSIONS } from '@bms/shared';
import { type RequestHandler, Router } from 'express';
import { requireRole } from '../middleware/auth.ts';
import { listAuditLog } from '../services/audit-log.ts';

// HTTP only (ARCHITECTURE.md 4). Admin only (SPEC.md 3). The role check runs before the shared
// reports limit (ARCHITECTURE.md 12.3), so a refused user does not use up the limit.
export function createAuditRouter(reportLimiter: RequestHandler) {
  const router = Router();

  router.get(
    '/audit',
    requireRole(...PERMISSIONS.viewAuditLog),
    reportLimiter,
    async (req, res) => {
      res.json(await listAuditLog(auditQuerySchema.parse(req.query)));
    },
  );

  return router;
}
