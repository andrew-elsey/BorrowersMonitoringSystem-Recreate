// Pure helpers for backup.ts and restore.ts (HRD-3, ARCHITECTURE.md 12.6). Kept apart so tests can import them.
import { existsSync } from 'node:fs';

export const KEEP_DAYS = 14; // owner decision D14

// Loads .env from the current folder when there is one; variables already set win.
export function loadEnv(): void {
  if (existsSync('.env')) process.loadEnvFile();
}

// Only files that look exactly like our own dumps are ever pruned, never anything else in the folder.
const BACKUP_FILE = /^bms-\d{8}-\d{6}\.dump$/;

export function isBackupFile(name: string): boolean {
  return BACKUP_FILE.test(name);
}

export function backupFileName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const day = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
  return `bms-${day}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.dump`;
}

export function filesToPrune(files: { name: string; mtimeMs: number }[], nowMs: number): string[] {
  const cutoff = nowMs - KEEP_DAYS * 24 * 60 * 60 * 1000;
  return files.filter((f) => isBackupFile(f.name) && f.mtimeMs < cutoff).map((f) => f.name);
}

export function isConfirmed(typed: string, databaseName: string): boolean {
  return typed.trim() === databaseName;
}
