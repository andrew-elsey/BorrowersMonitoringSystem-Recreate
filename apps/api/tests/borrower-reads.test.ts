import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { expect, test } from 'vitest';

// TC-MD-13 (CLAUDE.md rule 1): only services/borrowers.ts may query the borrowers table, through
// Prisma (`.borrower.`) or raw SQL. Scans the api source and scripts; generated code is skipped.
// The seed (prisma/seed.ts) only inserts sample borrowers, so it is not scanned.

const API_ROOT = join(import.meta.dirname, '..');
const ALLOWED = 'src/services/borrowers.ts';
const BORROWER_QUERY = /\.borrower\.|\b(from|join|update|into)\s+"?borrowers\b/i;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'generated' ? [] : sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

test('TC-MD-13: no code outside LocalBorrowerService queries the borrowers table', () => {
  const offenders = [
    ...sourceFiles(join(API_ROOT, 'src')),
    ...sourceFiles(join(API_ROOT, 'scripts')),
  ]
    .map((path) => relative(API_ROOT, path).split(sep).join('/'))
    .filter((path) => path !== ALLOWED)
    .filter((path) => BORROWER_QUERY.test(readFileSync(join(API_ROOT, path), 'utf8')));
  expect(offenders).toEqual([]);
});

test('the check catches a borrower query', () => {
  expect(BORROWER_QUERY.test('await prisma.borrower.findMany()')).toBe(true);
  expect(BORROWER_QUERY.test('SELECT * FROM "borrowers"')).toBe(true);
  expect(BORROWER_QUERY.test('// staff manage borrowers here')).toBe(false);
  expect(readFileSync(join(API_ROOT, ALLOWED), 'utf8')).toMatch(BORROWER_QUERY);
});
