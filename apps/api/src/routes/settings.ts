import { pageQuerySchema, PERMISSIONS, semesterSchema, settingsSchema } from '@bms/shared';
import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.ts';
import {
  createSemester,
  listSemesters,
  setCurrentSemester,
  updateSemester,
} from '../services/semesters.ts';
import { rescheduleFlagging } from '../jobs/flagging.ts';
import { getSettings, updateSettings } from '../services/settings.ts';

// HTTP only: parse, authorize, call the service (ARCHITECTURE.md 4). Rules live in
// services/settings.ts and services/semesters.ts. There is no delete: semesters keep history (BR 15).
// z.guid: any uuid PostgreSQL accepts.
const idParams = z.object({ id: z.guid() });

export function createSettingsRouter() {
  const router = Router();

  // The closing time, read-only, for all staff (BRW-3): the checkout screen shows when items are
  // due back (CLAUDE.md rule 3: never hardcoded). Changing it stays admin only (PUT /settings).
  router.get(
    '/closing-time',
    requireRole(...PERMISSIONS.viewDashboardAndReports),
    async (_req, res) => {
      res.json({ closingTime: (await getSettings()).closingTime });
    },
  );

  // Admins only (SPEC.md 3: manage settings and semesters).
  router.use(['/settings', '/semesters'], requireRole(...PERMISSIONS.manageSettingsAndSemesters));

  router.get('/settings', async (_req, res) => {
    res.json({ settings: await getSettings() });
  });

  router.put('/settings', async (req, res) => {
    const input = settingsSchema.parse(req.body);
    const settings = await updateSettings(req.session.userId!, input);
    await rescheduleFlagging();
    res.json({ settings });
  });

  router.get('/semesters', async (req, res) => {
    const { page, pageSize } = pageQuerySchema.parse(req.query);
    res.json(await listSemesters(page, pageSize));
  });

  router.post('/semesters', async (req, res) => {
    const input = semesterSchema.parse(req.body);
    res.status(201).json({ semester: await createSemester(req.session.userId!, input) });
  });

  router.put('/semesters/:id', async (req, res) => {
    const { id } = idParams.parse(req.params);
    const input = semesterSchema.parse(req.body);
    res.json({ semester: await updateSemester(req.session.userId!, id, input) });
  });

  router.post('/semesters/:id/current', async (req, res) => {
    const { id } = idParams.parse(req.params);
    res.json({ semester: await setCurrentSemester(req.session.userId!, id) });
  });

  return router;
}
