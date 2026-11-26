// Slowloris-style test (SEC-2, ARCHITECTURE.md 12.7 item 2): about 25 sockets send a request one
// header at a time and never finish it. nginx's client_header_timeout (10 s) must drop each one.
// Prints {"sockets":N,"closedAfterMs":[...],"stillOpen":N}. Node `net` only, no dependency.
//   node tests/load/slow.ts http://web:8080
import net from 'node:net';

const SOCKETS = 25;
const WATCH_MS = 25_000;
const url = new URL(process.argv[2] ?? 'http://web:8080');
const started = Date.now();
const closedAfterMs: number[] = [];

for (let i = 0; i < SOCKETS; i++) {
  const socket = net.connect(Number(url.port), url.hostname, () => {
    socket.write(`GET /api/health HTTP/1.1\r\nHost: ${url.host}\r\n`);
    // Drip one more header every 2 s, forever: the request never completes.
    const drip = setInterval(() => socket.write(`X-Slow: ${i}\r\n`), 2000);
    socket.on('close', () => clearInterval(drip));
  });
  socket.on('error', () => {});
  socket.on('data', () => {}); // nginx answers 408 before it closes
  socket.on('close', () => closedAfterMs.push(Date.now() - started));
}

setTimeout(() => {
  console.log(
    JSON.stringify({ sockets: SOCKETS, closedAfterMs, stillOpen: SOCKETS - closedAfterMs.length }),
  );
  process.exit(0);
}, WATCH_MS);
