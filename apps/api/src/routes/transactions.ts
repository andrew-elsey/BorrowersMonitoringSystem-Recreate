import { checkoutSchema, PERMISSIONS, returnSchema } from '@bms/shared';
import { Router } from 'express';
import { requireRole } from '../middleware/auth.ts';
import { checkout } from '../services/checkout.ts';
import { recordReturn } from '../services/returns.ts';

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

  return router;
}
