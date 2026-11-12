import { PERMISSIONS, usageQuerySchema } from '@bms/shared';
import { Router } from 'express';
import { requireRole } from '../middleware/auth.ts';
import { createReportRateLimiter } from '../middleware/request-rate-limit.ts';
import { getUsageSummary } from '../services/usage.ts';

// HTTP only: parse, authorize, call the service (ARCHITECTURE.md 4). All staff (SPEC.md 3).
export function createUsageReportRouter() {
  const router = Router();

  router.get(
    '/reports/usage',
    requireRole(...PERMISSIONS.viewDashboardAndReports),
    createReportRateLimiter(),
    async (req, res) => {
      res.json(await getUsageSummary(usageQuerySchema.parse(req.query)));
    },
  );

  return router;
}
