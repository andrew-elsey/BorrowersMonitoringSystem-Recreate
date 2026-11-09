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
- **Backend**: Express 5, Zod (request validation), Prisma (ORM and migrations), pino (logging), helmet, express-rate-limit, Luxon (all timezone-aware date logic), argon2 (password hashing), multer (CSV upload with size limits), csv-parse (CSV parsing).
- **Database**: PostgreSQL, current stable major version, pinned in `docker-compose.yml`.
- **Frontend**: React, Vite, React Router, TanStack Query (server state), React Hook Form with Zod resolvers, Tailwind CSS.
- **Testing**: Vitest, Supertest (API), React Testing Library with user-event and jsdom (components, added in AUTH-4), Playwright (end-to-end flow in HRD-2).
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
        pages/           one file per screen, with its component test
        components/      small shared pieces (FND-5 adds the form and table components)
        api.ts           fetch wrapper: CSRF header, standard errors, Retry-After
        auth.tsx         signed-in user (GET /api/auth/me), 401 handling, role labels
        App.tsx          routes and route guards (RequireSignIn, RequireRole); screen pages are lazy-loaded (HRD-6)
        AppShell.tsx     top bar and the role-filtered menu
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
    list(params: { q?: string; page: number; pageSize: number }): Promise<BorrowerPage>;
    isEligible(id: string): Promise<{ eligible: boolean; reason?: string }>;
  }
  ```

  `LocalBorrowerService` reads the local `borrowers` table. Checkout, reports, and the CSV import use the interface. A future implementation for an external school database must be addable without editing callers. Keep a test double in the tests to prove it.

  Built in MD-4 in `apps/api/src/services/borrowers.ts`. Callers import the `borrowerService` instance; swapping the implementation is the one line that creates it. The `Borrower` type (id, schoolId, name, type, department, active) is in `packages/shared`. `search` matches name or school ID as plain text (case-insensitive, `%` and `_` are not wildcards, sorted by name; inactive borrowers are included with `active: false` so admins can find them) and rejects text outside 2 to 100 characters or a `limit` outside 1 to 100 (default 25) with `VALIDATION_ERROR` (SPEC 7), reported on the field `q`. Search text with a control character (such as NUL, which PostgreSQL cannot store) is also `VALIDATION_ERROR`. The bounds are `SEARCH_MIN_LENGTH`, `SEARCH_MAX_LENGTH`, and `SEARCH_MAX_LIMIT` in `packages/shared`. `list` (added in MD-5 for the Borrowers screen) returns one page `{ data, page, pageSize, total }` of everyone, or of the borrowers matching `q` under the same rules as `search`, optionally narrowed to one `type` and to `active` true or false. `findById` returns `null` for an id that is not a well-formed uuid. `search(query, limit, { ids })` (BRW-5) can be limited to a set of borrower ids. `findByIds(ids)` (BRW-5) returns the borrowers that exist among the ids, ignoring malformed ids. `isEligible` returns `reason` as an error code: `NOT_FOUND` or `BORROWER_INACTIVE` (BR 3); `BORROWER_BLOCKED` (BR 11) is added in FLG-3. `apps/api/tests/borrower-reads.test.ts` fails if other api code queries the borrowers table (the seed only inserts sample rows and is not scanned).

  Writes (MD-5): `createBorrower` and `updateBorrower` (fields and `active`) are plain functions in the same file, because rule 1 lets only that file touch the table. They are not part of the interface: with an external school database that system owns the records, so they would be removed rather than reimplemented. Borrowers are never deleted (BR 15). Endpoints, admin only: `GET /api/borrowers?q=&type=&active=&page=&pageSize=` (calls `list`; optional filters `type` = `STUDENT`, `FACULTY`, or `EMPLOYEE` and `active` = `true` or `false`, anything else is `VALIDATION_ERROR`), `POST /api/borrowers` (`{ schoolId, name, type, department }`, 201 `{ borrower }`), `PATCH /api/borrowers/:id` (any of those fields and `active`, 200 `{ borrower }`). A school ID already in use is `DUPLICATE_VALUE` on the field `schoolId`; school IDs are unique regardless of case (`2026-A01` and `2026-a01` are the same borrower; a unique index on `lower(school_id)`, owner decision 2026-11-02) and stored as typed; a borrower may change only the case of its own school ID.

  Checkout lookup (BRW-3, owner decision 2026-11-05): `GET /api/borrowers/lookup?q=&page=&pageSize=` for admins and handlers (`PERMISSIONS.checkoutAndReturn`; view-only users get 403). It calls `list` with `q` only, so it has the same bounds: `q` is required and 2 to 100 characters, `pageSize` at most 100, otherwise `VALIDATION_ERROR`. The reply is one page `{ data, page, pageSize, total }` of `Borrower` (id, schoolId, name, type, department, active); inactive borrowers are included so the screen can mark them, and checkout refuses them (BR 3). The route is registered before the admin-only guard on `/borrowers`, and `GET /api/borrowers` stays admin only.
- Everything else uses Prisma directly. Do not build extra repository layers.
- Items (MD-2, `apps/api/src/services/items.ts`): `GET /api/items?q=&categoryId=&status=&trackingType=&page=&pageSize=` for all staff (`q` matches name or asset tag as plain text, 2 to 100 characters; each row adds `available`, what can be issued now, from one `getAvailability` call for the whole page, BRW-3; it names no borrower); for admins `POST /api/items` (201 `{ item }`), `PATCH /api/items/:id` (any field but `trackingType`, which is fixed and refused with `VALIDATION_ERROR`; retiring is `{ "status": "RETIRED" }`), and `DELETE /api/items/:id` (204; an item in any transaction line gets `HAS_HISTORY`, BR 15). The UNIT and QUANTITY rules are `trackingErrors` in `packages/shared`, used by the create schema and, against the stored item, by the update. A duplicate asset tag is `DUPLICATE_VALUE` on `assetTag` (unique index on `lower(asset_tag)`, owner decision 2026-11-03).
- Rooms and labs (MD-3, `apps/api/src/services/rooms.ts`, the `locations` table): `GET /api/rooms?page=&pageSize=` for admins and handlers (each room with `createdBy { id, name }`, `createdAt`, and `transactionCount`; admins get every room, handlers only active ones for the checkout room picker, enforced on the server whatever the query says, owner decision 2026-11-03); for admins `PATCH /api/rooms/:id` (`name` and/or `active`; deactivating is `{ "active": false }`, 200 `{ room }`), and `DELETE /api/rooms/:id` (204; a room used by any transaction gets `HAS_HISTORY`, BR 15). `POST /api/rooms` (`{ name }`, 201 `{ room }`) is also the quick-add endpoint for handlers adding a room at checkout (SPEC 3), so admins and handlers may call it; `created_by` is always the signed-in user. A duplicate name is `DUPLICATE_VALUE` on `name`, regardless of case (unique index on `lower(name)` from the initial migration); the message names the existing room as stored. Audit actions are `LOCATION_CREATED`, `LOCATION_UPDATED`, and `LOCATION_DELETED` on entity `location`.
- Semesters and settings (MD-7, `apps/api/src/services/semesters.ts` and `settings.ts`), admin only: `GET /api/semesters?page=&pageSize=` (newest start date first, plus `current`: the current semester or `null`, wherever it is in the list), `POST /api/semesters` (`{ name, startDate, endDate }` as `YYYY-MM-DD`, end not before start; 201 `{ semester }`, not current), `PUT /api/semesters/:id` (same body). On both, a name already used, regardless of case, is `DUPLICATE_VALUE` on `name` (unique index on `lower(name)`), and dates overlapping another semester, start and end included, are `SEMESTER_OVERLAP` on `startDate`, naming that semester (exclusion constraint `semesters_no_overlap`, a GiST index on `daterange(start_date, end_date, '[]')` that needs no extension). Both are enforced by the database, so concurrent requests cannot both get through (owner decisions 2026-11-03). Also `POST /api/semesters/:id/current` (clears the old current semester and sets this one in one transaction, under `LOCK TABLE semesters IN SHARE ROW EXCLUSIVE MODE` so concurrent switches take turns; one `SEMESTER_SET_CURRENT` audit entry records both). Semesters are never deleted (BR 15). `GET /api/settings` and `PUT /api/settings` (`{ closingTime, warningThreshold, noticeThreshold, blockThreshold }`, warning < notice < block, BR 11; the reply adds `timezone` from `APP_TIMEZONE` for display). `GET /api/closing-time` (`{ closingTime }`, BRW-3) is the one read-only part open to all staff, so the checkout screen can show when items are due back without hardcoding it (CLAUDE.md rule 3); changing it stays admin only. Checkout and the flagging job read these through `requireCurrentSemester(tx)` (`NO_CURRENT_SEMESTER`, BR 2) and `getSettings(tx)`, which always read the database, so a change applies on the next read.
- Availability (BRW-1, `apps/api/src/services/availability.ts`, BR 1), no endpoint of its own (GET /api/items shows it per row): `getAvailability(itemIds, tx?)` returns a `Map` of item id to available quantity (total minus outstanding on open lines; 0 for any status other than `ACTIVE`; never below 0, since MD-2 lets an admin lower a total under what is out). Ids that match no item are left out. Checkout (BRW-2) locks the item rows and then calls it with its transaction client (BR 4). The math is `availableQuantity(item, outstanding)`, unit tested on its own.
- Checkout (BRW-2, `apps/api/src/services/checkout.ts`, BR 1 to 4), admins and handlers: `POST /api/transactions` with `{ borrowerId, locationId, lines: [{ itemId, quantity, note?, expectedReturnDate? }] }` (`checkoutSchema` in `packages/shared`: 1 to 50 lines, each item at most once, quantity 1 to 10,000, note at most 500 characters, date `YYYY-MM-DD` from year 1; ids in any case, lowered by the schema; SPEC 7). The service also refuses an expected return date before today in `APP_TIMEZONE` (Luxon) with `VALIDATION_ERROR` on `lines.N.expectedReturnDate` (BR 7). The room row is read `FOR SHARE`: an unknown room is `NOT_FOUND`, an inactive one `LOCATION_INACTIVE` for every role (BR 2), and deleting or deactivating it at the same moment waits (a delete then gets `HAS_HISTORY`). 201 `{ transaction: { id, borrowerId, locationId, issuedById, issuedAt, semesterId, lines: [{ id, itemId, quantity, note, expectedReturnDate }] } }`. The issuing handler is the signed-in user and the semester is `requireCurrentSemester(tx)` (BR 2); nothing in the body can set them. The borrower is checked through `borrowerService.isEligible` (`BORROWER_INACTIVE`, BR 3; `BORROWER_BLOCKED` is added there in FLG-3). Inside one transaction it locks the item rows (`SELECT ... FOR UPDATE ... ORDER BY id`, so two checkouts never deadlock), calls `getAvailability(itemIds, tx)`, and checks each line in this order: status not `ACTIVE` is `ITEM_UNAVAILABLE`; a UNIT line with quantity other than 1 is `VALIDATION_ERROR`; a UNIT item already out is `ITEM_UNAVAILABLE`; a QUANTITY line over what is available is `INSUFFICIENT_QUANTITY` (`details: { itemId, available }`). Business errors carry `details.itemId`. An unknown borrower, room, or item is `NOT_FOUND`. One `CHECKOUT` audit entry on entity `transaction` holds the reply (BR 14). Any failure creates nothing.
- Returns (BRW-4, `apps/api/src/services/returns.ts`, BR 5, 6, 11), admins and handlers: `POST /api/returns` with `{ lines: [{ lineId, quantity, condition }] }` (`returnSchema` in `packages/shared`: 1 to 50 lines, each line at most once, quantity 1 to 10,000, condition `GOOD`, `FAIR`, or `DAMAGED`; ids in any case; SPEC 7). `lineId` is a `transaction_items` id, and lines may come from different transactions. 201 `{ returns: [{ id, lineId, quantity, condition, receivedById, returnedAt, outstanding }] }`, one return event per line, where `outstanding` is what is still out after this return (0 means the line is complete). The receiving handler is the signed-in user and the time is the clock (BR 5). Inside one transaction it locks the line rows (`SELECT ... ORDER BY id FOR NO KEY UPDATE OF ti`, so two returns of the same line never both pass, while foreign-key checks such as an item delete are not blocked into a deadlock), refuses a quantity above outstanding with `RETURN_EXCEEDS_OUTSTANDING` (`details: { lineId, outstanding }`, S15; message "You entered 4 of Extension cord, but the amount still out on this line is 2.", or "Extension cord on this line is already fully returned." when nothing is out; the screen adds "Nothing was recorded."), and an unknown line with `NOT_FOUND`. A `DAMAGED` return of a UNIT item then locks those item rows in id order (the same order as checkout, so the two never deadlock) and sets the item's condition to `DAMAGED`, status unchanged, with an `ITEM_UPDATED` audit entry (S17); QUANTITY items keep their condition. Only `quantity_returned` changes on the line, never `flag_status` (BR 6). There is no borrower check, so returns are never blocked (BR 11). One `RETURN` audit entry on entity `return` per event holds the reply (BR 14). Any failure records nothing.
- Open lines (BRW-5, `listOpenLines` in `apps/api/src/services/returns.ts`), admins and handlers (`PERMISSIONS.checkoutAndReturn`; view-only 403): `GET /api/returns/open?by=&q=&page=&pageSize=` for the Return screen. `by` is `borrower` (default, name or school ID), `item` (item name), or `assetTag`; `q` is optional (left out, every open line) and otherwise 2 to 100 characters with no control characters; `pageSize` at most 100 (default 25); bad input is `VALIDATION_ERROR` (`openLinesQuerySchema` in `packages/shared`). It returns `{ data, page, pageSize, total }` of `OpenLine`: lines with `quantity_borrowed > quantity_returned`, oldest issue first, each with `lineId`, `transactionId`, `borrower { id, schoolId, name }`, `item { id, name, assetTag, trackingType }`, `location`, `issuedBy`, `issuedAt`, `expectedReturnDate`, `note`, `quantityBorrowed`, `outstanding`, `flagStatus`, `flaggedAt`. Retired and lost items are listed like any other (owner decision 2026-11-10). Borrowers are found and read only through `borrowerService` (for `by=borrower`, `search` limited with `{ ids }` to the borrowers that have open lines, so a match is never cut off by the 100-result limit, then `findByIds`; CLAUDE.md rule 1). `%` and `_` in `q` match literally. Read-only, so no audit entry. For `by=borrower` it looks through at most 5,000 borrowers with open lines (`OPEN_BORROWER_CAP`, CLAUDE.md rule 12); over that it answers 422 `SEARCH_TOO_BROAD` ("Too many borrowers have items out; search by item or asset tag."), never a silently cut list, and `search` covers at most 100 matching borrowers. Like the checkout borrower lookup, it is exempt from the 60 a minute search limit (only the global limit and nginx apply), because it is bounded, staff-only, cheap, and runs only when Find is pressed.
- Flag review (FLG-4, `apps/api/src/services/flags.ts`, BR 13), admins only (`PERMISSIONS.overrideFlags`; handlers and view-only users get 403): `GET /api/flags?returned=all|out|returned&q=&page=&pageSize=` returns `{ data, page, pageSize, total, blockThreshold }` of lines with `flag_status = FLAGGED` in the CURRENT semester only (owner decision 2026-11-10; the same semester BR 10 and 12 count strikes in; no current semester gives an empty list; older flags stay in the database), newest flag first, each with `lineId`, `transactionId`, `borrower { id, schoolId, name }`, `item { id, name, assetTag }`, `issuedAt`, `flaggedAt`, `quantityBorrowed`, `outstanding` (0 means returned), `strikes`, `note`, `expectedReturnDate`. `strikes` come from one grouped query, `countStrikesForBorrowers` in `services/strikes.ts` (same meaning as `countStrikes`), and `blockThreshold` is the setting (BR 11, rule 3). `q` (2 to 100 characters) matches item name, asset tag, or a borrower. Borrowers are read only through `borrowerService` (rule 1): `search(q, 100, { ids })` limited to the borrowers that have a listed line, so a match is never cut off by the 100-result limit, then `findByIds`. Over 5,000 such borrowers (`FLAGGED_BORROWER_CAP`, rule 12) it answers 422 `SEARCH_TOO_BROAD` ("Too many borrowers have flagged lines; search by item or asset tag."). Read-only, no audit entry. `POST /api/flags/:id/override` with `{ reason }` (`overrideSchema`: trimmed, 5 to 500 characters) locks the line (`FOR UPDATE`), requires `FLAGGED` (else 409 `LINE_NOT_FLAGGED`, unknown id 404 `NOT_FOUND`; any semester), then sets `flag_status = OVERRIDDEN`, `override_by`, `override_at`, `override_reason` and writes a `FLAG_OVERRIDDEN` audit entry (entity `transaction_item`) in the same transaction. Allowed before or after the return. Reply `{ line: { lineId, flagStatus, overrideAt, strikes } }`, where `strikes` is the borrower's current-semester count afterwards. No migration: the columns exist since the initial schema. The screen's "Run flagging now" uses the existing `POST /api/flagging/run`. No endpoint reports the last flagging run (runs are only logged and audited per line), so the screen has no "Last flagging run" line.
- Strikes (FLG-1, `apps/api/src/services/strikes.ts`, BR 10 and 12), no endpoint of its own: `countStrikes(borrowerId, db?)` counts the borrower's transactions in the semester marked current (read from the database on every call) that have at least one `FLAGGED` line. It is never stored, so switching semesters resets the count and switching back brings it back; with no current semester it is 0. It reads only transactions and their lines, never the borrowers table. Pass a transaction client to read inside a transaction (FLG-3 checkout).
- **Audit helper**: `audit(tx, { actorId, action, entity, entityId, before, after })` is called with the transaction client so the audit entry commits or rolls back with the change.

## 5. Authentication and authorization

**Decision: server-side sessions, not JWT.** After login the server stores the session in PostgreSQL and gives the browser an opaque cookie. Why: the app is one origin behind one nginx; sessions can be revoked immediately (deactivating a user or logging out takes effect at once); there are no refresh tokens or token storage problems. JWTs are better for separate services or mobile clients, which this project does not have.

- Library: `express-session` with `@quixo3/prisma-session-store` (adopted in AUTH-1), so the session table is managed by Prisma migrations. Setup is in `apps/api/src/lib/session.ts`.
- Endpoints: `POST /api/auth/login` (`{ username, password }`, returns `{ user }`), `POST /api/auth/logout` (204), `PUT /api/auth/password` (`{ currentPassword, newPassword }`, 204, signed in only). `GET /api/auth/me` (returns `{ user }`, or 401 when signed out or the account is deactivated), added in AUTH-4.
- Cookie: `httpOnly`, `SameSite=Lax`, `Secure` controlled by `COOKIE_SECURE`. On a LAN served over plain HTTP, `COOKIE_SECURE` must be `false` or the browser will drop the cookie.
- Lifetime: rolling, `SESSION_TTL_HOURS` (default 8). Expired sessions are pruned every 15 minutes.
- `saveUninitialized: false`: a session row is created only after a successful login, never for anonymous visitors (otherwise an attacker could fill the session table). Regenerate the session ID on login and destroy it on logout. Keep session data small (user ID and role).
- **CSRF**: `SameSite=Lax` plus a required `X-Requested-With: fetch` header on every state-changing request (POST, PUT, PATCH, DELETE).
- **Password hashing: argon2id** (settled) using the `argon2` package with `memoryCost: 19456` (19 MiB), `timeCost: 2`, `parallelism: 1`. Why: it is the current recommended algorithm; bcrypt is fine but older. The parameters are stored inside each hash, so they can be raised later without a migration. Use a Debian-based Node image (such as `node:<lts>-bookworm-slim`), not Alpine, so the native module installs without trouble. Because argon2 is deliberately heavy, all hashing goes through a concurrency limiter (section 12.4).
- Password policy: minimum 10 characters, no other composition rules. Users can change their own password (AUTH-1).
- Failed logins are throttled, never locked out: 10 failures per 15 minutes per IP and username pair, 30 per 15 minutes per IP. Failures return a generic message. Details in section 12.4.
- **Authorization**: a `requireRole(...roles)` middleware on every route. Roles: `ADMIN`, `HANDLER`, `VIEWER`. The permission table is in `SPEC.md` and mirrored in code as `PERMISSIONS` in `packages/shared/src/permissions.ts` (adopted in AUTH-2), used as `requireRole(...PERMISSIONS.overrideFlags)`. Signed out gives 401 `UNAUTHENTICATED`; a role not allowed gives 403 `FORBIDDEN`. The role is read from the session, so a role change applies at the user's next login. The frontend also hides what a role cannot use, but the API is the real check.
- **First admin**: the seed script creates one admin from `ADMIN_USERNAME` and `ADMIN_PASSWORD` (the script refuses to run in production without them). The admin changes their password after first login.
- `helmet` is enabled. The API sets no CORS headers.

## 6. Time and timezone

- Application timezone: `Asia/Manila` (UTC+8, no daylight saving), set through `APP_TIMEZONE` (default `Asia/Manila`); the api refuses to start if it is not a valid IANA zone (`readTimezone` in `lib/config.ts`). Containers also set `TZ=Asia/Manila`.
- The database stores all timestamps as `timestamptz` (UTC). The API returns ISO 8601 strings in UTC (`2026-10-29T09:00:00.000Z`).
- **How UTC storage is guaranteed (FND-6):** every database connection the api opens sets its session time zone to UTC (`options: '-c TimeZone=UTC'` on the adapter in `apps/api/src/lib/prisma.ts`). This is required, not cosmetic: `@prisma/adapter-pg` sends `Date` values as UTC digits without an offset and reads `timestamptz` values as if they were UTC. Under any other session time zone, such as the db container's `Asia/Manila`, every write is stored shifted and every read is shifted back, so the API looks right while the stored instants and anything computed in SQL (`now()`, reports) are wrong. The containers keep `TZ=Asia/Manila`; only the api's connections use UTC. `apps/api/tests/timestamps.test.ts` checks stored instants with `extract(epoch ...)`, which the adapter cannot shift. `DATABASE_URL` must not contain an `options` parameter, because pg would let it replace this setting without any error; `prisma.ts` refuses to start if it does. Never open a database connection without this setting, and never compare against SQL `now()` from a connection that lacks it.
- The frontend formats everything in `Asia/Manila`.
- Business logic uses Luxon with the configured zone: closing time (`HH:mm` local), "today", and semester boundaries. Semester start and end are dates (no time) interpreted in `Asia/Manila`. Never compute business days with naive `Date` arithmetic.
- The flagging scheduler (FLG-2) is a single `setTimeout` to the next closing time, computed with Luxon in `APP_TIMEZONE` (no `node-cron`: one daily timer needs no cron library). The job reads the closing time each time it schedules, and `PUT /api/settings` runs it right away and re-schedules it. A failed or skipped run is retried every 60 s (`FLAGGING_RETRY_MS`).
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
| 409 | Business rule conflict | `ITEM_UNAVAILABLE`, `INSUFFICIENT_QUANTITY`, `BORROWER_INACTIVE`, `BORROWER_BLOCKED`, `NO_CURRENT_SEMESTER`, `LOCATION_INACTIVE`, `RETURN_EXCEEDS_OUTSTANDING`, `LINE_NOT_FLAGGED`, `DUPLICATE_VALUE`, `HAS_HISTORY`, `SEMESTER_OVERLAP` |
| 422 | Search too broad | `SEARCH_TOO_BROAD` |
| 413 | Body or upload too large | `PAYLOAD_TOO_LARGE` |
| 429 | Rate limited | `RATE_LIMITED` |
| 500 | Unexpected | `INTERNAL_ERROR` |
| 503 | Server is busy (hashing queue full) | `SERVER_BUSY` |

`RATE_LIMITED` and `SERVER_BUSY` responses include a `Retry-After` header. nginx also answers 429 when its own limits trigger, and 413 when a body is over its `client_max_body_size`; both return the same JSON shape, never nginx's HTML error page.

## 8. Data conventions

- Enums are defined once in `packages/shared` and mirrored in the Prisma schema: roles, borrower types, item tracking type, item condition and status, return condition, flag status.
- Constraints live in the database: unique asset tag (case-insensitive), unique borrower school ID, unique room name (case-insensitive), non-negative quantities, `quantity_returned <= quantity_borrowed`, one current semester, unique semester name (case-insensitive), no overlapping semesters.
- Add indexes for: open lines by item, transactions by borrower and semester, lines by flag status, audit log by entity and date.
- **Concurrency**: inside the checkout database transaction, lock the affected item rows (`SELECT ... FOR UPDATE` through `$queryRaw`) before re-checking availability (Rule 4).
- Edits that audit a "before" value (`updateBorrower`, `renameCategory`, `updateItem`, `updateRoom`, `updateSemester`, `updateSettings`) lock the row the same way before reading it, so two admins editing at once each audit the value their change really replaced (Rule 14).
- Deactivate or retire instead of deleting (Rule 15).

## 9. Scheduled job

`jobs/flagging.ts` implements Rule 8 and Rule 9. It runs at the configured closing time, exposes `runFlagging(now, actorId)` for the admin-only manual trigger (`POST /api/flagging/run`, once a minute), and runs once at API startup to catch up. A run that finds the advisory lock taken is skipped and reports `skipped: true`. Each flagged line writes a `LINE_FLAGGED` audit entry (actor null for scheduled runs). It must be idempotent, take a PostgreSQL advisory lock so runs never overlap (section 12.5), and log how many lines it flagged.

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
| `APP_TIMEZONE`, `TZ` | Timezone. The web image also receives `APP_TIMEZONE` as a build argument, so the app formats dates in it; rebuild the web image after changing it | Asia/Manila |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | First admin for the seed script | none |
| `QA_PASSWORD` | Development only: password for the seed's role test accounts `qa-handler` and `qa-viewer` (skipped when empty) | none |
| `WEB_PORT` | Published web port | 8080 |
| `WEB_BIND_ADDRESS` | Host address the web port is bound to (LAN address on the department PC, section 12.1) | 127.0.0.1 |
| `TRUST_PROXY_HOPS` | Number of proxies in front of the API (nginx = 1) | 1 |
| `HASH_CONCURRENCY` | Password hashes allowed at once | 2 |
| `HASH_QUEUE_MAX` | Hash requests allowed to wait | 10 |
| `NODE_ENV` | Environment | production in containers |

Moving to a department PC means copying the repo, creating `.env`, and running `docker compose up -d --build`. Other machines on the LAN reach it at `http://<pc-ip>:8080`. Backups use `pg_dump` through a documented script (HRD-3).

## 11. Testing strategy

- **Unit tests** (Vitest) for pure logic: availability math, strike counting, time helpers.
- **Integration tests** (Vitest and Supertest) against a real PostgreSQL database, started through a Docker Compose test profile. Each test file starts from a clean schema. The database comes from `TEST_DATABASE_URL` (shell first, then `.env`), which is required with no default (owner decision 2026-11-08): two suites sharing one database wipe each other's rows, so each worktree running tests at the same time uses its own database name ending in `_test` (create it on the db-test container first). Every scenario S1 to S21 in `BUSINESS_RULES.md` becomes a test.
- **Component tests** (React Testing Library in jsdom, with `fetch` replaced by a fake API) for the login and change-password forms (AUTH-4) and the checkout and return forms.
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
- `limit_req_status 429` and `limit_conn_status 429`, answered with the standard JSON error body and a `Retry-After` header (12 seconds on login, the time one more login is allowed; 1 second otherwise). nginx's own 413 is answered with the standard JSON error body too (`PAYLOAD_TOO_LARGE`).
- `client_max_body_size 100k`, except 2m on the CSV import location.
- Slow-connection protection: `client_header_timeout 10s`, `client_body_timeout 10s`, `send_timeout 15s`, `keepalive_timeout 15s`, `proxy_read_timeout 30s`.
- Set `X-Forwarded-For` to `$remote_addr` (overwrite, never append) so a client cannot fake its address.
- Gzip and cache static assets so page loads cost the API nothing. `/assets` sends one `Cache-Control: public, max-age=31536000, immutable` header.
- The CSV import zone, its location, and its 2m body limit are added with MD-6, when the endpoint exists.
- `npm run test:nginx` checks these limits through a real nginx: it runs the nginx image with this config and a stub API in throwaway containers on port 18080, never touching the compose stack.

### 12.3 Express

- `app.set('trust proxy', TRUST_PROXY_HOPS)`. Without it every request looks like it comes from nginx's address and the rate limits would block everyone at once.
- A global `express-rate-limit` of 600 requests per minute per IP (the same ceiling as nginx, so direct access to the API is still protected), and stricter limits on expensive endpoints: 60 per minute per IP on search, and 30 per minute per IP on reports and CSV import. Search means a list request with `?q=` (`GET /api/items`, `GET /api/borrowers`); each endpoint has its own count. Search gets the higher limit because staff type it live at the counter (owner decision 2026-11-07). The checkout borrower lookup (`GET /api/borrowers/lookup`) is exempt from the search limit by owner decision (2026-11-07); only the global limit and nginx's 10 requests per second apply to it. The health check is outside the global limit.
- `express.json({ limit: '100kb' })`. CSV upload through multer: 2 MB, one file, at most 5,000 rows, checked before parsing.
- Node timeouts (set in `apps/api/src/server.ts`): `server.headersTimeout = 15000`, `server.requestTimeout = 30000`, `server.keepAliveTimeout = 5000`.
- The input bounds in `SPEC.md` section 7 (page size, search length, lines per checkout, field lengths, report date range) are enforced in the shared Zod schemas.
- No user-supplied regular expressions. Search uses parameterized queries with escaped wildcards.
- No heavy synchronous work in request handlers. Anything slow is paginated, aggregated in SQL, or capped.
- Unauthenticated requests are rejected before any database work other than the session lookup.
- One central error handler. An unexpected error returns `INTERNAL_ERROR` and never crashes the process. On `unhandledRejection` or `uncaughtException`, log and exit so Docker restarts the container.

### 12.4 Login and password hashing

argon2 is deliberately slow and memory hungry, which makes `/api/auth/login` the easiest place to exhaust the server. So:

- All hashing and verifying goes through one limiter. At most `HASH_CONCURRENCY` (default 2) run at once and at most `HASH_QUEUE_MAX` (default 10) wait. Beyond that the request is refused immediately with 503 `SERVER_BUSY` and a `Retry-After` header. Memory used by hashing is therefore bounded (about 2 x 19 MiB).
- Rate limits are checked before any hashing happens.
- **Throttle, never lock.** Failed logins are throttled per IP-and-username pair (10 failures per 15 minutes) and per IP overall (30 per 15 minutes) with `Retry-After`. Accounts are never locked, because a lock would let an attacker lock the real admin out, which is itself a denial of service. Because throttling is keyed on the IP, the admin signing in from another machine is unaffected. The per-IP limiter runs first, so a blocked machine stores nothing more in memory, and the username in a limiter key is cut to 200 characters (AUTH-5).
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
| UI colors | College of Fine Arts and Design logo colors (section 14) | The handout room belongs to the college; contrast checked against WCAG AA |
| College logo | Not used | No license to use it |
| UI font | System font stack (Segoe UI Variable on Windows 11) | No download, works offline on the LAN, no new dependency |
| Web bundle | Screen pages lazy-loaded with `React.lazy` and one `Suspense` in `AppShell` | Sign-in and the app shell load first; the entry chunk (React, router, TanStack Query, shared Zod schemas, sign-in, shell) stays under Vite's 500 kB warning with no new dependency. If a page chunk fails to load (for example after a redeploy while a tab is open), React Router shows its default error page and a reload fixes it; a friendlier `errorElement` is left for HRD-5 |
| Test database | `TEST_DATABASE_URL` required, no default (2026-11-08) | Two suites sharing one database wipe each other's rows |

## 14. UI theme

The web app uses the colors of the College of Fine Arts and Design logo. Define them once as Tailwind theme tokens in the web app's CSS (`@theme`) and use the token names in components (`bg-primary`, `text-danger`). Never write a hex value in a component.

| Token | Hex | Use |
|---|---|---|
| `primary` | `#005423` (deep forest green) | Top bar, main buttons, links, active menu item text, login screen accent |
| `primary-hover` | `#003D19` | Hover and pressed state of primary buttons and links |
| `primary-tint` | `#E6F0EA` | Active menu item background, success message background |
| `danger` | `#4C0A0A` (dark maroon) | Errors, flags, strikes, "Blocked" status, destructive buttons and confirmations |
| `danger-tint` | `#F7ECEC` | Error and flag message backgrounds |
| `accent` | `#FFD52C` (sun gold) | Highlights only: role badges, the top bar's bottom edge, focus rings on dark backgrounds |
| `accent-tint` | `#FFF6CC` | Warning message background, selected table rows |
| `ink` | `#000000` | Body text |
| `muted` | `#4A4A4A` | Secondary text and hints |
| `page` | `#F5F5F5` | Page background |
| `surface` | `#FFFFFF` | Cards, forms, table rows |
| `divider` | `#CFCFCF` | Card borders and table dividers (decoration only) |
| `field-border` | `#767676` | Input and select borders |

Contrast rules (WCAG AA: 4.5:1 for text, 3:1 for field borders and focus rings):

- White text on `primary` (9.2:1) and on `danger` (15.5:1) is safe for buttons and the top bar.
- Gold is never text or a thin line on white (1.4:1). Use it as a background with `ink` text (14.8:1), or as an accent on `primary` (6.5:1) or `danger` (10.9:1).
- Focus rings: a 2px `primary` outline with a 2px offset on light backgrounds, and an `accent` outline on `primary` or `danger` backgrounds. Every interactive element shows one.
- `divider` (1.6:1 on white) is too light for input borders, so inputs use `field-border` (4.5:1).
- The logo's foliage green (`#048136`) is not used. It is too close to `primary` to tell success apart from the brand.
- Never use color alone. Every message pairs its color with an icon and a text label, and selected rows also get a check mark or bold text, because `accent-tint` is close to white.

Strike levels (thresholds come from settings, BR 11) differ in lightness and label, not only in hue:

| Level | Look |
|---|---|
| Warning | `accent-tint` background, `ink` text, warning icon, "Warning: N strikes" |
| Stricter notice | `danger-tint` background, `danger` text, alert icon, "Notice: N strikes" |
| Blocked | `danger` background, white text, block icon, "Blocked: N strikes" |

The app does not use the college logo, because the project has no license for it. The top bar and login screen show the app name with a generic icon.

Font: the system font stack, `"Segoe UI Variable", "Segoe UI", system-ui, sans-serif`, set as Tailwind's `--font-sans`. The department PC runs Windows 11, which ships Segoe UI Variable, so nothing is downloaded and the app works without internet access. Body text is at least 16px.

### 14.1 Approved screen designs

Every screen follows an owner-approved mockup. Open the mockup before building or changing a screen, and match its layout, states, and wording. The mockups are private claude.ai pages, readable by the owner and by Claude Code sessions in the owner's account (Artifact tool, `read` action).

| Mockup | Screens | Tickets |
|---|---|---|
| [Sign-in screens](https://claude.ai/artifact/V5rxz4djYHtTg1yDyEW87b) (approved 2026-10-31) | Login, app shell and home, change password, not allowed | AUTH-4 |
| [All other screens](https://claude.ai/artifact/9FampTJnZj8twygeqD8iao) (approved 2026-11-01) | Dashboard; Checkout; Return; Flag review; Inventory and categories; Borrowers; Rooms and labs; Users; Settings and semesters; Reports; Audit log | RPT-1, BRW-3, FLG-3, BRW-5, BRW-6, FLG-4, FLG-2, MD-2, MD-1, MD-5, MD-6, MD-3, AUTH-3, MD-7, RPT-2, RPT-3, RPT-4, HRD-1 |

Decisions the owner made with the second mockup:

- Notes on open lines are edited on the Return screen only. The Dashboard only shows them.
- "Run flagging now" is on Flag review, asks for confirmation, and shows the API's refusal when pressed again within a minute.
- New users get a starting password typed by the admin, who tells the user in person. The user changes it on the Change password screen. No forced change at first sign-in.
- The audit sweep in HRD-1 is a script and a test, not a screen.
- The checkout confirmation summary is the Summary panel next to the form, plus a success message after saving, not a separate confirm step (owner decision 2026-11-05).
- The shared message area (`NotificationProvider`, at the top of `<main>`) is pinned with `position: sticky` at the top of the window, so success and error messages stay visible on long pages (owner decision 2026-11-05, BRW-3). It stays in the page flow below the top bar, has the page background, and sets `scroll-padding-top` on the page to its own height, so a field or button that gets focus is scrolled in below the messages, never under them. Page messages with more than text (Checkout's saved and not-saved results, with their Start a new checkout button) are rendered into the same area through a portal (`useMessageArea`), so they are pinned too; the padding follows whatever is in the area.
- The usage summary (RPT-4) uses bar charts. ARCHITECTURE section 2 names no chart library, so adding one needs the owner's approval. The mockup's light and dark chart switch is ignored: the app has light colors only.
- The banner and message wording in the mockup is approved as written.

The rules in this document and `BUSINESS_RULES.md` win over a mockup. If a ticket's acceptance criteria and a mockup disagree, ask the owner.
