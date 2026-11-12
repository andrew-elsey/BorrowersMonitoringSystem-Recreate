import type { User, UserInput, UserPage, UserUpdate } from '@bms/shared';
import type { Prisma } from '../generated/prisma/client.ts';
import { audit } from '../lib/audit.ts';
import { ApiError, isPrismaError } from '../lib/errors.ts';
import { hashPassword } from '../lib/password.ts';
import { prisma } from '../lib/prisma.ts';

// User management (AUTH-3, SPEC.md 3: admins only; the route checks the role). Users are
// deactivated, never deleted (BR 15), so there is no delete. The password hash is never returned
// or written to the audit log.

const userFields = { id: true, name: true, username: true, role: true, active: true } as const;

const notFound = () => new ApiError(404, 'NOT_FOUND', 'User not found.');

function duplicateUsername(username: string): ApiError {
  const message = `The username "${username}" is already taken.`;
  return new ApiError(409, 'DUPLICATE_VALUE', message, { fields: { username: [message] } });
}

// Signs the user out everywhere: their session rows are deleted, so their next request is 401.
// Sessions store the user id inside the JSON `data` column (lib/session.ts).
async function signOutEverywhere(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$executeRaw`DELETE FROM session WHERE data::jsonb ->> 'userId' = ${userId}`;
}

export async function listUsers(page: number, pageSize: number): Promise<UserPage> {
  const [data, total] = await prisma.$transaction([
    prisma.user.findMany({
      select: userFields,
      orderBy: [{ name: 'asc' }, { username: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.user.count(),
  ]);
  return { data, page, pageSize, total };
}

export async function createUser(actorId: string, input: UserInput): Promise<User> {
  const { password, ...fields } = input;
  // Through the hashing limiter (CLAUDE.md rule 11), before the transaction so no row lock waits on it.
  const passwordHash = await hashPassword(password);
  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { ...fields, passwordHash },
        select: userFields,
      });
      // Rule 14
      await audit(tx, {
        actorId,
        action: 'USER_CREATED',
        entity: 'user',
        entityId: user.id,
        after: { ...fields, active: user.active },
      });
      return user;
    });
  } catch (error) {
    if (isPrismaError(error, 'P2002')) throw duplicateUsername(fields.username);
    throw error;
  }
}

// Edits fields, and deactivates or reactivates (BR 15).
export async function updateUser(actorId: string, id: string, changes: UserUpdate): Promise<User> {
  // BACKLOG AUTH-3: an admin cannot deactivate their own account.
  if (id === actorId && changes.active === false) {
    throw new ApiError(
      409,
      'CANNOT_DEACTIVATE_SELF',
      'You cannot deactivate your own account. Ask another admin to do it.',
    );
  }
  try {
    return await prisma.$transaction(async (tx) => {
      // Lock the row first, so two edits at once take turns and each audit entry records the
      // values its change really replaced (rule 14).
      await tx.$queryRaw`SELECT 1 FROM users WHERE id = ${id}::uuid FOR UPDATE`;
      const before = await tx.user.findUnique({ where: { id }, select: userFields });
      if (!before) throw notFound();
      const changedKeys = (Object.keys(changes) as (keyof UserUpdate)[]).filter(
        (key) => changes[key] !== before[key],
      );
      // Nothing differs: nothing is written or audited.
      if (changedKeys.length === 0) return before;
      const pick = (source: UserUpdate) =>
        Object.fromEntries(changedKeys.map((key) => [key, source[key]]));
      const user = await tx.user.update({ where: { id }, data: pick(changes), select: userFields });
      // Deactivation takes effect at once (ARCHITECTURE.md 5). A role change too: the role is
      // kept in the session, so the user signs in again to get the new one.
      if (changedKeys.includes('active') || changedKeys.includes('role')) {
        await signOutEverywhere(tx, id);
      }
      // Rule 14: the changed fields, before and after.
      await audit(tx, {
        actorId,
        action: 'USER_UPDATED',
        entity: 'user',
        entityId: id,
        before: pick(before),
        after: pick(changes),
      });
      return user;
    });
  } catch (error) {
    if (isPrismaError(error, 'P2002')) throw duplicateUsername(changes.username ?? '');
    throw error;
  }
}

// An admin sets a new password for another user, who is told it in person.
export async function resetUserPassword(
  actorId: string,
  id: string,
  password: string,
): Promise<void> {
  const passwordHash = await hashPassword(password); // through the limiter (rule 11)
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id }, select: { username: true } });
    if (!user) throw notFound();
    await tx.user.update({ where: { id }, data: { passwordHash } });
    // Rule 14. The same action the command-line reset writes; the actor tells them apart.
    await audit(tx, {
      actorId,
      action: 'USER_PASSWORD_RESET',
      entity: 'user',
      entityId: id,
      after: { username: user.username },
    });
  });
}
