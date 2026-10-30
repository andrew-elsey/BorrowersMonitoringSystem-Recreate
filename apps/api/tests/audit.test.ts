import { beforeEach, expect, test } from 'vitest';
import { audit } from '../src/lib/audit.ts';
import { prisma } from '../src/lib/prisma.ts';
import { resetDatabase } from './setup/reset-database.ts';

beforeEach(resetDatabase);

test('writes an audit entry together with the change', async () => {
  const admin = await prisma.user.create({
    data: { name: 'Admin', username: 'admin', passwordHash: 'x', role: 'ADMIN' },
  });

  await prisma.$transaction(async (tx) => {
    const category = await tx.category.create({ data: { name: 'Projectors' } });
    await audit(tx, {
      actorId: admin.id,
      action: 'CATEGORY_CREATED',
      entity: 'category',
      entityId: category.id,
      after: { name: category.name },
    });
  });

  const entries = await prisma.auditLog.findMany();
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    actorId: admin.id,
    action: 'CATEGORY_CREATED',
    entity: 'category',
    before: null,
    after: { name: 'Projectors' },
  });
});

test('rolls back the audit entry when the change fails (Rule 14)', async () => {
  await prisma.category.create({ data: { name: 'Cables' } });

  const failingChange = prisma.$transaction(async (tx) => {
    await audit(tx, {
      actorId: null,
      action: 'CATEGORY_CREATED',
      entity: 'category',
      entityId: 'x',
    });
    // The duplicate name violates the unique constraint, so the whole transaction rolls back.
    await tx.category.create({ data: { name: 'Cables' } });
  });

  await expect(failingChange).rejects.toThrow();
  expect(await prisma.auditLog.count()).toBe(0);
});

test('allows a null actor for system actions', async () => {
  await prisma.$transaction((tx) =>
    audit(tx, { actorId: null, action: 'FLAGGING_RUN', entity: 'flagging', entityId: 'run' }),
  );
  expect(await prisma.auditLog.count()).toBe(1);
});
