import {
  borrowerListQuerySchema,
  borrowerLookupQuerySchema,
  borrowerSchema,
  borrowerUpdateSchema,
  PERMISSIONS,
} from '@bms/shared';
import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../lib/errors.ts';
import { requireRole } from '../middleware/auth.ts';
import { csvUpload } from '../middleware/csv-upload.ts';
import {
  createCsvImportRateLimiter,
  createSearchRateLimiter,
} from '../middleware/request-rate-limit.ts';
import { importBorrowerCsv } from '../services/borrower-import.ts';
import { borrowerService, createBorrower, updateBorrower } from '../services/borrowers.ts';
import { getStrikeStatus } from '../services/strikes.ts';

// HTTP only: parse, authorize, call the service (ARCHITECTURE.md 4). Rules live in services/borrowers.ts.
// z.guid, like BorrowerService.findById: any uuid PostgreSQL accepts.
const idParams = z.object({ id: z.guid() });

export function createBorrowersRouter() {
  const router = Router();

  // The checkout borrower search (BRW-3; SPEC.md 3: check out items). Registered before the admin
  // guard below, which would otherwise cover this path too. Inactive borrowers are included
  // (active: false); checkout refuses them (BR 3).
  router.get(
    '/borrowers/lookup',
    requireRole(...PERMISSIONS.checkoutAndReturn),
    async (req, res) => {
      const { q, page, pageSize } = borrowerLookupQuerySchema.parse(req.query);
      res.json(await borrowerService.list({ q, page, pageSize }));
    },
  );

  // Strikes and thresholds for the Checkout and Return screens (FLG-3, BR 11). One count query.
  router.get(
    '/borrowers/:id/strikes',
    requireRole(...PERMISSIONS.checkoutAndReturn),
    async (req, res) => {
      const { id } = idParams.parse(req.params);
      if (!(await borrowerService.findById(id))) {
        throw new ApiError(404, 'NOT_FOUND', 'Borrower not found.');
      }
      res.json(await getStrikeStatus(id));
    },
  );

  // Admins only (SPEC.md 3: manage borrowers).
  router.use('/borrowers', requireRole(...PERMISSIONS.manageMasterData));

  router.get('/borrowers', createSearchRateLimiter(), async (req, res) => {
    res.json(await borrowerService.list(borrowerListQuerySchema.parse(req.query)));
  });

  // MD-6: CSV import. The rate limit and the upload limits run before any parsing (SPEC.md 7).
  router.post('/borrowers/import', createCsvImportRateLimiter(), csvUpload, async (req, res) => {
    res.json(await importBorrowerCsv(req.session.userId!, req.file!.buffer));
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
