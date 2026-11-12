import { pageQuerySchema, PERMISSIONS } from '@bms/shared';
import { Router } from 'express';
import { requireRole } from '../middleware/auth.ts';
import { listFlaggedBorrowers } from '../services/dashboard.ts';
import { listOpenLines } from '../services/returns.ts';

// HTTP only: parse, authorize, call the service (ARCHITECTURE.md 4). The dashboard (RPT-1) is for
// every role (SPEC.md 3). Both lists are paged (at most 100 rows, SPEC 7).
const allStaff = requireRole(...PERMISSIONS.viewDashboardAndReports);

export function createDashboardRouter() {
  const router = Router();

  // Currently unreturned: every line with something still out, the same rows as the Return screen.
  router.get('/dashboard/unreturned', allStaff, async (req, res) => {
    const { page, pageSize } = pageQuerySchema.parse(req.query);
    res.json(await listOpenLines({ by: 'borrower', page, pageSize }));
  });

  router.get('/dashboard/flagged-borrowers', allStaff, async (req, res) => {
    res.json(await listFlaggedBorrowers(pageQuerySchema.parse(req.query)));
  });

  return router;
}
