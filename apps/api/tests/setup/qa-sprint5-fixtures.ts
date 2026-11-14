import request from 'supertest';
import { createApp } from '../../src/app.ts';
import { hashPassword } from '../../src/lib/password.ts';
import { prisma } from '../../src/lib/prisma.ts';
import { resetDatabase } from './reset-database.ts';

// Shared builders for the Sprint 5 QA gap tests (qa-s5-*.test.ts). Fictional people only.

export const PASSWORD = 'correct-horse-battery';
let passwordHash: string | undefined;

export type World = Awaited<ReturnType<typeof seedWorld>>;

// Empty tables, then: default settings; admin ana, handler hal, viewer vic; one room; semesters
// S1 (older) and S2 (current); one category; a borrower; a QUANTITY item (10) and a UNIT item.
export async function seedWorld() {
  passwordHash ??= await hashPassword(PASSWORD);
  await resetDatabase();
  await prisma.setting.create({ data: { id: 1 } });
  const users = await prisma.user.createManyAndReturn({
    data: [
      { name: 'Ana Admin', username: 'ana', passwordHash, role: 'ADMIN' },
      { name: 'Hal Handler', username: 'hal', passwordHash, role: 'HANDLER' },
      { name: 'Vic Viewer', username: 'vic', passwordHash, role: 'VIEWER' },
    ],
  });
  const userId = (username: string) => users.find((u) => u.username === username)!.id;
  const halId = userId('hal');
  const roomId = (await prisma.location.create({ data: { name: 'CL-201', createdById: halId } }))
    .id;
  const [s1, s2] = await prisma.semester.createManyAndReturn({
    data: [
      { name: 'S1', startDate: new Date('2026-01-05'), endDate: new Date('2026-05-30') },
      {
        name: 'S2',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-12-15'),
        isCurrent: true,
      },
    ],
  });
  const categoryId = (await prisma.category.create({ data: { name: 'Supplies' } })).id;
  const borrowerId = await borrower('QA-0001', 'Test Borrower One');
  const cordId = (
    await prisma.item.create({
      data: {
        name: 'Extension cord',
        categoryId,
        trackingType: 'QUANTITY',
        totalQuantity: 10,
        condition: 'GOOD',
      },
    })
  ).id;
  const laptopId = (
    await prisma.item.create({
      data: {
        name: 'Laptop',
        categoryId,
        trackingType: 'UNIT',
        assetTag: 'LT-QA-1',
        totalQuantity: 1,
        condition: 'GOOD',
      },
    })
  ).id;
  return {
    adminId: userId('ana'),
    halId,
    vicId: userId('vic'),
    roomId,
    olderSemesterId: s1!.id,
    currentSemesterId: s2!.id,
    categoryId,
    borrowerId,
    cordId,
    laptopId,
  };
}

export async function borrower(schoolId: string, name: string, active = true) {
  return (
    await prisma.borrower.create({
      data: { schoolId, name, type: 'STUDENT', department: 'IT', active },
    })
  ).id;
}

// One transaction straight in the database (no API), one line per entry. Returns the line ids.
export async function lend(
  world: World,
  lines: {
    itemId: string;
    quantity?: number;
    returned?: number;
    flagStatus?: 'NONE' | 'FLAGGED' | 'OVERRIDDEN';
    note?: string;
  }[],
  options: { borrowerId?: string; semesterId?: string; issuedAt?: Date; issuedById?: string } = {},
) {
  const transaction = await prisma.transaction.create({
    data: {
      borrowerId: options.borrowerId ?? world.borrowerId,
      locationId: world.roomId,
      issuedById: options.issuedById ?? world.halId,
      semesterId: options.semesterId ?? world.currentSemesterId,
      issuedAt: options.issuedAt ?? new Date(),
      lines: {
        create: lines.map((line) => ({
          itemId: line.itemId,
          quantityBorrowed: line.quantity ?? 1,
          quantityReturned: line.returned ?? 0,
          flagStatus: line.flagStatus ?? 'NONE',
          flaggedAt: line.flagStatus && line.flagStatus !== 'NONE' ? new Date() : null,
          note: line.note ?? null,
        })),
      },
    },
    include: { lines: { orderBy: { createdAt: 'asc' } } },
  });
  return transaction.lines.map((line) => line.id);
}

export type Agent = ReturnType<typeof request.agent>;

// A signed-in agent.
export async function signIn(username: string, app = createApp(), password = PASSWORD) {
  const agent = request.agent(app);
  await agent
    .post('/api/auth/login')
    .set('X-Requested-With', 'fetch')
    .send({ username, password })
    .expect(200);
  return agent;
}

export function login(username: string, password: string, app = createApp()) {
  return request(app)
    .post('/api/auth/login')
    .set('X-Requested-With', 'fetch')
    .send({ username, password });
}

export const auditCount = (action: string) => prisma.auditLog.count({ where: { action } });

// Fault injection in the real database (no mocks): the next audit_log insert with this action
// raises an error, so a test can check the change it belongs to rolls back with it (BR 14).
export async function failAuditFor(action: string) {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION qa_fail_audit() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'qa: audit insert refused'; END $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS qa_fail_audit ON audit_log`);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER qa_fail_audit BEFORE INSERT ON audit_log FOR EACH ROW
    WHEN (NEW.action = '${action.replace(/[^A-Z_]/g, '')}') EXECUTE FUNCTION qa_fail_audit()`);
}

export async function stopFailingAudit() {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS qa_fail_audit ON audit_log`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS qa_fail_audit()`);
}
