import { itemListQuerySchema, itemSchema, itemUpdateSchema, PERMISSIONS } from '@bms/shared';
import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.ts';
import { createItem, deleteItem, listItems, updateItem } from '../services/items.ts';

// HTTP only: parse, authorize, call the service (ARCHITECTURE.md 4). Rules live in services/items.ts.
// z.guid: any uuid PostgreSQL accepts.
const idParams = z.object({ id: z.guid() });
// Admins only (SPEC.md 3: manage inventory).
const admin = requireRole(...PERMISSIONS.manageMasterData);

export function createItemsRouter() {
  const router = Router();

  // Every signed-in staff member can look items up (owner decision 2026-11-03).
  router.get('/items', requireRole(...PERMISSIONS.viewDashboardAndReports), async (req, res) => {
    res.json(await listItems(itemListQuerySchema.parse(req.query)));
  });

  router.post('/items', admin, async (req, res) => {
    const input = itemSchema.parse(req.body);
    res.status(201).json({ item: await createItem(req.session.userId!, input) });
  });

  // Edit, including retiring (status RETIRED, BR 15).
  router.patch('/items/:id', admin, async (req, res) => {
    const { id } = idParams.parse(req.params);
    const changes = itemUpdateSchema.parse(req.body);
    res.json({ item: await updateItem(req.session.userId!, id, changes) });
  });

  // Only an item with no history can be deleted (BR 15, S19).
  router.delete('/items/:id', admin, async (req, res) => {
    const { id } = idParams.parse(req.params);
    await deleteItem(req.session.userId!, id);
    res.status(204).end();
  });

  return router;
}
