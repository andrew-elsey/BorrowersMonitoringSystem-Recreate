import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { prisma } from '../src/lib/prisma.ts';
import { LocalBorrowerService } from '../src/services/borrowers.ts';
import { resetDatabase } from './setup/reset-database.ts';

// QA gap tests for MD-4 (BorrowerService), automated QA 2026-11-02. Not part of the ticket's
// own suite. Fictional borrowers only.

type Row = { schoolId: string; name: string; type?: 'STUDENT' | 'FACULTY' | 'EMPLOYEE' };
const service = new LocalBorrowerService();

async function addBorrowers(rows: Row[]): Promise<Record<string, string>> {
  const created = await prisma.borrower.createManyAndReturn({
    data: rows.map((row) => ({ type: 'STUDENT' as const, department: 'CS', ...row })),
  });
  return Object.fromEntries(created.map((row) => [row.schoolId, row.id]));
}

const names = async (query: string, limit?: number) =>
  (await service.search(query, limit)).map((borrower) => borrower.name);

beforeEach(async () => {
  await resetDatabase();
});

describe('search treats its text literally (SQL wildcards)', () => {
  beforeEach(async () => {
    await addBorrowers([
      { schoolId: 'QA-0001', name: 'Ana Santos' },
      { schoolId: 'QA-0002', name: 'Ben Reyes' },
      { schoolId: 'QA_0003', name: 'Cora 100% Cruz' },
    ]);
  });

  test('a search for "%%" matches only names that contain a percent sign', async () => {
    expect(await names('%%')).toEqual([]);
    expect(await names('0%')).toEqual(['Cora 100% Cruz']);
  });

  test('a search for "__" matches only text that contains underscores', async () => {
    expect(await names('__')).toEqual([]);
  });

  test('an underscore in a school ID search matches only that literal underscore', async () => {
    expect(await names('QA_')).toEqual(['Cora 100% Cruz']);
  });

  test('a backslash in the search text does not error', async () => {
    await expect(service.search('a\\')).resolves.toEqual([]);
  });
});

describe('whitespace and unicode in search text', () => {
  beforeEach(async () => {
    await addBorrowers([
      { schoolId: 'QA-0101', name: 'José Peña' },
      { schoolId: 'QA-0102', name: 'Dana Cruz' },
    ]);
  });

  test('surrounding whitespace, tabs and newlines are ignored', async () => {
    expect(await names('\t peña \n')).toEqual(['José Peña']);
  });

  test('non-ASCII letters match regardless of case', async () => {
    expect(await names('PEÑA')).toEqual(['José Peña']);
    expect(await names('josé')).toEqual(['José Peña']);
  });

  test('text that is only whitespace is rejected', async () => {
    await expect(service.search('     ')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('100 characters after trimming are accepted even with padding around them', async () => {
    await expect(service.search(`  ${'z'.repeat(100)}  `)).resolves.toEqual([]);
  });

  test('the default limit is 25 rows', async () => {
    await addBorrowers(
      Array.from({ length: 30 }, (_, i) => ({
        schoolId: `QA-9${String(i).padStart(3, '0')}`,
        name: `Zed ${i}`,
      })),
    );
    expect(await names('zed')).toHaveLength(25);
  });

  test('a non-number limit is rejected', async () => {
    await expect(service.search('an', Number.NaN)).rejects.toMatchObject({ status: 400 });
    await expect(service.search('an', '5' as unknown as number)).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('ordering matches between the database and plain string sorting', () => {
  test('lowercase and uppercase names sort together, by name', async () => {
    await addBorrowers([
      { schoolId: 'QA-0201', name: 'ben Abad' },
      { schoolId: 'QA-0202', name: 'Ana Abad' },
      { schoolId: 'QA-0203', name: 'Cid Abad' },
    ]);
    expect(await names('abad')).toEqual(['Ana Abad', 'ben Abad', 'Cid Abad']);
  });

  test('borrowers with the same name are ordered by school ID', async () => {
    await addBorrowers([
      { schoolId: 'QA-0302', name: 'Eli Ramos' },
      { schoolId: 'QA-0301', name: 'Eli Ramos' },
    ]);
    const rows = await service.search('eli ramos');
    expect(rows.map((row) => row.schoolId)).toEqual(['QA-0301', 'QA-0302']);
  });
});

describe('findById', () => {
  test('returns only the shared Borrower fields', async () => {
    const ids = await addBorrowers([{ schoolId: 'QA-0401', name: 'Fe Lim' }]);
    const borrower = await service.findById(ids['QA-0401']!);
    expect(Object.keys(borrower!).sort()).toEqual(
      ['active', 'department', 'id', 'name', 'schoolId', 'type'].sort(),
    );
  });

  test('accepts an uppercase uuid for an existing borrower', async () => {
    const ids = await addBorrowers([{ schoolId: 'QA-0402', name: 'Gil Tan' }]);
    const borrower = await service.findById(ids['QA-0402']!.toUpperCase());
    expect(borrower?.schoolId).toBe('QA-0402');
  });

  test('finds a borrower whose id is a valid PostgreSQL uuid that is not RFC 4122 v1-v8', async () => {
    // An imported or externally generated id; PostgreSQL stores any 128-bit uuid.
    const id = '00000000-0000-0000-0000-000000000001';
    await prisma.borrower.create({
      data: { id, schoolId: 'QA-0403', name: 'Hana Uy', type: 'STUDENT', department: 'CS' },
    });
    expect((await service.findById(id))?.schoolId).toBe('QA-0403');
  });

  test.each(['', ' ', 'not-a-uuid', "1' OR '1'='1", 'x'.repeat(10_000)])(
    'returns null for the malformed id %j instead of throwing',
    async (id) => {
      expect(await service.findById(id)).toBeNull();
      expect(await service.isEligible(id, prisma)).toEqual({ eligible: false, reason: 'NOT_FOUND' });
    },
  );
});

// The rule 1 guard lives in borrower-reads.test.ts. These read its regex from that file so they
// test the real pattern. Its known limits are listed in the shortcut comment there.
describe('rule 1 guard pattern (TC-MD-13)', () => {
  const guardSource = readFileSync(join(import.meta.dirname, 'borrower-reads.test.ts'), 'utf8');
  const literal = /BORROWER_QUERY =\s*\/(.+)\/([a-z]*);/.exec(guardSource);
  const guard = new RegExp(literal![1]!, literal![2]);

  test.each([
    'await tx.borrower.findMany()',
    'prisma.borrower.count()',
    'select * from borrowers',
    'SELECT * FROM\n  "borrowers"',
    'UPDATE borrowers SET active = false',
    'include: { borrower: true }',
    'select: { borrower: true }',
  ])('catches %j', (code) => {
    expect(guard.test(code)).toBe(true);
  });
});
