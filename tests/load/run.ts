// Load generator for SEC-2. Runs INSIDE a node container on the bms-load compose network, with the
// repo mounted read-only, so its requests come from another source address than the host and go
// through nginx (http://web:8080). main.ts starts it once per phase and reads the JSON it prints.
//   node tests/load/run.ts <phase> <baseUrl>
// Phases: flood, load, oversize, slow, login. Secrets come in through the environment.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [phase, base] = process.argv.slice(2) as [string, string];
const AUTOCANNON = 'node_modules/autocannon/autocannon.js';

// Runs the autocannon CLI and returns its JSON result (no @types dependency needed).
function autocannon(args: string[]): unknown {
  const out = execFileSync('node', [AUTOCANNON, '--json', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

const JSON_HEADER = ['-H', 'content-type=application/json', '-H', 'X-Requested-With=fetch'];

function flood() {
  const body = JSON.stringify({ username: 'admin', password: 'wrong-password-for-load-test' });
  return autocannon([
    ...['-c', '200', '-d', process.env.FLOOD_SECONDS ?? '60', '-m', 'POST', '-b', body],
    ...JSON_HEADER,
    `${base}/api/auth/login`,
  ]);
}

// Background API traffic for the flagging test: a rate the nginx limit (10 a second) lets through.
function load() {
  return autocannon([
    ...['-c', '8', '-R', '8', '-d', process.env.LOAD_SECONDS ?? '20'],
    ...['-H', `cookie=${process.env.LOAD_COOKIE}`],
    `${base}/api/dashboard/unreturned`,
  ]);
}

// Bodies over the limits (100 KB JSON, 2 MB CSV). nginx must answer 413 itself: the reply has the
// API error body but none of the headers Express adds (helmet), so it never reached the api.
async function oversize() {
  const dir = mkdtempSync(join(tmpdir(), 'load-'));
  const jsonFile = join(dir, 'big.json');
  const csvFile = join(dir, 'big.csv');
  writeFileSync(jsonFile, JSON.stringify({ username: 'a'.repeat(150 * 1024), password: 'x' }));
  writeFileSync(
    csvFile,
    'school_id,name,type,department\n' + 'L-9,Name,STUDENT,Dept\n'.repeat(150_000),
  );

  const probe = async (path: string, init: RequestInit) => {
    const res = await fetch(base + path, { method: 'POST', ...init });
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
    return {
      status: res.status,
      code: body.error?.code,
      reachedExpress: res.headers.has('x-content-type-options'),
    };
  };
  const form = new FormData();
  form.append('file', new Blob([readFileSync(csvFile)]), 'big.csv');
  return {
    // Control: a normal API answer must carry the Express (helmet) header the 413 answers lack.
    control: {
      reachedExpress: (await fetch(base + '/api/health')).headers.has('x-content-type-options'),
    },
    jsonProbe: await probe('/api/auth/login', {
      headers: { 'content-type': 'application/json', 'X-Requested-With': 'fetch' },
      body: readFileSync(jsonFile),
    }),
    csvProbe: await probe('/api/borrowers/import', {
      headers: { 'X-Requested-With': 'fetch' },
      body: form,
    }),
    jsonLoad: autocannon([
      ...['-c', '10', '-d', '10', '-R', '8', '-m', 'POST', '-i', jsonFile],
      ...JSON_HEADER,
      `${base}/api/auth/login`,
    ]),
    csvLoad: autocannon([
      ...['-c', '4', '-d', '10', '-R', '4', '-m', 'POST'],
      ...['-F', JSON.stringify({ file: { type: 'file', path: csvFile } })],
      ...['-H', 'X-Requested-With=fetch'],
      `${base}/api/borrowers/import`,
    ]),
  };
}

// A valid login from this container's address (used after the throttle window has passed).
async function login() {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Requested-With': 'fetch' },
    body: JSON.stringify({ username: 'admin', password: process.env.ADMIN_PASSWORD }),
  });
  return { status: res.status };
}

const result =
  phase === 'flood'
    ? flood()
    : phase === 'load'
      ? load()
      : phase === 'oversize'
        ? await oversize()
        : phase === 'login'
          ? await login()
          : phase === 'slow'
            ? JSON.parse(
                spawnSync('node', ['tests/load/slow.ts', base], { encoding: 'utf8' }).stdout,
              )
            : (() => {
                throw new Error(`Unknown phase "${phase}"`);
              })();
console.log(JSON.stringify(result));
