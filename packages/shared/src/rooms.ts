import { z } from 'zod';
import { textField } from './categories.ts';

// Rooms and labs (MD-3, SPEC.md 4: the locations table). Names are unique regardless of case; the
// API answers DUPLICATE_VALUE.
export const roomSchema = z.object({ name: textField('Enter a room or lab name.') });
export type RoomInput = z.infer<typeof roomSchema>;

// Edit body: a new name, or active to deactivate or reactivate (BR 15).
export const roomUpdateSchema = roomSchema.extend({ active: z.boolean() }).partial();
export type RoomUpdate = z.infer<typeof roomUpdateSchema>;

// One room as the API returns it. createdAt is an ISO 8601 string in UTC. transactionCount > 0
// means the room is part of history, so it can only be deactivated (BR 15).
export type Room = {
  id: string;
  name: string;
  active: boolean;
  createdBy: { id: string; name: string };
  createdAt: string;
  transactionCount: number;
};
export type RoomPage = { data: Room[]; page: number; pageSize: number; total: number };
