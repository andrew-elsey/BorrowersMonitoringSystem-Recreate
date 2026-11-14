import { PERMISSIONS, usageQuerySchema } from '@bms/shared';
import { type RequestHandler, Router } from 'express';
import { requireRole } from '../middleware/auth.ts';
import { getUsageSummary } from '../services/usage.ts';

// HTTP only: parse, authorize, call the service (ARCHITECTURE.md 4). All staff (SPEC.md 3).
// reportLimiter is the shared reports limit from app.ts (ARCHITECTURE.md 12.3).
export function createUsageReportRouter(reportLimiter: RequestHandler) {
  const router = Router();

  router.get(
    '/reports/usage',
    requireRole(...PERMISSIONS.viewDashboardAndReports),
    reportLimiter,
    async (req, res) => {
      res.json(await getUsageSummary(usageQuerySchema.parse(req.query)));
    },
  );

  return router;
}
