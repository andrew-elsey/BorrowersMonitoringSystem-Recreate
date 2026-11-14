import type { Room, RoomOption, RoomPage, RoomUpdate } from '@bms/shared';
import { audit } from '../lib/audit.ts';
import { ApiError, isPrismaError } from '../lib/errors.ts';
import { prisma } from '../lib/prisma.ts';

// Rooms and labs (MD-3), stored in the locations table. Admins manage them; admins and handlers
// can add one, and handlers can list active rooms for the checkout picker (SPEC.md 3). The routes
// check the role and pass `activeOnly` to listRooms.

const roomFields = {
  id: true,
  name: true,
  active: true,
  createdBy: { select: { id: true, name: true } },
  createdAt: true,
  _count: { select: { transactions: true } },
} as const;

type RoomRow = {
  id: string;
  name: string;
  active: boolean;
  createdBy: { id: string; name: string };
  createdAt: Date;
  _count: { transactions: number };
};

function toRoom({ _count, createdAt, ...rest }: RoomRow): Room {
  return { ...rest, createdAt: createdAt.toISOString(), transactionCount: _count.transactions };
}

const notFound = () => new ApiError(404, 'NOT_FOUND', 'Room not found.');

// Names are unique regardless of case (SPEC.md 4, index on lower(name)). The message names the
// room that already exists, as typed when it was added, so "cl-201" reports "CL-201".
// An inactive match gets a message saying what to do: only admins can reactivate (owner decision
// 2026-11-03). The unique index still enforces the rule; this lookup only words the message.
// Reported as a field error, so the form shows it under the name.
async function duplicateName(name: string, byAdmin: boolean): Promise<ApiError> {
  const [existing] = await prisma.$queryRaw<{ name: string; active: boolean }[]>`
    SELECT name, active FROM locations WHERE lower(name) = lower(${name})`;
  const stored = `"${existing?.name ?? name}"`;
  const message =
    existing?.active === false
      ? byAdmin
        ? `${stored} exists but is inactive. Reactivate it instead.`
        : `${stored} exists but is inactive. Ask an admin to reactivate it, or choose another room.`
      : `${stored} already exists. Names are compared without regard to case.`;
  return new ApiError(409, 'DUPLICATE_VALUE', message, { fields: { name: [message] } });
}

export async function listRooms(
  page: number,
  pageSize: number,
  activeOnly: boolean,
): Promise<Omit<RoomPage, 'data'> & { data: Room[] | RoomOption[] }> {
  const where = activeOnly ? { active: true } : {};
  const [rows, total] = await prisma.$transaction([
    prisma.location.findMany({
      where,
      select: roomFields,
      orderBy: { name: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.location.count({ where }),
  ]);
  const rooms = rows.map(toRoom);
  // Handlers only need the checkout picker: id and name, no creator or counts.
  const data: Room[] | RoomOption[] = activeOnly
    ? rooms.map(({ id, name }) => ({ id, name }))
    : rooms;
  return { data, page, pageSize, total };
}

// Used by the admin screen and by handlers adding a room at checkout. created_by is the signed-in
// user, never typed.
export async function createRoom(actorId: string, name: string, byAdmin: boolean): Promise<Room> {
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.location.create({
        data: { name, createdById: actorId },
        select: roomFields,
      });
      // Rule 14
      await audit(tx, {
        actorId,
        action: 'LOCATION_CREATED',
        entity: 'location',
        entityId: row.id,
        after: { name, active: true },
      });
      return toRoom(row);
    });
  } catch (error) {
    if (isPrismaError(error, 'P2002')) throw await duplicateName(name, byAdmin);
    throw error;
  }
}

export async function updateRoom(actorId: string, id: string, changes: RoomUpdate): Promise<Room> {
  try {
    return await prisma.$transaction(async (tx) => {
      // Lock the row first, so two edits at once take turns and each audit entry records the
      // values its change really replaced (rule 14).
      await tx.$queryRaw`SELECT 1 FROM locations WHERE id = ${id}::uuid FOR UPDATE`;
      const before = await tx.location.findUnique({ where: { id }, select: roomFields });
      if (!before) throw notFound();
      const changedKeys = (Object.keys(changes) as (keyof RoomUpdate)[]).filter(
        (key) => changes[key] !== before[key],
      );
      // Nothing differs: nothing is written or audited.
      if (changedKeys.length === 0) return toRoom(before);
      const pick = (source: RoomUpdate) =>
        Object.fromEntries(changedKeys.map((key) => [key, source[key]]));
      const row = await tx.location.update({
        where: { id },
        data: pick(changes),
        select: roomFields,
      });
      // Rule 14: the changed fields, before and after.
      await audit(tx, {
        actorId,
        action: 'LOCATION_UPDATED',
        entity: 'location',
        entityId: id,
        before: pick(before),
        after: pick(changes),
      });
      return toRoom(row);
    });
  } catch (error) {
    if (isPrismaError(error, 'P2002')) throw await duplicateName(changes.name ?? '', true); // admin only
    throw error;
  }
}

export async function deleteRoom(actorId: string, id: string): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.location.findUnique({ where: { id }, select: roomFields });
      if (!before) throw notFound();
      // Rule 15: a room any transaction uses is deactivated, never deleted. The transactions
      // foreign key (ON DELETE RESTRICT) refuses it, which also covers a checkout at the same moment.
      await tx.location.delete({ where: { id } });
      // Rule 14
      await audit(tx, {
        actorId,
        action: 'LOCATION_DELETED',
        entity: 'location',
        entityId: id,
        before: { name: before.name, active: before.active },
      });
    });
  } catch (error) {
    if (isPrismaError(error, 'P2003')) {
      throw new ApiError(
        409,
        'HAS_HISTORY',
        'This room is used in transactions, so it cannot be deleted. Deactivate it instead.',
      );
    }
    throw error;
  }
}
