// Restores a backup made by backup.ts (HRD-3, ARCHITECTURE.md 12.6): `npm run restore -- <file>`.
// This REPLACES the whole database. The api is stopped first and started again afterwards, which
// reruns migrations and the seed. Every session is gone after a restore, so everyone signs in again.
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { once } from 'node:events';
import { createInterface } from 'node:readline/promises';
import { isConfirmed, loadEnv } from './backup-lib.ts';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

loadEnv();
const file = process.argv[2];
if (!file) fail('Usage: npm run restore -- <path to a bms-*.dump file>');
if (!process.stdin.isTTY)
  fail('Restore needs a person at the keyboard (it asks for a typed confirmation).');

const databaseName = process.env.POSTGRES_DB ?? 'bms';

// Streams the file into a command run inside the db container; resolves to its exit code.
async function runInDb(command: string, stdout: 'ignore' | 'inherit'): Promise<number | null> {
  const fd = openSync(file!, 'r'); // a file descriptor, because spawn cannot take a stream that is not open yet
  try {
    const child = spawn('docker', ['compose', 'exec', '-T', 'db', 'sh', '-c', command], {
      stdio: [fd, stdout, 'inherit'],
    });
    return (await once(child, 'close'))[0] as number | null;
  } finally {
    closeSync(fd);
  }
}

// Dry check: pg_restore --list must be able to read the file before anything is stopped.
if ((await runInDb('pg_restore --list', 'ignore')) !== 0) {
  fail('That file is not a readable backup. Nothing was changed.');
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const typed = await rl.question(
  `This replaces ALL data in "${databaseName}". Type the database name to continue: `,
);
rl.close();
if (!isConfirmed(typed, databaseName)) fail('Not confirmed. Nothing was changed.');

spawnSync('docker', ['compose', 'stop', 'api'], { stdio: 'inherit' });
let code: number | null;
try {
  code = await runInDb(
    'pg_restore --clean --if-exists --no-owner --single-transaction -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
    'inherit',
  );
} finally {
  spawnSync('docker', ['compose', 'start', 'api'], { stdio: 'inherit' });
}
if (code !== 0)
  fail(
    'Restore failed; the database was left as it was (single transaction). The api was started again.',
  );
console.log('Restore finished. Everyone must sign in again.');
