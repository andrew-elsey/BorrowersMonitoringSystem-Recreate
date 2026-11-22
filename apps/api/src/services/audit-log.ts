import type { AuditPage, AuditQuery } from '@bms/shared';
import type { Prisma } from '../generated/prisma/client.ts';
import { prisma } from '../lib/prisma.ts';
import { issuedBetween } from './history.ts';

// Audit log viewer (HRD-1, BR 14): read-only, newest first, paginated. The date range (at most
// 366 days, SPEC.md 7) is checked by auditQuerySchema. Reads audit_log only, never the borrowers table.
export async function listAuditLog(query: AuditQuery): Promise<AuditPage> {
  const { from, to, entity, actor, page, pageSize } = query;
  const where: Prisma.AuditLogWhereInput = {
    createdAt: issuedBetween(from, to), // calendar days in the app timezone (CLAUDE.md rule 4)
    ...(entity && { entity }),
    // "system" is an entry with no actor
    ...(actor && { actorId: actor === 'system' ? null : actor }),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      include: { actor: { select: { id: true, name: true } } },
      omit: { actorId: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);
  const data = rows.map(({ createdAt, ...row }) => ({
    ...row,
    createdAt: createdAt.toISOString(),
  }));
  return { data, page, pageSize, total };
}
