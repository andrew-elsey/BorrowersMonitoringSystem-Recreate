// Backs up the database to BACKUP_DIR (HRD-3, ARCHITECTURE.md 12.6). Run on the host: `npm run backup`.
// pg_dump runs inside the db container; its output is streamed into a file on the host.
// The session table's rows are left out (they only hold sign-ins, which a restore would invalidate anyway).
import { spawn } from 'node:child_process';
import { createWriteStream, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { once } from 'node:events';
import { join } from 'node:path';
import { backupFileName, filesToPrune, loadEnv } from './backup-lib.ts';

loadEnv();
const dir = process.env.BACKUP_DIR; // rule 3: no default, and never inside the repo
if (!dir) {
  console.error(
    'BACKUP_DIR is not set. Set it in .env to a folder outside the project (see .env.example).',
  );
  process.exit(1);
}

const finalPath = join(dir, backupFileName(new Date()));
const partialPath = `${finalPath}.partial`;
const out = createWriteStream(partialPath);
const dump = spawn(
  'docker',
  [
    'compose',
    'exec',
    '-T',
    'db',
    'sh',
    '-c',
    'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --exclude-table-data=session',
  ],
  { stdio: ['ignore', 'pipe', 'inherit'] },
);
dump.stdout.pipe(out);
const [[code]] = await Promise.all([once(dump, 'close'), once(out, 'close')]);

if (code !== 0 || statSync(partialPath).size === 0) {
  rmSync(partialPath, { force: true });
  console.error('Backup failed. Nothing was kept and no old backups were deleted.');
  process.exit(1);
}
renameSync(partialPath, finalPath);
console.log(`Backup written: ${finalPath}`);

// Prune only after a good backup.
const files = readdirSync(dir).map((name) => ({
  name,
  mtimeMs: statSync(join(dir, name)).mtimeMs,
}));
for (const name of filesToPrune(files, Date.now())) {
  rmSync(join(dir, name));
  console.log(`Deleted old backup: ${name}`);
}
