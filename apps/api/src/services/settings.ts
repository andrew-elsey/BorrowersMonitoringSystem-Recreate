import type { Settings, SettingsInput } from '@bms/shared';
import type { Prisma } from '../generated/prisma/client.ts';
import { audit } from '../lib/audit.ts';
import { config } from '../lib/config.ts';
import { prisma } from '../lib/prisma.ts';

// Settings (MD-7): closing time and strike thresholds, one row with id 1 created by the seed.
// Admin only to change; the route checks the role.

const SETTINGS_ID = 1;

const settingFields = {
  closingTime: true,
  warningThreshold: true,
  noticeThreshold: true,
  blockThreshold: true,
} as const;

// CLAUDE.md rule 3: closing time and thresholds always come from here. Nothing caches them, so
// checkout (BRW-2, FLG-3) and the flagging job (FLG-2) see a change on their next read.
export async function getSettings(db: Prisma.TransactionClient = prisma): Promise<Settings> {
  const row = await db.setting.findUniqueOrThrow({
    where: { id: SETTINGS_ID },
    select: settingFields,
  });
  return { ...row, timezone: config.timezone };
}

export async function updateSettings(actorId: string, input: SettingsInput): Promise<Settings> {
  return prisma.$transaction(async (tx) => {
    // Lock the row so two saves at once take turns and each audit entry has the true "before".
    await tx.$queryRaw`SELECT 1 FROM settings WHERE id = ${SETTINGS_ID} FOR UPDATE`;
    const before = await tx.setting.findUniqueOrThrow({
      where: { id: SETTINGS_ID },
      select: settingFields,
    });
    const after = { ...before, ...input };
    // Nothing changed: nothing is written or audited.
    if (JSON.stringify(before) === JSON.stringify(after))
      return { ...after, timezone: config.timezone };
    await tx.setting.update({ where: { id: SETTINGS_ID }, data: after });
    // Rule 14
    await audit(tx, {
      actorId,
      action: 'SETTINGS_UPDATED',
      entity: 'setting',
      entityId: String(SETTINGS_ID),
      before,
      after,
    });
    return { ...after, timezone: config.timezone };
  });
}
