// Checks the nginx limits in apps/web/nginx.conf through a real nginx (SEC-1, ARCHITECTURE.md 12.2,
// test cases TC-SEC-01 to TC-SEC-04 and TC-SEC-06). Run with `npm run test:nginx`; needs Docker.
//
// It starts its own containers on a private network, so it never touches the compose stack:
// nginx (the same image as apps/web/Dockerfile) with this repo's nginx.conf on 127.0.0.1:18080,
// and a stub "api" that answers every request with the X-Forwarded-For it received.
// The stub stands in for Express so that every 413 and 429 seen here must come from nginx.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NGINX_IMAGE = 'nginxinc/nginx-unprivileged:1.30.6-alpine';
const NODE_IMAGE = 'node:24.11.1-bookworm-slim';
const NAME = 'bms-nginx-check';
const PORT = Number(process.env.NGINX_CHECK_PORT ?? 18080);
const BASE = `http://127.0.0.1:${PORT}`;
const CONF = new URL('../nginx.conf', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');

const EXPRESS_429_BODY = '{"error":{"code":"RATE_LIMITED","message":"From Express.","details":{}}}';

// Answers like the API would, holding /api/slow open so connections stay in use.
// /api/express-429 answers like the Express limiters, so nginx must pass it through untouched.
const STUB = `require('http').createServer((req, res) => {
  req.resume();
  if (req.url === '/api/express-429') {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '42' });
    return res.end(${JSON.stringify(EXPRESS_429_BODY)});
  }
  const reply = () => res.end(JSON.stringify({ xff: req.headers['x-forwarded-for'] }));
  req.url === '/api/slow' ? setTimeout(reply, 6000) : reply();
}).listen(3000);`;

const docker = (...args: string[]) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function cleanUp() {
  for (const container of [`${NAME}-web`, `${NAME}-api`]) {
    try {
      docker('rm', '-f', container);
    } catch {
      // not running
    }
  }
  try {
    docker('network', 'rm', NAME);
  } catch {
    // not created
  }
}

const html = mkdtempSync(join(tmpdir(), `${NAME}-`));

function start() {
  mkdirSync(join(html, 'assets'));
  writeFileSync(join(html, 'index.html'), '<!doctype html>');
  writeFileSync(join(html, 'assets', 'app-abc123.js'), 'console.log(1);');

  docker('network', 'create', NAME);
  docker(
    'run',
    '-d',
    '--name',
    `${NAME}-api`,
    '--network',
    NAME,
    '--network-alias',
    'api',
    NODE_IMAGE,
    'node',
    '-e',
    STUB,
  );
  docker(
    'run',
    '-d',
    '--name',
    `${NAME}-web`,
    '--network',
    NAME,
    '-p',
    `127.0.0.1:${PORT}:8080`,
    '--mount',
    `type=bind,source=${CONF},target=/etc/nginx/conf.d/default.conf,readonly`,
    '--mount',
    `type=bind,source=${html},target=/usr/share/nginx/html,readonly`,
    NGINX_IMAGE,
  );
}

async function waitForNginx() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return;
    } catch {
      // not up yet
    }
    await sleep(200);
  }
  throw new Error(`nginx did not start:\n${docker('logs', `${NAME}-web`)}`);
}

// A 413 or 429 from nginx must be the API's JSON error, never nginx's HTML page.
async function expectJsonError(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
  assert.deepEqual(await response.json(), {
    error: { code, message: MESSAGES[code], details: {} },
  });
}
const MESSAGES: Record<string, string> = {
  RATE_LIMITED: 'Too many requests. Try again later.',
  PAYLOAD_TOO_LARGE: 'The request is too large.',
};

const statuses = (responses: Response[]) => responses.map((response) => response.status);

const checks: [string, () => Promise<void>][] = [
  [
    'TC-SEC-04: /assets sends exactly one long-lived Cache-Control header',
    async () => {
      const response = await fetch(`${BASE}/assets/app-abc123.js`);
      assert.equal(response.status, 200);
      // fetch joins repeated headers with ", ", so a second header would change this value.
      assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    },
  ],
  [
    'TC-SEC-06: nginx overwrites a fake X-Forwarded-For with the real address',
    async () => {
      const response = await fetch(`${BASE}/api/echo`, {
        headers: { 'X-Forwarded-For': '6.6.6.6' },
      });
      const { xff } = (await response.json()) as { xff: string };
      assert.notEqual(xff, '6.6.6.6');
      assert.doesNotMatch(xff, /6\.6\.6\.6|,/);
    },
  ],
  [
    'an Express 429 passes through nginx with its own body and Retry-After',
    async () => {
      const response = await fetch(`${BASE}/api/express-429`);
      assert.equal(response.status, 429);
      assert.equal(response.headers.get('retry-after'), '42');
      assert.equal(await response.text(), EXPRESS_429_BODY);
    },
  ],
  [
    'TC-SEC-02: a 200 KB body on another API path also gets 413 PAYLOAD_TOO_LARGE as JSON',
    async () => {
      const body = JSON.stringify({ name: 'a'.repeat(200_000) });
      const response = await fetch(`${BASE}/api/items`, { method: 'POST', body });
      await expectJsonError(response, 413, 'PAYLOAD_TOO_LARGE');
    },
  ],
  [
    'TC-SEC-02: a 200 KB body gets 413 PAYLOAD_TOO_LARGE as JSON',
    async () => {
      const body = JSON.stringify({ username: 'a'.repeat(200_000), password: 'x' });
      const response = await fetch(`${BASE}/api/auth/login`, { method: 'POST', body });
      await expectJsonError(response, 413, 'PAYLOAD_TOO_LARGE');
    },
  ],
  [
    'TC-SEC-03: more than 30 open connections from one address get 429',
    async () => {
      // Spaced under 10 a second, so the request rate limit never triggers: only the connection limit.
      const pending: Promise<Response>[] = [];
      for (let i = 0; i < 35; i++) {
        pending.push(fetch(`${BASE}/api/slow`));
        await sleep(120);
      }
      const responses = await Promise.all(pending);
      assert.deepEqual(statuses(responses).slice(0, 30), Array(30).fill(200));
      assert.deepEqual(statuses(responses).slice(30), Array(5).fill(429));
      await expectJsonError(responses[30]!, 429, 'RATE_LIMITED');
      assert.equal(responses[30]!.headers.get('retry-after'), '1');
    },
  ],
  [
    'TC-SEC-01: the login limit (5 a minute, burst 5) answers 429 RATE_LIMITED with Retry-After',
    async () => {
      const login = () => fetch(`${BASE}/api/auth/login`, { method: 'POST', body: '{}' });
      const responses: Response[] = [];
      for (let i = 0; i < 8; i++) responses.push(await login());
      assert.deepEqual(statuses(responses).slice(0, 6), Array(6).fill(200));
      assert.deepEqual(statuses(responses).slice(6), [429, 429]);
      await expectJsonError(responses[6]!, 429, 'RATE_LIMITED');
      assert.equal(responses[6]!.headers.get('retry-after'), '12');
    },
  ],
  [
    'TC-SEC-01: the general API limit (10 a second, burst 30) answers 429 RATE_LIMITED with Retry-After',
    async () => {
      await sleep(4000); // let the earlier checks' requests drain from the bucket
      // One request at a time: never near the connection limit, so only the rate limit can answer 429.
      let limited = 0;
      for (let i = 0; i < 60; i++) {
        const response = await fetch(`${BASE}/api/echo`);
        if (response.status === 429 && limited++ === 0) {
          assert.equal(response.headers.get('retry-after'), '1');
          await expectJsonError(response, 429, 'RATE_LIMITED');
        } else {
          await response.arrayBuffer(); // frees the connection for the next request
        }
      }
      // 31 pass at once (burst 30); the rest come far faster than 10 a second.
      assert.ok(limited >= 15, `expected at least 15 limited, got ${limited}`);
    },
  ],
  [
    'TC-SEC-06: a client with another address is limited independently',
    async () => {
      await sleep(4000);
      // A second client inside the Docker network floods nginx from its own address...
      // One request at a time, as above, so only the rate limit can answer 429.
      const flood = `(async () => {
        let limited = 0;
        for (let i = 0; i < 60; i++) {
          const r = await fetch('http://${NAME}-web:8080/api/echo');
          await r.arrayBuffer();
          if (r.status === 429) limited++;
        }
        console.log(limited);
      })()`;
      const limited = Number(
        docker('run', '--rm', '--network', NAME, NODE_IMAGE, 'node', '-e', flood),
      );
      assert.ok(limited >= 15, `the second client should be limited, got ${limited} 429s`);
      // ...while this client, on another address, is still allowed.
      assert.equal((await fetch(`${BASE}/api/echo`)).status, 200);
    },
  ],
];

cleanUp();
let failed = 0;
try {
  start();
  await waitForNginx();
  for (const [name, check] of checks) {
    try {
      await check();
      console.log(`PASS ${name}`);
    } catch (error) {
      failed++;
      console.log(`FAIL ${name}\n  ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} finally {
  cleanUp();
  rmSync(html, { recursive: true, force: true });
}
console.log(failed === 0 ? `\nAll ${checks.length} nginx checks passed.` : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
