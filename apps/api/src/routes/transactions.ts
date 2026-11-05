import { checkoutSchema, PERMISSIONS } from '@bms/shared';
import { Router } from 'express';
import { requireRole } from '../middleware/auth.ts';
import { checkout } from '../services/checkout.ts';

// HTTP only: parse, authorize, call the service (ARCHITECTURE.md 4). Rules live in services/checkout.ts.

export function createTransactionsRouter() {
  const router = Router();

  // Admins and handlers check items out (SPEC.md 3). BR 2: the issuing handler is the signed-in user.
  router.post('/transactions', requireRole(...PERMISSIONS.checkoutAndReturn), async (req, res) => {
    const input = checkoutSchema.parse(req.body);
    res.status(201).json({ transaction: await checkout(req.session.userId!, input) });
  });

  return router;
}
