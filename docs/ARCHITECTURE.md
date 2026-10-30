# Architecture

Version 1.1. Decisions here are settled. If you think one should change, raise it with the owner before working around it.

## 1. Overview

```
Browser  ->  nginx (web container)  ->  Express API (api container)  ->  PostgreSQL (db container)
              serves the React build     /api/* routes, business rules      named volume
              proxies /api to api
```

The browser only talks to nginx, so the app and API share one origin. There is no CORS configuration.

## 2. Technology choices

- **Node.js**: current LTS release (24.x at the time of writing). Pin the exact version in `.nvmrc` and the Dockerfiles.
- **TypeScript**: `strict: true` in every package.
- **Backend**: Express 5, Zod (request validation), Prisma (ORM and migrations), pino (logging), helmet, express-rate-limit, node-cron (scheduler), Luxon (all timezone-aware date logic), argon2 (password hashing), multer (CSV upload with size limits), csv-parse (CSV parsing).
- **Database**: PostgreSQL, current stable major version, pinned in `docker-compose.yml`.
- **Frontend**: React, Vite, React Router, TanStack Query (server state), React Hook Form with Zod resolvers, Tailwind CSS.
- **Testing**: Vitest, Supertest (API), React Testing Library (components), Playwright (end-to-end flow in HRD-2).
- **Tooling**: ESLint, Prettier, npm workspaces, autocannon (load and abuse testing, development only).

Adding a dependency outside this list needs the owner's approval.

## 3. Repository layout

```
/
  CLAUDE.md
  docs/                  SPEC.md, BUSINESS_RULES.md, ARCHITECTURE.md, BACKLOG.md
  apps/
    api/
      Dockerfile
      prisma/            schema.prisma, migrations/, seed.ts
      scripts/           admin-reset-password.ts
      src/
        routes/          HTTP only: parse, authorize, call a service, send response
        services/        business rules; one file per area (checkout, returns, flagging, strikes, ...)
        borrowers/       BorrowerService interface + LocalBorrowerService
        middleware/      auth, roles, errors, rate limit
        jobs/            end-of-day flagging scheduler
        lib/             audit helper, time helpers, config, errors
      tests/
    web/
      Dockerfile
      nginx.conf         rate limits, timeouts, proxy rules (section 12.2)
      src/
        pages/  components/  api/  hooks/
  packages/
    shared/              Zod schemas, enums, and types used by both api and web
  scripts/               backup.sh, restore.sh (HRD-3)
  tests/load/            autocannon abuse and load scripts (SEC-2)
  docker-compose.yml
  .env.example
```

## 4. Layering

- **Routes** are thin. They validate input with Zod, check the user's role, call a service, and return JSON. No business logic.
- **Services** contain all business rules from `BUSINESS_RULES.md`. They take plain inputs, use Prisma, and run multi-step changes inside `prisma.$transaction`. Each rule is referenced in a comment (`// Rule 8`).
- **BorrowerService** is the only abstracted data source:

  ```ts
  interface BorrowerService {
    findById(id: string): Promise<Borrower | null>;
    search(query: string, limit?: number): Promise<Borrower[]>;
    isEligible(id: string): Promise<{ eligible: boolean; reason?: string }>;
  }
  ```

  `LocalBorrowerService` reads the local `borrowers` table. Checkout, reports, and the CSV import use the interface. A future implementation for an external school database must be addable without editing callers. Keep a test double in the tests to prove it.
- Everything else uses Prisma directly. Do not build extra repository layers.
- **Audit helper**: `audit(tx, { actorId, action, entity, entityId, before, after })` is called with the transaction client so the audit entry commits or rolls back with the change.

## 5. Authentication and authorization

**Decision: server-side sessions, not JWT.** After login the server stores the session in PostgreSQL and gives the browser an opaque cookie. Why: the app is one origin behind one nginx; sessions can be revoked immediately (deactivating a user or logging out takes effect at once); there are no refresh tokens or token storage problems. JWTs are better for separate services or mobile clients, which this project does not have.

- Library: `express-session` with `@quixo3/prisma-session-store` (adopted in AUTH-1), so the session table is managed by Prisma migrations. Setup is in `apps/api/src/lib/session.ts`.
- Endpoints: `POST /api/auth/login` (`{ username, password }`, returns `{ user }`), `POST /api/auth/logout` (204), `PUT /api/auth/password` (`{ currentPassword, newPassword }`, 204, signed in only).
- Cookie: `httpOnly`, `SameSite=Lax`, `Secure` controlled by `COOKIE_SECURE`. On a LAN served over plain HTTP, `COOKIE_SECURE` must be `false` or the browser will drop the cookie.
- Lifetime: rolling, `SESSION_TTL_HOURS` (default 8). Expired sessions are pruned every 15 minutes.
- `saveUninitialized: false`: a session row is created only after a successful login, never for anonymous visitors (otherwise an attacker could fill the session table). Regenerate the session ID on login and destroy it on logout. Keep session data small (user ID and role).
- **CSRF**: `SameSite=Lax` plus a required `X-Requested-With: fetch` header on every state-changing request (POST, PUT, PATCH, DELETE).
- **Password hashing: argon2id** (settled) using the `argon2` package with `memoryCost: 19456` (19 MiB), `timeCost: 2`, `parallelism: 1`. Why: it is the current recommended algorithm; bcrypt is fine but older. The parameters are stored inside each hash, so they can be raised later without a migration. Use a Debian-based Node image (such as `node:<lts>-bookworm-slim`), not Alpine, so the native module installs without trouble. Because argon2 is deliberately heavy, all hashing goes through a concurrency limiter (section 12.4).
- Password policy: minimum 10 characters, no other composition rules. Users can change their own password (AUTH-1).
- Failed logins are throttled, never locked out: 10 failures per 15 minutes per IP and username pair, 30 per 15 minutes per IP. Failures return a generic message. Details in section 12.4.
- **Authorization**: a `requireRole(...roles)` middleware on every route. Roles: `ADMIN`, `HANDLER`, `VIEWER`. The permission table is in `SPEC.md`. The frontend also hides what a role cannot use, but the API is the real check.
- **First admin**: the seed script creates one admin from `ADMIN_USERNAME` and `ADMIN_PASSWORD` (the script refuses to run in production without them). The admin changes their password after first login.
- `helmet` is enabled. The API sets no CORS headers.

## 6. Time and timezone

- Application timezone: `Asia/Manila` (UTC+8, no daylight saving), set through `APP_TIMEZONE` (default `Asia/Manila`). Containers also set `TZ=Asia/Manila`.
- The database stores all timestamps as `timestamptz` (UTC). The API returns ISO 8601 strings in UTC (`2026-10-29T09:00:00.000Z`).
- The frontend formats everything in `Asia/Manila`.
- Business logic uses Luxon with the configured zone: closing time (`HH:mm` local), "today", and semester boundaries. Semester start and end are dates (no time) interpreted in `Asia/Manila`. Never compute business days with naive `Date` arithmetic.
- The scheduler (`node-cron`) runs with the `timezone` option set to `APP_TIMEZONE`. Because the closing time is a setting, the job reads it each time it schedules, and re-schedules when settings change.
- Test the flagging logic with an injected clock so tests do not depend on real time.

## 7. API conventions

- REST under `/api`, JSON bodies, plural nouns (`/api/items`, `/api/transactions`), UUID ids.
- List endpoints paginate with `?page=1&pageSize=25` and return `{ "data": [...], "page": 1, "pageSize": 25, "total": 120 }`. Maximum page size 100.
- Dates and times are ISO 8601. Date-only fields (semester dates, expected return date) are `YYYY-MM-DD`.
- Validation uses Zod schemas from `packages/shared`.
- **Error format** for every non-2xx response:

  ```json
  { "error": { "code": "ITEM_UNAVAILABLE", "message": "Projector P-014 is already borrowed.", "details": {} } }
  ```

  `message` is safe to show to staff. `details` carries field errors for validation failures. Unexpected errors return `INTERNAL_ERROR` with no internals and are logged server-side.

| HTTP | When | Codes |
|---|---|---|
| 400 | Invalid input | `VALIDATION_ERROR` |
| 401 | Not signed in | `UNAUTHENTICATED` |
| 403 | Role not allowed | `FORBIDDEN` |
| 404 | Not found | `NOT_FOUND` |
| 409 | Business rule conflict | `ITEM_UNAVAILABLE`, `INSUFFICIENT_QUANTITY`, `BORROWER_INACTIVE`, `BORROWER_BLOCKED`, `NO_CURRENT_SEMESTER`, `RETURN_EXCEEDS_OUTSTANDING`, `DUPLICATE_VALUE`, `HAS_HISTORY` |
| 413 | Body or upload too large | `PAYLOAD_TOO_LARGE` |
| 429 | Rate limited | `RATE_LIMITED` |
| 500 | Unexpected | `INTERNAL_ERROR` |
| 503 | Server is busy (hashing queue full) | `SERVER_BUSY` |

`RATE_LIMITED` and `SERVER_BUSY` responses include a `Retry-After` header. nginx also answers 429 when its own limits trigger; it returns the same JSON shape.

## 8. Data conventions

- Enums are defined once in `packages/shared` and mirrored in the Prisma schema: roles, borrower types, item tracking type, item condition and status, return condition, flag status.
- Constraints live in the database: unique asset tag, unique borrower school ID, unique room name (case-insensitive), non-negative quantities, `quantity_returned <= quantity_borrowed`, one current semester.
- Add indexes for: open lines by item, transactions by borrower and semester, lines by flag status, audit log by entity and date.
- **Concurrency**: inside the checkout database transaction, lock the affected item rows (`SELECT ... FOR UPDATE` through `$queryRaw`) before re-checking availability (Rule 4).
- Deactivate or retire instead of deleting (Rule 15).

## 9. Scheduled job

`jobs/flagging.ts` implements Rule 8 and Rule 9. It runs at the configured closing time, exposes `runFlagging(now)` for the admin-only manual trigger, and runs once at API startup to catch up. It must be idempotent, take a PostgreSQL advisory lock so runs never overlap (section 12.5), and log how many lines it flagged.

## 10. Docker

Services in `docker-compose.yml`:

- **db**: PostgreSQL with a named volume, started with the timeout settings in section 12.5. The port is not published to the host except through a development override file.
- **api**: builds from `apps/api`, waits for `db` to be healthy, runs `prisma migrate deploy` and then the seed on every start, exposes port 3000 internally. The seed only adds what is missing: in production (`NODE_ENV=production`, as in the containers) the first admin and default settings; in development also sample categories, rooms, items, borrowers, and a current semester.
- **web**: multi-stage build (Vite build, then nginx). Serves the SPA with fallback to `index.html`, proxies `/api` to `api:3000`. Published on `WEB_PORT` (default 8080).
- All services get the memory, CPU, restart, healthcheck, and log-rotation settings in section 12.6. Only the web port is published, and it should be bound to the LAN address.

Environment variables (all documented in `.env.example`):

| Variable | Purpose | Default |
|---|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Database credentials | none for password |
| `DATABASE_URL` | Prisma connection string | built from the above |
| `SESSION_SECRET` | Signs session cookies | none |
| `SESSION_TTL_HOURS` | Session lifetime | 8 |
| `COOKIE_SECURE` | Secure cookie flag | false |
| `APP_TIMEZONE`, `TZ` | Timezone | Asia/Manila |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | First admin for the seed script | none |
| `WEB_PORT` | Published web port | 8080 |
| `WEB_BIND_ADDRESS` | Host address the web port is bound to (LAN address on the department PC, section 12.1) | 127.0.0.1 |
| `TRUST_PROXY_HOPS` | Number of proxies in front of the API (nginx = 1) | 1 |
| `HASH_CONCURRENCY` | Password hashes allowed at once | 2 |
| `HASH_QUEUE_MAX` | Hash requests allowed to wait | 10 |
| `NODE_ENV` | Environment | production in containers |

Moving to a department PC means copying the repo, creating `.env`, and running `docker compose up -d --build`. Other machines on the LAN reach it at `http://<pc-ip>:8080`. Backups use `pg_dump` through a documented script (HRD-3).

## 11. Testing strategy

- **Unit tests** (Vitest) for pure logic: availability math, strike counting, time helpers.
- **Integration tests** (Vitest and Supertest) against a real PostgreSQL database, started through a Docker Compose test profile. Each test file starts from a clean schema. Every scenario S1 to S21 in `BUSINESS_RULES.md` becomes a test.
- **Component tests** for the checkout and return forms.
- **End-to-end** (Playwright, HRD-2): checkout, partial return, flagging, strike, block, override.
- **Abuse and load tests** (autocannon, SEC-2): login flood, slow connections, oversized bodies and uploads, maximum-range reports, all run from a separate container against the compose stack. Pass criteria are in section 12.7.
- Use an injected clock for anything involving closing time or semesters.

## 12. Abuse and denial-of-service resistance

Goal: someone on the network (or an attacker, if the app is ever exposed) cannot easily make the app unavailable to staff. Protection is layered: network, nginx, Express, database, containers.

**What this can and cannot do.** These measures stop cheap application-level attacks: request floods, slow connections, oversized uploads, expensive queries, login spamming, and resource exhaustion. They cannot stop a flood large enough to saturate the network link or the PC itself. That is why the app stays on the department LAN (12.1).

### 12.1 Network exposure

- Publish only the web port. The db and api ports are never published to the host, except through a development override file.
- Bind the web port to the LAN address (for example `"192.168.1.20:8080:80"`) or restrict it with the host firewall to the department subnet.
- Do not expose the app to the internet. For remote access use a VPN. If it must ever be public, put it behind a CDN or WAF, serve it over HTTPS, and set `COOKIE_SECURE=true`.

### 12.2 nginx (first line of defense)

Required settings, kept in `apps/web/nginx.conf` and tuned on the department PC:

- `limit_req_zone` per client IP: general API 10 requests per second (burst 30), login endpoint 5 per minute (burst 5), CSV import 2 per minute.
- `limit_conn` 30 connections per IP.
- `limit_req_status 429` and `limit_conn_status 429`, answered with the standard JSON error body.
- `client_max_body_size 100k`, except 2m on the CSV import location.
- Slow-connection protection: `client_header_timeout 10s`, `client_body_timeout 10s`, `send_timeout 15s`, `keepalive_timeout 15s`, `proxy_read_timeout 30s`.
- Set `X-Forwarded-For` to `$remote_addr` (overwrite, never append) so a client cannot fake its address.
- Gzip and cache static assets so page loads cost the API nothing.

### 12.3 Express

- `app.set('trust proxy', TRUST_PROXY_HOPS)`. Without it every request looks like it comes from nginx's address and the rate limits would block everyone at once.
- A global `express-rate-limit` of 600 requests per minute per IP (the same ceiling as nginx, so direct access to the API is still protected), and stricter limits (30 per minute per IP) on expensive endpoints: reports, search, CSV import.
- `express.json({ limit: '100kb' })`. CSV upload through multer: 2 MB, one file, at most 5,000 rows, checked before parsing.
- Node timeouts: `server.headersTimeout = 15000`, `server.requestTimeout = 30000`, `server.keepAliveTimeout = 5000`.
- The input bounds in `SPEC.md` section 7 (page size, search length, lines per checkout, field lengths, report date range) are enforced in the shared Zod schemas.
- No user-supplied regular expressions. Search uses parameterized queries with escaped wildcards.
- No heavy synchronous work in request handlers. Anything slow is paginated, aggregated in SQL, or capped.
- Unauthenticated requests are rejected before any database work other than the session lookup.
- One central error handler. An unexpected error returns `INTERNAL_ERROR` and never crashes the process. On `unhandledRejection` or `uncaughtException`, log and exit so Docker restarts the container.

### 12.4 Login and password hashing

argon2 is deliberately slow and memory hungry, which makes `/api/auth/login` the easiest place to exhaust the server. So:

- All hashing and verifying goes through one limiter. At most `HASH_CONCURRENCY` (default 2) run at once and at most `HASH_QUEUE_MAX` (default 10) wait. Beyond that the request is refused immediately with 503 `SERVER_BUSY` and a `Retry-After` header. Memory used by hashing is therefore bounded (about 2 x 19 MiB).
- Rate limits are checked before any hashing happens.
- **Throttle, never lock.** Failed logins are throttled per IP-and-username pair (10 failures per 15 minutes) and per IP overall (30 per 15 minutes) with `Retry-After`. Accounts are never locked, because a lock would let an attacker lock the real admin out, which is itself a denial of service. Because throttling is keyed on the IP, the admin signing in from another machine is unaffected.
- A login for an unknown username still runs a dummy verify through the same limiter, so response time does not reveal which usernames exist.
- Emergency recovery: `npm run admin:reset-password` (run inside the api container) resets any user's password from the command line.

### 12.5 PostgreSQL

- Connection pool capped at 10, waiting at most 10 seconds for a connection. Set on the `pg` driver adapter in `apps/api/src/lib/prisma.ts`, because Prisma 7 with a driver adapter ignores `connection_limit` and `pool_timeout` in `DATABASE_URL`.
- Server settings passed in compose: `statement_timeout=15000`, `lock_timeout=5000`, `idle_in_transaction_session_timeout=15000`. (`pg_dump` turns the statement timeout off for itself.)
- Prisma interactive transactions use `{ maxWait: 5000, timeout: 10000 }`.
- Indexes for every filter and sort used by lists and reports (section 8). Reports aggregate in SQL.
- The flagging job takes a PostgreSQL advisory lock so scheduled, startup, and manual runs never overlap. The manual trigger is limited to once per minute.

### 12.6 Containers and host

- Resource limits so one service cannot starve the host: api `mem_limit: 512m`, `cpus: 1.0`, `pids_limit: 200`; web `128m` and `0.5`; db `1g` and `1.5`. Tune to the department PC.
- `restart: unless-stopped` and healthchecks on every service: `/healthz` on web and `/api/health` on api, both cheap and free of database work.
- Log rotation with the `json-file` driver (`max-size: 10m`, `max-file: 3`) so logs cannot fill the disk.
- Rate-limit hits are logged at warn level with the IP, never with passwords or session IDs.
- Containers run as a non-root user.
- Backup files are stored outside the web root, in a folder only the admin account can read.

### 12.7 Verification

Ticket SEC-2 load-tests these protections with autocannon, run from a separate container so it has a different source address. Pass criteria:

1. **Login flood:** 200 concurrent connections hit `/api/auth/login` for 60 seconds. Meanwhile a signed-in client from another source completes checkout and dashboard requests with p95 latency under 2 seconds. The api container stays under its memory limit with no out-of-memory kill and no restart. After the flood, a valid login works once the throttle window has passed.
2. **Slow connections:** a slowloris-style test does not stop other clients' requests.
3. **Oversized input:** an oversized JSON body and an oversized CSV are rejected with 413 without reaching a service.
4. **Heavy reads:** reports and search at their maximum allowed ranges answer in under 2 seconds on seeded data (5,000 borrowers, 500 items, 20,000 transactions).
5. **Flagging under load:** the flagging job runs correctly, without overlapping runs, while the API is under load.

Record the results and any tuned limits in this section.

## 13. Decision log

| Decision | Choice | Reason |
|---|---|---|
| Backend framework | Express 5 | Owner is familiar with it |
| Auth mechanism | Server-side sessions in PostgreSQL | One origin, instant revocation, simpler than JWT |
| Password hashing | argon2id | Current recommendation; Debian image avoids native build problems |
| ORM | Prisma | Typed queries and managed migrations |
| Monorepo | npm workspaces with a shared package | Share enums and Zod schemas without extra tooling |
| Timezone | `Asia/Manila`, UTC in the database | Deployed in the Philippines; avoids naive date bugs |
| Borrower source | Local table behind `BorrowerService` | No external database now, easy to add one later |
| Availability | Calculated, never stored | Cannot drift out of sync |
| Hashing load | Concurrency-limited argon2id (2 at once, queue of 10) | A login flood cannot exhaust CPU or memory |
| Failed logins | Throttle per IP and username, never lock accounts | A lockout would let an attacker lock out the real admin |
| Anonymous visitors | No session rows until login | Prevents filling the session table |
| Exposure | LAN only, web port only, VPN for remote access | Application limits cannot stop a flood that saturates the network link |
| Resource limits | Per-container memory, CPU, and log caps | One misbehaving service cannot take the host down |
