/* eslint-disable @typescript-eslint/no-explicit-any -- API replies and autocannon JSON are read loosely in this script */
// SEC-2 abuse and load tests (ARCHITECTURE.md 12.7, TC-SEC-11 to TC-SEC-25). Run: npm run test:load
// Needs Docker. Starts its own compose project `bms-load` (web on 127.0.0.1:18180, database
// bms_load, throwaway secrets) and removes it with its data at the end. It never touches the dev
// stack. Load comes from a node container on the compose network (run.ts, slow.ts); everything
// that is measured or checked is done from the host (a different source address) and in SQL.
//
// Settings (environment): FLOOD_SECONDS (60), LOAD_FULL=1 waits out the 15 minute login throttle
// for TC-SEC-22, LOAD_REQUIRE_HRD=1 turns the "HRD-1 / HRD-1b not merged" skips into failures,
// LOAD_KEEP=1 leaves the stack up.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';

const PROJECT = 'bms-load';
const PORT = 18180;
const BASE = `http://127.0.0.1:${PORT}`;
const FLOOD_SECONDS = Number(process.env.FLOOD_SECONDS ?? 60);
const THROTTLE_WINDOW_MS = 15 * 60 * 1000; // ARCHITECTURE.md 12.4
const REQUIRE_HRD = process.env.LOAD_REQUIRE_HRD === '1';
const NODE_IMAGE = 'node:24.11.1-bookworm-slim';

const ENV: NodeJS.ProcessEnv = {
  ...process.env,
  POSTGRES_DB: 'bms_load',
  POSTGRES_USER: 'bms',
  POSTGRES_PASSWORD: randomBytes(16).toString('hex'),
  SESSION_SECRET: randomBytes(32).toString('hex'),
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD: randomBytes(16).toString('hex'),
  WEB_PORT: String(PORT),
  WEB_BIND_ADDRESS: '127.0.0.1',
};

// ---------- results ----------
type Row = { id: string; name: string; status: 'PASS' | 'FAIL' | 'SKIP'; detail: string };
const rows: Row[] = [];
function record(id: string, name: string, status: Row['status'], detail: string) {
  rows.push({ id, name, status, detail });
  console.log(`${status.padEnd(4)} ${id} ${name}: ${detail}`);
}
const check = (id: string, name: string, ok: boolean, detail: string) =>
  record(id, name, ok ? 'PASS' : 'FAIL', detail);
// A part that needs HRD-1 / HRD-1b: skipped with a reason until they are merged.
const skipOrFail = (id: string, name: string, why: string) =>
  record(id, name, REQUIRE_HRD ? 'FAIL' : 'SKIP', why);

// ---------- helpers ----------
const run = (cmd: string, args: string[], input?: string) =>
  execFileSync(cmd, args, {
    env: ENV,
    input,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
const compose = (...args: string[]) => run('docker', ['compose', '-p', PROJECT, ...args]);
// psql inside the db container; the SQL goes in on stdin so quoting never matters.
const sql = (query: string, db = 'bms_load') =>
  run(
    'docker',
    [
      'compose',
      '-p',
      PROJECT,
      'exec',
      '-T',
      'db',
      'psql',
      '-U',
      'bms',
      '-d',
      db,
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    query,
  );
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const p95 = (xs: number[]) =>
  [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * 0.95) - 1)] ?? 0;

// Runs a phase of run.ts in a throwaway container on the compose network (another source address).
function container(phase: string, extraEnv: string[] = []): Promise<any> {
  const args = [
    'run',
    '--rm',
    '--network',
    `${PROJECT}_default`,
    '-v',
    `${process.cwd()}:/repo:ro`,
    '-w',
    '/repo',
  ];
  for (const name of ['FLOOD_SECONDS', 'ADMIN_PASSWORD', ...extraEnv]) args.push('-e', name); // by name: no secret on the command line
  args.push(NODE_IMAGE, 'node', 'tests/load/run.ts', phase, 'http://web:8080');
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { env: ENV });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      try {
        resolve(JSON.parse(out.trim().split('\n').pop()!));
      } catch {
        reject(new Error(`phase ${phase} failed (exit ${code}): ${err || out}`.slice(0, 1500)));
      }
    });
  });
}

type Reply = { status: number; ms: number; json: any };
async function api(
  method: string,
  path: string,
  cookie?: string,
  body?: unknown,
): Promise<Reply & { setCookie?: string }> {
  const start = performance.now();
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'X-Requested-With': 'fetch',
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return {
    status: res.status,
    ms: performance.now() - start,
    json: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text,
    setCookie: res.headers.getSetCookie()[0]?.split(';')[0],
  };
}

// The "other client": a signed-in staff member from the host. Each cycle is a checkout, the
// return of that line, and a dashboard read. Runs until `stop()` is called.
function startClient(cookie: string, ids: { borrower: string; location: string; item: string }) {
  const latencies: number[] = [];
  const failures: string[] = [];
  let running = true;
  const timed = (r: Reply, expected: number, what: string) => {
    latencies.push(r.ms);
    if (r.status !== expected) failures.push(`${what} -> ${r.status} ${r.json?.error?.code ?? ''}`);
    return r;
  };
  const loop = (async () => {
    while (running) {
      const out = timed(
        await api('POST', '/api/transactions', cookie, {
          borrowerId: ids.borrower,
          locationId: ids.location,
          lines: [{ itemId: ids.item, quantity: 1 }],
        }),
        201,
        'checkout',
      );
      const lineId = out.json?.transaction?.lines?.[0]?.id;
      if (lineId) {
        timed(
          await api('POST', '/api/returns', cookie, {
            lines: [{ lineId, quantity: 1, condition: 'GOOD' }],
          }),
          201,
          'return',
        );
      }
      timed(await api('GET', '/api/dashboard/unreturned', cookie), 200, 'dashboard');
      await sleep(600);
    }
  })();
  return {
    stop: async () => {
      running = false;
      await loop;
      return {
        requests: latencies.length,
        p95: p95(latencies),
        max: Math.max(0, ...latencies),
        failures,
      };
    },
  };
}

// ---------- docker stats ----------
function toMiB(text: string): number {
  const [, n, unit] = /([\d.]+)\s*([KMG]i?B)/.exec(text) ?? [];
  const f =
    { KiB: 1 / 1024, KB: 1 / 1024, MiB: 1, MB: 1, GiB: 1024, GB: 1024 }[unit as string] ?? 1;
  return Number(n) * f;
}
const containerId = (service: string) => compose('ps', '-q', service);
function memoryMiB(service: string): { used: number; limit: number } {
  const text = run('docker', [
    'stats',
    '--no-stream',
    '--format',
    '{{.MemUsage}}',
    containerId(service),
  ]);
  const [used, limit] = text.split('/');
  return { used: toMiB(used!), limit: toMiB(limit!) };
}
function restartState(service: string) {
  const [count, oom] = run('docker', [
    'inspect',
    '-f',
    '{{.RestartCount}} {{.State.OOMKilled}}',
    containerId(service),
  ]).split(' ');
  return { restarts: Number(count), oomKilled: oom === 'true' };
}

// ---------- the test ----------
const manilaToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
const daysBefore = (date: string, days: number) =>
  new Date(Date.parse(date) - days * 86_400_000).toISOString().slice(0, 10);

async function main() {
  const startedAt = new Date().toISOString();

  // TC-SEC-16: the seed refuses on production and on a database without "load" in its name.
  const refusedProd = execSeed({ ...ENV, NODE_ENV: 'production' });
  const refusedName = execSeed({ ...ENV, POSTGRES_DB: 'bms' });
  check(
    'TC-SEC-16',
    'seed.ts refuses NODE_ENV=production and a non-load database',
    /production/.test(refusedProd) && /no "load"/.test(refusedName),
    `${refusedProd.trim()} | ${refusedName.trim()}`,
  );

  console.log('Starting the bms-load stack (first run builds the images)...');
  compose('up', '-d', '--build', '--wait');

  // TC-SEC-17: seed.sql also refuses inside the database (run against the "postgres" database).
  let sqlGuard = 'ran';
  try {
    sql(readSeedSql(), 'postgres');
  } catch (error: any) {
    sqlGuard = String(error.stderr);
  }
  check(
    'TC-SEC-17',
    'seed.sql refuses a database without "load" in its name',
    /Refusing to seed/.test(sqlGuard),
    sqlGuard.split('\n')[0]!.slice(0, 120),
  );

  console.log('Seeding...');
  const seeded = run('node', ['tests/load/seed.ts']);
  const [borrowers, items, transactions, , audit] = seeded
    .split('\n')
    .find((l) => /^\d+\|/.test(l))!
    .split('|')
    .map(Number) as number[];
  const actions = sql(
    `SELECT action || '=' || count(*) FROM audit_log GROUP BY action ORDER BY action;`,
  )
    .split('\n')
    .join(', ');
  check(
    'TC-SEC-18',
    'Seed volumes: 5,000 borrowers, 500 items, 20,000 transactions, 100,000+ audit rows',
    borrowers === 5000 && items === 500 && transactions === 20000 && audit! >= 100_000,
    `${borrowers}/${items}/${transactions}/${audit} (${actions})`,
  );

  // Sign in as the admin from the host, and find the ids the clients need.
  const login = await api('POST', '/api/auth/login', undefined, {
    username: 'admin',
    password: ENV.ADMIN_PASSWORD,
  });
  if (login.status !== 200 || !login.setCookie)
    throw new Error(`Admin login failed: ${login.status}`);
  const cookie = login.setCookie;
  const [borrower, location, item, adminId] = sql(`
    SELECT (SELECT id FROM borrowers WHERE school_id = 'LC-1'), (SELECT id FROM locations WHERE name = 'Load room'),
           (SELECT id FROM items WHERE name = 'Load item 460'), (SELECT id FROM users WHERE username = 'admin');`).split(
    '|',
  ) as [string, string, string, string];
  const ids = { borrower, location, item };

  // ---- TC-SEC-11 and TC-SEC-20: login flood ----
  console.log(`Login flood: 200 connections for ${FLOOD_SECONDS} s...`);
  const flood = container('flood');
  const client = startClient(cookie, ids);
  const memory = { peak: 0, limit: 512 };
  const sampler = setInterval(() => {
    const m = memoryMiB('api');
    memory.peak = Math.max(memory.peak, m.used);
    memory.limit = m.limit;
  }, 5000);
  const floodResult = await flood;
  clearInterval(sampler);
  const clientResult = await client.stop();
  const floodEnd = Date.now();
  const codes = Object.fromEntries(
    Object.entries(floodResult.statusCodeStats ?? {}).map(([k, v]: any) => [k, v.count]),
  );
  const fiveXX = Object.entries(codes)
    .filter(([k]) => Number(k) >= 500)
    .reduce((a, [, v]) => a + (v as number), 0);
  const other = await api('POST', '/api/auth/login', undefined, {
    username: 'admin',
    password: ENV.ADMIN_PASSWORD,
  });
  check(
    'TC-SEC-11',
    'Login flood: other client p95 < 2 s, no failures, valid login from another source works',
    clientResult.p95 < 2000 && clientResult.failures.length === 0 && other.status === 200,
    `client ${clientResult.requests} requests, p95 ${clientResult.p95.toFixed(0)} ms, max ${clientResult.max.toFixed(0)} ms, failures ${clientResult.failures.length} ${clientResult.failures.slice(0, 3).join('; ')}; other-source login ${other.status}`,
  );
  check(
    'TC-SEC-20',
    'Login flood is answered by nginx limits: no 5xx, no timeouts, no 2xx',
    fiveXX === 0 && !floodResult.timeouts && !floodResult.errors && !codes['200'],
    `${floodResult.requests.total} requests, status codes ${JSON.stringify(codes)}, errors ${floodResult.errors}, timeouts ${floodResult.timeouts}, p99 ${floodResult.latency.p99} ms`,
  );
  const afterFlood = restartState('api');
  check(
    'TC-SEC-21',
    'Memory and restarts after the flood: api under its limit, no OOM kill, no restart',
    !afterFlood.oomKilled && afterFlood.restarts === 0 && memory.peak < memory.limit,
    `peak ${memory.peak.toFixed(0)} of ${memory.limit.toFixed(0)} MiB, restarts ${afterFlood.restarts}, oomKilled ${afterFlood.oomKilled}`,
  );

  // ---- TC-SEC-14 and TC-SEC-19: heavy reads, a few sequential requests per endpoint ----
  const to = manilaToday();
  const from = daysBefore(to, 365); // 366 days, the maximum (SPEC 7)
  const range = `from=${from}&to=${to}`;
  const heavyBorrower = sql(`SELECT id FROM borrowers WHERE school_id = 'L-1';`);
  const heavyItem = sql(`SELECT id FROM items WHERE name = 'Load item 1';`);
  const reads: [string, string][] = [
    ['usage 366 d', `/api/reports/usage?${range}`],
    [
      'borrower history 366 d, page 100',
      `/api/reports/borrowers/${heavyBorrower}/history?${range}&page=1&pageSize=100`,
    ],
    [
      'item history 366 d, page 100',
      `/api/reports/items/${heavyItem}/history?${range}&page=1&pageSize=100`,
    ],
    ['items ?q=', '/api/items?q=Load%20item%201&page=1&pageSize=100'],
    ['borrowers ?q=', '/api/borrowers?q=Load%20Borrower%201&page=1&pageSize=100'],
    ['returns/open ?q=', '/api/returns/open?by=borrower&q=Load%20Borrower&page=1&pageSize=100'],
    ['flags ?q=', '/api/flags?q=Load&page=1&pageSize=100'],
  ];
  const audit1 = await api('GET', `/api/audit?${range}&page=1&pageSize=100`, cookie);
  const auditAvailable = audit1.status !== 404;
  if (auditAvailable) {
    reads.push(['audit viewer 366 d', `/api/audit?${range}&page=1&pageSize=100`]);
    reads.push([
      'audit viewer, entity=transaction',
      `/api/audit?${range}&entity=transaction&page=1&pageSize=100`,
    ]);
    reads.push([
      'audit viewer, actor=admin',
      `/api/audit?${range}&actor=${adminId}&page=1&pageSize=100`,
    ]);
  }
  const readResults: string[] = [];
  let slowest = { name: '', ms: 0 };
  let bad = '';
  for (const [name, path] of reads) {
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await api('GET', path, cookie);
      if (r.status !== 200) bad ||= `${name} -> ${r.status}`;
      times.push(r.ms);
    }
    const max = Math.max(...times);
    if (max > slowest.ms) slowest = { name, ms: max };
    readResults.push(`${name}: max ${max.toFixed(0)} ms`);
    if (name.startsWith('audit'))
      record(
        'TC-SEC-19',
        `Audit viewer filter "${name}" under 2 s`,
        max < 2000 ? 'PASS' : 'FAIL',
        `max ${max.toFixed(0)} ms of 5`,
      );
  }
  check(
    'TC-SEC-14',
    'Reports and search at maximum ranges on seeded data answer in under 2 s',
    !bad && slowest.ms < 2000,
    `${bad || 'all 200'}; ${readResults.join('; ')}`,
  );
  if (!auditAvailable)
    skipOrFail(
      'TC-SEC-19',
      'Audit viewer filters under 2 s',
      'GET /api/audit not found (HRD-1 not merged)',
    );

  // ---- TC-SEC-12 and TC-SEC-23: slow connections ----
  console.log('Slow connections: 25 sockets dripping headers for 25 s...');
  const slow = container('slow');
  const slowClient = startClient(cookie, ids);
  const slowResult = await slow;
  const slowClientResult = await slowClient.stop();
  check(
    'TC-SEC-12',
    'Slow connections: other clients keep working',
    slowClientResult.failures.length === 0 && slowClientResult.p95 < 2000,
    `${slowClientResult.requests} requests, p95 ${slowClientResult.p95.toFixed(0)} ms, failures ${slowClientResult.failures.length}`,
  );
  check(
    'TC-SEC-23',
    'nginx drops every slow socket (client_header_timeout 10 s)',
    slowResult.stillOpen === 0 && Math.max(...slowResult.closedAfterMs) < 15_000,
    `${slowResult.sockets - slowResult.stillOpen} of ${slowResult.sockets} closed, last after ${Math.max(0, ...slowResult.closedAfterMs)} ms`,
  );

  // ---- TC-SEC-13 and TC-SEC-24: oversized input ----
  const oversize = await container('oversize');
  const statuses = (r: any) =>
    JSON.stringify(
      Object.fromEntries(
        Object.entries(r.statusCodeStats ?? {}).map(([k, v]: any) => [k, v.count]),
      ),
    );
  const only413 = (r: any) =>
    Object.keys(r.statusCodeStats ?? {}).every((k) => k === '413') && r.requests.total > 0;
  check(
    'TC-SEC-13',
    'Oversized JSON (150 KB) and CSV (3 MB) get 413 under load',
    only413(oversize.jsonLoad) && only413(oversize.csvLoad),
    `json ${statuses(oversize.jsonLoad)}, csv ${statuses(oversize.csvLoad)}`,
  );
  const probes = [oversize.jsonProbe, oversize.csvProbe];
  const controlOk = oversize.control.reachedExpress === true;
  check(
    'TC-SEC-24',
    '413 answers come from nginx (API error body, none of the Express headers)',
    probes.every((p) => p.status === 413 && p.code === 'PAYLOAD_TOO_LARGE' && !p.reachedExpress) &&
      controlOk,
    JSON.stringify({ ...probes, control: oversize.control }),
  );

  // ---- TC-SEC-15 and TC-SEC-25: flagging under load ----
  console.log('Flagging under load...');
  const eligibleSql = `
    SELECT count(*) FROM transaction_items ti JOIN transactions t ON t.id = ti.transaction_id,
      (SELECT CASE WHEN x <= now() THEN x ELSE x - interval '1 day' END AS closing FROM
        (SELECT (date_trunc('day', now() AT TIME ZONE 'Asia/Manila') + closing_time::time) AT TIME ZONE 'Asia/Manila' AS x
         FROM settings WHERE id = 1) q) c
    WHERE ti.flag_status = 'NONE' AND ti.quantity_returned < ti.quantity_borrowed AND t.issued_at < c.closing;`;
  const eligible = Number(sql(eligibleSql));
  const flaggedBefore = Number(
    sql(`SELECT count(*) FROM audit_log WHERE action = 'LINE_FLAGGED';`),
  );
  const runsBefore = Number(sql(`SELECT count(*) FROM audit_log WHERE action = 'FLAGGING_RUN';`));
  ENV.LOAD_COOKIE = cookie;
  const load = container('load', ['LOAD_COOKIE']);
  await sleep(3000); // let the background load start
  const [first, second] = await Promise.all([
    api('POST', '/api/flagging/run', cookie),
    api('POST', '/api/flagging/run', cookie),
  ]);
  const loadResult = await load;
  const winner = [first, second].find((r) => r.status === 200);
  const loser = [first, second].find((r) => r.status !== 200);
  const flaggedNow = Number(sql(`SELECT count(*) FROM audit_log WHERE action = 'LINE_FLAGGED';`));
  const stillEligible = Number(sql(eligibleSql));
  const doubles = Number(
    sql(
      `SELECT count(*) FROM (SELECT entity_id FROM audit_log WHERE action = 'LINE_FLAGGED' GROUP BY entity_id HAVING count(*) > 1) d;`,
    ),
  );
  const loadCodes = Object.fromEntries(
    Object.entries(loadResult.statusCodeStats ?? {}).map(([k, v]: any) => [k, v.count]),
  );
  check(
    'TC-SEC-15',
    'Flagging under load: one run does the work, the other is refused, and nothing is left unflagged',
    !!winner &&
      winner.json?.run?.flagged === eligible &&
      !winner.json.run.skipped &&
      loser?.status === 429 &&
      stillEligible === 0 &&
      !('500' in loadCodes),
    `eligible ${eligible}, run ${JSON.stringify(winner?.json?.run)}, second call ${loser?.status}, still eligible ${stillEligible}, background load ${loadResult.requests.total} requests ${JSON.stringify(loadCodes)}`,
  );
  check(
    'TC-SEC-25',
    'Every line has at most one LINE_FLAGGED entry, and the run wrote one per flagged line',
    doubles === 0 && flaggedNow - flaggedBefore === eligible,
    `lines with 2+ entries ${doubles}, new entries ${flaggedNow - flaggedBefore} (eligible ${eligible})`,
  );
  const runEntries = sql(
    `SELECT count(*) || '|' || count(*) FILTER (WHERE after IS NOT NULL) FROM audit_log WHERE action = 'FLAGGING_RUN';`,
  )
    .split('|')
    .map(Number) as [number, number];
  if (runEntries[0] === runsBefore)
    skipOrFail(
      'TC-SEC-25',
      'FLAGGING_RUN entry written once for the run',
      'no FLAGGING_RUN entry (HRD-1b not merged)',
    );
  else
    check(
      'TC-SEC-25',
      'FLAGGING_RUN entry written once for the run',
      runEntries[0] - runsBefore === 1 && runEntries[1] === runEntries[0],
      `new entries ${runEntries[0] - runsBefore}, with an "after" ${runEntries[1]} of ${runEntries[0]}`,
    );

  // ---- TC-SEC-21: final memory and restart state of every service ----
  const finalState = ['api', 'web', 'db'].map((s) => ({
    s,
    ...restartState(s),
    mem: memoryMiB(s),
  }));
  check(
    'TC-SEC-21',
    'Memory and restarts at the end of the whole run: no service restarted, OOM-killed or over its limit',
    finalState.every((x) => x.restarts === 0 && !x.oomKilled && x.mem.used < x.mem.limit),
    finalState
      .map(
        (x) =>
          `${x.s}: ${x.mem.used.toFixed(0)}/${x.mem.limit.toFixed(0)} MiB, restarts ${x.restarts}, oom ${x.oomKilled}`,
      )
      .join('; '),
  );

  // ---- TC-SEC-22: valid login from the flooding address once the 15 minute window has passed ----
  const waitMs = floodEnd + THROTTLE_WINDOW_MS + 15_000 - Date.now();
  if (waitMs > 0 && process.env.LOAD_FULL !== '1') {
    record(
      'TC-SEC-22',
      'Valid login from the flooded address after the throttle window',
      'SKIP',
      `set LOAD_FULL=1 to wait ${Math.ceil(waitMs / 1000)} s more`,
    );
  } else {
    if (waitMs > 0) {
      console.log(`Waiting ${Math.ceil(waitMs / 1000)} s for the login throttle window...`);
      await sleep(waitMs);
    }
    const again = await container('login');
    check(
      'TC-SEC-22',
      'Valid login from the flooded address after the throttle window',
      again.status === 200,
      `status ${again.status}`,
    );
  }

  return startedAt;
}

function readSeedSql() {
  return readFileSync(new URL('./seed.sql', import.meta.url), 'utf8');
}
function execSeed(env: NodeJS.ProcessEnv): string {
  try {
    execFileSync('node', ['tests/load/seed.ts'], {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return 'seed ran';
  } catch (error: any) {
    return String(error.stderr);
  }
}

let startedAt = '';
try {
  startedAt = await main();
} catch (error) {
  record(
    'TC-SEC-ERR',
    'The load test itself',
    'FAIL',
    String((error as Error).message).slice(0, 800),
  );
} finally {
  if (process.env.LOAD_KEEP !== '1') {
    try {
      compose('down', '-v');
    } catch {
      // already gone
    }
  }
}

const dockerInfo = (() => {
  try {
    return run('docker', [
      'info',
      '--format',
      '{{.NCPU}} CPUs, {{.MemTotal}} bytes, Docker {{.ServerVersion}}',
    ]);
  } catch {
    return 'unknown';
  }
})();
console.log(
  `\nMachine: ${cpus().length} x ${cpus()[0]?.model.trim()}, ${(totalmem() / 2 ** 30).toFixed(1)} GiB RAM; Docker VM: ${dockerInfo}`,
);
console.log(
  `Started ${startedAt}. flood ${FLOOD_SECONDS} s. LOAD_FULL=${process.env.LOAD_FULL ?? '0'}`,
);
const failed = rows.filter((r) => r.status === 'FAIL').length;
console.log(
  `${rows.filter((r) => r.status === 'PASS').length} passed, ${failed} failed, ${rows.filter((r) => r.status === 'SKIP').length} skipped`,
);
process.exit(failed ? 1 : 0);
