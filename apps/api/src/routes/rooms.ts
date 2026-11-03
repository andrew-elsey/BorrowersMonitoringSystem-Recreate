import { pageQuerySchema, PERMISSIONS, Role, roomSchema, roomUpdateSchema } from '@bms/shared';
import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.ts';
import { createRoom, deleteRoom, listRooms, updateRoom } from '../services/rooms.ts';

// HTTP only: parse, authorize, call the service (ARCHITECTURE.md 4). Rules live in services/rooms.ts.
// z.guid: any uuid PostgreSQL accepts.
const idParams = z.object({ id: z.guid() });
// Admins only (SPEC.md 3: manage rooms).
const admin = requireRole(...PERMISSIONS.manageMasterData);

export function createRoomsRouter() {
  const router = Router();

  // Admins see every room. Handlers need the list for the checkout room picker (SPEC.md 5) and
  // see only active rooms, whatever the query says.
  router.get('/rooms', requireRole(...PERMISSIONS.addLocationAtCheckout), async (req, res) => {
    const { page, pageSize } = pageQuerySchema.parse(req.query);
    res.json(await listRooms(page, pageSize, req.session.role !== Role.ADMIN));
  });

  // The quick-add endpoint: admins and handlers may add a room (SPEC.md 3: add a room or lab at
  // checkout). The Rooms and labs screen uses it too.
  router.post('/rooms', requireRole(...PERMISSIONS.addLocationAtCheckout), async (req, res) => {
    const { name } = roomSchema.parse(req.body);
    res
      .status(201)
      .json({ room: await createRoom(req.session.userId!, name, req.session.role === Role.ADMIN) });
  });

  // Rename, deactivate, or reactivate (BR 15).
  router.patch('/rooms/:id', admin, async (req, res) => {
    const { id } = idParams.parse(req.params);
    const changes = roomUpdateSchema.parse(req.body);
    res.json({ room: await updateRoom(req.session.userId!, id, changes) });
  });

  // Only a room no transaction uses can be deleted (BR 15).
  router.delete('/rooms/:id', admin, async (req, res) => {
    const { id } = idParams.parse(req.params);
    await deleteRoom(req.session.userId!, id);
    res.status(204).end();
  });

  return router;
}
