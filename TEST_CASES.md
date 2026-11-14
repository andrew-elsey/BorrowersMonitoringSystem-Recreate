# Test Cases

One list of test cases for every ticket in `docs/BACKLOG.md`. Cases come from each ticket's acceptance criteria and from the worked scenarios in `docs/BUSINESS_RULES.md` section 3. They add no rules of their own: if a case and `BUSINESS_RULES.md` disagree, the rules win and the case is fixed.

## How to use this file

- **ID**: `TC-<EPIC>-NN`, numbered per epic (FND, AUTH, MD, BRW, FLG, RPT, SEC, HRD, DOC). IDs are never reused or renumbered. A case that no longer applies is marked "Removed", not deleted.
- **Ticket**: the ticket that makes the case pass. A ticket is ready for testing only when its cases are implemented and pass (`CLAUDE.md`, Trello workflow).
- **Rule**: business rule (`BR 1` to `BR 16`), scenario (`S1` to `S21`), or document section the case checks.
- **Level**: `unit`, `integration` (Vitest and Supertest against the real test database), `component` (Vitest and Testing Library), `e2e` (Playwright), or `manual`.
- **Automated by**: the test file that covers the case, `not yet` when the ticket is not built, or `manual` when it is checked by hand. When a ticket is built, replace `not yet` with the test file.
- Unless a case says otherwise, "closing" is 17:00 `Asia/Manila`, a current semester is set, and thresholds are the defaults (3, 4, 5).
- When a ticket's acceptance criteria change, update its cases in the same change.

Paths are shortened: `api/` is `apps/api/tests/`, `web/` is `apps/web/src/pages/`, and `web/components/` is `apps/web/src/components/`.

## FND: Foundation

| ID | Ticket | Rule | Level | Steps | Expected | Automated by |
|---|---|---|---|---|---|---|
| TC-FND-01 | FND-1 | ARCH 2, 3 | manual | From a clean checkout run `npm install`, `npm run lint`, `npm run typecheck`, `npm test` from the root | All four finish with no errors | manual |
| TC-FND-02 | FND-1 | CLAUDE.md | manual | Compare the Commands section of `CLAUDE.md` with the root `package.json` scripts | Every listed "available" command exists | manual |
| TC-FND-03 | FND-2 | ARCH 10 | manual | `cp .env.example .env`, set the required secrets, `docker compose up --build` | db, api, and web start and all healthchecks are healthy | manual |
| TC-FND-04 | FND-2 | ARCH 10 | manual | Open http://127.0.0.1:8080 and `GET /api/health` through it | The web app loads; `/api/health` answers ok through the nginx proxy | `api/health.test.ts` (endpoint); manual (proxy) |
| TC-FND-05 | FND-2 | ARCH 12.1, 12.6 | manual | `docker compose ps` and `docker compose config` | Only the web port is published; api and db have memory, CPU, restart, and log-rotation settings; containers have `TZ=Asia/Manila`; api runs as non-root | manual |
| TC-FND-06 | FND-2 | ARCH 10 | manual | Create data, `docker compose down`, then `up` again | Data is still there (named volume) | manual |
| TC-FND-07 | FND-2 | ARCH 12.2 | manual | Send a header over the nginx limit and a body over 100 KB through port 8080 | nginx refuses both; timeouts in `nginx.conf` match ARCH 12.2 | manual |
| TC-FND-08 | FND-3 | SPEC 4, ARCH 8 | integration | Apply migrations to a clean database | The initial migration applies; tables match SPEC 4 | `api/schema-constraints.test.ts` |
| TC-FND-09 | FND-3 | SPEC 4 | integration | Insert a UNIT item without asset tag, a UNIT item with quantity 2, a QUANTITY item with an asset tag | All three are rejected by constraints; valid UNIT and QUANTITY items are accepted | `api/schema-constraints.test.ts` (items) |
| TC-FND-10 | FND-3 | SPEC 4 | integration | Set two semesters current; create a semester that ends before it starts | Both rejected | `api/schema-constraints.test.ts` (semesters) |
| TC-FND-11 | FND-3 | SPEC 4 | integration | Create rooms "Lab 1" and "lab 1" | The second is rejected (case-insensitive unique) | `api/schema-constraints.test.ts` |
| TC-FND-12 | FND-3 | SPEC 4 | integration | Read settings; try to add a second settings row | One row only, defaults 17:00, 3, 4, 5 | `api/schema-constraints.test.ts` (settings) |
| TC-FND-13 | FND-3 | SPEC 4 | integration | Return more than borrowed; borrow 0; return 0 | All rejected by constraints | `api/schema-constraints.test.ts` (transaction lines and returns) |
| TC-FND-14 | FND-3 | BR 15 | integration | Delete a user who has transactions or is named in the audit log | Rejected by the database | `api/schema-constraints.test.ts` |
| TC-FND-15 | FND-3 | BR 14 | integration | Make a change with `audit(tx, ...)`; make a change that fails after auditing; audit a system action | Entry written with the change; rolled back with a failed change; null actor allowed | `api/audit.test.ts` |
| TC-FND-16 | FND-3 | SPEC 4 | unit | Compare each shared enum with the Prisma schema | They match | `api/enums.test.ts` |
| TC-FND-17 | FND-4 | ARCH 5 | integration | Run the seed with `ADMIN_USERNAME` and `ADMIN_PASSWORD` | First admin, default settings, sample categories, rooms, items of both types, borrowers, and a current semester exist; every record is audited without the hash | `api/seed.test.ts` |
| TC-FND-18 | FND-4 | ARCH 5 | integration | Run the seed twice | Nothing duplicated or overwritten | `api/seed.test.ts` (also after a case-only change of a sample school ID), `api/qa-md1-seed-rerun.test.ts` (after a case-only rename of a sample category) |
| TC-FND-19 | FND-4 | ARCH 5 | integration | Run the seed without admin credentials or with a too-short password | It fails with a clear message | `api/seed.test.ts` |
| TC-FND-20 | FND-4 | ARCH 5 | integration | Run the seed in production mode | Only the admin and settings are created; no QA accounts | `api/seed.test.ts` |
| TC-FND-21 | FND-4 | ARCH 12.4 | integration | `admin:reset-password` for a known user, an unknown user, and with a short password | Known: reset and audited without the hash; unknown and short: refused, old password kept | `api/admin-reset-password.test.ts` |
| TC-FND-22 | FND-5 | SPEC 8, ARCH 7 | component | Submit a form field with an invalid value, then with a field error returned in the API `details` | Both errors show inline next to the field | `web/components/Field.test.tsx` |
| TC-FND-23 | FND-5 | SPEC 8 | component | Use each shared component with the keyboard only and query it by label | Every control has a label and works with the keyboard | `web/components/Field.test.tsx`, `web/components/DataTable.test.tsx`, `web/components/ConfirmDialog.test.tsx`, `web/components/FormDialog.test.tsx`, `web/components/Notifications.test.tsx` |
| TC-FND-24 | FND-5 | SPEC 7 | component | Render the data table loading, with zero rows, and with more rows than one page | Loading state, empty state, and pagination all show | `web/components/DataTable.test.tsx` |
| TC-FND-25 | FND-5 | SPEC 5 | component | Start a destructive action, cancel, then confirm | Cancel does nothing; confirm runs the action | `web/components/ConfirmDialog.test.tsx` |
| TC-FND-26 | FND-5 | ARCH 7 | component | Trigger a success and an API error | Success notification; error notification shows the API error `message` | `web/components/Notifications.test.tsx` |
| TC-FND-27 | FND-6 | ARCH 6 | integration | With the database session time zone at Asia/Manila, write rows using `@default(now())`, `@updatedAt`, and `new Date()` | Stored instants are within a few seconds of `Date.now()` | `api/timestamps.test.ts` |
| TC-FND-28 | FND-6 | ARCH 6 | integration | Create a session | Expiry stored as now plus `SESSION_TTL_HOURS` | `api/timestamps.test.ts` |
| TC-FND-29 | FND-6 | ARCH 6 | integration | Start the API with a `DATABASE_URL` that has `options` | Refused, because it would replace `TimeZone=UTC` | `api/timestamps.test.ts` |
| TC-FND-30 | FND-7 | SPEC 8, ARCH 7 | component | Submit a form, from the keyboard, that gets API field errors for two fields listed out of form order | Focus moves to the first errored field in form order; each field error is announced (`role="alert"`) | `web/components/Field.test.tsx`, `web/qa-fnd7-gaps.test.tsx` (Change password and a real form), `web/qa-md1-r5-fnd7-merge.test.tsx` (Inventory add and rename) |
| TC-FND-31 | REG-1 | SPEC 5 | component | Open Home, Checkout, Change password, a page the role may not open, an unknown path, and the sign-in page | The tab title is "<Page> · Borrowers Monitoring System": Home, Checkout, Change password, Not allowed, Home (redirected), Sign in | `web/reg1.test.tsx` |

## AUTH: Authentication and users

| ID | Ticket | Rule | Level | Steps | Expected | Automated by |
|---|---|---|---|---|---|---|
| TC-AUTH-01 | AUTH-1 | ARCH 5 | integration | Log in with a valid username and password | 200 with the user; session cookie with the ARCH 5 settings | `api/auth.test.ts` |
| TC-AUTH-02 | AUTH-1 | ARCH 5 | integration | Log in with a wrong password, an unknown username, and an inactive user | All three get the same generic error | `api/auth.test.ts` |
| TC-AUTH-03 | AUTH-1 | CLAUDE.md rule 14 | integration | Make anonymous requests and failed logins | No session is stored | `api/auth.test.ts` |
| TC-AUTH-04 | AUTH-1 | ARCH 5 | integration | Log in twice | The second login gets a new session ID and the old one stops working | `api/auth.test.ts` |
| TC-AUTH-05 | AUTH-1 | ARCH 5 | integration | Log out, then call a protected endpoint | 401; the session is gone | `api/auth.test.ts` |
| TC-AUTH-06 | AUTH-1 | ARCH 5, BR 14 | integration | Change own password with the right current password | Changed; the change is audited | `api/auth.test.ts` |
| TC-AUTH-07 | AUTH-1 | ARCH 5 | integration | Change password with a wrong current password, a too-short new one, and while signed out | Refused each time | `api/auth.test.ts` |
| TC-AUTH-08 | AUTH-1 | ARCH 5 | integration | Send a state-changing request without `X-Requested-With: fetch` | Refused (CSRF) | `api/auth.test.ts` |
| TC-AUTH-09 | AUTH-1 | ARCH 12.4 | integration | Log in with an unknown username | One password verify runs, the same as a wrong password | `api/auth.test.ts` |
| TC-AUTH-10 | AUTH-1 | BR 16, S20 | integration | Fail login 10 times for one username from one IP, then try the right password | 429 `RATE_LIMITED` with `Retry-After`, no hashing; the account is not locked and works from another IP | `api/auth.test.ts` |
| TC-AUTH-11 | AUTH-1 | BR 16 | integration | Fail login 30 times from one IP across usernames | 429 per IP | `api/auth.test.ts` |
| TC-AUTH-12 | AUTH-1 | BR 16 | integration | Log in successfully many times | Successful logins do not count toward the throttle | `api/auth.test.ts` |
| TC-AUTH-13 | AUTH-1 | ARCH 12.4 | integration | Fill the hashing queue, then log in | 503 `SERVER_BUSY` with `Retry-After` | `api/auth.test.ts`, `api/password.test.ts` |
| TC-AUTH-14 | AUTH-1 | ARCH 12.4 | unit | Hash and verify a password; run more jobs than the limiter allows | argon2id hash verifies; never more than `concurrency` at once; beyond the queue is refused | `api/password.test.ts` |
| TC-AUTH-15 | AUTH-1 | ARCH 12.3 | integration | Read the app's `trust proxy` setting | Set from `TRUST_PROXY_HOPS`, default 1 | `api/health.test.ts` |
| TC-AUTH-16 | AUTH-2 | SPEC 3 | unit | Compare `PERMISSIONS` with the table in SPEC 3 | They match | `api/roles.test.ts` |
| TC-AUTH-17 | AUTH-2 | SPEC 3, S18 | integration | Call every protected capability as Admin, Handler, and View-only | Allowed per SPEC 3; otherwise 403 `FORBIDDEN` | `api/roles.test.ts` |
| TC-AUTH-18 | AUTH-2 | SPEC 3 | integration | Call a protected endpoint signed out | 401 `UNAUTHENTICATED`, not 403 | `api/roles.test.ts` |
| TC-AUTH-19 | AUTH-3 | BR 14 | integration | Admin creates, edits, deactivates a user, and resets a password | Each works and is audited | `api/users.test.ts` (no password or hash in the reply or the audit log; duplicate username `DUPLICATE_VALUE`; password policy and SPEC 7 bounds; deactivating or changing a role signs that user out at once, ARCH 5), `web/UsersPage.test.tsx` (add form behind "+ Add user", short password refused in the browser, edit and reset dialogs) |
| TC-AUTH-20 | AUTH-3 | BR 15 | integration | Admin tries to remove a user who has transactions | The user can only be deactivated; the record and its history stay | `api/users.test.ts` (there is no DELETE: 404 `NOT_FOUND`; deactivated, transaction kept), `web/UsersPage.test.tsx` (no Delete button) |
| TC-AUTH-21 | AUTH-3 | BACKLOG AUTH-3 | integration | Admin deactivates their own account | Refused | `api/users.test.ts` (409 `CANNOT_DEACTIVATE_SELF`, also with the id in upper case; nothing audited), `web/UsersPage.test.tsx` (the server's message is shown) |
| TC-AUTH-22 | AUTH-3 | S18 | integration | Handler opens user management | 403 | `api/users.test.ts` (handler and viewer 403 on every endpoint, signed out 401), `web/UsersPage.test.tsx` (handler sees the "not allowed" page and no Users menu item) |
| TC-AUTH-38 | AUTH-3 | ARCH 5 (owner decision 2026-11-12) | integration | Sign a user in twice; an admin resets their password (screen and command line). Then the user changes their own password from one of two sessions | Reset: every session of that user is signed out. Own change: the session that made it stays, the other is signed out. Other users stay signed in | `api/users.test.ts` |
| TC-AUTH-39 | AUTH-3 | owner decision 2026-11-12 | integration | Admin changes their own role; edits their own row on the Users screen | 409 `CANNOT_CHANGE_OWN_ROLE`, nothing saved or audited; the dialog shows the role locked and sends no role | `api/users.test.ts`, `web/UsersPage.test.tsx` |
| TC-AUTH-40 | AUTH-3 | SPEC 4 (owner decision 2026-11-12) | integration | Create "HAL" when "hal" exists; rename to another user's name in other case; change the case of your own username; sign in with the old case; run the migration with case duplicates present | `DUPLICATE_VALUE` on `username`; own case change saved as typed; sign-in is exact, so the old case fails; the migration stops naming the clashing usernames and changes nothing | `api/users.test.ts` |
| TC-AUTH-23 | AUTH-4 | SPEC 3, 5 | component | Signed-out user opens the app, signs in | Sent to login; after sign-in sees home with name and role | `web/LoginPage.test.tsx` |
| TC-AUTH-24 | AUTH-4 | ARCH 5 | component | Submit login with empty fields | Caught in the browser; no API call | `web/LoginPage.test.tsx` |
| TC-AUTH-25 | AUTH-4 | ARCH 5 | component | Submit a failed login | Generic API error shown; password cleared | `web/LoginPage.test.tsx` |
| TC-AUTH-26 | AUTH-4 | ARCH 7 | component | Login answered with 429 or 503 and `Retry-After` | "Try again in N seconds" | `web/LoginPage.test.tsx` |
| TC-AUTH-27 | AUTH-4 | BACKLOG AUTH-4 | component | Reload while signed in | Still signed in (user from `GET /api/auth/me`) | `web/LoginPage.test.tsx`, `api/auth.test.ts` |
| TC-AUTH-28 | AUTH-4 | BACKLOG AUTH-4 | component | Sign out, then sign in again | Back on the login page; next sign-in lands on home | `web/LoginPage.test.tsx` |
| TC-AUTH-29 | AUTH-4 | ARCH 7 | component | Session expires on a page (401), then sign in | Returned to login, then back to the same page | `web/LoginPage.test.tsx`, `web/ChangePasswordPage.test.tsx` |
| TC-AUTH-30 | AUTH-4 | ARCH 5 | component | Change password with a short password and with mismatched new passwords | Password rule shown; both refused in the browser | `web/ChangePasswordPage.test.tsx` |
| TC-AUTH-31 | AUTH-4 | ARCH 5 | component | Change password with valid input; with a wrong current password | Only current and new password are sent, form clears; API error shows by the current-password field | `web/ChangePasswordPage.test.tsx` |
| TC-AUTH-32 | AUTH-4 | SPEC 3 | component | A role opens a page it may not use | "Not allowed" page | `web/ChangePasswordPage.test.tsx` |
| TC-AUTH-36 | AUTH-4 | SPEC 3, 5 | manual | Sign in as Admin, Handler, and View-only | The menu shows only items the role may use; items for screens not built yet are hidden | manual |
| TC-AUTH-37 | REG-1 | SPEC 5 | component | (a) Signed in, then the API answers 401 on any request. (b) Press Sign out. (c) Open the app signed out (first visit, redirected to login), then fail a login. (d) After (a), enter a wrong password | (a) The sign-in page shows "Your session has expired. Please sign in again." (b) and (c) No such message. (d) Only the login error shows, the expiry message goes away | `web/reg1.test.tsx` |
| TC-AUTH-33 | AUTH-4 | ARCH 7 | manual | Sign in and change password at http://127.0.0.1:8080 under `docker compose up` | Works through nginx | manual |
| TC-AUTH-34 | AUTH-5 | BR 16, ARCH 12.4 | integration | Block an IP by the per-IP limit, then send failed logins with new usernames | Nothing new is stored in the limiters | `api/login-rate-limit.test.ts` |
| TC-AUTH-35 | AUTH-5 | ARCH 12.4 | integration | Fail login with a very long username | The limiter key's username part is at most 200 characters | `api/login-rate-limit.test.ts` |

## MD: Master data

| ID | Ticket | Rule | Level | Steps | Expected | Automated by |
|---|---|---|---|---|---|---|
| TC-MD-01 | MD-1 | BR 14 | integration | Admin creates and renames a category | Saved and audited | `api/categories.test.ts`, `api/qa-md1-gaps.test.ts`, `web/InventoryPage.test.tsx`, `web/qa-md1-r3-gaps.test.tsx` (same-name rename: no toast; rename NOT_FOUND closes and reloads); `api/categories.test.ts` (SPEC 7 bounds: a name with a control character such as NUL gets `VALIDATION_ERROR` on `name`, not a 500) |
| TC-MD-02 | MD-1 | BR 15 | integration | Admin deletes an unused category, then one in use | Unused: deleted; in use: `HAS_HISTORY` | `api/categories.test.ts`, `api/qa-md1-gaps.test.ts`, `web/InventoryPage.test.tsx` (NOT_FOUND reloads the list), `web/qa-md1-r5-gaps.test.tsx` (HAS_HISTORY reloads the list) |
| TC-MD-03 | MD-1 | SPEC 3 | integration | Handler creates a category | 403 | `api/categories.test.ts`, `api/qa-md1-gaps.test.ts` (signed out: 401 on every endpoint) |
| TC-MD-04 | MD-2 | SPEC 4 | integration | Create a UNIT item without an asset tag, with a duplicate asset tag, with quantity other than 1 | Each rejected with `VALIDATION_ERROR` or `DUPLICATE_VALUE` | `api/items.test.ts`, `web/InventoryItems.test.tsx` (duplicate asset tag shown under the field), `api/qa-md2-gaps.test.ts` (whitespace, null, 200/201 characters, UNIT totals other than 1, concurrent creates), `web/qa-md2-gaps.test.tsx` (duplicate tag on edit) |
| TC-MD-05 | MD-2 | SPEC 4 | integration | Create a QUANTITY item with an asset tag, with a negative quantity; then with quantity 0 | First two rejected; quantity 0 accepted | `api/items.test.ts` (also 10,001, 2.5, and a missing quantity; 10,000 accepted), `web/InventoryItems.test.tsx`, `api/qa-md2-gaps.test.ts` (-1, 0, 10,000, 10,001 and non-integers on create and edit) |
| TC-MD-06 | MD-2 | SPEC 4, 7 | integration | Search and filter items by name, category, status, and tracking type with `pageSize=100` and `101` | Filters work; 100 allowed, 101 rejected | `api/items.test.ts` (search also matches asset tags), `web/InventoryItems.test.tsx` (filters send their values and go back to page 1), `api/qa-md2-gaps.test.ts` (search 1/2/100/101 characters, wildcards, control characters, pageSize, roles), `web/qa-md2-gaps.test.tsx` (each filter and the search go back to page 1) |
| TC-MD-07 | MD-2 | BR 15, S19 | integration | Delete an item with past transactions; delete one without | With history: `HAS_HISTORY`, told to retire; without: deleted | `api/items.test.ts`, `web/InventoryItems.test.tsx` (the "Cannot delete" message and its Retire button), `api/qa-md2-gaps.test.ts` (open line, NOT_FOUND, edit racing a delete), `web/qa-md2-gaps.test.tsx` (Cancel, failed Retire) |
| TC-MD-08 | MD-2 | BR 14 | integration | Create, edit, and retire an item | Each audited | `api/items.test.ts`, `api/qa-md2-gaps.test.ts` (audit contents; a no-change edit writes none) |
| TC-MD-09 | MD-3 | SPEC 3 | integration | Admin creates, edits, and deactivates a room | All work and are audited | `api/rooms.test.ts` (rename, deactivate, reactivate; a no-change edit writes no audit), `web/RoomsPage.test.tsx` (Rename dialog from the row, Deactivate, Delete; Retry after a failed load moves focus to the name field), `api/qa-md3-gaps.test.ts` (empty PATCH and PATCH with `createdById` write no audit), `web/qa-md3-gaps.test.tsx` (Reactivate; same-name rename shows no message; empty state) |
| TC-MD-10 | MD-3 | SPEC 3 | integration | Handler uses quick-add for a room; handler edits a room | Quick-add works with `created_by` set; edit is 403 | `api/rooms.test.ts` (handler quick-add via `POST /api/rooms`; rename, deactivate, and delete are 403 for a handler; viewer 403, signed out 401; listing is TC-MD-30), `api/qa-md3-gaps.test.ts` (`created_by` from the session even when the body sends one; signed-out PATCH/DELETE 401; handler DELETE 403; missing fetch header 403) |
| TC-MD-11 | MD-3 | SPEC 4 | integration | Add "CL-201" when "cl-201" exists | `DUPLICATE_VALUE` | `api/rooms.test.ts` (on create by admin and handler, and on rename; a room may change the case of its own name; a match with an inactive room keeps `DUPLICATE_VALUE` but says so, telling a handler to ask an admin and an admin to reactivate it, owner decision 2026-11-03), `web/RoomsPage.test.tsx` (message under the field), `api/qa-md3-gaps.test.ts` (padded and differently cased names; concurrent adds; rename to an inactive name changes nothing), `web/qa-md3-gaps.test.tsx` (inactive message under the add field; rename duplicate keeps the dialog open) |
| TC-MD-12 | MD-3 | BR 15 | integration | Admin tries to remove a room used in a transaction | The room can only be deactivated; the record and its history stay | `api/rooms.test.ts` (`HAS_HISTORY`, record and transaction kept, then deactivated; an unused room is deleted and audited), `web/RoomsPage.test.tsx` (Delete unavailable with "Used in 3 transactions"), `api/qa-md3-gaps.test.ts` (deactivated room with history still `HAS_HISTORY`; second delete `NOT_FOUND`; bad and unknown ids; 413 body), `web/qa-md3-gaps.test.tsx` (refused delete reloads the list) |
| TC-MD-13 | MD-4 | CLAUDE.md rule 1 | unit | Search the code for queries on the borrowers table outside `LocalBorrowerService` | None found | `api/borrower-reads.test.ts`, `api/qa-md4-gaps.test.ts` (patterns the guard catches) |
| TC-MD-14 | MD-4 | ARCH 4 | integration | Replace `LocalBorrowerService` with a test double | Callers work unchanged | `api/borrower-service.test.ts`, `api/qa-md4-gaps.test.ts` (wildcards, whitespace, unicode, ordering, uuid forms) |
| TC-MD-15 | MD-5 | SPEC 4 | integration | Admin creates and edits a borrower; duplicate school ID | Saved and audited; duplicate gets `DUPLICATE_VALUE` | `api/borrowers.test.ts`, `web/BorrowersPage.test.tsx` (form, edit dialog, duplicate under the field); `api/borrowers.test.ts` (three edits at once: the row lock keeps the audit before values consistent), `api/qa-md5-gaps.test.ts`, `web/qa-md5-gaps.test.tsx` (edit dialog errors, failed Deactivate) |
| TC-MD-16 | MD-5 | SPEC 7 | integration | Search borrowers by name and by school ID with 1, 2, and 101 characters | 2 to 100 accepted; others rejected; results paginated | `api/borrowers.test.ts`, `api/borrower-service.test.ts` (`list` in both implementations), `web/BorrowersPage.test.tsx` (search box; back to page 1 only when the trimmed text changes), `api/qa-md5-gaps.test.ts` (bounds, control characters, wildcards) |
| TC-MD-17 | MD-5 | BR 3 | integration | Deactivate a borrower, then look them up for checkout | Not selectable for checkout | `api/borrowers.test.ts` (search returns `active: false`, `isEligible` gives `BORROWER_INACTIVE`; the checkout screen itself is BRW-3), `web/BorrowersPage.test.tsx` (Deactivate keeps focus while pending and after the label flips; focus moves to the Status filter when the filter hides the row) |
| TC-MD-18 | MD-6 | SPEC 6 | integration | Import a CSV with new, existing, and invalid rows | New created, existing updated by school ID, invalid rejected with reasons; counts reported; audited | `api/borrower-import.test.ts` (school ID matched ignoring case, a case-only change saved as typed; unchanged rows counted and not audited; a repeated school ID in the file; missing header, broken CSV, and no file refused with nothing saved; handler 403, signed out 401), `web/BorrowerImport.test.tsx` (Import CSV sends the file, shows the counts and rejected rows, reloads the list) |
| TC-MD-19 | MD-6 | SPEC 7, S21 | integration | Import a 2.1 MB CSV, two files, and a CSV with 5,001 rows | Rejected before parsing with `PAYLOAD_TOO_LARGE` | `api/borrower-import.test.ts` (nothing saved or audited), `npm run test:nginx` (nginx answers 2.1 MB with its JSON 413 and takes 1.9 MB; 2 imports a minute, burst 1, then 429 with `Retry-After: 30`) |
| TC-MD-20 | MD-6 | ARCH 12.3 | integration | Import a 5,000-row CSV while making other requests | Other requests are not blocked | `api/borrower-import.test.ts` (list requests answered during the import; the event loop never held for 250 ms; also the 30 a minute import limit per address) |
| TC-MD-21 | MD-7 | SPEC 4 | integration | Admin creates semesters and sets one current, then another | Exactly one is current; audited | `api/settings.test.ts` (also concurrent switches, edit, validation), `web/SettingsPage.test.tsx`, `api/qa-md7-gaps.test.ts` (handler and viewer 403 on edit, set current and settings; signed out 401 and missing CSRF header 403 on every endpoint; name 200/201 characters and control characters; page size 100/101; `current` on another page; bad uuid; body over 100 KB; audit rolled back with its change), `web/qa-md7-gaps.test.tsx` (viewer gets Not allowed; menu order Rooms and labs, then Settings and semesters) |
| TC-MD-22 | MD-7 | SPEC 4 | integration | Save thresholds 4, 3, 5 and 3, 3, 5 | Rejected (warning < notice < block) | `api/settings.test.ts`, `web/SettingsPage.test.tsx`, `api/qa-md7-gaps.test.ts` (1, 2, 3 and 98, 99, 100 saved; closing time 00:00 and 23:59 saved, 17:60, 17:00:00, 5pm and empty refused; missing, null and negative thresholds refused; 4, 4, 4 marks both fields; timezone in the body ignored), `web/qa-md7-gaps.test.tsx` (4, 3, 5 marked under Notice and not sent; a server error shows under Closing time) |
| TC-MD-23 | MD-7 | CLAUDE.md rule 3 | integration | Change closing time and thresholds | Saved and audited; checkout and flagging read the new values | `api/settings.test.ts` (saved, audited, and read fresh by `getSettings`; checkout and flagging themselves are checked in BRW-2, FLG-2, FLG-3), `api/qa-md7-gaps.test.ts` (two saves at once: audit entries chain; `requireCurrentSemester(tx)` and `getSettings(tx)` see the latest switch and save inside a transaction) |
| TC-MD-24 | MD-1 | SPEC 4 | integration | Create "audio" when "Audio" exists; rename another category to "AUDIO"; rename "Audio" to "AUDIO" | First two: `DUPLICATE_VALUE`; changing its own case is saved | `api/categories.test.ts`, `api/qa-md1-gaps.test.ts` |
| TC-MD-25 | MD-1 | SPEC 5 | component | Open Inventory and categories while the categories API fails (500 or down), then press Retry | An error message and a Retry button, no "No categories yet." and no row count; Retry loads the list again | `web/InventoryPage.test.tsx` (focus moves to the name field after Retry), `web/qa-md1-r3-gaps.test.tsx` (API down), `web/qa-md1-r5-gaps.test.tsx` (a failed Retry keeps focus on Retry) |
| TC-MD-26 | MD-1 | SPEC 8 | component | With the keyboard only: Rename a category from its row, save with Enter; Rename again and press Escape; Tab to Delete on a category in use | The dialog opens with the name filled in and focused; Enter saves; Escape closes without saving; focus returns to the row Rename button; the in-use Delete is focusable, does nothing, and reads "Used by N items" | `web/InventoryPage.test.tsx`, `web/components/FormDialog.test.tsx`, `web/qa-md1-r3-gaps.test.tsx` (keyboard only), `web/components/qa-md1-r3-dialog-isolation.test.tsx` |
| TC-MD-27 | MD-5 | SPEC 4 | integration | Create school ID "2026-a01" when "2026-A01" exists; edit another borrower to "2026-a01"; edit "2026-A01" to "2026-a01" | First two: `DUPLICATE_VALUE` on `schoolId`; changing its own case is saved as typed and audited | `api/borrowers.test.ts`, `api/seed.test.ts` (seed re-run after a case-only change), `api/qa-md5-gaps.test.ts` (padded IDs, concurrent creates) |
| TC-MD-28 | MD-5 | SPEC 5 | component | On Borrowers, check the Type ("All types", Student, Faculty, Employee) and Status ("Active and inactive", Active, Inactive) filters; go to page 2 and pick Faculty, then Inactive; send `type=ALUMNI` and `active=yes` to the API | Defaults match everyone; each change reloads page 1 with `type` and `active`; filtered results only; bad values get `VALIDATION_ERROR` | `web/BorrowersPage.test.tsx`, `api/borrowers.test.ts`, `api/borrower-service.test.ts` (both implementations), `api/qa-md5-gaps.test.ts` (bad filter values) |
| TC-MD-29 | MD-2 | SPEC 4 | integration | Create asset tag "lt-001" when "LT-001" exists; edit another item to "Lt-001"; edit "LT-001" to "lt-001" | First two: `DUPLICATE_VALUE` on `assetTag`; changing its own case is saved as typed and audited | `api/items.test.ts`, `api/seed.test.ts` (seed re-run after a case-only change), `api/qa-md2-gaps.test.ts` (case and whitespace, concurrent edits) |
| TC-MD-30 | MD-3 | SPEC 3, 5 | integration | Handler lists rooms | Only active rooms are returned; viewer 403 | `api/rooms.test.ts` (also with `?active=false` and `pageSize=100`; 101 rejected; admins see inactive rooms too; viewer 403 and signed out 401 in the viewer test), `api/qa-md3-gaps.test.ts` (page 2 with `?active=false`; past the last page; page and pageSize refused) |
| TC-MD-31 | MD-7 | SPEC 4 | integration | Create or edit a semester whose dates overlap another's, including one starting on the day another ends, and two overlapping creates at once; then one starting the day after | Overlaps: `SEMESTER_OVERLAP` on `startDate` naming the other semester, nothing saved, only one of the concurrent creates saved; the day after is saved | `api/settings.test.ts`, `web/SettingsPage.test.tsx` (error under the field), `api/qa-md7-gaps.test.ts` (edit an earlier semester to end on the day a later one starts: refused naming the later one; the day before: saved; a semester inside another refused) |
| TC-MD-32 | MD-7 | SPEC 4 | integration | Create "1ST SEMESTER AY 2026-2027" when "1st Semester AY 2026-2027" exists; edit another semester to that name; edit it to its own name in lower case | First two: `DUPLICATE_VALUE` on `name`; changing its own case is saved and audited | `api/settings.test.ts`, `web/SettingsPage.test.tsx` (error under the field) |
| TC-MD-33 | MD-7 | BR 12 | component | Press Set as current on a semester, Cancel; press it again and confirm | A confirm dialog says only flags from transactions in that semester will count as strikes, with Cancel focused; Cancel sends nothing; confirming switches it and focus goes to the newly current semester's name in the list, or to the new semester name field when its row is not shown (the list failed to reload) | `web/SettingsPage.test.tsx` (also the focus fallback when the reload fails), `web/qa-md7-gaps.test.tsx` (a failed Set as current shows the API message, closes the dialog, and keeps the old current semester), `web/qa-md7-r2-gaps.test.tsx` (focus: the row moved to page 2 on reload goes to the new semester name; a semester on page 2 keeps page 2 and focuses its name; a second Set as current focuses the second one, one current; paging away during the reload never focuses an old row) |
| TC-MD-34 | REG-1 | BR 1 | component | Open the Items tab with a quantity item (8 of 20 free), a unit item that is out, one that is in, and an item under repair | An Available column sits between Asset tag and Condition, as in the approved mockup: "8 of 20", "Out", "Available", "—" | `web/reg1.test.tsx` |
| TC-MD-35 | REG-1 | SPEC 5 | manual | At 1000, 400, and 320 px wide, open Inventory, Borrowers, and Categories with a name like "Extension cord" | "Extension cord, 5 m" stays on one line at every width, never split inside a word; a 100-character name with no spaces wraps inside a 16 rem cell; at 1000 px Edit and Delete stay in view; at 400 and 320 px the table scrolls inside its own box and the page has no sideways scroll, also with a 100-character category name in the Category filter and the item dialog (selects are `w-full max-w-full`) | manual (the cell uses `block max-w-64 break-words`, the table sits in `overflow-x-auto`, and selects are `w-full max-w-full`: `web/reg1.test.tsx`) |

## BRW: Borrowing

| ID | Ticket | Rule | Level | Steps | Expected | Automated by |
|---|---|---|---|---|---|---|
| TC-BRW-01 | BRW-1 | BR 1 | unit | Ask availability of a UNIT item with and without an open line | Unavailable with an open line; available without | `api/availability.test.ts` (unit and integration: out, returned, never borrowed) |
| TC-BRW-02 | BRW-1 | BR 1 | unit | QUANTITY item total 10, open lines 4 and 3 (1 returned on the second) | Available 4 | `api/availability.test.ts` (unit and integration through a transaction client; a fully returned line adds nothing) |
| TC-BRW-03 | BRW-1 | BR 1 | unit | Ask availability of items with status `UNDER_REPAIR`, `LOST`, `RETIRED` | Not available | `api/availability.test.ts` (unit for UNIT and QUANTITY items; integration for UNIT items) |
| TC-BRW-04 | BRW-2 | BR 2 | integration | Handler checks out two items to a borrower for a room | One transaction and two lines; handler from the session; issue time and current semester set; audited | `api/checkout.test.ts` (also: an `issuedById` in the body is ignored) |
| TC-BRW-05 | BRW-2 | BR 1, S14 | integration | Issue a unit item that is already out | `ITEM_UNAVAILABLE` | `api/checkout.test.ts` |
| TC-BRW-06 | BRW-2 | BR 1, S14 | integration | Issue 4 of a quantity item with 3 available | `INSUFFICIENT_QUANTITY` | `api/checkout.test.ts` (3 of the same item then succeeds) |
| TC-BRW-07 | BRW-2 | BR 1, S14 | integration | Issue items with status `UNDER_REPAIR`, `LOST`, `RETIRED` | `ITEM_UNAVAILABLE` | `api/checkout.test.ts` (UNIT and QUANTITY items) |
| TC-BRW-08 | BRW-2 | BR 3, S14 | integration | Issue to an inactive borrower | `BORROWER_INACTIVE` | `api/checkout.test.ts` |
| TC-BRW-09 | BRW-2 | BR 2, S14 | integration | Check out with no current semester | `NO_CURRENT_SEMESTER` | `api/checkout.test.ts` |
| TC-BRW-10 | BRW-2 | BR 4, S14 | integration | Check out two lines where the second fails | No transaction and no lines are created | `api/checkout.test.ts` (no audit entry either) |
| TC-BRW-11 | BRW-2 | BR 4, S16 | integration | Two handlers issue the same unit item at the same moment | Exactly one succeeds; the other gets `ITEM_UNAVAILABLE` | `api/checkout.test.ts` (fails if the row lock is removed; opposite line orders do not deadlock) |
| TC-BRW-12 | BRW-2 | SPEC 7, S21 | integration | Check out 51 lines; a line with quantity 0 or 10,001 | `VALIDATION_ERROR` | `api/checkout.test.ts` (also: no lines, a repeated item, a 501-character note, a unit item with quantity 2; an unknown item, borrower, or room is `NOT_FOUND`) |
| TC-BRW-13 | BRW-2 | SPEC 3 | integration | View-only user calls checkout | 403 (S18) | `api/checkout.test.ts` (signed out 401) |
| TC-BRW-14 | BRW-3 | SPEC 5 | component | Look up a borrower | Name, type, and department shown | `web/CheckoutPage.test.tsx` (also: an inactive borrower shows "Inactive borrower." and Confirm is disabled, BR 3) |
| TC-BRW-15 | BRW-3 | SPEC 5 | component | Pick a room; add a new room from the picker | Room selected; new room is created and selected | `web/CheckoutPage.test.tsx` (also: a duplicate name shows under the new room field) |
| TC-BRW-16 | BRW-3 | SPEC 5 | component | Search an item; enter quantity for a QUANTITY item; add a note and expected return date | Lines show with quantity, note, and date | `web/CheckoutPage.test.tsx` (also: non-active items and items already on a line cannot be added; a unit line has no quantity field) |
| TC-BRW-17 | BRW-3 | SPEC 5 | component | Review and submit, clicking submit twice quickly | Confirmation summary shown; only one request is sent | `web/CheckoutPage.test.tsx` (two clicks in the same moment send one request; nothing is sent while the borrower, room, or items are missing, and focus goes to the first missing one; after a save focus goes to "Start a new checkout") |
| TC-BRW-18 | BRW-3 | ARCH 7 | component | Submit a checkout the API refuses | The API error `message` is shown | `web/CheckoutPage.test.tsx` (`INSUFFICIENT_QUANTITY` and `ITEM_UNAVAILABLE` marked on the line by `details.itemId`, the line's availability updated from `details.available`, `lines.N.expectedReturnDate` on that line, `fields.lines` and `LOCATION_INACTIVE` at the top) |
| TC-BRW-19 | BRW-3 | SPEC 8 | manual | Complete a checkout with the keyboard only | Possible without a mouse | manual |
| TC-BRW-20 | BRW-4 | BR 5 | integration | Return a line in full | Return event with quantity, time, condition, and receiving handler from the session; audited | `api/returns.test.ts` |
| TC-BRW-21 | BRW-4 | BR 5 | integration | Handler B returns an item issued by handler A | Receiving handler is B; issuing handler stays A | `api/returns.test.ts` |
| TC-BRW-22 | BRW-4 | BR 5, S3 | integration | Cara borrows 5 extension cords at 09:00 and returns 3 at 14:00 | Line open with 2 outstanding | `api/returns.test.ts` |
| TC-BRW-23 | BRW-4 | BR 6 | integration | Return a flagged line in full | Quantities change; `flag_status` stays `FLAGGED` | `api/returns.test.ts` |
| TC-BRW-24 | BRW-4 | S15 | integration | Return 3 when 2 are outstanding; return on a line with nothing outstanding | `RETURN_EXCEEDS_OUTSTANDING` both times, with the message "You entered 3 of Extension cord, but the amount still out on this line is 2." (and "Extension cord on this line is already fully returned." when 0 are out) | `api/returns.test.ts` |
| TC-BRW-25 | BRW-4 | S17 | integration | Return a unit laptop as `DAMAGED`; return a quantity item as `DAMAGED` | Laptop: event and item condition `DAMAGED`, status stays `ACTIVE`; quantity item: condition on the event only | `api/returns.test.ts` |
| TC-BRW-26 | BRW-4 | BR 11 | integration | Return items for a borrower at 5 strikes | Return works (returns are never blocked) | `api/returns.test.ts` (5 transactions with a `FLAGGED` line, borrower also inactive), `api/strike-blocking.test.ts` (blocked at 5 strikes, still returns; TC-FLG-50) |
| TC-BRW-27 | BRW-5 | SPEC 5 | component | Find open borrowings by borrower, by item, and by asset tag | Matching open lines shown | `web/ReturnPage.test.tsx` (the first load lists every open line; the screen also shows borrower, item and tag, room, quantity out, expected date) |
| TC-BRW-28 | BRW-5 | BR 5 | component | Return all of one line and part of another, choosing condition | Requests sent with the chosen quantities and conditions | `web/ReturnPage.test.tsx` (GOOD is the default; a unit line is fixed at 1; the confirmation says the flag stays; a bad quantity is stopped on the row; the list reloads after a return, and the quantity box restarts from the new outstanding count) |
| TC-BRW-29 | BRW-5 | BR 6 | component | Show a borrower with a flagged line | The flagged line is clearly marked | `web/ReturnPage.test.tsx` (the Flagged badge has an icon and the word, the row is tinted) |
| TC-BRW-30 | BRW-6 | BR 7 | integration | Handler adds and edits a note and expected return date on an open line | Saved and audited | `api/line-notes.test.ts` (also: an admin may, a viewer 403, signed out 401, empty clears), `web/ReturnPage.test.tsx` (the dialog sends both fields; an empty date is null) |
| TC-BRW-31 | BRW-6 | SPEC 7 | integration | Save a 501-character note; edit a note on a closed line | Rejected | `api/line-notes.test.ts` (501 characters `VALIDATION_ERROR` on `note`; closed line 409 `LINE_NOT_OPEN`; also a past date and an unknown line; nothing saved or audited; a stored date that has passed may be kept unchanged or cleared but not changed to another past date, owner decision 2026-11-12), `web/ReturnPage.test.tsx` (a field error shows on the field and is focused; a closed line closes the dialog with the message; a passed stored date is kept and is the picker's min) |
| TC-BRW-32 | BRW-6 | BR 7, S4 | integration | James borrows 5 extension cables, handler notes "returning tomorrow" with tomorrow's date; job runs at 17:00 | Line is flagged anyway; strikes counted as usual | `api/line-notes.test.ts` (also: after the next-day return the flag and strike remain) |
| TC-BRW-33 | BRW-6 | RPT-1 | component | Open the dashboard with a noted line | Note and expected return date shown | `web/DashboardPage.test.tsx` (the dashboard has no note editing) |
| TC-BRW-34 | BRW-2 | BR 2, SPEC 4 | integration | A handler, then an admin, checks out in a deactivated room | `LOCATION_INACTIVE` for both; nothing created | `api/checkout.test.ts` |
| TC-BRW-35 | BRW-2 | BR 7, SPEC 7 | integration | Check out with an expected return date before today, today, and later in Asia/Manila, just before and just after Manila midnight | Before today: `VALIDATION_ERROR` on `lines.0.expectedReturnDate`; today and later: saved | `api/checkout.test.ts` (clock faked at 23:59:59 and 00:00 Manila time) |
| TC-BRW-36 | BRW-3 | SPEC 3, 7 | integration | Admin and handler call `GET /api/borrowers/lookup` with a matching `q`, a page, a missing, 1-character, and 101-character `q`, and `pageSize=101`; a viewer and a signed-out visitor call it | Admin and handler: 200 with only `id`, `schoolId`, `name`, `type`, `department`, `active` (inactive included), paginated; bad `q` or page size: `VALIDATION_ERROR`; viewer: 403; signed out: 401 | `api/borrowers.test.ts`; the screen uses it: `web/CheckoutPage.test.tsx` |
| TC-BRW-37 | BRW-3 | BR 1 | integration | List items: a unit item out, one free, one under repair, and a quantity item of 20 with 3 outstanding; then search them on the Checkout screen | `available` is 0, 1, 0, 17, no borrower details; the screen shows "Out", "Available", "Under repair", "N available", and Add is disabled when 0 | `api/items.test.ts`, `api/qa-md2-gaps.test.ts` (row fields), `web/CheckoutPage.test.tsx` |
| TC-BRW-38 | BRW-3 | Rule 3 | integration | Set closing time 18:30; every role reads `GET /api/closing-time`; a handler reads and writes `/api/settings`; open Checkout | All roles get `{ closingTime: "18:30" }`; handler gets 403 on settings; signed out 401; the screen shows "Today by 18:30", "Lines still out at 18:30", "Due back by 18:30 today" | `api/settings.test.ts`, `web/CheckoutPage.test.tsx` |
| TC-BRW-39 | BRW-3 | ARCH 14.1, SPEC 8 | component | Show a message, scroll a long page, then tab to a field | The message area is sticky at the top of the window below the top bar, and a focused field scrolls in below the messages | `web/components/Notifications.test.tsx` (class and `scroll-padding-top`), `web/CheckoutPage.test.tsx` (the saved and not-saved results are in the area); the visual check is manual |
| TC-BRW-40 | BRW-3 | BR 8, S10 | component | Closing time 17:00; open Checkout at 17:30 Manila time and confirm a checkout issued at 17:30 | The Summary shows "Tomorrow by 17:00", the note under the lines says "Lines still out at 17:00 tomorrow", and the success message says "Due back by 17:00 tomorrow"; before closing they say "Today" and "today" (TC-BRW-38) | `web/CheckoutPage.test.tsx` |
| TC-BRW-41 | BRW-3 | SPEC 8 | component | Open Checkout at 320, 360, 768, 900, and 1100 px wide with a 100-character room name, choose that room, and add an item line | The page stays the window width; the room picker shrinks; only the lines table scrolls sideways in its own box | `web/CheckoutPage.test.tsx` (`min-w-0` on each section and the room picker, `relative` on the table scroll box; the widths are checked by hand) |
| TC-BRW-42 | BRW-5 | SPEC 5, BR 5 | integration | Open lines: Cara has a laptop and a fully returned projector, Dan has 2 of 5 cords still out (flagged); search by borrower name and school ID, by item, by asset tag, with no text, and page 2 of size 1; `%%` as text; a retired item | Only lines with something outstanding, with borrower, item, room, handler, `outstanding`, and flag fields; item and tag matching ignores case; `%` is literal; a retired item is listed | `api/open-lines.test.ts` |
| TC-BRW-43 | BRW-5 | SPEC 3, 7 | integration | `GET /api/returns/open` as handler, viewer, and signed out; 1-character and 101-character `q`, `pageSize=101`, `page=0`, an unknown `by`, a NUL in `q` | Handler: 200; viewer: 403; signed out: 401; bad input: `VALIDATION_ERROR` | `api/open-lines.test.ts` |
| TC-BRW-44 | BRW-5 | BR 5, FND-7 | component | Return 3 cords when 2 are out (409 `RETURN_EXCEEDS_OUTSTANDING` with `details.lineId`); a `fields.lines` schema error | The row is marked (`aria-invalid`, message) and focused; the top message says "Return not saved" and "Nothing was recorded"; a schema error shows at the top | `web/ReturnPage.test.tsx` (also: a view-only user cannot open Return) |
| TC-BRW-45 | BRW-5 | SPEC 8 | manual | Open Return with open lines, a 100-character item name and a long note at 1280, 1000, 400, and 320 px wide | No sideways scroll on the page; rows wrap; the Search field stays usable (full width on its own line) under 640 px, with the button wrapping below it | manual (`web/ReturnPage.test.tsx` checks only the shrink and wrap classes) |
| TC-BRW-46 | BRW-5 | SPEC 7, BR 5 | integration | 105 borrowers match "alex"; the one with an open line sorts last by name | `by=borrower&q=alex` finds that line (the search is limited to borrowers with open lines, not cut at 100) | `api/open-lines.test.ts` |
| TC-BRW-47 | BRW-5 | FND-7 | component | A return of a unit line is refused (the quantity box is disabled); then the reload no longer lists the line | Focus goes to that row's Return button; when the row is gone, to the Search field | `web/ReturnPage.test.tsx` (also: a reload with changed data while the user is in the Search field leaves focus there; focus is moved back to the refused row only when it was lost to the page) |
| TC-BRW-48 | BRW-5 | SPEC 7, rule 12 | integration | Two borrowers have open lines and the cap is 1 (a test stand-in for 5,000); search by borrower; at a cap of 2; search by item at a cap of 1 | Over the cap: 422 `SEARCH_TOO_BROAD` with "Too many borrowers have items out; search by item or asset tag." (never a cut list); at the cap: both found; by item is not affected | `api/open-lines.test.ts` (calls `listOpenLines` with a small cap), `web/ReturnPage.test.tsx` (the message is shown) |

## FLG: Flagging and strikes

| ID | Ticket | Rule | Level | Steps | Expected | Automated by |
|---|---|---|---|---|---|---|
| TC-FLG-01 | FLG-1 | BR 10, S2 | integration | Ben has one transaction with a flagged line | 1 strike | `api/strikes.test.ts` |
| TC-FLG-02 | FLG-1 | BR 10, S5 | integration | Dan's one transaction has three flagged lines | 1 strike, not 3 | `api/strikes.test.ts` |
| TC-FLG-03 | FLG-1 | BR 10, S6 | integration | Eva has two transactions the same day, both flagged | 2 strikes | `api/strikes.test.ts` |
| TC-FLG-04 | FLG-1 | BR 10, 13, S7 | integration | A transaction has two flagged lines; override one, then the other | 1 strike after the first override; 0 after the second | `api/strikes.test.ts` |
| TC-FLG-05 | FLG-1 | BR 12, S9 | integration | Gio has 4 strikes in semester 1; admin sets semester 2 current, then semester 1 again | 0 strikes in semester 2; semester 1 history still shows the flags; back to 4 strikes when semester 1 is current again | `api/strikes.test.ts` |
| TC-FLG-06 | FLG-2 | BR 8, S1 | integration | Ana borrows at 10:00 and returns at 15:00; job runs at 17:00 | Nothing flagged; 0 strikes | `api/flagging.test.ts` |
| TC-FLG-07 | FLG-2 | BR 8, S2 | integration | Ben borrows a laptop at 10:00 and keeps it; job runs at 17:00 | Line `FLAGGED` with `flagged_at` set; audited | `api/flagging.test.ts` |
| TC-FLG-08 | FLG-2 | BR 8, S3 | integration | Cara has 2 of 5 cords outstanding at 17:00; returns the 2 next morning | Line flagged at 17:00; stays `FLAGGED` after the return; 1 strike | `api/flagging.test.ts` |
| TC-FLG-09 | FLG-2 | BR 8, S10 | integration | Hana borrows at 17:30 | Not flagged tonight; flagged at tomorrow's 17:00 if still out | `api/flagging.test.ts` |
| TC-FLG-10 | FLG-2 | BR 9, S11 | integration | API stopped 16:30 to 18:00, started at 18:00 | Catch-up flags lines issued before 17:00; a line issued at 18:10 is not flagged | `api/flagging.test.ts` |
| TC-FLG-11 | FLG-2 | BR 8, S12 | integration | Run the job twice at 17:00 | Second run changes nothing | `api/flagging.test.ts` |
| TC-FLG-12 | FLG-2 | BR 8, S13 | integration | A flagged line is overridden while the item is still out; next closing passes | Not flagged again | `api/flagging.test.ts` |
| TC-FLG-13 | FLG-2 | ARCH 6, CLAUDE.md rule 3 | integration | With an injected clock, change closing time in settings | Job runs at the new time in `Asia/Manila` | `api/flagging.test.ts` |
| TC-FLG-14 | FLG-2 | ARCH 12.5 | integration | Start a scheduled run and a manual run at the same time | Advisory lock: runs never overlap | `api/flagging.test.ts` |
| TC-FLG-15 | FLG-2 | SPEC 3, ARCH 12.5 | integration | Admin triggers the job twice within a minute; handler triggers it | Second admin call refused (once per minute); handler gets 403 | `api/flagging.test.ts` |
| TC-FLG-16 | FLG-2 | BACKLOG FLG-2 | integration | Run the job | Each run is logged | `api/flagging.test.ts` |
| TC-FLG-17 | FLG-3 | BR 11, S8 | integration | Fil at 3 strikes checks out | Checkout works; the warning is shown | `api/strike-blocking.test.ts` (checkout 201; `GET /api/borrowers/:id/strikes` gives the count and thresholds the banner is built from), `web/pages/strike-banners.test.tsx` |
| TC-FLG-18 | FLG-3 | BR 11, S8 | integration | Fil at 4 strikes checks out | Checkout works; the stricter notice is shown | `api/strike-blocking.test.ts`, `web/pages/strike-banners.test.tsx` |
| TC-FLG-19 | FLG-3 | BR 3, 11, S8 | integration | Fil at 5 strikes checks out | `BORROWER_BLOCKED`; no transaction created | `api/strike-blocking.test.ts` (409, nothing created, no `CHECKOUT` audit entry) |
| TC-FLG-20 | FLG-3 | BR 11, CLAUDE.md rule 3 | integration | Change thresholds to 2, 3, 4 | Warning, notice, and block follow the new values | `api/strike-blocking.test.ts`, `web/pages/strike-banners.test.tsx` |
| TC-FLG-21 | FLG-3 | BR 11 | component | Open checkout for borrowers at 3, 4, and 5 strikes | Warning banner, stricter notice banner, blocked message | `web/pages/strike-banners.test.tsx` |
| TC-FLG-22 | FLG-4 | SPEC 5 | integration | Admin lists flagged lines | Borrower, item, note, and expected return date shown | `api/flag-override.test.ts`, `web/pages/FlagReviewPage.test.tsx` |
| TC-FLG-23 | FLG-4 | BR 13, SPEC 7 | integration | Override with a reason of 4 characters, 5 characters, and 501 characters | 5 accepted; 4 and 501 rejected | `api/flag-override.test.ts` (4, whitespace-only, 501 refused; 5 and 500 accepted), `web/pages/FlagReviewPage.test.tsx` |
| TC-FLG-24 | FLG-4 | BR 13 | integration | Override a line before it is returned and another after | Both become `OVERRIDDEN` with `override_by`, `override_at`, reason; audited | `api/flag-override.test.ts`, `web/pages/FlagReviewPage.test.tsx` (danger-colored submit; success message with the new strike count) |
| TC-FLG-25 | FLG-4 | S18 | integration | Handler and view-only user call override | 403 | `api/flag-override.test.ts` (list and override), `web/pages/FlagReviewPage.test.tsx` (not-allowed page) |
| TC-FLG-26 | FLG-2 | BR 9, ARCH 6 | integration | Fake clock 08:00, start the job, advance 9 hours | Line issued at 10:00 is `FLAGGED`; the next day's closing also fires | `api/flagging.test.ts` |
| TC-FLG-27 | FLG-2 | BR 9, S22 | integration | Closing 17:00; at 16:00 admin does `PUT /api/settings` with closing 15:00 | Line issued at 10:00 is flagged at once | `api/flagging.test.ts` |
| TC-FLG-28 | FLG-2 | BR 9, S23 | integration | Lock held at closing, so the run is skipped; release the lock | Retried after 60 s and the line is flagged | `api/flagging.test.ts` |
| TC-FLG-29 | FLG-2 | BR 9, S11 | integration | Down Friday, started Monday 08:00 | Lines issued Friday and Saturday flagged; a Monday 07:00 line is not | `api/flagging.test.ts` |
| TC-FLG-30 | FLG-2 | BR 9, S23 | integration | The scheduled run throws | Startup does not throw; retried after 60 s | `api/flagging.test.ts` |
| TC-FLG-31 | FLG-4 | BR 8, 13, S13 | integration | Override a line that is still out; run the job at the next closing | Stays `OVERRIDDEN`, not flagged again | `api/flag-override.test.ts` |
| TC-FLG-32 | FLG-4 | BR 13 | integration | Override a line that is `NONE`, already `OVERRIDDEN`, or unknown | 409 `LINE_NOT_FLAGGED`, 404 `NOT_FOUND`; no audit entry | `api/flag-override.test.ts` |
| TC-FLG-33 | FLG-4 | BR 14 | integration | Two overrides of the same line at once | One 200 and one 409; one audit entry | `api/flag-override.test.ts` |
| TC-FLG-34 | FLG-4 | BR 10, 12, owner decision 2026-11-10 | integration | A flag from an earlier semester, one in the current semester; then no current semester | Only the current one is listed; with no current semester the list is empty; `hasCurrentSemester` is false and the screen says "No current semester is set."; the old flag is kept | `api/flag-override.test.ts`, `web/pages/FlagReviewPage.test.tsx` |
| TC-FLG-35 | FLG-4 | rule 1, 12 | integration | 101 borrowers match "Smith" and sort before the one flagged borrower | The flagged borrower is still found | `api/flag-override.test.ts` |
| TC-FLG-36 | FLG-4 | rule 12, owner decision | integration, component | More borrowers with flagged lines than the cap; exactly at the cap | Over the cap the name part is skipped, item and asset tag matches still work, `borrowerSearchSkipped: true`, and the screen shows a note; at the cap names are searched; no `SEARCH_TOO_BROAD` on this endpoint | `api/flag-override.test.ts`, `web/pages/FlagReviewPage.test.tsx` |
| TC-FLG-37 | FLG-4 | BR 10, 11 | integration | Borrower with 2 flagged transactions; override their lines one by one | List shows `strikes` and `blockThreshold`; the override reply gives 2, 1, 0 | `api/flag-override.test.ts` |
| TC-FLG-38 | FLG-4 | BR 10, 12 | integration | Same data through `countStrikesForBorrowers` and `countStrikes`, plus a flagged transaction in an older semester and an empty id list | Same counts (the older semester does not count); empty result for no ids | `api/flag-override.test.ts` |
| TC-FLG-39 | FLG-4 | BR 11, ARCH 6 | component | List with a borrower at 3 and one at the block threshold | "3 strikes", "5 strikes · blocked"; Issued shown in Asia/Manila | `web/pages/FlagReviewPage.test.tsx` |
| TC-FLG-40 | FLG-4 | SPEC 8 | component | Override a line; fail a load and press Retry | Focus goes to the search field | `web/pages/FlagReviewPage.test.tsx` |
| TC-FLG-41 | FLG-4 | FLG-2, SPEC 3 | component | Run flagging now: Cancel, confirm, confirm again within a minute | Cancel sends nothing; the old refusal clears when the dialog is opened again; the dialog is described for screen readers (`FormDialog` `describedBy`, `web/components/FormDialog.test.tsx`); "Flagging run finished. 3 lines flagged."; then "Flagging was run less than a minute ago. Try again in 38 seconds." | `web/pages/FlagReviewPage.test.tsx` |
| TC-FLG-50 | FLG-3 | BR 11, S8 | integration | Fil is blocked at 5 strikes and returns an item he has out | Return works (returns are never blocked) | `api/strike-blocking.test.ts` |
| TC-FLG-51 | FLG-3 | BR 11, S8 | integration | Fil at 5 strikes; one flag is overridden | 4 strikes; checkout works again | `api/strike-blocking.test.ts` |
| TC-FLG-52 | FLG-3 | BR 11, 12 | integration | 5 strikes in an earlier semester; `isEligible` given each semester id | The current semester does not block; the semester given is the one counted | `api/strike-blocking.test.ts` |
| TC-FLG-53 | FLG-3 | SPEC 3, 7 | integration | `GET /api/borrowers/:id/strikes` as viewer, unknown id, bad id, signed out | 403, `NOT_FOUND`, 400, 401 | `api/strike-blocking.test.ts` |
| TC-FLG-54 | FLG-3 | BR 10, 12 | integration | No current semester; strikes endpoint | 0 strikes, no semester name | `api/strike-blocking.test.ts` |
| TC-FLG-55 | FLG-3 | CLAUDE.md rule 1, owner decision 2026-11-10 | integration | `isEligible` in a transaction; another transaction deactivates the borrower | The update waits (borrower row locked `FOR SHARE`) | `api/strike-blocking.test.ts` |
| TC-FLG-56 | FLG-3 | BR 11, SPEC 5 | component | Open Return for a borrower at 5 strikes | Strike badge shown from the open-lines reply (no `/strikes` request); Return button still enabled | `web/pages/strike-banners.test.tsx` |
| TC-FLG-57 | FLG-3 | BR 11, SPEC 8 | component | The strikes load fails on Checkout | A Retry message shows, not "0 strikes" | `web/pages/strike-banners.test.tsx` |
| TC-FLG-58 | FLG-3 | BR 10, 11, rule 3 | integration | `GET /api/returns/open` with borrowers at 3 and 0 strikes, block threshold 6 | Each line carries its borrower's strikes; the reply carries the thresholds from settings | `api/strike-blocking.test.ts` |
| TC-FLG-59 | FLG-3 | BR 10, 12 | integration | Batched strike count against `countStrikes`; no current semester | Same numbers; every open line shows 0 | `api/strike-blocking.test.ts` |

## RPT: Dashboard and reports

| ID | Ticket | Rule | Level | Steps | Expected | Automated by |
|---|---|---|---|---|---|---|
| TC-RPT-01 | RPT-1 | SPEC 5 | integration | Load the dashboard with open, flagged, and returned lines | Only unreturned lines and borrowers with strikes in the current semester, with notes and expected return dates | `api/dashboard.test.ts` (returned lines left out; overridden and older-semester strikes not counted; most strikes first; paged; no current semester empty), `web/DashboardPage.test.tsx` (strike levels and the due or flagged text) |
| TC-RPT-02 | RPT-1 | S18 | integration | Admin, handler, and view-only load the dashboard | All allowed | `api/dashboard.test.ts` (also signed out 401; page size 101 and page 0 `VALIDATION_ERROR`), `web/DashboardPage.test.tsx` (view-only) |
| TC-RPT-03 | RPT-2 | BR section 4 | integration | History for a borrower over a date range | Room, issuing and receiving handlers, return details, flag status; paginated | `api/history.test.ts`, `web/pages/ReportsPage.test.tsx` |
| TC-RPT-04 | RPT-2 | SPEC 7, S21 | integration | Request ranges of 366 and 367 days | 366 accepted; 367 `VALIDATION_ERROR` | `api/history.test.ts`, `web/pages/ReportsPage.test.tsx` |
| TC-RPT-05 | RPT-3 | BR section 4 | integration | History for an item by item and by asset tag | Same detail as RPT-2; paginated | `api/history.test.ts`, `web/pages/ReportsPage.test.tsx` |
| TC-RPT-06 | RPT-4 | BR section 4 | integration | Usage summary for a period | Most borrowed items with counts by category and by room; range capped at 366 days; the default period is 30 days before today to today (Asia/Manila) | `api/usage-report.test.ts`, `web/pages/UsageReport.test.tsx` |
| TC-RPT-07 | RPT-1 to RPT-4 | S18 | integration | View-only user loads all four reports: the Dashboard (unreturned and flagged) and the three Reports tabs | All allowed | `api/dashboard.test.ts`, `api/history.test.ts` (both history reports), `api/usage-report.test.ts`, `web/pages/UsageReport.test.tsx` |

## SEC: Security and resilience

| ID | Ticket | Rule | Level | Steps | Expected | Automated by |
|---|---|---|---|---|---|---|
| TC-SEC-01 | SEC-1 | ARCH 12.2 | integration | Exceed the nginx general, login, and CSV limits through the nginx check (real nginx config on port 18080, so it never clashes with the stack on 8080) | 429 with the standard JSON error `RATE_LIMITED` and `Retry-After`, never HTML | `apps/web/scripts/check-nginx.ts` (`npm run test:nginx`) (general and login; the CSV limit comes with MD-6) |
| TC-SEC-02 | SEC-1 | ARCH 7, 12.2 | integration | POST a 200 KB body through nginx to `/api/auth/login` | 413 with the standard JSON error `PAYLOAD_TOO_LARGE`, never HTML | `apps/web/scripts/check-nginx.ts` (`npm run test:nginx`) |
| TC-SEC-03 | SEC-1 | ARCH 12.2 | integration | Open more than 30 connections from one IP | Extra connections refused with 429 | `apps/web/scripts/check-nginx.ts` (`npm run test:nginx`) |
| TC-SEC-04 | SEC-1 | ARCH 12.2 | manual | `curl -I` a file under `/assets/` | Exactly one `Cache-Control: public, max-age=31536000, immutable` header | manual; also `apps/web/scripts/check-nginx.ts` (`npm run test:nginx`) |
| TC-SEC-05 | SEC-1 | ARCH 12.3 | integration | Exceed the Express global limit and the expensive-endpoint limit | 429 `RATE_LIMITED` with `Retry-After` | `api/request-limits.test.ts` |
| TC-SEC-06 | SEC-1 | ARCH 12.2, 12.3 | integration | Two clients with different addresses hit the limit; one sends a fake `X-Forwarded-For` | Limited independently; nginx overwrites the fake header | `apps/web/scripts/check-nginx.ts` (`npm run test:nginx`), `api/request-limits.test.ts` |
| TC-SEC-07 | SEC-1 | ARCH 12.3 | integration | Check the Node server timeouts | `headersTimeout` 15000, `requestTimeout` 30000, `keepAliveTimeout` 5000 | `api/request-limits.test.ts` |
| TC-SEC-08 | SEC-1 | ARCH 12.3 | integration | Cause an unexpected error in a route; cause an unhandled rejection | Route: `INTERNAL_ERROR` with no internals; unhandled: logged and the process exits so Docker restarts it | `api/qa-regression-flows.test.ts` (a failed audit insert in a route answers 500 `INTERNAL_ERROR`), `api/request-limits.test.ts` (exit on unhandled errors) |
| TC-SEC-09 | SEC-1 | SPEC 7, S21 | integration | Send a body over 100 KB to Express directly | `PAYLOAD_TOO_LARGE` | `api/auth.test.ts` |
| TC-SEC-10 | SEC-1 | SPEC 7 | unit | Validate the shared Zod schemas at and over every SPEC 7 limit | At the limit accepted; over it rejected | `packages/shared/src/limits.test.ts` (override reasons, report ranges, and CSV rows come with their tickets) |
| TC-SEC-11 | SEC-2 | ARCH 12.7 | manual | Login flood: 200 connections for 60 s while a signed-in client from another source works | p95 under 2 s; api under its memory limit with no restart; valid login works after the window | not yet |
| TC-SEC-12 | SEC-2 | ARCH 12.7 | manual | Slow-connection (slowloris) test | Other clients keep working | not yet |
| TC-SEC-13 | SEC-2 | ARCH 12.7, S21 | manual | Oversized JSON body and oversized CSV under load | Rejected with 413 without reaching a service | not yet |
| TC-SEC-14 | SEC-2 | ARCH 12.7 | manual | Reports and search at maximum ranges on seeded data (5,000 borrowers, 500 items, 20,000 transactions) | Each answers in under 2 s | not yet |
| TC-SEC-15 | SEC-2 | ARCH 12.7 | manual | Run the flagging job while the API is under load | Correct results; no overlapping runs | not yet |

## HRD: Hardening

| ID | Ticket | Rule | Level | Steps | Expected | Automated by |
|---|---|---|---|---|---|---|
| TC-HRD-01 | HRD-1 | BR 14, SPEC 7 | integration | Admin filters the audit log by actor, entity, and date | Matching entries, paginated; a request without a date range is rejected | not yet |
| TC-HRD-02 | HRD-1 | SPEC 3 | integration | Handler opens the audit log | 403 | not yet |
| TC-HRD-03 | HRD-1 | BR 14 | integration | Run the audit sweep after a state change with no audit entry | The change is reported | not yet |
| TC-HRD-04 | HRD-2 | BR section 3 | e2e | Checkout, partial return, end-of-day flagging, strike, block, override in Docker | The whole flow passes | not yet |
| TC-HRD-05 | HRD-2 | BR section 3 | manual | Check every scenario S1 to S21 against the coverage table below | Each has an automated test that passes | not yet |
| TC-HRD-06 | HRD-3 | ARCH 12.6 | manual | Back up, restore on a clean environment | Data restored; backup files outside the web root, readable only by admin | not yet |
| TC-HRD-07 | HRD-4 | ARCH 12.1 | manual | Follow the LAN guide on another PC | App reachable from the network with `COOKIE_SECURE=false`; port bound to the LAN address | not yet |
| TC-HRD-08 | HRD-5 | SPEC 8 | manual | Go through each screen with bad input, slow loads, and empty data | Clear messages, consistent loading and empty states, keyboard-friendly checkout | not yet |
| TC-HRD-09 | HRD-6 | SPEC 8, ARCH 3, 13 | manual | Run `npm run build` | No chunk-size warning; each screen page (Home, Inventory, Borrowers, Rooms, Settings, Change password) is its own chunk | manual |
| TC-HRD-10 | HRD-6 | SPEC 8 | component | Render the app at each route (`/`, `/inventory`, `/borrowers`, `/rooms`, `/settings`, `/password`, `/login`) with the lazy pages | Each page renders inside the app shell | the page tests (`apps/web/src/pages/*.test.tsx`) through `renderApp` |
| TC-HRD-11 | HRD-6 | SPEC 8 | manual | Under `docker compose up`, open sign-in with the browser network tab open, sign in, then open every menu item | Sign-in and the shell load from the entry chunk; each screen fetches its own chunk on first visit, shows "Loading…" briefly if slow, and renders | manual |

## DOC: Documentation

| ID | Ticket | Rule | Level | Steps | Expected | Automated by |
|---|---|---|---|---|---|---|
| TC-DOC-01 | DOC-1 | CLAUDE.md | manual | Check that every ticket ID in `docs/BACKLOG.md` appears in this file | All present | manual |
| TC-DOC-02 | DOC-1 | BR 1 to 16, S1 to S23 | manual | Check the coverage table | Every rule and scenario lists at least one case | manual |
| TC-DOC-03 | DOC-1 | CLAUDE.md | manual | Run every test file named in "Automated by" (`npm test`) | All pass | manual |

## Coverage: business rules and scenarios

| Rule or scenario | Cases |
|---|---|
| BR 1 Availability | TC-BRW-01, 02, 03, 05, 06, 07, 37, TC-MD-34 |
| BR 2 Who and when | TC-BRW-04, 09, 34 |
| BR 3 Eligible borrowers | TC-MD-17, TC-BRW-08, TC-FLG-19 |
| BR 4 Atomic and safe | TC-BRW-10, 11 |
| BR 5 Return events | TC-BRW-20, 21, 22, 28 |
| BR 6 Returning never touches flags | TC-BRW-23, 29, TC-FLG-08 |
| BR 7 Notes are informational | TC-BRW-30, 32, 35 |
| BR 8 End-of-day flagging | TC-FLG-06 to 12 |
| BR 9 Catch-up | TC-FLG-10 |
| BR 10 Strike count | TC-FLG-01 to 04 |
| BR 11 Thresholds | TC-BRW-26, TC-FLG-17 to 21 |
| BR 12 Semester reset | TC-FLG-05 |
| BR 13 Override | TC-FLG-04, 23, 24 |
| BR 14 Audit | TC-FND-15, 17, TC-AUTH-06, 19, TC-MD-01, 08, TC-BRW-04, 20, 30, TC-FLG-07, 24, TC-HRD-01, 03 |
| BR 15 No deletion of history | TC-FND-14, TC-AUTH-20, TC-MD-02, 07, 12 |
| BR 16 Throttled, never locked | TC-AUTH-10, 11, 12, 34 |
| S1 Same-day return | TC-FLG-06 |
| S2 Unit item not returned | TC-FLG-01, 07 |
| S3 Partial return | TC-BRW-22, TC-FLG-08 |
| S4 Note does not prevent the flag | TC-BRW-32 |
| S5 One transaction, many lines | TC-FLG-02 |
| S6 Two transactions, same day | TC-FLG-03 |
| S7 Partial override | TC-FLG-04 |
| S8 Thresholds | TC-FLG-17, 18, 19 |
| S9 Semester reset | TC-FLG-05 |
| S10 Checkout after closing | TC-FLG-09 |
| S11 Service down at closing | TC-FLG-10 |
| S12 Idempotent job | TC-FLG-11 |
| S13 Overridden stays overridden | TC-FLG-12 |
| S14 Checkout validations | TC-BRW-05 to 10, 34 |
| S15 Return validations | TC-BRW-24 |
| S16 Concurrent checkout | TC-BRW-11 |
| S17 Damaged return | TC-BRW-25 |
| S18 Permissions | TC-AUTH-17, 22, TC-BRW-13, TC-FLG-25, TC-RPT-02, 07 |
| S19 Retiring versus deleting | TC-MD-07 |
| S20 Login flood | TC-AUTH-10, TC-SEC-11 |
| S21 Oversized input | TC-MD-19, TC-BRW-12, TC-RPT-04, TC-SEC-02, 09, 13 |
| S22 Closing time moved earlier | TC-FLG-27 |
| S23 Failed or skipped run | TC-FLG-28, 30 |
