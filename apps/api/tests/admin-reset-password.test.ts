import { beforeEach, expect, test } from 'vitest';
import { resetPassword, ResetPasswordError } from '../scripts/admin-reset-password.ts';
import { prisma } from '../src/lib/prisma.ts';
import { hashPassword, verifyPassword } from '../src/lib/password.ts';
import { resetDatabase } from './setup/reset-database.ts';

beforeEach(resetDatabase);

async function createUser(username: string, password: string) {
  return prisma.user.create({
    data: { name: username, username, passwordHash: await hashPassword(password), role: 'HANDLER' },
  });
}

test('resets any user password and audits it without the hash', async () => {
  const user = await createUser('handler', 'old-password');

  await resetPassword('handler', 'new-password');

  const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  expect(await verifyPassword(updated.passwordHash, 'new-password')).toBe(true);
  expect(await verifyPassword(updated.passwordHash, 'old-password')).toBe(false);

  const entry = await prisma.auditLog.findFirstOrThrow();
  expect(entry).toMatchObject({
    actorId: null,
    action: 'USER_PASSWORD_RESET',
    entity: 'user',
    entityId: user.id,
  });
  expect(JSON.stringify(entry)).not.toContain(updated.passwordHash);
});

test('rejects an unknown username', async () => {
  await expect(resetPassword('nobody', 'new-password')).rejects.toThrow(ResetPasswordError);
  expect(await prisma.auditLog.count()).toBe(0);
});

test('rejects a password shorter than 10 characters and keeps the old one', async () => {
  const user = await createUser('handler', 'old-password');

  await expect(resetPassword('handler', 'short')).rejects.toThrow(/at least 10 characters/);

  const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  expect(await verifyPassword(unchanged.passwordHash, 'old-password')).toBe(true);
});
