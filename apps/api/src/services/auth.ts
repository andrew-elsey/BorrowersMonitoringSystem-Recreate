import { randomUUID } from 'node:crypto';
import type { Role } from '@bms/shared';
import { audit } from '../lib/audit.ts';
import { ApiError } from '../lib/errors.ts';
import { hashPassword, verifyPassword } from '../lib/password.ts';
import { prisma } from '../lib/prisma.ts';

export type SignedInUser = { id: string; name: string; username: string; role: Role };

// A hash of a random password nobody knows, verified when the username does not exist, so an
// unknown username costs the same as a wrong password (ARCHITECTURE.md 12.4). Made once, on first use.
let dummyHash: Promise<string> | undefined;

function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomUUID()).catch((error: unknown) => {
    dummyHash = undefined; // try again next time, for example after SERVER_BUSY
    throw error;
  });
  return dummyHash;
}

// Returns the user when the username and password match an active account, otherwise null.
// Callers must give the same generic error for every null, so nobody learns which part was wrong.
export async function authenticate(
  username: string,
  password: string,
): Promise<SignedInUser | null> {
  const user = await prisma.user.findUnique({ where: { username } });
  // Always run exactly one verify through the limiter, whether or not the user exists.
  const passwordMatches = await verifyPassword(
    user?.passwordHash ?? (await getDummyHash()),
    password,
  );
  // Inactive users cannot sign in. Checked after the verify so timing does not reveal it either.
  if (!user || !user.active || !passwordMatches) return null;
  return { id: user.id, name: user.name, username: user.username, role: user.role };
}

// The user behind a session, or null when the account is gone or deactivated.
export async function getSignedInUser(userId: string): Promise<SignedInUser | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.active) return null;
  return { id: user.id, name: user.name, username: user.username, role: user.role };
}

// shortcut: the user's other sessions stay signed in after a password change; sign them out when AUTH-3 adds session revocation.
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.active) throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in.');

  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'The current password is incorrect.', {
      fields: { currentPassword: ['The current password is incorrect.'] },
    });
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    // Rule 14. The hash is never written to the audit log.
    await audit(tx, {
      actorId: userId,
      action: 'USER_PASSWORD_CHANGED',
      entity: 'user',
      entityId: userId,
    });
  });
}
