# Backlog and Sprint Plan

Tickets are tracked in Trello (board: "Borrowers Monitoring System", https://trello.com/b/uo6MS7IX/borrowers-monitoring-system). This file is the same plan in a form Claude Code can read offline. The Trello cards were synced with this file on 2026-10-29. If a card and this file disagree, this file is current.

Estimates are story points. Sprints are two weeks with a working capacity of about 20 points. Both are provisional and will be adjusted after Sprint 1.

Scope note: unless a ticket says API or UI only, it includes both its API and its screens (see SPEC 5). All screens are built on the web app shell from FND-5.

Document references: `BR` = `BUSINESS_RULES.md`, `ARCH` = `ARCHITECTURE.md`, `SPEC` = `SPEC.md`.

## Sprint plan

| Sprint | Goal | Tickets | Points |
|---|---|---|---|
| 1 | Foundation and sign-in: running Docker environment, schema, seed data, role-based login with protected hashing | FND-1, FND-2, FND-3, FND-4, AUTH-1, AUTH-2 | 20 |
| 2 | Web app shell and master data: sign-in screens, admins manage items, rooms, borrowers, semesters, settings | FND-5, MD-1, MD-2, MD-3, MD-4, MD-5, MD-7 | 22 |
| 3 | Checkout: handlers can check items out; return API works; rate limits and request limits in place | BRW-1, BRW-2, BRW-3, BRW-4, SEC-1 | 21 |
| 4 | Returns and flagging: full return flow, end-of-day flagging, strikes, blocking, override | BRW-5, FLG-1, FLG-2, FLG-3, FLG-4 | 19 |
| 5 | Dashboard, reports, admin tools | BRW-6, RPT-1, RPT-2, RPT-3, RPT-4, AUTH-3, MD-6 | 20 |
| 6 | Hardening, abuse testing, and release | HRD-1, HRD-2, HRD-3, HRD-4, HRD-5, SEC-2 | 20 |

Total: 122 points. Sprints 2 (22) and 3 (21) are over the working capacity of about 20; that is accepted for now and will be revisited once Sprint 1 shows the real velocity.

## Epic FND: Foundation

**FND-1 · Repo and tooling setup** (2 pts, Sprint 1). Depends on: none.
npm workspaces monorepo with `apps/api`, `apps/web`, `packages/shared`; shared TypeScript config; ESLint; Prettier; Vitest; `.nvmrc`; `.gitignore`.
Acceptance: `npm run lint`, `typecheck`, and `test` run clean from the root; README explains the layout; the Commands section of `CLAUDE.md` matches reality. Refs: ARCH 2, 3.

**FND-2 · Docker Compose environment** (3 pts, Sprint 1). Depends on: FND-1.
Acceptance: `docker compose up --build` starts db, api, and web; `.env.example` documents every variable in ARCH 10; healthchecks pass; data persists across restarts; web serves the app and proxies `/api`; containers use `TZ=Asia/Manila`; the api container uses a Debian-based Node image and runs as a non-root user; only the web port is published; memory, CPU, restart, and log-rotation settings follow ARCH 12.6; Postgres starts with the timeout settings in ARCH 12.5; nginx has the header, body, and timeout limits from ARCH 12.2 (rate limits come in SEC-1). Refs: ARCH 10, 12.

**FND-3 · Database schema, migrations, and audit helper** (5 pts, Sprint 1). Depends on: FND-1, FND-2.
Prisma schema for every table in SPEC 4 with the constraints in ARCH 8, plus the shared enums in `packages/shared` and the reusable `audit(tx, ...)` helper.
Acceptance: the initial migration applies on a clean database; relations, constraints, and indexes are in place; schema matches SPEC 4; the session table exists for the session store (ARCH 5); the audit helper has a test. Refs: SPEC 4, ARCH 4, 5, 8.

**FND-4 · Seed data** (2 pts, Sprint 1). Depends on: FND-3.
Acceptance: the seed creates the first admin from `ADMIN_USERNAME` and `ADMIN_PASSWORD` (fails clearly if missing), settings with default values, sample categories, rooms, items of both tracking types, borrowers, and a current semester; it is safe to re-run; `npm run admin:reset-password` resets any user's password from the command line. Refs: ARCH 5, 12.4.

**FND-5 · Web app shell and API client** (3 pts, Sprint 2). Depends on: AUTH-1, AUTH-2.
React Router layout with navigation, an API client wrapper, TanStack Query setup, an auth context, the login and change-password screens, and shared form and table components for the CRUD screens.
Acceptance: users can sign in, sign out, and change their password from the browser; navigation shows only what the user's role may use (SPEC 3, 5); the API client sends `X-Requested-With: fetch`, understands the standard error format, and shows the error `message`; a 401 returns the user to the login screen; a 429 or 503 shows a "try again in N seconds" message from `Retry-After`. Refs: SPEC 3, 5, ARCH 2, 5, 7.

## Epic AUTH: Authentication and users

**AUTH-1 · Login, logout, and password change** (5 pts, Sprint 1). Depends on: FND-3, FND-4.
Server-side sessions and argon2id hashing behind a concurrency limiter, as decided in ARCH 5 and 12.4. This ticket is API only; the login and change-password screens are built in FND-5.
Acceptance: valid login works; invalid login shows a generic error; logout ends the session; inactive users cannot log in; a logged-in user can change their own password; cookie settings follow ARCH 5 and the CSRF header is enforced; sessions are created only after a successful login and the session ID is regenerated at login; all hashing goes through the limiter, and a full queue returns 503 `SERVER_BUSY` with `Retry-After`; failed logins are throttled per IP and username and per IP, never locked (BR 16, scenario S20); `trust proxy` is configured; an unknown username costs the same as a wrong password. Refs: ARCH 5, 12.3, 12.4.

**AUTH-2 · Role-based access** (3 pts, Sprint 1). Depends on: AUTH-1.
Acceptance: `requireRole` middleware enforces the permission table in SPEC 3; unauthorized API calls return 403 with `FORBIDDEN`; tests cover each role (BR scenario S18). Hiding navigation by role is part of FND-5.

**AUTH-3 · User management** (3 pts, Sprint 5). Depends on: AUTH-2.
Acceptance: admins create, edit, and deactivate users and reset passwords; users with transactions are deactivated, never deleted (BR 15); an admin cannot deactivate themselves; changes are audited.

## Epic MD: Master data

**MD-1 · Categories CRUD** (2 pts, Sprint 2). Depends on: AUTH-2, FND-5.
Acceptance: admins create, rename, and delete unused categories; categories in use cannot be deleted (`HAS_HISTORY`).

**MD-2 · Items CRUD** (5 pts, Sprint 2). Depends on: MD-1.
Acceptance: UNIT items require a unique asset tag and have total quantity 1; QUANTITY items have no asset tag and total quantity 0 or more; fields: name, category, description, condition, status (SPEC 4); search and filter by name, category, status, and tracking type, paginated; items with history are retired, never deleted (BR 15, scenario S19).

**MD-3 · Rooms and labs** (3 pts, Sprint 2). Depends on: AUTH-2, FND-5.
Acceptance: admins have full CRUD; handlers can add a room through a quick-add endpoint; duplicate names are rejected case-insensitively (`DUPLICATE_VALUE`); `created_by` is recorded; admins can deactivate rooms.

**MD-4 · BorrowerService** (3 pts, Sprint 2). Depends on: FND-3.
Interface and `LocalBorrowerService` as specified in ARCH 4.
Acceptance: no code outside the implementation queries the borrowers table; integration points are documented in comments; a test double replaces the implementation without changes to callers.

**MD-5 · Borrowers CRUD and search** (3 pts, Sprint 2). Depends on: MD-4, FND-5.
Acceptance: fields per SPEC 4; search by name or school ID returns quickly; inactive borrowers cannot be selected at checkout; all reads go through BorrowerService.

**MD-6 · Borrower CSV import** (3 pts, Sprint 5). Depends on: MD-5.
Acceptance: format per SPEC 6; valid rows are created or updated by school ID; the result reports counts of created, updated, and rejected rows with reasons; the import is audited; upload limits per SPEC 7 (2 MB, one file, 5,000 rows) are enforced before parsing and return `PAYLOAD_TOO_LARGE`; parsing does not block other requests.

**MD-7 · Semesters and settings** (3 pts, Sprint 2). Depends on: AUTH-2, FND-5.
Acceptance: admins define semesters with start and end dates and exactly one current semester; settings for closing time and the three thresholds with validation (warning < notice < block); changes are audited; checkout reads the current semester.

## Epic BRW: Borrowing

**BRW-1 · Availability service** (3 pts, Sprint 3). Depends on: MD-2.
Acceptance: BR 1; unit tests cover partial returns and non-ACTIVE items.

**BRW-2 · Checkout API** (5 pts, Sprint 3). Depends on: BRW-1, MD-3, MD-4, MD-7.
Acceptance: BR 1 to 4; creates the transaction and its lines atomically; issuing handler comes from the session; item rows are locked before the availability re-check; audited; scenario S14 and S16 pass as integration tests. The strike-based block (BR 11) is added in FLG-3.

**BRW-3 · Checkout UI** (5 pts, Sprint 3). Depends on: BRW-2, MD-3, MD-5.
Acceptance: borrower lookup shows name, type, and department; room picker with add-new; item search with quantity entry for QUANTITY items; optional note and expected return date per line; confirmation summary; double submission is prevented; API errors are shown with their messages. Refs: SPEC 5.

**BRW-4 · Return API** (5 pts, Sprint 3). Depends on: BRW-2.
Acceptance: BR 5 and 6; records a return event per line with quantity, condition, receiving handler, and time; supports partial returns; DAMAGED return on a UNIT item updates item condition (S17); returning never changes flag status; scenarios S3 (before closing) and S15 pass.

**BRW-5 · Return UI** (3 pts, Sprint 4). Depends on: BRW-4.
Acceptance: find open borrowings by borrower, item, or asset tag; return all or part of a line; select condition; flagged lines are clearly marked.

**BRW-6 · Line notes** (2 pts, Sprint 5). Depends on: BRW-2.
Acceptance: BR 7; handler can add or edit a note and expected return date on an open line; edits are audited; notes show on the dashboard; notes have no effect on flagging (scenario S4).

## Epic FLG: Flagging and strikes

**FLG-1 · Strike service** (3 pts, Sprint 4). Depends on: BRW-4.
Acceptance: BR 10 and 12; returns a borrower's strike count for the current semester; unit tests cover scenarios S5, S6, S7, S9.

**FLG-2 · End-of-day flagging job** (5 pts, Sprint 4). Depends on: BRW-4, MD-7.
Acceptance: BR 8 and 9; runs at the configured closing time in `Asia/Manila`; reschedules when settings change; idempotent; skips FLAGGED and OVERRIDDEN lines; evaluates lines issued after closing at the next closing; admin-only manual trigger limited to once per minute; takes a PostgreSQL advisory lock so runs never overlap; catch-up on startup; logs each run; audited; injected clock in tests; scenarios S1, S2, S10, S11, S12, S13 pass.

**FLG-3 · Strike warnings and blocking** (3 pts, Sprint 4). Depends on: FLG-1, BRW-3.
Acceptance: BR 11; checkout shows a warning at the warning threshold and a stricter notice at the notice threshold; checkout is blocked at the block threshold with `BORROWER_BLOCKED`, enforced in the API; thresholds come from settings; returns are never blocked; scenario S8 passes.

**FLG-4 · Flag review and override** (5 pts, Sprint 4). Depends on: FLG-1.
Acceptance: BR 13; admin list of flagged lines shows borrower, item, note, and expected return date; override requires a reason of at least 5 characters (SPEC 7); overriding works before or after return; overridden lines stop counting; audited; handlers and view-only users get 403; scenarios S4 and S7 pass.

## Epic RPT: Dashboard and reports

**RPT-1 · Dashboard** (3 pts, Sprint 5). Depends on: FLG-1, BRW-6.
Currently unreturned items and flagged borrowers, with notes and expected return dates. Visible to all roles.

**RPT-2 · Borrowing history per borrower** (3 pts, Sprint 5). Depends on: BRW-4.
Date range filter capped at 366 days, paginated; shows room, issuing and receiving handlers, return details, and flag status.

**RPT-3 · Borrowing history per item** (3 pts, Sprint 5). Depends on: BRW-4.
Lookup by item or asset tag; same detail as RPT-2, paginated.

**RPT-4 · Usage summary** (3 pts, Sprint 5). Depends on: BRW-4.
Most borrowed items for a chosen period (capped at 366 days), with counts by category and by room or lab, aggregated in SQL.

## Epic SEC: Security and resilience

**SEC-1 · Edge rate limits and request limits** (3 pts, Sprint 3). Depends on: FND-2, AUTH-1.
Acceptance: nginx rate limits and connection limits per ARCH 12.2, answering 429 with the standard JSON error and `Retry-After`; Express global and expensive-endpoint limiters per ARCH 12.3; `trust proxy` verified so limits key on the real client IP (test: two clients with different addresses are limited independently, and nginx overwrites `X-Forwarded-For`); Node server timeouts set; one central error handler, with crash-and-restart on unhandled errors; the input limits in SPEC 7 are enforced in the shared Zod schemas; `RATE_LIMITED`, `PAYLOAD_TOO_LARGE`, and `SERVER_BUSY` are tested. Refs: ARCH 12.2, 12.3, SPEC 7.

**SEC-2 · Abuse and load testing** (5 pts, Sprint 6). Depends on: SEC-1, FLG-4, MD-6.
Acceptance: autocannon scripts in `tests/load` run against the compose stack from a separate container; all five pass criteria in ARCH 12.7 are met (login flood, slow connections, oversized input, maximum-range reports and search, flagging under load); results and any tuned limits are recorded in ARCH 12.7. Refs: ARCH 12.7.

## Epic HRD: Hardening

**HRD-1 · Audit log viewer** (3 pts, Sprint 6). Depends on: FND-3.
Admin viewer with filters by actor, entity, and date, plus a sweep to find state changes with no audit entry. Always date-filtered and paginated (SPEC 7).

**HRD-2 · End-to-end tests** (5 pts, Sprint 6). Depends on: FLG-4.
Playwright flow: checkout, partial return, end-of-day flagging, strike, block, override. Runs in Docker. Confirm every scenario in BR section 3 has an automated test.

**HRD-3 · Backup and restore** (2 pts, Sprint 6). Depends on: FND-2.
Documented `pg_dump` backup and restore scripts, verified on a clean environment. Backup files are stored outside the web root and readable only by the admin account (ARCH 12.6).

**HRD-4 · LAN deployment guide and README** (2 pts, Sprint 6). Depends on: FND-2.
Step-by-step instructions to run on a department PC and reach it from other machines on the network, including `COOKIE_SECURE=false` for plain HTTP, binding the web port to the LAN address, firewall steps, and why the app must not be exposed to the internet (ARCH 12.1).

**HRD-5 · UX and error handling pass** (3 pts, Sprint 6). Depends on: BRW-5.
Clear validation and error messages; keyboard-friendly checkout; consistent loading and empty states.

## Unscheduled

- Export reports to CSV or PDF
- Barcode or QR scanning of asset tags
- Connect BorrowerService to an external school database
- Reminders before closing time
- Item reservations
