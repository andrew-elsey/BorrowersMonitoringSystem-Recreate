// HRD-2: `npm run test:e2e`. Starts a separate compose project (bms-e2e, own database volume, port
// 18280, throwaway secrets), runs Playwright in a container on that project's network, then removes
// everything with `down -v`. It never touches the dev stack on 8080.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const { version } = JSON.parse(
  readFileSync(resolve(root, 'node_modules/@playwright/test/package.json'), 'utf8'),
);
// The image carries the browsers for exactly this Playwright version.
const image = `mcr.microsoft.com/playwright:v${version}-noble`;

const env = {
  ...process.env,
  WEB_PORT: '18280',
  WEB_BIND_ADDRESS: '127.0.0.1',
  POSTGRES_PASSWORD: randomBytes(12).toString('hex'),
  SESSION_SECRET: randomBytes(32).toString('hex'),
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD: randomBytes(12).toString('hex'),
  COOKIE_SECURE: 'false',
};

const run = (args: string[]) => spawnSync('docker', args, { cwd: root, env, stdio: 'inherit' });
const compose = (...args: string[]) => run(['compose', '-p', 'bms-e2e', ...args]);

let status = 1;
// Ctrl+C skips the finally block below, so start from a clean project after an interrupted run.
compose('down', '-v');
try {
  if (compose('up', '-d', '--build', '--wait').status === 0) {
    status =
      run([
        'run',
        '--rm',
        '--ipc=host',
        '--network',
        'bms-e2e_default',
        '-v',
        `${root}:/work`,
        '-w',
        '/work',
        '-e',
        'BASE_URL=http://web:8080',
        '-e',
        'ADMIN_USERNAME',
        '-e',
        'ADMIN_PASSWORD',
        image,
        'npx',
        'playwright',
        'test',
        '-c',
        'tests/e2e',
      ]).status ?? 1;
  }
} finally {
  compose('down', '-v');
}
process.exit(status);
