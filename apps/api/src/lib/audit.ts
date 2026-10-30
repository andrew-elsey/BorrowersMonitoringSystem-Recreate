import type { Prisma } from '../generated/prisma/client.ts';

export type AuditEntry = {
  // The signed-in user who made the change, or null for system actions (the flagging job).
  actorId: string | null;
  // What happened, for example 'CHECKOUT' or 'ITEM_UPDATED'.
  action: string;
  // Which kind of record changed, for example 'transaction' or 'item'.
  entity: string;
  entityId: string;
  // The record before and after the change. Leave out what does not apply (no `before` on create).
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
};

// Rule 14: every state change writes an audit entry in the same database transaction as the change.
// Always pass the transaction client (`tx`) from prisma.$transaction, so the entry is rolled back
// together with the change if anything fails.
export async function audit(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({ data: entry });
}
