import { beforeEach, describe, expect, test } from 'vitest';
import { seed, SeedConfigError } from '../prisma/seed.ts';
import { prisma } from '../src/lib/prisma.ts';
import { verifyPassword } from '../src/lib/password.ts';
import { resetDatabase } from './setup/reset-database.ts';

beforeEach(resetDatabase);

const credentials = { adminUsername: 'admin', adminPassword: 'first-password' };

async function countAll() {
  return {
    users: await prisma.user.count(),
    settings: await prisma.setting.count(),
    categories: await prisma.category.count(),
    locations: await prisma.location.count(),
    items: await prisma.item.count(),
    borrowers: await prisma.borrower.count(),
    semesters: await prisma.semester.count(),
    audit: await prisma.auditLog.count(),
  };
}

test('creates the first admin, default settings, and sample data', async () => {
  await seed({ ...credentials, includeSampleData: true });

  const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
  expect(admin.role).toBe('ADMIN');
  expect(await verifyPassword(admin.passwordHash, 'first-password')).toBe(true);

  expect(await prisma.setting.findUniqueOrThrow({ where: { id: 1 } })).toMatchObject({
    closingTime: '17:00',
    warningThreshold: 3,
    noticeThreshold: 4,
    blockThreshold: 5,
  });
  expect(await prisma.item.count({ where: { trackingType: 'UNIT' } })).toBeGreaterThan(0);
  expect(await prisma.item.count({ where: { trackingType: 'QUANTITY' } })).toBeGreaterThan(0);
  expect(await prisma.location.count()).toBeGreaterThan(0);
  expect(await prisma.borrower.count()).toBeGreaterThan(0);

  const semester = await prisma.semester.findFirstOrThrow({ where: { isCurrent: true } });
  // Compare calendar dates in the app timezone, as the semester dates are.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
  const isoDate = (date: Date) => date.toISOString().slice(0, 10);
  expect(isoDate(semester.startDate) <= today && today <= isoDate(semester.endDate)).toBe(true);
});

test('audits every created record and never stores the password hash in the audit log', async () => {
  await seed({ ...credentials, includeSampleData: true });
  const counts = await countAll();
  const records = Object.entries(counts)
    .filter(([table]) => table !== 'audit')
    .reduce((sum, [, count]) => sum + count, 0);

  expect(counts.audit).toBe(records);
  const adminEntry = await prisma.auditLog.findFirstOrThrow({ where: { entity: 'user' } });
  expect(adminEntry).toMatchObject({ actorId: null, action: 'USER_CREATED' });
  expect(JSON.stringify(adminEntry.after)).not.toContain('argon2');
});

test('is safe to re-run: nothing is duplicated and nothing is overwritten', async () => {
  await seed({ ...credentials, includeSampleData: true });
  await prisma.setting.update({ where: { id: 1 }, data: { closingTime: '18:00' } });
  const before = await countAll();

  const created = await seed({
    adminUsername: 'admin',
    adminPassword: 'other-password',
    includeSampleData: true,
  });

  expect(created).toBe(0);
  expect(await countAll()).toEqual(before);
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
  expect(await verifyPassword(admin.passwordHash, 'first-password')).toBe(true);
  expect((await prisma.setting.findUniqueOrThrow({ where: { id: 1 } })).closingTime).toBe('18:00');
});

test('production seeds only the admin and settings', async () => {
  await seed({ ...credentials, includeSampleData: false });
  const counts = await countAll();
  expect(counts).toMatchObject({
    users: 1,
    settings: 1,
    categories: 0,
    locations: 0,
    items: 0,
    borrowers: 0,
    semesters: 0,
  });
});

test('development sample data adds the QA role accounts when QA_PASSWORD is set, never overwriting them', async () => {
  await seed({ ...credentials, includeSampleData: true, qaPassword: 'qa-password-1' });

  for (const [username, role] of [
    ['qa-handler', 'HANDLER'],
    ['qa-viewer', 'VIEWER'],
  ]) {
    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    expect(user).toMatchObject({ role, active: true });
    expect(await verifyPassword(user.passwordHash, 'qa-password-1')).toBe(true);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { entityId: user.id } });
    expect(JSON.stringify(entry.after)).not.toContain('argon2');
  }

  const created = await seed({
    ...credentials,
    includeSampleData: true,
    qaPassword: 'other-qa-password',
  });
  expect(created).toBe(0);
  const handler = await prisma.user.findUniqueOrThrow({ where: { username: 'qa-handler' } });
  expect(await verifyPassword(handler.passwordHash, 'qa-password-1')).toBe(true);
});

test('QA accounts are skipped without QA_PASSWORD and never created in production', async () => {
  await seed({ ...credentials, includeSampleData: true });
  await seed({ ...credentials, includeSampleData: false, qaPassword: 'qa-password-1' });
  expect(await prisma.user.count({ where: { username: { startsWith: 'qa-' } } })).toBe(0);
});

test('a too-short QA_PASSWORD fails clearly', async () => {
  const run = seed({ ...credentials, includeSampleData: true, qaPassword: 'short' });
  await expect(run).rejects.toThrow(/QA_PASSWORD: .*at least 10 characters/);
});

describe('fails clearly without valid admin credentials', () => {
  test.each([
    [
      'missing username',
      { adminUsername: undefined, adminPassword: 'first-password' },
      /ADMIN_USERNAME and ADMIN_PASSWORD/,
    ],
    [
      'missing password',
      { adminUsername: 'admin', adminPassword: undefined },
      /ADMIN_USERNAME and ADMIN_PASSWORD/,
    ],
    [
      'short password',
      { adminUsername: 'admin', adminPassword: 'short' },
      /at least 10 characters/,
    ],
  ])('%s', async (_case, admin, message) => {
    const run = seed({ ...admin, includeSampleData: true });
    await expect(run).rejects.toBeInstanceOf(SeedConfigError);
    await expect(run).rejects.toThrow(message);
    expect(await prisma.user.count()).toBe(0);
  });
});
