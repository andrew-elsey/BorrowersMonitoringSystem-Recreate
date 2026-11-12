import {
  type BorrowerImportResult,
  BorrowerType,
  CONTROL_CHARACTER,
  CSV_IMPORT_HEADER,
  CSV_IMPORT_MAX_ROWS,
  NAME_MAX_LENGTH,
} from '@bms/shared';
import { type Info, parse } from 'csv-parse';
import { setImmediate } from 'node:timers/promises';
import { ApiError } from '../lib/errors.ts';
import { type BorrowerImportRow, importBorrowers } from './borrowers.ts';

// Borrower CSV import (MD-6, SPEC.md 6 and 7). Reads and checks the file here; the database work
// is importBorrowers in services/borrowers.ts, the only file that touches borrowers (CLAUDE.md rule 1).

// Parsed in pieces of this many characters, giving other requests a turn in between (ARCHITECTURE.md 12.3).
const PARSE_CHUNK_CHARS = 64 * 1024;
const TYPES = Object.values(BorrowerType) as string[];

type Rejected = BorrowerImportResult['rejected'][number];

function fileError(message: string): ApiError {
  return new ApiError(400, 'VALIDATION_ERROR', message, { fields: { file: [message] } });
}

// SPEC.md 7: at most 5,000 rows, counted from the line breaks before any parsing.
// shortcut: a line break inside a quoted value counts as a row, so such a file may be refused
// early; valid borrower fields cannot hold line breaks anyway.
function checkRowCount(text: string): void {
  let lines = text.split('\n').length;
  if (text.endsWith('\n')) lines -= 1;
  if (lines - 1 > CSV_IMPORT_MAX_ROWS) {
    throw new ApiError(
      413,
      'PAYLOAD_TOO_LARGE',
      `The file has more than ${CSV_IMPORT_MAX_ROWS} rows. Split it into smaller files.`,
    );
  }
}

// Each record with the line it ended on. Fed in chunks, waiting for the event loop between
// them, so a 2 MB file never holds up other requests.
async function parseCsv(text: string): Promise<{ record: string[]; info: Info }[]> {
  const parser = parse({ bom: true, skip_empty_lines: true, relax_column_count: true, info: true });
  const records: { record: string[]; info: Info }[] = [];
  parser.on('readable', () => {
    let entry;
    while ((entry = parser.read()) !== null) records.push(entry);
  });
  const finished = new Promise<void>((resolve, reject) => {
    parser.on('end', resolve);
    parser.on('error', reject);
  });
  for (let start = 0; start < text.length; start += PARSE_CHUNK_CHARS) {
    parser.write(text.slice(start, start + PARSE_CHUNK_CHARS));
    await setImmediate();
  }
  parser.end();
  try {
    await finished;
  } catch (error) {
    throw fileError(`The file is not valid CSV: ${(error as Error).message}`);
  }
  return records;
}

// A text value: trimmed, required, at most 200 characters, no control characters (SPEC.md 7).
function textProblem(field: string, value: string): string | null {
  if (value === '') return `${field} is empty`;
  if (value.length > NAME_MAX_LENGTH)
    return `${field} is longer than ${NAME_MAX_LENGTH} characters`;
  if (CONTROL_CHARACTER.test(value)) return `${field} contains control characters`;
  return null;
}

// One data row to a borrower, or the reason it is rejected (SPEC.md 6). Reasons are worded as in
// the approved mockup.
function readRow(values: string[], row: number): BorrowerImportRow | string {
  if (values.length !== CSV_IMPORT_HEADER.length) {
    return `expected ${CSV_IMPORT_HEADER.length} values, found ${values.length}`;
  }
  const [schoolId, name, rawType, department, rawActive] = values.map((value) => value.trim()) as [
    string,
    string,
    string,
    string,
    string,
  ];
  const problem =
    textProblem('school_id', schoolId) ??
    textProblem('name', name) ??
    textProblem('department', department);
  if (problem) return problem;
  // type is case-insensitive; active is true or false, blank meaning true (SPEC.md 6).
  const type = rawType.toUpperCase();
  if (!TYPES.includes(type)) return `type "${rawType}" is not STUDENT, FACULTY, or EMPLOYEE`;
  const active = rawActive.toLowerCase();
  if (active !== '' && active !== 'true' && active !== 'false') {
    return 'active must be true or false';
  }
  return {
    row,
    schoolId,
    name,
    type: type as BorrowerType,
    department,
    active: active !== 'false',
  };
}

export async function importBorrowerCsv(
  actorId: string,
  file: Buffer,
): Promise<BorrowerImportResult> {
  const text = file.toString('utf8');
  checkRowCount(text);
  const [header, ...data] = await parseCsv(text);
  const columns = header?.record.map((name) => name.trim().toLowerCase());
  if (columns?.join(',') !== CSV_IMPORT_HEADER.join(',')) {
    throw fileError(`The first row must be the header ${CSV_IMPORT_HEADER.join(',')}.`);
  }

  const valid: BorrowerImportRow[] = [];
  const rejected: Rejected[] = [];
  // School IDs are unique regardless of case (SPEC.md 4): a repeat in the same file is rejected.
  const firstRowOf = new Map<string, number>();
  for (const { record, info } of data) {
    const row = info.lines;
    const result = readRow(record, row);
    const schoolId = record[0]?.trim() ?? '';
    if (typeof result === 'string') {
      rejected.push({ row, schoolId, reason: result });
      continue;
    }
    const key = result.schoolId.toLowerCase();
    const first = firstRowOf.get(key);
    if (first !== undefined) {
      rejected.push({ row, schoolId, reason: `school_id is already on row ${first}` });
      continue;
    }
    firstRowOf.set(key, row);
    valid.push(result);
  }

  const counts = await importBorrowers(actorId, valid, rejected.length);
  return { ...counts, rejected };
}
