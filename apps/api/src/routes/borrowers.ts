import {
  borrowerListQuerySchema,
  borrowerSchema,
  borrowerUpdateSchema,
  PERMISSIONS,
} from '@bms/shared';
import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.ts';
import { createSearchRateLimiter } from '../middleware/request-rate-limit.ts';
import { borrowerService, createBorrower, updateBorrower } from '../services/borrowers.ts';

// HTTP only: parse, authorize, call the service (ARCHITECTURE.md 4). Rules live in services/borrowers.ts.
// z.guid, like BorrowerService.findById: any uuid PostgreSQL accepts.
const idParams = z.object({ id: z.guid() });

export function createBorrowersRouter() {
  const router = Router();
  // Admins only (SPEC.md 3: manage borrowers).
  router.use('/borrowers', requireRole(...PERMISSIONS.manageMasterData));

  router.get('/borrowers', createSearchRateLimiter(), async (req, res) => {
    res.json(await borrowerService.list(borrowerListQuerySchema.parse(req.query)));
  });

  router.post('/borrowers', async (req, res) => {
    const input = borrowerSchema.parse(req.body);
    res.status(201).json({ borrower: await createBorrower(req.session.userId!, input) });
  });

  // Edit, deactivate, or reactivate. There is no DELETE: borrowers are never deleted (BR 15).
  router.patch('/borrowers/:id', async (req, res) => {
    const { id } = idParams.parse(req.params);
    const changes = borrowerUpdateSchema.parse(req.body);
    res.json({ borrower: await updateBorrower(req.session.userId!, id, changes) });
  });

  return router;
}
