import { borrowerLookupQuerySchema, historyQuerySchema, PERMISSIONS } from '@bms/shared';
import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.ts';
import { createRequestLimiter, createSearchRateLimiter } from '../middleware/request-rate-limit.ts';
import { borrowerService } from '../services/borrowers.ts';
import { listBorrowerHistory } from '../services/history.ts';

// HTTP only: parse, authorize, call the service (ARCHITECTURE.md 4). Rules live in services/history.ts.
// Every role may read reports (SPEC.md 3).
const staff = requireRole(...PERMISSIONS.viewDashboardAndReports);
const idParams = z.object({ id: z.guid() });
// Reports are expensive endpoints: 30 a minute per IP (ARCHITECTURE.md 12.3).
const REPORT_REQUESTS_PER_MINUTE = 30;

export function createHistoryRouter() {
  const router = Router();
  const reportLimiter = createRequestLimiter(REPORT_REQUESTS_PER_MINUTE);

  // Picks the borrower for the history report. Its own path because view-only users may read reports
  // but not the checkout lookup (SPEC.md 3). Same bounds as that lookup: q required, 2 to 100 characters.
  router.get('/reports/borrowers', staff, createSearchRateLimiter(), async (req, res) => {
    const { q, page, pageSize } = borrowerLookupQuerySchema.parse(req.query);
    res.json(await borrowerService.list({ q, page, pageSize }));
  });

  router.get('/reports/borrowers/:id/history', staff, reportLimiter, async (req, res) => {
    const { id } = idParams.parse(req.params);
    res.json(await listBorrowerHistory(id, historyQuerySchema.parse(req.query)));
  });

  return router;
}
