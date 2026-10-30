import type { Prisma } from '../src/generated/prisma/client.ts';
import { audit } from '../src/lib/audit.ts';
import { config } from '../src/lib/config.ts';
import { prisma } from '../src/lib/prisma.ts';
import { checkPasswordPolicy, hashPassword } from '../src/lib/password.ts';

// Seed data (BACKLOG FND-4). Runs on every api start in Docker, and with `npm run db:seed` in development.
// Safe to re-run: it only inserts what is missing and never changes existing rows, so a re-run
// never resets the admin's password, edited settings, or the current semester.
// Every insert is audited with a null actor, because the seed is a system action (Rule 14).

export class SeedConfigError extends Error {}

export type SeedOptions = {
  adminUsername: string | undefined;
  adminPassword: string | undefined;
  // Fake rooms, items, borrowers, and a semester. Never in production, so they never mix with real data.
  includeSampleData: boolean;
};

const SAMPLE_CATEGORIES = ['Laptops', 'Projectors', 'Cables and power'];

const SAMPLE_ROOMS = ['Room 101', 'Room 102', 'Computer Lab 1'];

const SAMPLE_UNIT_ITEMS = [
  { name: 'Laptop', category: 'Laptops', assetTag: 'LAP-001' },
  { name: 'Laptop', category: 'Laptops', assetTag: 'LAP-002' },
  { name: 'Projector', category: 'Projectors', assetTag: 'PRJ-001' },
];

const SAMPLE_QUANTITY_ITEMS = [
  { name: 'Extension cord', category: 'Cables and power', totalQuantity: 10 },
  { name: 'HDMI cable', category: 'Cables and power', totalQuantity: 5 },
];

const SAMPLE_BORROWERS = [
  {
    schoolId: '2026-00001',
    name: 'Juan Dela Cruz',
    type: 'STUDENT',
    department: 'Computer Science',
  },
  {
    schoolId: '2026-00002',
    name: 'Maria Santos',
    type: 'STUDENT',
    department: 'Information Technology',
  },
  { schoolId: 'F-0001', name: 'Jose Reyes', type: 'FACULTY', department: 'Computer Science' },
  { schoolId: 'E-0001', name: 'Ana Garcia', type: 'EMPLOYEE', department: 'Registrar' },
] as const;

// Returns how many records were created.
export async function seed(options: SeedOptions): Promise<number> {
  const { adminUsername, adminPassword } = readAdminCredentials(options);
  const admin = await seedAdmin(adminUsername, adminPassword);

  const created = await prisma.$transaction(async (tx) => {
    // Settings with the defaults from SPEC 4 (the column defaults). Always a single row with id 1.
    let count = await auditCreated(
      tx,
      'setting',
      await tx.setting.createManyAndReturn({ data: [{ id: 1 }], skipDuplicates: true }),
    );
    if (options.includeSampleData) count += await seedSampleData(tx, admin.id);
    return count;
  });

  return admin.created + created;
}

// ARCHITECTURE.md 5: the first admin comes from ADMIN_USERNAME and ADMIN_PASSWORD. Fail clearly without them.
function readAdminCredentials(options: SeedOptions) {
  const adminUsername = options.adminUsername?.trim();
  const adminPassword = options.adminPassword;
  if (!adminUsername || !adminPassword) {
    throw new SeedConfigError(
      'ADMIN_USERNAME and ADMIN_PASSWORD must be set (see .env.example). The seed creates the first admin from them.',
    );
  }
  const policyError = checkPasswordPolicy(adminPassword);
  if (policyError) throw new SeedConfigError(`ADMIN_PASSWORD: ${policyError}`);
  return { adminUsername, adminPassword };
}

async function seedAdmin(username: string, password: string) {
  // An existing user is left alone, so re-running the seed never resets a changed password.
  const existing = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (existing) return { id: existing.id, created: 0 };

  // Hash before opening the transaction, so no database connection waits on argon2.
  const passwordHash = await hashPassword(password);
  return prisma.$transaction(async (tx) => {
    const admin = await tx.user.create({
      data: { name: 'Administrator', username, passwordHash, role: 'ADMIN' },
      omit: { passwordHash: true },
    });
    return { id: admin.id, created: await auditCreated(tx, 'user', [admin]) };
  });
}

async function seedSampleData(tx: Prisma.TransactionClient, adminId: string): Promise<number> {
  let count = 0;

  count += await auditCreated(
    tx,
    'category',
    await tx.category.createManyAndReturn({
      data: SAMPLE_CATEGORIES.map((name) => ({ name })),
      skipDuplicates: true,
    }),
  );
  const categories = await tx.category.findMany({ where: { name: { in: SAMPLE_CATEGORIES } } });
  const categoryId = (name: string) => categories.find((category) => category.name === name)!.id;

  // Room names are unique regardless of case, so existing rooms are skipped.
  count += await auditCreated(
    tx,
    'location',
    await tx.location.createManyAndReturn({
      data: SAMPLE_ROOMS.map((name) => ({ name, createdById: adminId })),
      skipDuplicates: true,
    }),
  );

  // UNIT items are unique by asset tag.
  count += await auditCreated(
    tx,
    'item',
    await tx.item.createManyAndReturn({
      data: SAMPLE_UNIT_ITEMS.map((item) => ({
        name: item.name,
        categoryId: categoryId(item.category),
        trackingType: 'UNIT',
        assetTag: item.assetTag,
        totalQuantity: 1,
        condition: 'GOOD',
      })),
      skipDuplicates: true,
    }),
  );

  // QUANTITY items have no unique key, so skip the names that already exist.
  const existingQuantityItems = await tx.item.findMany({
    where: {
      trackingType: 'QUANTITY',
      name: { in: SAMPLE_QUANTITY_ITEMS.map((item) => item.name) },
    },
    select: { name: true },
  });
  const missingQuantityItems = SAMPLE_QUANTITY_ITEMS.filter(
    (item) => !existingQuantityItems.some((existing) => existing.name === item.name),
  );
  count += await auditCreated(
    tx,
    'item',
    await tx.item.createManyAndReturn({
      data: missingQuantityItems.map((item) => ({
        name: item.name,
        categoryId: categoryId(item.category),
        trackingType: 'QUANTITY',
        totalQuantity: item.totalQuantity,
        condition: 'GOOD',
      })),
    }),
  );

  // CLAUDE.md rule 1: the seed only inserts borrowers and never reads them; reads go through BorrowerService.
  // Unique by school ID, so existing borrowers are skipped.
  count += await auditCreated(
    tx,
    'borrower',
    await tx.borrower.createManyAndReturn({ data: [...SAMPLE_BORROWERS], skipDuplicates: true }),
  );

  // Skipped when a current semester already exists (only one may be current).
  count += await auditCreated(
    tx,
    'semester',
    await tx.semester.createManyAndReturn({
      data: [{ ...sampleSemesterDates(), name: 'Sample semester', isCurrent: true }],
      skipDuplicates: true,
    }),
  );

  return count;
}

// A sample semester from the start of this month (in the app timezone) to the end of the month
// five months later, so it contains today.
function sampleSemesterDates() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(new Date());
  const [year, month] = today.split('-').map(Number);
  // Semester dates are calendar dates, stored as midnight UTC in a DATE column.
  return {
    startDate: new Date(Date.UTC(year, month - 1, 1)),
    endDate: new Date(Date.UTC(year, month + 5, 0)),
  };
}

// Rule 14: one audit entry per created record, in the same transaction as the insert.
async function auditCreated(
  tx: Prisma.TransactionClient,
  entity: string,
  rows: { id: string | number }[],
): Promise<number> {
  for (const row of rows) {
    await audit(tx, {
      actorId: null,
      action: `${entity.toUpperCase()}_CREATED`,
      entity,
      entityId: String(row.id),
      // Round-trip through JSON so dates become strings.
      after: JSON.parse(JSON.stringify(row)) as Prisma.InputJsonObject,
    });
  }
  return rows.length;
}

async function main(): Promise<void> {
  try {
    const created = await seed({
      adminUsername: process.env.ADMIN_USERNAME,
      adminPassword: process.env.ADMIN_PASSWORD,
      includeSampleData: !config.isProduction,
    });
    console.log(`Seed finished: ${created} record(s) created.`);
  } catch (error) {
    console.error(error instanceof SeedConfigError ? `Seed failed: ${error.message}` : error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

// Run only when started as a script, not when imported by the tests.
if (import.meta.main) await main();
