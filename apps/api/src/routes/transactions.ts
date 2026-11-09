import { checkoutSchema, openLinesQuerySchema, PERMISSIONS, returnSchema } from '@bms/shared';
import { Router } from 'express';
import { requireRole } from '../middleware/auth.ts';
import { checkout } from '../services/checkout.ts';
import { listOpenLines, recordReturn } from '../services/returns.ts';

// HTTP only: parse, authorize, call the service (ARCHITECTURE.md 4). Rules live in
// services/checkout.ts and services/returns.ts.

export function createTransactionsRouter() {
  const router = Router();

  // Admins and handlers check items out (SPEC.md 3). BR 2: the issuing handler is the signed-in user.
  router.post('/transactions', requireRole(...PERMISSIONS.checkoutAndReturn), async (req, res) => {
    const input = checkoutSchema.parse(req.body);
    res.status(201).json({ transaction: await checkout(req.session.userId!, input) });
  });

  // Admins and handlers record returns (SPEC.md 3). BR 5: the receiving handler is the signed-in user.
  router.post('/returns', requireRole(...PERMISSIONS.checkoutAndReturn), async (req, res) => {
    const input = returnSchema.parse(req.body);
    res.status(201).json({ returns: await recordReturn(req.session.userId!, input) });
  });

  // The Return screen's search (BRW-5). Not under the search rate limit, like the checkout borrower
  // lookup (owner decision 2026-11-07): staff type it live; the global limit and nginx still apply.
  router.get('/returns/open', requireRole(...PERMISSIONS.checkoutAndReturn), async (req, res) => {
    res.json(await listOpenLines(openLinesQuerySchema.parse(req.query)));
  });

  return router;
}
