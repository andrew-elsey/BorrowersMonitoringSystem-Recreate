import type { Borrower } from '@bms/shared';
import { beforeEach, describe, expect, test } from 'vitest';
import { prisma } from '../src/lib/prisma.ts';
import {
  type BorrowerService,
  LocalBorrowerService,
  checkSearchBounds,
} from '../src/services/borrowers.ts';
import { resetDatabase } from './setup/reset-database.ts';

// MD-4: BorrowerService. TC-MD-14 in TEST_CASES.md: the same checks run against
// LocalBorrowerService (real test database) and an in-memory test double, so a caller written
// against the interface works unchanged with either.

const BORROWERS = [
  { schoolId: '2026-0001', name: 'Ana Santos', type: 'STUDENT', department: 'CS', active: true },
  { schoolId: '2026-0002', name: 'Ben Reyes', type: 'FACULTY', department: 'IT', active: true },
  { schoolId: '2026-0003', name: 'Cora Santos', type: 'STUDENT', department: 'CS', active: false },
] as const;

// Test double: keeps borrowers in an array instead of a database.
class InMemoryBorrowerService implements BorrowerService {
  private readonly borrowers: Borrower[];

  constructor(borrowers: Borrower[]) {
    this.borrowers = borrowers;
  }

  async findById(id: string) {
    return this.borrowers.find((borrower) => borrower.id === id) ?? null;
  }

  async search(query: string, limit = 25) {
    const text = query.trim();
    checkSearchBounds(text, limit);
    return this.matching(text).slice(0, limit);
  }

  async list({ q, page, pageSize }: { q?: string; page: number; pageSize: number }) {
    const text = q?.trim() ?? '';
    if (q !== undefined) checkSearchBounds(text, pageSize);
    const all = this.matching(text);
    const data = all.slice((page - 1) * pageSize, page * pageSize);
    return { data, page, pageSize, total: all.length };
  }

  private matching(text: string) {
    const matches = (value: string) => value.toLowerCase().includes(text.toLowerCase());
    return this.borrowers
      .filter((borrower) => matches(borrower.name) || matches(borrower.schoolId))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async isEligible(id: string) {
    const borrower = await this.findById(id);
    if (!borrower) return { eligible: false, reason: 'NOT_FOUND' };
    if (!borrower.active) return { eligible: false, reason: 'BORROWER_INACTIVE' };
    return { eligible: true };
  }
}

// A stand-in caller, written only against the interface, as checkout will be (BRW-2).
async function describeForCheckout(service: BorrowerService, id: string) {
  const borrower = await service.findById(id);
  const { eligible, reason } = await service.isEligible(id);
  return { name: borrower?.name, eligible, reason };
}

let ids: Record<string, string>;

beforeEach(async () => {
  await resetDatabase();
  const rows = await prisma.borrower.createManyAndReturn({ data: [...BORROWERS] });
  ids = Object.fromEntries(rows.map((row) => [row.schoolId, row.id]));
});

const implementations: [string, () => BorrowerService][] = [
  ['LocalBorrowerService', () => new LocalBorrowerService()],
  [
    'test double',
    () => new InMemoryBorrowerService(BORROWERS.map((b) => ({ ...b, id: ids[b.schoolId]! }))),
  ],
];

describe.each(implementations)('%s', (_name, makeService) => {
  test('findById returns the borrower, or null for an unknown id', async () => {
    const service = makeService();
    expect(await service.findById(ids['2026-0002']!)).toEqual({
      id: ids['2026-0002'],
      schoolId: '2026-0002',
      name: 'Ben Reyes',
      type: 'FACULTY',
      department: 'IT',
      active: true,
    });
    expect(await service.findById('00000000-0000-4000-8000-000000000000')).toBeNull();
    // A malformed id is not found, the same in every implementation.
    expect(await service.findById('abc')).toBeNull();
  });

  test('search matches name or school ID, ignoring case, sorted by name', async () => {
    const service = makeService();
    const names = async (query: string, limit?: number) =>
      (await service.search(query, limit)).map((borrower) => borrower.name);
    expect(await names('santos')).toEqual(['Ana Santos', 'Cora Santos']);
    expect(await names('2026-0002')).toEqual(['Ben Reyes']);
    expect(await names('santos', 1)).toEqual(['Ana Santos']);
    expect(await names('zz')).toEqual([]);
    // % and _ are plain text, not SQL wildcards.
    expect(await names('%%')).toEqual([]);
    expect(await names('__')).toEqual([]);
  });

  test('search enforces the SPEC 7 bounds', async () => {
    const service = makeService();
    for (const [query, limit] of [
      ['a', 25],
      [' a ', 25],
      ['a'.repeat(101), 25],
      ['an', 0],
      ['an', 101],
      ['an', 1.5],
    ] as const) {
      await expect(service.search(query, limit)).rejects.toMatchObject({
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }
    await expect(service.search('a'.repeat(100), 100)).resolves.toEqual([]);
    // A NUL would be a 500 from PostgreSQL; every implementation refuses it as invalid input.
    await expect(service.search('an\u0000')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('list pages through everyone or the matches, with a total', async () => {
    const service = makeService();
    const page = async (params: { q?: string; page: number; pageSize: number }) => {
      const result = await service.list(params);
      return { ...result, data: result.data.map((borrower) => borrower.name) };
    };
    expect(await page({ page: 2, pageSize: 2 })).toEqual({
      data: ['Cora Santos'],
      page: 2,
      pageSize: 2,
      total: 3,
    });
    expect(await page({ q: 'SANTOS', page: 1, pageSize: 1 })).toEqual({
      data: ['Ana Santos'],
      page: 1,
      pageSize: 1,
      total: 2,
    });
    await expect(service.list({ q: 'a', page: 1, pageSize: 25 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { fields: { q: [expect.any(String)] } },
    });
  });

  test('isEligible: rule 3, inactive borrowers cannot borrow', async () => {
    const service = makeService();
    expect(await service.isEligible(ids['2026-0001']!)).toEqual({ eligible: true });
    expect(await service.isEligible(ids['2026-0003']!)).toEqual({
      eligible: false,
      reason: 'BORROWER_INACTIVE',
    });
    expect(await service.isEligible('00000000-0000-4000-8000-000000000000')).toEqual({
      eligible: false,
      reason: 'NOT_FOUND',
    });
  });

  test('TC-MD-14: a caller works unchanged', async () => {
    expect(await describeForCheckout(makeService(), ids['2026-0003']!)).toEqual({
      name: 'Cora Santos',
      eligible: false,
      reason: 'BORROWER_INACTIVE',
    });
  });
});
