// Loads the SEC-2 data (seed.sql) into the throwaway load stack. Never runs where real data could
// be: it refuses when NODE_ENV is production or the database name has no "load" in it (D18), and
// seed.sql checks current_database() again. Runs on the host because the api container always has
// NODE_ENV=production. Used by main.ts; also usable alone:
//   POSTGRES_DB=bms_load POSTGRES_USER=bms node tests/load/seed.ts
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const db = process.env.POSTGRES_DB ?? '';
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed: NODE_ENV is production.');
  process.exit(1);
}
if (!db.includes('load')) {
  console.error(`Refusing to seed: database name "${db}" has no "load" in it.`);
  process.exit(1);
}

const sql = readFileSync(new URL('./seed.sql', import.meta.url));
const out = execFileSync(
  'docker',
  [
    'compose',
    '-p',
    'bms-load',
    'exec',
    '-T',
    'db',
    'psql',
    '-U',
    process.env.POSTGRES_USER ?? 'bms',
    '-qAt',
    '-d',
    db,
  ],
  { input: sql, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
);
console.log(out.trim());
