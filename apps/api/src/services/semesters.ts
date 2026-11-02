import type { Semester, SemesterInput, SemesterPage } from '@bms/shared';
import type { Prisma } from '../generated/prisma/client.ts';
import { audit } from '../lib/audit.ts';
import { ApiError } from '../lib/errors.ts';
import { prisma } from '../lib/prisma.ts';

// Semesters (MD-7). Admin only; the route checks the role. Semesters are never deleted (BR 15):
// transactions point at them and strikes are counted through them (BR 10, 12).

type SemesterRow = { id: string; name: string; startDate: Date; endDate: Date; isCurrent: boolean };

// DATE columns come back as midnight UTC (the connection runs in UTC, ARCHITECTURE.md 6).
const toDateString = (date: Date) => date.toISOString().slice(0, 10);
const toDate = (date: string) => new Date(`${date}T00:00:00Z`);

function toSemester(row: SemesterRow): Semester {
  return {
    id: row.id,
    name: row.name,
    startDate: toDateString(row.startDate),
    endDate: toDateString(row.endDate),
    isCurrent: row.isCurrent,
  };
}

const notFound = () => new ApiError(404, 'NOT_FOUND', 'Semester not found.');

// Audit snapshot: what an admin can change.
const snapshot = ({ name, startDate, endDate }: Semester) => ({ name, startDate, endDate });

// `current` is the current semester even when it is on another page, so the screen can warn
// when there is none.
export async function listSemesters(page: number, pageSize: number): Promise<SemesterPage> {
  const [rows, total, current] = await prisma.$transaction([
    prisma.semester.findMany({
      orderBy: [{ startDate: 'desc' }, { name: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.semester.count(),
    prisma.semester.findFirst({ where: { isCurrent: true } }),
  ]);
  return {
    data: rows.map(toSemester),
    page,
    pageSize,
    total,
    current: current && toSemester(current),
  };
}

// BR 2: the semester a checkout records. Checkout (BRW-2) calls this inside its own transaction,
// so it reads the current semester fresh from the database every time.
export async function getCurrentSemester(
  db: Prisma.TransactionClient = prisma,
): Promise<Semester | null> {
  const row = await db.semester.findFirst({ where: { isCurrent: true } });
  return row && toSemester(row);
}

// BR 2: with no current semester, checkout is rejected.
export async function requireCurrentSemester(
  db: Prisma.TransactionClient = prisma,
): Promise<Semester> {
  const semester = await getCurrentSemester(db);
  if (!semester) {
    throw new ApiError(
      409,
      'NO_CURRENT_SEMESTER',
      'There is no current semester. An admin must set one in Settings and semesters.',
    );
  }
  return semester;
}

// A new semester is not current; the admin sets it with setCurrentSemester.
export async function createSemester(actorId: string, input: SemesterInput): Promise<Semester> {
  return prisma.$transaction(async (tx) => {
    const semester = toSemester(
      await tx.semester.create({
        data: {
          name: input.name,
          startDate: toDate(input.startDate),
          endDate: toDate(input.endDate),
        },
      }),
    );
    // Rule 14
    await audit(tx, {
      actorId,
      action: 'SEMESTER_CREATED',
      entity: 'semester',
      entityId: semester.id,
      after: snapshot(semester),
    });
    return semester;
  });
}

export async function updateSemester(
  actorId: string,
  id: string,
  input: SemesterInput,
): Promise<Semester> {
  return prisma.$transaction(async (tx) => {
    // Lock the row so two edits at once take turns and each audit entry has the true "before".
    await tx.$queryRaw`SELECT 1 FROM semesters WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await tx.semester.findUnique({ where: { id } });
    if (!row) throw notFound();
    const before = toSemester(row);
    const after = { ...before, ...input };
    // Nothing changed: nothing is written or audited.
    if (JSON.stringify(snapshot(before)) === JSON.stringify(snapshot(after))) return before;
    await tx.semester.update({
      where: { id },
      data: {
        name: input.name,
        startDate: toDate(input.startDate),
        endDate: toDate(input.endDate),
      },
    });
    // Rule 14
    await audit(tx, {
      actorId,
      action: 'SEMESTER_UPDATED',
      entity: 'semester',
      entityId: id,
      before: snapshot(before),
      after: snapshot(after),
    });
    return after;
  });
}

// Exactly one current semester (SPEC.md 4). Setting a new one starts every borrower at 0 strikes
// (BR 12); old transactions keep their semester.
export async function setCurrentSemester(actorId: string, id: string): Promise<Semester> {
  return prisma.$transaction(async (tx) => {
    // One change of the current semester at a time. Without this, two admins setting different
    // semesters at once could both clear the old one and then collide on the unique index.
    // Reads are not blocked.
    await tx.$executeRaw`LOCK TABLE semesters IN SHARE ROW EXCLUSIVE MODE`;
    const row = await tx.semester.findUnique({ where: { id } });
    if (!row) throw notFound();
    if (row.isCurrent) return toSemester(row);
    const previous = await tx.semester.findFirst({ where: { isCurrent: true } });
    // Clear the old one first: the partial unique index allows only one is_current row.
    await tx.semester.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
    const semester = toSemester(
      await tx.semester.update({ where: { id }, data: { isCurrent: true } }),
    );
    // Rule 14: one entry records both sides of the switch.
    await audit(tx, {
      actorId,
      action: 'SEMESTER_SET_CURRENT',
      entity: 'semester',
      entityId: id,
      before: { currentSemester: previous && { id: previous.id, name: previous.name } },
      after: { currentSemester: { id, name: semester.name } },
    });
    return semester;
  });
}
