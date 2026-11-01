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
| TC-FND-18 | FND-4 | ARCH 5 | integration | Run the seed twice | Nothing duplicated or overwritten | `api/seed.test.ts` |
| TC-FND-19 | FND-4 | ARCH 5 | integration | Run the seed without admin credentials or with a too-short password | It fails with a clear message | `api/seed.test.ts` |
| TC-FND-20 | FND-4 | ARCH 5 | integration | Run the seed in production mode | Only the admin and settings are created; no QA accounts | `api/seed.test.ts` |
| TC-FND-21 | FND-4 | ARCH 12.4 | integration | `admin:reset-password` for a known user, an unknown user, and with a short password | Known: reset and audited without the hash; unknown and short: refused, old password kept | `api/admin-reset-password.test.ts` |
| TC-FND-22 | FND-5 | SPEC 8, ARCH 7 | component | Submit a form field with an invalid value, then with a field error returned in the API `details` | Both errors show inline next to the field | `web/components/Field.test.tsx` |
| TC-FND-23 | FND-5 | SPEC 8 | component | Use each shared component with the keyboard only and query it by label | Every control has a label and works with the keyboard | `web/components/Field.test.tsx`, `web/components/DataTable.test.tsx`, `web/components/ConfirmDialog.test.tsx`, `web/components/Notifications.test.tsx` |
| TC-FND-24 | FND-5 | SPEC 7 | component | Render the data table loading, with zero rows, and with more rows than one page | Loading state, empty state, and pagination all show | `web/components/DataTable.test.tsx` |
| TC-FND-25 | FND-5 | SPEC 5 | component | Start a destructive action, cancel, then confirm | Cancel does nothing; confirm runs the action | `web/components/ConfirmDialog.test.tsx` |
| TC-FND-26 | FND-5 | ARCH 7 | component | Trigger a success and an API error | Success notification; error notification shows the API error `message` | `web/components/Notifications.test.tsx` |
| TC-FND-27 | FND-6 | ARCH 6 | integration | With the database session time zone at Asia/Manila, write rows using `@default(now())`, `@updatedAt`, and `new Date()` | Stored instants are within a few seconds of `Date.now()` | `api/timestamps.test.ts` |
| TC-FND-28 | FND-6 | ARCH 6 | integration | Create a session | Expiry stored as now plus `SESSION_TTL_HOURS` | `api/timestamps.test.ts` |
| TC-FND-29 | FND-6 | ARCH 6 | integration | Start the API with a `DATABASE_URL` that has `options` | Refused, because it would replace `TimeZone=UTC` | `api/timestamps.test.ts` |

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
| TC-AUTH-19 | AUTH-3 | BR 14 | integration | Admin creates, edits, deactivates a user, and resets a password | Each works and is audited | not yet |
| TC-AUTH-20 | AUTH-3 | BR 15 | integration | Admin tries to remove a user who has transactions | The user can only be deactivated; the record and its history stay | not yet |
| TC-AUTH-21 | AUTH-3 | BACKLOG AUTH-3 | integration | Admin deactivates their own account | Refused | not yet |
| TC-AUTH-22 | AUTH-3 | S18 | integration | Handler opens user management | 403 | not yet |
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
| TC-AUTH-33 | AUTH-4 | ARCH 7 | manual | Sign in and change password at http://127.0.0.1:8080 under `docker compose up` | Works through nginx | manual |
| TC-AUTH-34 | AUTH-5 | BR 16, ARCH 12.4 | integration | Block an IP by the per-IP limit, then send failed logins with new usernames | Nothing new is stored in the limiters | `api/login-rate-limit.test.ts` |
| TC-AUTH-35 | AUTH-5 | ARCH 12.4 | integration | Fail login with a very long username | The limiter key's username part is at most 200 characters | `api/login-rate-limit.test.ts` |

## MD: Master data

| ID | Ticket | Rule | Level | Steps | Expected | Automated by |
|---|---|---|---|---|---|---|
| TC-MD-01 | MD-1 | BR 14 | integration | Admin creates and renames a category | Saved and audited | `api/categories.test.ts` |
| TC-MD-02 | MD-1 | BR 15 | integration | Admin deletes an unused category, then one in use | Unused: deleted; in use: `HAS_HISTORY` | `api/categories.test.ts` |
| TC-MD-03 | MD-1 | SPEC 3 | integration | Handler creates a category | 403 | `api/categories.test.ts` |
| TC-MD-04 | MD-2 | SPEC 4 | integration | Create a UNIT item without an asset tag, with a duplicate asset tag, with quantity other than 1 | Each rejected with `VALIDATION_ERROR` or `DUPLICATE_VALUE` | not yet |
| TC-MD-05 | MD-2 | SPEC 4 | integration | Create a QUANTITY item with an asset tag, with a negative quantity; then with quantity 0 | First two rejected; quantity 0 accepted | not yet |
| TC-MD-06 | MD-2 | SPEC 4, 7 | integration | Search and filter items by name, category, status, and tracking type with `pageSize=100` and `101` | Filters work; 100 allowed, 101 rejected | not yet |
| TC-MD-07 | MD-2 | BR 15, S19 | integration | Delete an item with past transactions; delete one without | With history: `HAS_HISTORY`, told to retire; without: deleted | not yet |
| TC-MD-08 | MD-2 | BR 14 | integration | Create, edit, and retire an item | Each audited | not yet |
| TC-MD-09 | MD-3 | SPEC 3 | integration | Admin creates, edits, and deactivates a room | All work and are audited | not yet |
| TC-MD-10 | MD-3 | SPEC 3 | integration | Handler uses quick-add for a room; handler edits a room | Quick-add works with `created_by` set; edit is 403 | not yet |
| TC-MD-11 | MD-3 | SPEC 4 | integration | Add "CL-201" when "cl-201" exists | `DUPLICATE_VALUE` | not yet |
| TC-MD-12 | MD-3 | BR 15 | integration | Admin tries to remove a room used in a transaction | The room can only be deactivated; the record and its history stay | not yet |
| TC-MD-13 | MD-4 | CLAUDE.md rule 1 | unit | Search the code for queries on the borrowers table outside `LocalBorrowerService` | None found | not yet |
| TC-MD-14 | MD-4 | ARCH 4 | integration | Replace `LocalBorrowerService` with a test double | Callers work unchanged | not yet |
| TC-MD-15 | MD-5 | SPEC 4 | integration | Admin creates and edits a borrower; duplicate school ID | Saved and audited; duplicate gets `DUPLICATE_VALUE` | not yet |
| TC-MD-16 | MD-5 | SPEC 7 | integration | Search borrowers by name and by school ID with 1, 2, and 101 characters | 2 to 100 accepted; others rejected; results paginated | not yet |
| TC-MD-17 | MD-5 | BR 3 | integration | Deactivate a borrower, then look them up for checkout | Not selectable for checkout | not yet |
| TC-MD-18 | MD-6 | SPEC 6 | integration | Import a CSV with new, existing, and invalid rows | New created, existing updated by school ID, invalid rejected with reasons; counts reported; audited | not yet |
| TC-MD-19 | MD-6 | SPEC 7, S21 | integration | Import a 2.1 MB CSV, two files, and a CSV with 5,001 rows | Rejected before parsing with `PAYLOAD_TOO_LARGE` | not yet |
| TC-MD-20 | MD-6 | ARCH 12.3 | integration | Import a 5,000-row CSV while making other requests | Other requests are not blocked | not yet |
| TC-MD-21 | MD-7 | SPEC 4 | integration | Admin creates semesters and sets one current, then another | Exactly one is current; audited | not yet |
| TC-MD-22 | MD-7 | SPEC 4 | integration | Save thresholds 4, 3, 5 and 3, 3, 5 | Rejected (warning < notice < block) | not yet |
| TC-MD-23 | MD-7 | CLAUDE.md rule 3 | integration | Change closing time and thresholds | Saved and audited; checkout and flagging read the new values | not yet |
| TC-MD-24 | MD-1 | SPEC 4 | integration | Create "audio" when "Audio" exists; rename another category to "AUDIO"; rename "Audio" to "AUDIO" | First two: `DUPLICATE_VALUE`; changing its own case is saved | `api/categories.test.ts` |

## BRW: Borrowing

| ID | Ticket | Rule | Level | Steps | Expected | Automated by |
|---|---|---|---|---|---|---|
| TC-BRW-01 | BRW-1 | BR 1 | unit | Ask availability of a UNIT item with and without an open line | Unavailable with an open line; available without | not yet |
| TC-BRW-02 | BRW-1 | BR 1 | unit | QUANTITY item total 10, open lines 4 and 3 (1 returned on the second) | Available 4 | not yet |
| TC-BRW-03 | BRW-1 | BR 1 | unit | Ask availability of items with status `UNDER_REPAIR`, `LOST`, `RETIRED` | Not available | not yet |
| TC-BRW-04 | BRW-2 | BR 2 | integration | Handler checks out two items to a borrower for a room | One transaction and two lines; handler from the session; issue time and current semester set; audited | not yet |
| TC-BRW-05 | BRW-2 | BR 1, S14 | integration | Issue a unit item that is already out | `ITEM_UNAVAILABLE` | not yet |
| TC-BRW-06 | BRW-2 | BR 1, S14 | integration | Issue 4 of a quantity item with 3 available | `INSUFFICIENT_QUANTITY` | not yet |
| TC-BRW-07 | BRW-2 | BR 1, S14 | integration | Issue items with status `UNDER_REPAIR`, `LOST`, `RETIRED` | `ITEM_UNAVAILABLE` | not yet |
| TC-BRW-08 | BRW-2 | BR 3, S14 | integration | Issue to an inactive borrower | `BORROWER_INACTIVE` | not yet |
| TC-BRW-09 | BRW-2 | BR 2, S14 | integration | Check out with no current semester | `NO_CURRENT_SEMESTER` | not yet |
| TC-BRW-10 | BRW-2 | BR 4, S14 | integration | Check out two lines where the second fails | No transaction and no lines are created | not yet |
| TC-BRW-11 | BRW-2 | BR 4, S16 | integration | Two handlers issue the same unit item at the same moment | Exactly one succeeds; the other gets `ITEM_UNAVAILABLE` | not yet |
| TC-BRW-12 | BRW-2 | SPEC 7, S21 | integration | Check out 51 lines; a line with quantity 0 or 10,001 | `VALIDATION_ERROR` | not yet |
| TC-BRW-13 | BRW-2 | SPEC 3 | integration | View-only user calls checkout | 403 (S18) | not yet |
| TC-BRW-14 | BRW-3 | SPEC 5 | component | Look up a borrower | Name, type, and department shown | not yet |
| TC-BRW-15 | BRW-3 | SPEC 5 | component | Pick a room; add a new room from the picker | Room selected; new room is created and selected | not yet |
| TC-BRW-16 | BRW-3 | SPEC 5 | component | Search an item; enter quantity for a QUANTITY item; add a note and expected return date | Lines show with quantity, note, and date | not yet |
| TC-BRW-17 | BRW-3 | SPEC 5 | component | Review and submit, clicking submit twice quickly | Confirmation summary shown; only one request is sent | not yet |
| TC-BRW-18 | BRW-3 | ARCH 7 | component | Submit a checkout the API refuses | The API error `message` is shown | not yet |
| TC-BRW-19 | BRW-3 | SPEC 8 | manual | Complete a checkout with the keyboard only | Possible without a mouse | manual |
| TC-BRW-20 | BRW-4 | BR 5 | integration | Return a line in full | Return event with quantity, time, condition, and receiving handler from the session; audited | not yet |
| TC-BRW-21 | BRW-4 | BR 5 | integration | Handler B returns an item issued by handler A | Receiving handler is B; issuing handler stays A | not yet |
| TC-BRW-22 | BRW-4 | BR 5, S3 | integration | Cara borrows 5 extension cords at 09:00 and returns 3 at 14:00 | Line open with 2 outstanding | not yet |
| TC-BRW-23 | BRW-4 | BR 6 | integration | Return a flagged line in full | Quantities change; `flag_status` stays `FLAGGED` | not yet |
| TC-BRW-24 | BRW-4 | S15 | integration | Return 3 when 2 are outstanding; return on a line with nothing outstanding | `RETURN_EXCEEDS_OUTSTANDING` both times | not yet |
| TC-BRW-25 | BRW-4 | S17 | integration | Return a unit laptop as `DAMAGED`; return a quantity item as `DAMAGED` | Laptop: event and item condition `DAMAGED`, status stays `ACTIVE`; quantity item: condition on the event only | not yet |
| TC-BRW-26 | BRW-4 | BR 11 | integration | Return items for a borrower at 5 strikes | Return works (returns are never blocked) | not yet |
| TC-BRW-27 | BRW-5 | SPEC 5 | component | Find open borrowings by borrower, by item, and by asset tag | Matching open lines shown | not yet |
| TC-BRW-28 | BRW-5 | BR 5 | component | Return all of one line and part of another, choosing condition | Requests sent with the chosen quantities and conditions | not yet |
| TC-BRW-29 | BRW-5 | BR 6 | component | Show a borrower with a flagged line | The flagged line is clearly marked | not yet |
| TC-BRW-30 | BRW-6 | BR 7 | integration | Handler adds and edits a note and expected return date on an open line | Saved and audited | not yet |
| TC-BRW-31 | BRW-6 | SPEC 7 | integration | Save a 501-character note; edit a note on a closed line | Rejected | not yet |
| TC-BRW-32 | BRW-6 | BR 7, S4 | integration | James borrows 5 extension cables, handler notes "returning tomorrow" with tomorrow's date; job runs at 17:00 | Line is flagged anyway; strikes counted as usual | not yet |
| TC-BRW-33 | BRW-6 | RPT-1 | component | Open the dashboard with a noted line | Note and expected return date shown | not yet |

## FLG: Flagging and strikes

| ID | Ticket | Rule | Level | Steps | Expected | Automated by |
|---|---|---|---|---|---|---|
| TC-FLG-01 | FLG-1 | BR 10, S2 | integration | Ben has one transaction with a flagged line | 1 strike | not yet |
| TC-FLG-02 | FLG-1 | BR 10, S5 | integration | Dan's one transaction has three flagged lines | 1 strike, not 3 | not yet |
| TC-FLG-03 | FLG-1 | BR 10, S6 | integration | Eva has two transactions the same day, both flagged | 2 strikes | not yet |
| TC-FLG-04 | FLG-1 | BR 10, 13, S7 | integration | A transaction has two flagged lines; override one, then the other | 1 strike after the first override; 0 after the second | not yet |
| TC-FLG-05 | FLG-1 | BR 12, S9 | integration | Gio has 4 strikes in semester 1; admin sets semester 2 current | 0 strikes; semester 1 history still shows the flags | not yet |
| TC-FLG-06 | FLG-2 | BR 8, S1 | integration | Ana borrows at 10:00 and returns at 15:00; job runs at 17:00 | Nothing flagged; 0 strikes | not yet |
| TC-FLG-07 | FLG-2 | BR 8, S2 | integration | Ben borrows a laptop at 10:00 and keeps it; job runs at 17:00 | Line `FLAGGED` with `flagged_at` set; audited | not yet |
| TC-FLG-08 | FLG-2 | BR 8, S3 | integration | Cara has 2 of 5 cords outstanding at 17:00; returns the 2 next morning | Line flagged at 17:00; stays `FLAGGED` after the return; 1 strike | not yet |
| TC-FLG-09 | FLG-2 | BR 8, S10 | integration | Hana borrows at 17:30 | Not flagged tonight; flagged at tomorrow's 17:00 if still out | not yet |
| TC-FLG-10 | FLG-2 | BR 9, S11 | integration | API stopped 16:30 to 18:00, started at 18:00 | Catch-up flags lines issued before 17:00; a line issued at 18:10 is not flagged | not yet |
| TC-FLG-11 | FLG-2 | BR 8, S12 | integration | Run the job twice at 17:00 | Second run changes nothing | not yet |
| TC-FLG-12 | FLG-2 | BR 8, S13 | integration | A flagged line is overridden while the item is still out; next closing passes | Not flagged again | not yet |
| TC-FLG-13 | FLG-2 | ARCH 6, CLAUDE.md rule 3 | integration | With an injected clock, change closing time in settings | Job runs at the new time in `Asia/Manila` | not yet |
| TC-FLG-14 | FLG-2 | ARCH 12.5 | integration | Start a scheduled run and a manual run at the same time | Advisory lock: runs never overlap | not yet |
| TC-FLG-15 | FLG-2 | SPEC 3, ARCH 12.5 | integration | Admin triggers the job twice within a minute; handler triggers it | Second admin call refused (once per minute); handler gets 403 | not yet |
| TC-FLG-16 | FLG-2 | BACKLOG FLG-2 | integration | Run the job | Each run is logged | not yet |
| TC-FLG-17 | FLG-3 | BR 11, S8 | integration | Fil at 3 strikes checks out | Checkout works; the warning is shown | not yet |
| TC-FLG-18 | FLG-3 | BR 11, S8 | integration | Fil at 4 strikes checks out | Checkout works; the stricter notice is shown | not yet |
| TC-FLG-19 | FLG-3 | BR 3, 11, S8 | integration | Fil at 5 strikes checks out | `BORROWER_BLOCKED`; no transaction created | not yet |
| TC-FLG-20 | FLG-3 | BR 11, CLAUDE.md rule 3 | integration | Change thresholds to 2, 3, 4 | Warning, notice, and block follow the new values | not yet |
| TC-FLG-21 | FLG-3 | BR 11 | component | Open checkout for borrowers at 3, 4, and 5 strikes | Warning banner, stricter notice banner, blocked message | not yet |
| TC-FLG-22 | FLG-4 | SPEC 5 | integration | Admin lists flagged lines | Borrower, item, note, and expected return date shown | not yet |
| TC-FLG-23 | FLG-4 | BR 13, SPEC 7 | integration | Override with a reason of 4 characters, 5 characters, and 501 characters | 5 accepted; 4 and 501 rejected | not yet |
| TC-FLG-24 | FLG-4 | BR 13 | integration | Override a line before it is returned and another after | Both become `OVERRIDDEN` with `override_by`, `override_at`, reason; audited | not yet |
| TC-FLG-25 | FLG-4 | S18 | integration | Handler and view-only user call override | 403 | not yet |

## RPT: Dashboard and reports

| ID | Ticket | Rule | Level | Steps | Expected | Automated by |
|---|---|---|---|---|---|---|
| TC-RPT-01 | RPT-1 | SPEC 5 | integration | Load the dashboard with open, flagged, and returned lines | Only unreturned lines and borrowers with strikes in the current semester, with notes and expected return dates | not yet |
| TC-RPT-02 | RPT-1 | S18 | integration | Admin, handler, and view-only load the dashboard | All allowed | not yet |
| TC-RPT-03 | RPT-2 | BR section 4 | integration | History for a borrower over a date range | Room, issuing and receiving handlers, return details, flag status; paginated | not yet |
| TC-RPT-04 | RPT-2 | SPEC 7, S21 | integration | Request ranges of 366 and 367 days | 366 accepted; 367 `VALIDATION_ERROR` | not yet |
| TC-RPT-05 | RPT-3 | BR section 4 | integration | History for an item by item and by asset tag | Same detail as RPT-2; paginated | not yet |
| TC-RPT-06 | RPT-4 | BR section 4 | integration | Usage summary for a period | Most borrowed items with counts by category and by room; range capped at 366 days | not yet |
| TC-RPT-07 | RPT-1 to RPT-4 | S18 | integration | View-only user loads the dashboard and all four reports | All allowed | not yet |

## SEC: Security and resilience

| ID | Ticket | Rule | Level | Steps | Expected | Automated by |
|---|---|---|---|---|---|---|
| TC-SEC-01 | SEC-1 | ARCH 12.2 | integration | Exceed the nginx general, login, and CSV limits through port 8080 | 429 with the standard JSON error `RATE_LIMITED` and `Retry-After`, never HTML | not yet |
| TC-SEC-02 | SEC-1 | ARCH 7, 12.2 | integration | POST a 200 KB body through nginx to `/api/auth/login` | 413 with the standard JSON error `PAYLOAD_TOO_LARGE`, never HTML | not yet |
| TC-SEC-03 | SEC-1 | ARCH 12.2 | integration | Open more than 30 connections from one IP | Extra connections refused with 429 | not yet |
| TC-SEC-04 | SEC-1 | ARCH 12.2 | manual | `curl -I` a file under `/assets/` | Exactly one `Cache-Control: public, max-age=31536000, immutable` header | not yet |
| TC-SEC-05 | SEC-1 | ARCH 12.3 | integration | Exceed the Express global limit and the expensive-endpoint limit | 429 `RATE_LIMITED` with `Retry-After` | not yet |
| TC-SEC-06 | SEC-1 | ARCH 12.2, 12.3 | integration | Two clients with different addresses hit the limit; one sends a fake `X-Forwarded-For` | Limited independently; nginx overwrites the fake header | not yet |
| TC-SEC-07 | SEC-1 | ARCH 12.3 | integration | Check the Node server timeouts | `headersTimeout` 15000, `requestTimeout` 30000, `keepAliveTimeout` 5000 | not yet |
| TC-SEC-08 | SEC-1 | ARCH 12.3 | integration | Cause an unexpected error in a route; cause an unhandled rejection | Route: `INTERNAL_ERROR` with no internals; unhandled: logged and the process exits so Docker restarts it | `api/errors.test.ts` (standard format); not yet (crash and restart) |
| TC-SEC-09 | SEC-1 | SPEC 7, S21 | integration | Send a body over 100 KB to Express directly | `PAYLOAD_TOO_LARGE` | `api/auth.test.ts` |
| TC-SEC-10 | SEC-1 | SPEC 7 | unit | Validate the shared Zod schemas at and over every SPEC 7 limit | At the limit accepted; over it rejected | not yet |
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

## DOC: Documentation

| ID | Ticket | Rule | Level | Steps | Expected | Automated by |
|---|---|---|---|---|---|---|
| TC-DOC-01 | DOC-1 | CLAUDE.md | manual | Check that every ticket ID in `docs/BACKLOG.md` appears in this file | All present | manual |
| TC-DOC-02 | DOC-1 | BR 1 to 16, S1 to S21 | manual | Check the coverage table | Every rule and scenario lists at least one case | manual |
| TC-DOC-03 | DOC-1 | CLAUDE.md | manual | Run every test file named in "Automated by" (`npm test`) | All pass | manual |

## Coverage: business rules and scenarios

| Rule or scenario | Cases |
|---|---|
| BR 1 Availability | TC-BRW-01, 02, 03, 05, 06, 07 |
| BR 2 Who and when | TC-BRW-04, 09 |
| BR 3 Eligible borrowers | TC-MD-17, TC-BRW-08, TC-FLG-19 |
| BR 4 Atomic and safe | TC-BRW-10, 11 |
| BR 5 Return events | TC-BRW-20, 21, 22, 28 |
| BR 6 Returning never touches flags | TC-BRW-23, 29, TC-FLG-08 |
| BR 7 Notes are informational | TC-BRW-30, 32 |
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
| S14 Checkout validations | TC-BRW-05 to 10 |
| S15 Return validations | TC-BRW-24 |
| S16 Concurrent checkout | TC-BRW-11 |
| S17 Damaged return | TC-BRW-25 |
| S18 Permissions | TC-AUTH-17, 22, TC-BRW-13, TC-FLG-25, TC-RPT-02, 07 |
| S19 Retiring versus deleting | TC-MD-07 |
| S20 Login flood | TC-AUTH-10, TC-SEC-11 |
| S21 Oversized input | TC-MD-19, TC-BRW-12, TC-RPT-04, TC-SEC-02, 09, 13 |
