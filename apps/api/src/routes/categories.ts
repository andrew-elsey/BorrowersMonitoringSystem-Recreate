import { categorySchema, pageQuerySchema, PERMISSIONS } from '@bms/shared';
import { Router } from 'express';
import { z } from 'zod';
import {
  createCategory,
  deleteCategory,
  listCategories,
  renameCategory,
} from '../services/categories.ts';
import { requireRole } from '../middleware/auth.ts';

// HTTP only: parse, authorize, call the service (ARCHITECTURE.md 4). Rules live in services/categories.ts.
// A bad id would make PostgreSQL reject the uuid, so it is checked first.
const idParams = z.object({ id: z.uuid() });

export function createCategoriesRouter() {
  const router = Router();
  // Admins only (SPEC.md 3: manage inventory and categories).
  router.use('/categories', requireRole(...PERMISSIONS.manageMasterData));

  router.get('/categories', async (req, res) => {
    const { page, pageSize } = pageQuerySchema.parse(req.query);
    res.json(await listCategories(page, pageSize));
  });

  router.post('/categories', async (req, res) => {
    const { name } = categorySchema.parse(req.body);
    res.status(201).json({ category: await createCategory(req.session.userId!, name) });
  });

  router.put('/categories/:id', async (req, res) => {
    const { id } = idParams.parse(req.params);
    const { name } = categorySchema.parse(req.body);
    res.json({ category: await renameCategory(req.session.userId!, id, name) });
  });

  router.delete('/categories/:id', async (req, res) => {
    const { id } = idParams.parse(req.params);
    await deleteCategory(req.session.userId!, id);
    res.status(204).end();
  });

  return router;
}
