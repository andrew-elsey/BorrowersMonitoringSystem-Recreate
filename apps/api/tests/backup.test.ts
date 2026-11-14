import { describe, expect, it } from 'vitest';
import { backupFileName, filesToPrune, isBackupFile, isConfirmed } from '../scripts/backup-lib.ts';

// TC-HRD-25 to TC-HRD-27: the pure choices the backup and restore scripts make.
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-14T12:00:00Z');

describe('backup file names', () => {
  it('TC-HRD-25: names a dump bms-YYYYMMDD-HHmmss.dump and recognises it', () => {
    const name = backupFileName(new Date(2026, 10, 4, 9, 5, 7));
    expect(name).toBe('bms-20261104-090507.dump');
    expect(isBackupFile(name)).toBe(true);
    expect(isBackupFile(`${name}.partial`)).toBe(false);
  });
});

describe('pruning', () => {
  it('TC-HRD-26: removes only our dumps older than 14 days', () => {
    const files = [
      { name: 'bms-20261001-010101.dump', mtimeMs: NOW - 20 * DAY },
      { name: 'bms-20261110-010101.dump', mtimeMs: NOW - 4 * DAY },
      { name: 'bms-20261031-010101.dump', mtimeMs: NOW - 14 * DAY - 1 },
      { name: 'notes.txt', mtimeMs: NOW - 90 * DAY },
      { name: 'bms-20260101-000000.dump.partial', mtimeMs: NOW - 90 * DAY },
    ];
    expect(filesToPrune(files, NOW)).toEqual([
      'bms-20261001-010101.dump',
      'bms-20261031-010101.dump',
    ]);
  });
});

describe('restore confirmation', () => {
  it('TC-HRD-27: accepts only the exact database name', () => {
    expect(isConfirmed('bms', 'bms')).toBe(true);
    expect(isConfirmed(' bms \n', 'bms')).toBe(true);
    expect(isConfirmed('yes', 'bms')).toBe(false);
    expect(isConfirmed('', 'bms')).toBe(false);
  });
});
