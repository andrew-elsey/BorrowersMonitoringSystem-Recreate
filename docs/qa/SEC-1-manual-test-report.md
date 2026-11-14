# SEC-1 Manual Test Report
Date / build or commit: 2026-11-07, feature/SEC-1-edge-limits at 5ec50a8
Environment: docker compose stack on 127.0.0.1:8080 (api and web rebuilt from 5ec50a8 by the developer; not rebuilt by QA). curl, node scripts, headless Edge (own profile, deleted afterwards). Windows 11.
Verdict: PASS (no defects found; 3 owner-relevant observations)

Scope note: `npm test`, `npm run test:nginx`, lint and typecheck were NOT run by me (another agent runs the suite). The BRW-3 checkout screen does not exist on this branch, so "Checkout search" was not tested. This is not a mockup-comparison ticket (no new screen), so the Artifact mockup was not read.

## Acceptance criteria results
| # | Criterion | Result | Notes |
|---|---|---|---|
| 1 | nginx rate and connection limits per ARCH 12.2, Retry-After on 429 | Pass | 60 parallel `GET /api/auth/me`: 30 x 401 then 30 x 429 JSON, `Retry-After: 1`. Login: 6 bad logins pass, 7th and 8th get nginx 429 with `Retry-After: 12`. 40 stalled POSTs (header sent, body withheld): 30 held, 10 got 429; a new request meanwhile got 429 JSON with `Retry-After: 1`; after nginx's 10 s body timeout `/api/health` returned 200 again. |
| 2 | nginx's own 413 and 429 are standard JSON, never HTML, through nginx | Pass | 200 KB body to POST `/api/auth/login`, `/api/auth/password`, `/api/items`, `/api/borrowers`, `/api/nonexistent`, PUT `/api/items/1`, POST `/` (text/plain), and a chunked POST: all `413 application/json` `PAYLOAD_TOO_LARGE`, no HTML. 429s from rate and connection limits are JSON `RATE_LIMITED` with `Retry-After`. |
| 3 | /assets sends a single `Cache-Control: public, max-age=31536000, immutable` | Pass | `curl -I /assets/index-COnFqtf6.js` shows exactly one Cache-Control line with that value. |
| 4 | Express global and expensive-endpoint limiters per ARCH 12.3 | Pass | Search: 30 x `GET /api/items?q=ab` as admin return 200, the 31st returns 429 JSON (`application/json; charset=utf-8`, `RATE_LIMITED`, `Retry-After: 52`). `/api/borrowers?q=` has its own bucket (still 200 right after). `GET /api/items` without `q` not limited. Global: about 11 req/s for 62 s: 620 x 401, then 25 Express 429s (charset header, `Retry-After: 3`, standard JSON) plus 37 nginx 429s; `/api/health` stayed 200 during the flood. |
| 5 | trust proxy: clients limited independently; nginx overwrites X-Forwarded-For | Pass (partly by design) | 60 parallel requests each with a different spoofed `X-Forwarded-For` and `X-Real-IP`: still 31 x 401 and 29 x 429, so spoofing does not create new buckets. "Two different real addresses limited independently" cannot be reproduced from one PC; that part is covered by `test:nginx` / `request-limits.test.ts`, which I did not run. |
| 6 | Node server timeouts set | Not tested | Read-only in code (headers 15 s, request 30 s, keep-alive 5 s per card comment); I did not verify behaviour. nginx's own body timeout was observed (item 1). |
| 7 | One central error handler, crash-and-restart on unhandled errors | Pass (restart only) | Killed the node process (PID 7, SIGKILL) inside the api container: Docker restarted it (RestartCount 1, healthy), first poll 3 s later returned 502, the next poll 3 s after that returned 200. The old session cookie still worked. The unhandled-rejection exit path itself was not triggered (needs code change). |
| 8 | Input limits in SPEC 7 enforced in shared Zod schemas | Not tested | Not a manual target here beyond the borrower/item `q` bounds; left to the automated suite. |
| 9 | RATE_LIMITED, PAYLOAD_TOO_LARGE, SERVER_BUSY tested | Partly | RATE_LIMITED and PAYLOAD_TOO_LARGE seen by hand (above). SERVER_BUSY not exercised (card says covered by TC-AUTH-13). |
| 10 | Login throttle never locks the account (BR 16) | Pass | 16 bad logins for username `floodtest` (nginx pace). After 10 failures Express answered `429 RATE_LIMITED` "Too many failed sign-in attempts" with `Retry-After: 835` (counts down). A valid `admin` login right after returned 200. At the very end admin login was 200 again; I never failed a login as `admin`, so the admin account was never throttled. |

## Additional tests run
- Browser (headless Edge, 1200 px): sign in through the login screen works; Inventory loads; Borrowers loads and searches (maria, juan, santos return rows). No console-visible failures; the only non-2xx was the expected 401 on `/api/auth/me` before sign-in.
- Search rate (owner question 2), measured with the 300 ms debounce in the code:
  - Typing a whole word at 100 ms per key (about 600 chars a minute) sends 1 request per word: "laptop", "projector", "cord" gave 3 requests.
  - Slow, hunt-and-peck typing at 450 ms per key sent 12 requests for the single term "extension cord" (one per character after the minimum of 2). Two to three such terms in one minute hit the 30/min limit, and so would a few handlers sharing one PC/IP.
  - Quick check: after the limiter was hit, the Inventory screen showed "Too many requests. Try again in 34 seconds." with a Retry button. Friendly message, countdown correct.
- Narrow window (400 px) on Borrowers: no horizontal overflow (scrollWidth 385 vs 400).
- Regression: `/api/auth/me`, items and borrowers lists, login, change of session after the api restart all behave normally.
- qa-handler / qa-viewer: login with QA_PASSWORD returned 401 for both (users do not exist or use another password), so I tested as admin only. No role-based differences are part of SEC-1.

## Defects
None found.

## Observations (not bugs)
1. Owner Q2 (search limit): 30/min per IP per endpoint is easy to hit when typing slowly because every character after the second fires a request (12 requests for "extension cord" at 450 ms/key). A fast typist uses 1 request per term. Several handlers behind one PC/IP share the same bucket. I agree with the reviewer that about 120/min for search is safer; the owner decides. The UI handles the limit gracefully.
2. nginx's api limit (10 r/s, burst 30) also applies to `/api/health` through port 8080, so a flood from one IP gets nginx 429 on health too; only the Express global limiter skips health. Docker's own healthcheck is not affected as far as I observed. Worth a line in ARCH 12.2 if "health never limited" is meant to include nginx.
3. The global Express limit (600/min) can only be reached through nginx by sustained traffic just above 10 req/s (the burst of 30 helps once). At exactly 10 req/s for 80 s I got no Express 429 at all (800 x 401), so in practice nginx is the effective limiter and the Express global limiter is a second layer.
4. After a SIGKILL of the api, Docker restarted it with the same container IP and nginx recovered within about 6 s (one 502 only). The FND-8 stale-IP 502 problem did not show on a crash restart. I did not run `docker compose stop api` then `start` (known FND-8 case).
5. Owner Q1: Retry-After 12 s on login matches the 5/min rate and the 1 s elsewhere matches 10 r/s; both looked sensible in practice.
6. Owner Q3 (BRW-3 lookup limiter) could not be checked: the endpoint is not on this branch.
7. Express's login 429 uses `Retry-After: 835` (about 14 minutes) while nginx's uses 12: expected, two different limiters.

## Not tested
- `npm test`, `npm run test:nginx`, lint, typecheck (told not to run).
- Node server timeouts behaviour, unhandled-rejection exit path, SERVER_BUSY, SPEC 7 schema bounds.
- Two genuinely different client IPs limited independently (single PC).
- Checkout search screen (not on this branch); role-specific accounts (qa-handler, qa-viewer could not sign in).
- `docker compose stop/start api` and the FND-8 502.
