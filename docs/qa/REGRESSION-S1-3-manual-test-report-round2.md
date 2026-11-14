# REGRESSION-S1-3 Manual Test Report, Round 2
Date / build or commit: 2026-11-07. Stack at http://127.0.0.1:8080 runs main 995c803 (owner built it; dev DB wiped and reseeded before my run). Repo files from branch feature/REGRESSION-S1-3 at b6cccc0 (main + 36 regression tests), read-only; clean checkout cloned to D:\edgetmp-reg2\clone.
Environment: Windows 11, Node 24 scripts (API, sockets, psql through `docker exec` on the db container), headless Edge driven over CDP (profile, screenshots and temp files on D:). All records I created are prefixed "REG2-".
Verdict: PASS (no new defects; 1 known Low bug re-confirmed; see "Defects" and the summary of FAIL/N/A below)

Result summary: see Totals. Verdict rule used: a FAIL row or an unfixed new defect would make this FAIL. No row is FAIL, except as written in the AUTH-11 row if it says so.

Mockup: the Artifact read of https://claude.ai/artifact/9FampTJnZj8twygeqD8iao returns only the Design-type wrapper; I read project/Inventory.dc.html, Borrowers.dc.html and Rooms.dc.html as files and compared. Checkout.dc.html was compared in round 1 and the wording is unchanged. Differences are in Observations (Inventory has no "Available" column; Strikes column and CSV import belong to unbuilt tickets).


## Traceability table (one row per in-scope TC)

| ID | Ticket | Result | How verified | Notes |
|---|---|---|---|---|
| TC-FND-01 | FND-1 | PASS | manual: fresh `git clone` of b6cccc0 into D:\edgetmp-reg2\clone, then npm install, lint, typecheck, build, npm test | All five exited 0; npm test 68 files, 747/747. Noise only: MaxListenersExceededWarning in test output. |
| TC-FND-02 | FND-1 | PASS | doc check: CLAUDE.md Commands vs package.json | Every "available now" command exists (lint, typecheck, test:db, test, build, format, dev:db, db:migrate, db:seed, test:nginx, api admin:reset-password). `npm run dev` is listed as not created and does not exist. |
| TC-FND-03 | FND-2 | PASS | inspection only: `docker compose config -q` on the clean clone with a dummy env file; without secrets compose refuses with "Set ADMIN_PASSWORD in .env..." messages; running stack (built by the owner) has db, api, web all healthy | NOT re-run from scratch: I was told not to rebuild/restart the stack and C: has ~500 MB free. Result is for the owner-started stack plus config validation. |
| TC-FND-04 | FND-2 | PASS | browser (SPA loads at :8080) + API (`GET /api/health` via nginx = {"status":"ok"}, `/healthz` 200, unknown path 404 JSON) + automated api/health.test.ts |  |
| TC-FND-05 | FND-2 | PASS | docker inspect of db/api/web | Only web published (127.0.0.1:8080); api 3000/db 5432 unpublished. mem 1g/512m/128m, cpus 1.5/1.0/0.5, api pids 200, restart unless-stopped, json-file 10m x3, TZ=Asia/Manila (all), api user node (uid 1000), web nginx, postgres pid1 uid 999. (db-test on 127.0.0.1:5433 is the separate test profile, not part of the stack.) |
| TC-FND-06 | FND-2 | N/A | not executed | Needs `docker compose down` / `up`; instructed not to restart the stack. Only evidence: db data is on named volume `borrowersmonitoringsystem_db-data`. |
| TC-FND-07 | FND-2 | PASS | API/sockets through :8080 + doc check of nginx.conf | 20 KB header: 400. 102,500 B body: 413 JSON PAYLOAD_TOO_LARGE; 99 KB passes nginx. Incomplete request closed after 10.0 s (client_header_timeout). nginx.conf timeouts (10s/10s/15s/15s/30s), 100k body, limits match ARCH 12.2. |
| TC-FND-08 | FND-3 | PASS | automated api/schema-constraints.test.ts (clean checkout run, migrations applied to test DB) + live psql: tables/constraints present |  |
| TC-FND-09 | FND-3 | PASS | live psql (items_unit_or_quantity_check rejects UNIT without tag and QUANTITY with tag) + API (UNIT qty 2, no tag, QUANTITY with tag: 400) + automated schema-constraints (items) |  |
| TC-FND-10 | FND-3 | PASS | live psql (semesters_one_current_key, semesters_dates_check) + API + automated schema-constraints (semesters) |  |
| TC-FND-11 | FND-3 | PASS | live psql (locations_name_lower_key on "ROOM 101" vs "Room 101") + API 409 + automated |  |
| TC-FND-12 | FND-3 | PASS | live psql (settings_single_row_check, pkey) + defaults 17:00/3/4/5 read via API + automated |  |
| TC-FND-13 | FND-3 | PASS | live psql (returns_quantity_check on 0, transaction_items_quantity_check on returned>borrowed) + API 409/400 + automated |  |
| TC-FND-14 | FND-3 | PASS | live psql: `delete from users` for a user with history inside a rolled-back transaction fails with RESTRICT FK + automated schema-constraints (Rule 15) |  |
| TC-FND-15 | FND-3 | PASS | live: audit_log rows for every state change I made (CHECKOUT, RETURN, ITEM_*, ...) with actor; seed/system rows have null actor; automated api/audit.test.ts (rollback) + qa-regression-flows (failed audit insert rolls back checkout/return) |  |
| TC-FND-16 | FND-3 | PASS | automated api/enums.test.ts (test.each over enum names) | Not observed live. |
| TC-FND-17 | FND-4 | PASS | live: seed run in clone against the throwaway test DB (3 users, 3 categories, 3 rooms, 5 items, 4 borrowers, 1 current semester, settings) + dev DB shows same and audited rows with no argon2 in audit before/after + automated seed.test.ts |  |
| TC-FND-18 | FND-4 | PASS | live: ran the seed twice on the test DB, second run "0 record(s) created", counts unchanged + automated seed.test.ts / qa-md1-seed-rerun.test.ts |  |
| TC-FND-19 | FND-4 | PASS | live: `npm run db:seed` without credentials and with ADMIN_PASSWORD=short | "Seed failed: ADMIN_USERNAME and ADMIN_PASSWORD must be set..." and "Seed failed: ADMIN_PASSWORD: Password must be at least 10 characters." Exit 1. |
| TC-FND-20 | FND-4 | PASS | automated api/seed.test.ts "production seeds only the admin and settings"; containers run NODE_ENV=production | Not run live (would need an empty database). |
| TC-FND-21 | FND-4 | PASS | automated api/admin-reset-password.test.ts; live: non-interactive run refuses ("Run this in an interactive terminal") | Hidden-prompt reset itself not run live (no TTY, and it would change a real password). |
| TC-FND-22 | FND-5 | PASS | component Field.test.tsx (names TC-FND-22) + browser: empty Add item shows "Enter a name." under the field; duplicate category shows the API error under the field |  |
| TC-FND-23 | FND-5 | PASS | component tests (Field, DataTable, ConfirmDialog, Notifications carry the ID; FormDialog named in the TC) + browser keyboard-only use of login, checkout, rename dialog, confirm dialog |  |
| TC-FND-24 | FND-5 | PASS | component DataTable.test.tsx + browser: items 26 rows = "Showing 1-25 of 26", Next/Previous; "No borrower matches..." empty state; "Loading..." seen on slow network |  |
| TC-FND-25 | FND-5 | PASS | component ConfirmDialog.test.tsx + browser: Delete category dialog opens with Cancel focused; Cancel keeps the row; confirm deletes |  |
| TC-FND-26 | FND-5 | PASS | component Notifications.test.tsx + browser: success notification after add/rename; API error message shown on duplicate |  |
| TC-FND-27 | FND-6 | PASS | live: API issuedAt vs Date.now() within 60 s; DB row shows 18:55:14+08 = 10:55:14Z; DB timezone Asia/Manila + automated timestamps.test.ts |  |
| TC-FND-28 | FND-6 | PASS | live: session expires_at minus now = 07:59:42 (8 h TTL, rolling) + automated timestamps.test.ts |  |
| TC-FND-29 | FND-6 | PASS | live: in the api container, DATABASE_URL with ?options=... fails with "DATABASE_URL must not set options; prisma.ts sets TimeZone=UTC" + automated |  |
| TC-FND-30 | FND-7 | PASS | component Field.test.tsx (names TC-FND-30) + qa-fnd7-gaps.test.tsx + browser: empty Add item submit moves focus to the first errored field ("Fix 3 fields below.") | TEST_CASES lists qa-md1-r5-fnd7-merge.test.tsx; the ID tag is in Field.test.tsx and qa-fnd7-gaps.test.tsx. |
| TC-AUTH-01 | AUTH-1 | PASS | API (200 + user, no hash; cookie bms.sid Path=/ HttpOnly SameSite=Lax, 8 h expiry; Secure off because COOKIE_SECURE=false) + automated auth.test.ts |  |
| TC-AUTH-02 | AUTH-1 | PASS | API: wrong password and unknown user return the identical 401 body "Incorrect username or password." + automated auth.test.ts | Inactive-user case only in the automated test (no way to create an inactive user until AUTH-3). |
| TC-AUTH-03 | AUTH-1 | PASS | API: anonymous GET and failed login set no cookie + automated; session table has rows only from successful logins |  |
| TC-AUTH-04 | AUTH-1 | PASS | API: login with old cookie gives a new id, old id 401, new id 200 + automated |  |
| TC-AUTH-05 | AUTH-1 | PASS | API: logout then /auth/me and /items both 401 + browser sign-out and Back stays on login |  |
| TC-AUTH-06 | AUTH-1 | PASS | API (viewer, 204, USER_PASSWORD_CHANGED audit row, no hash in it) + browser (valid change clears form) + automated | Viewer password restored; sign-in with QA_PASSWORD re-verified after. |
| TC-AUTH-07 | AUTH-1 | PASS | API: wrong current, 5-char new, signed out: 400/401 each + browser |  |
| TC-AUTH-08 | AUTH-1 | PASS | API: login, password change and POST /rooms without X-Requested-With: 403 FORBIDDEN |  |
| TC-AUTH-09 | AUTH-1 | PASS | automated api/auth.test.ts ("an unknown username runs one password verify") | Timing not measured live. |
| TC-AUTH-10 | AUTH-1 | PASS | browser (username reg2-flood, 10 failures) + API: 11th and later failure = 429 RATE_LIMITED "Too many failed sign-in attempts", Retry-After 781..755; real account qa-viewer still signs in from the same IP + automated | "Works from another IP" not tested live (one PC). |
| TC-AUTH-11 | AUTH-1 | PASS | API: failed logins across 31 different usernames from one IP; Express 429 RATE_LIMITED at attempt 31st (after 30 failures, the first run of 26 distinct usernames had fallen out of the 15 minute window) (a brand-new username is refused too) + automated | The IP is blocked for about 15 minutes after this test; existing sessions keep working. |
| TC-AUTH-12 | AUTH-1 | PASS | API: 4 successful logins (3 accounts) in a row, all 200, plus earlier ones; none throttled + automated |  |
| TC-AUTH-13 | AUTH-1 | PASS | automated api/auth.test.ts + password.test.ts (503 SERVER_BUSY) | Not reproducible live without filling the hash queue. |
| TC-AUTH-14 | AUTH-1 | PASS | automated api/password.test.ts + live: all 3 stored hashes start $argon2id$v=19$m=19456 |  |
| TC-AUTH-15 | AUTH-1 | PASS | automated api/health.test.ts; api container env TRUST_PROXY_HOPS=1; rate limits are per client IP through nginx |  |
| TC-AUTH-16 | AUTH-2 | PASS | doc check: packages/shared/src/permissions.ts vs SPEC 3 table + automated roles.test.ts |  |
| TC-AUTH-17 | AUTH-2 | PASS | API: 22 capabilities x 3 roles (66 calls); refusals are 403 FORBIDDEN, allowed calls never 401/403 + automated roles.test.ts |  |
| TC-AUTH-18 | AUTH-2 | PASS | API: 14 protected endpoints signed out all 401 UNAUTHENTICATED + automated |  |
| TC-AUTH-23 | AUTH-4 | PASS | browser: signed-out /inventory goes to /login; admin, handler, viewer sign in from /login to Home showing name and role badge + automated LoginPage.test.tsx | Signing in after a deep link returns to the deep-linked page (/inventory), not Home (same behaviour as AUTH-29). |
| TC-AUTH-24 | AUTH-4 | PASS | browser: empty submit shows "Enter your username." / "Enter your password.", no request sent, focus in username + automated |  |
| TC-AUTH-25 | AUTH-4 | PASS | browser: "Incorrect username or password." and password field cleared + automated |  |
| TC-AUTH-26 | AUTH-4 | PASS | browser: after 6 quick failures the page shows "Too many requests. Try again in 12 seconds." (nginx 429, Retry-After 12) + automated | 503 text only in the automated test. |
| TC-AUTH-27 | AUTH-4 | PASS | browser: reload on / and on /borrowers stays signed in + automated |  |
| TC-AUTH-28 | AUTH-4 | PASS | browser: Sign out goes to /login, Back stays on login; later sign-ins land on Home + automated |  |
| TC-AUTH-29 | AUTH-4 | PASS | browser: session deleted on server while on /password; next submit returns to /login; signing in returns to /password + automated | Login page shows no "session expired" message (observation). |
| TC-AUTH-30 | AUTH-4 | PASS | browser: empty, 5-char and mismatched confirm all refused with no request; messages "Too short: n of at least 10 characters." / "The two new passwords do not match." + automated |  |
| TC-AUTH-31 | AUTH-4 | PASS | browser: wrong current shows "The current password is incorrect." by the field; request body has only currentPassword and newPassword; valid change clears the form + automated |  |
| TC-AUTH-32 | AUTH-4 | PASS | browser: handler on /inventory /borrowers /rooms /settings and viewer on /checkout /inventory /borrowers /rooms /settings see the "You can't open this page" page; /password opens for both + automated |  |
| TC-AUTH-36 | AUTH-4 | PASS | browser menus: admin = Home, Checkout, Inventory and categories, Borrowers, Rooms and labs, Settings and semesters; handler = Home, Checkout; viewer = Home (Change password in the header for all). Unbuilt screens are hidden |  |
| TC-AUTH-33 | AUTH-4 | PASS | browser through nginx at http://127.0.0.1:8080: sign in and change password (and change back) as qa-viewer |  |
| TC-AUTH-34 | AUTH-5 | PASS | automated api/login-rate-limit.test.ts | Not observable live. |
| TC-AUTH-35 | AUTH-5 | PASS | API: 5000-char username answered 400 "Too long: at most 200 characters." (no 500); limiter key length covered by automated api/login-rate-limit.test.ts |  |
| TC-MD-01 | MD-1 | PASS | API (create, rename, invalid names empty/blank/201/control char: 400) + browser dialogs + automated |  |
| TC-MD-02 | MD-1 | PASS | API: unused deleted, in use gives 409 HAS_HISTORY + browser confirm dialog + automated |  |
| TC-MD-03 | MD-1 | PASS | API: handler and viewer POST /categories 403; signed out 401 + automated |  |
| TC-MD-04 | MD-2 | PASS | API: UNIT without tag, blank tag, duplicate tag in other case, qty 2, qty 0 all refused; valid UNIT 201 + browser + automated |  |
| TC-MD-05 | MD-2 | PASS | API: QUANTITY with tag, -1, 10001, 2.5, "3", null, missing refused; 0 and 10000 accepted + automated |  |
| TC-MD-06 | MD-2 | PASS | API: filters category/status/tracking, q 1/2/100/101 chars, pageSize 100 ok / 101 refused, page 0/-1/abc refused, "%%" matches nothing + automated |  |
| TC-MD-07 | MD-2 | PASS | API (delete without history 204, again 404; with history refused) + browser: "Cannot delete REG2-LT-001. This item appears in past transactions. Set its status to Retired instead." with Retire button + automated |  |
| TC-MD-08 | MD-2 | PASS | API (create, edit, retire) + audit_log rows ITEM_CREATED/UPDATED + automated |  |
| TC-MD-09 | MD-3 | PASS | API + browser (add, rename, deactivate, reactivate) + audit rows LOCATION_CREATED/UPDATED + automated |  |
| TC-MD-10 | MD-3 | PASS | API: handler quick-add 201 with createdBy QA Handler; handler PATCH 403 + automated |  |
| TC-MD-11 | MD-3 | PASS | API (create/rename in other case: 409 DUPLICATE_VALUE; own case ok) + browser message under field + automated |  |
| TC-MD-12 | MD-3 | PASS | browser: room used in 17 transactions has aria-disabled Delete and "Used in 17 transactions"; unused room deleted after confirm + automated |  |
| TC-MD-13 | MD-4 | PASS | code check: only apps/api/src/services/borrowers.ts (LocalBorrowerService) touches the borrower table; checkout uses borrowerService.isEligible + automated borrower-reads.test.ts |  |
| TC-MD-14 | MD-4 | PASS | automated api/borrower-service.test.ts (test double) + code check of the interface | Not observable live. |
| TC-MD-15 | MD-5 | PASS | API (create, edit, duplicate, invalid) + browser + audit rows BORROWER_CREATED/UPDATED; HTML in a name is shown as text; school ID trimmed + automated |  |
| TC-MD-16 | MD-5 | PASS | API: q of 1 and 101 chars refused, 2 and 100 ok, by name and by school ID, pagination + browser search + automated |  |
| TC-MD-17 | MD-5 | PASS | API + browser: deactivate/reactivate; lookup returns active:false; checkout screen shows "Inactive borrower." and Confirm disabled; API checkout BORROWER_INACTIVE + automated |  |
| TC-MD-21 | MD-7 | PASS | API: create semesters, set current A then B then Sample: exactly one current each time; handler/viewer 403 + audit rows + automated |  |
| TC-MD-22 | MD-7 | PASS | API: 4/3/5, 3/3/5, 3/5/4, 0, 101, 2.5 and closing times 24:00, 17:60, 5pm, empty, 17:00:00 all 400 + browser message "Thresholds must go up..." + automated |  |
| TC-MD-23 | MD-7 | PASS | API: saved 18:30/2/3/4, read by /closing-time, restored 17:00/3/4/5; SETTINGS_UPDATED audited; browser "Settings saved." + automated | Checkout screen read the new closing time (see BRW-38, BRW-40). |
| TC-MD-24 | MD-1 | PASS | API: create "reg2-audio", rename other to "REG2-AUDIO": 409 DUPLICATE_VALUE; own case rename saved + automated |  |
| TC-MD-25 | MD-1 | PASS | browser: categories GET forced to 500: error message and Retry, no "No categories yet." and no row count; Retry loads the list + automated | "API down" variant only in automated tests. |
| TC-MD-26 | MD-1 | PASS | browser keyboard: Rename opens filled and focused; Escape closes and focus returns to row Rename; Enter saves; in-use Delete focusable, does nothing, described "Used by 2 items" + automated | My first run polluted a category name with appended text (my script, not an app bug); restored. |
| TC-MD-27 | MD-5 | PASS | API: create/edit to "reg2-s1" other case: 409 on schoolId; own case saved as typed + automated |  |
| TC-MD-28 | MD-5 | PASS | API: type=ALUMNI and active=yes 400; type/active filters + browser: Type=Faculty and Status=Inactive filters + automated |  |
| TC-MD-29 | MD-2 | PASS | API: create/edit tag in other case 409 on assetTag; own case saved as typed + automated |  |
| TC-MD-30 | MD-3 | PASS | API: handler list shows only active (also with ?active=false); admin sees inactive; pageSize 101 400; viewer 403 + automated |  |
| TC-MD-31 | MD-7 | PASS | API: starts on end date: SEMESTER_OVERLAP on startDate naming the other; inside: overlap; concurrent creates: 201+409; day after saved; edit to end on another start refused + browser + automated |  |
| TC-MD-32 | MD-7 | PASS | API: create/edit to same name other case 409 on name; own name lower-case saved + automated |  |
| TC-MD-33 | MD-7 | PASS | browser: Set as current opens confirm with Cancel focused and "Only flags from transactions in REG2-Sem A will count as strikes..."; Cancel changes nothing; confirm switches; focus to new current semester name; restored Sample semester + automated |  |
| TC-BRW-01 | BRW-1 | PASS | API: unit out = available 0, free = 1 (item list `available`) + automated availability.test.ts |  |
| TC-BRW-02 | BRW-1 | PASS | API: cord total 8 with 3 out = 5; total 20 with 3 out = 17; fully returned line adds nothing + automated |  |
| TC-BRW-03 | BRW-1 | PASS | API: UNDER_REPAIR/LOST/RETIRED items (UNIT and QUANTITY) cannot be checked out (ITEM_UNAVAILABLE); browser shows Under repair/Lost/Retired + automated |  |
| TC-BRW-04 | BRW-2 | PASS | API: handler checkout of 2 items: one transaction, 2 lines, issuedById = session handler (body issuedById ignored), current semester, issuedAt = now; 7+ CHECKOUT audit rows + automated |  |
| TC-BRW-05 | BRW-2 | PASS | API: unit already out 409 ITEM_UNAVAILABLE + automated |  |
| TC-BRW-06 | BRW-2 | PASS | API: 6 of 5 409 INSUFFICIENT_QUANTITY with details.available 5; 5 of 5 ok; 1 of 0 409 + automated |  |
| TC-BRW-07 | BRW-2 | PASS | API: all three statuses, UNIT and QUANTITY: 409 ITEM_UNAVAILABLE + automated |  |
| TC-BRW-08 | BRW-2 | PASS | API: inactive borrower 409 BORROWER_INACTIVE + browser + automated |  |
| TC-BRW-09 | BRW-2 | PASS | automated api/checkout.test.ts (NO_CURRENT_SEMESTER) | Cannot be reached live: the system never allows zero current semesters. |
| TC-BRW-10 | BRW-2 | PASS | API: line 2 fails: 409, line 1 item still available, no transaction + automated |  |
| TC-BRW-11 | BRW-2 | PASS | API: 3 simultaneous checkouts of one unit: 201 + 2x 409 ITEM_UNAVAILABLE + automated |  |
| TC-BRW-12 | BRW-2 | PASS | API: 51 lines, no lines, repeated item, qty 0/-1/1.5/10001, 501-char note, unit qty 2: 400; unknown item/borrower/room 404 + automated |  |
| TC-BRW-13 | BRW-2 | PASS | API: viewer 403, signed out 401 + automated |  |
| TC-BRW-14 | BRW-3 | PASS | browser: lookup shows name, school ID, type, department; inactive borrower shows "Inactive borrower." and Confirm disabled + automated |  |
| TC-BRW-15 | BRW-3 | PASS | browser: room picker, new room (empty message, duplicate "already exists", new room created and selected, createdBy handler) + automated |  |
| TC-BRW-16 | BRW-3 | PASS | browser: item search, quantity validation ("", 0, -1, 1.5 give "Enter a whole number from 1 to 10,000."), unit line has no quantity, note and expected date saved (DB), past date refused + automated |  |
| TC-BRW-17 | BRW-3 | PASS | browser: Summary panel; double click on Confirm created exactly 1 transaction; "Checkout saved. ..." + automated |  |
| TC-BRW-18 | BRW-3 | PASS | browser: stale availability gives "Checkout not saved. Only 16 of REG2-Cable available, 99 requested. Nothing was issued." and marks the line "Only 16 available" + automated |  |
| TC-BRW-19 | BRW-3 | PASS | browser: whole checkout done with key events only (Tab, Enter, ArrowDown, typing): borrower, Choose, room, item, Add, quantity, note, Confirm; focus lands on "Start a new checkout" | Headless Edge ignored typed digits in the native date field, so the date was left empty; that field is a native date input. |
| TC-BRW-20 | BRW-4 | PASS | API: full return, receivedById = session user, returnedAt, condition; RETURN audit rows + automated |  |
| TC-BRW-21 | BRW-4 | PASS | API: line issued by handler returned by admin: receiver admin, issuer handler (DB) + automated |  |
| TC-BRW-22 | BRW-4 | PASS | API: return 3 of 5 leaves outstanding 2 (DB), then 2 closes it + automated |  |
| TC-BRW-23 | BRW-4 | PASS | API + DB: line set FLAGGED by SQL (FLG-2 not built) and returned in full: quantities 3/3, flag_status stays FLAGGED + automated | Flag set by direct SQL on my REG2 data. |
| TC-BRW-24 | BRW-4 | PASS | API: 3 when 2 outstanding and any return on a closed line: 409 RETURN_EXCEEDS_OUTSTANDING; two simultaneous returns: 201 + 409; bad quantity/condition/duplicate line 400; mixed batch atomic + automated |  |
| TC-BRW-25 | BRW-4 | PASS | API: unit returned DAMAGED: item condition DAMAGED, status ACTIVE; quantity item DAMAGED: item condition unchanged, event DAMAGED + automated |  |
| TC-BRW-26 | BRW-4 | PASS | API + DB: borrower with 5 transactions whose lines were set FLAGGED by SQL: handler returned all 5 (201); return also works for an inactive borrower + automated | The "blocked at 5 cannot check out" half needs FLG-3 (not built): N/A. |
| TC-BRW-34 | BRW-2 | PASS | API: inactive room, handler and admin: 409 LOCATION_INACTIVE + automated |  |
| TC-BRW-35 | BRW-2 | PASS | API: yesterday 400 on lines.0.expectedReturnDate; today, tomorrow, 2099-01-01 saved; 2026-13-45 400 + automated | Manila-midnight boundary only in the automated faked-clock test. |
| TC-BRW-36 | BRW-3 | PASS | API: admin/handler lookup returns only id, schoolId, name, type, department, active (inactive included), paginated; missing/1/101-char q and pageSize 101 400; viewer 403; signed out 401 + automated |  |
| TC-BRW-37 | BRW-3 | PASS | API (available 0/1/0/17, no borrower info) + browser: Out, Available, Under repair, "17 available", "0 available" with Add disabled + automated |  |
| TC-BRW-38 | BRW-3 | PASS | API (all roles read closing-time 18:30; handler 403 on /settings GET and PUT; signed out 401) + browser: with closing 23:30 the page showed "Today by 23:30", "Lines still out at 23:30 are flagged anyway" and "Due back by 23:30 today" + automated | Closing time restored to 17:00. |
| TC-BRW-39 | BRW-3 | PASS | browser: after scrolling, the "Room ... added." notification stays at the top (sticky area, top 0 after scroll); focused fields land below it; scroll-padding-top 65px + automated Notifications.test.tsx | See BRW banners observation LXHOTPZY: checkout banners are not in that area. |
| TC-BRW-40 | BRW-3 | PASS | browser at 19:1x Manila with closing 18:30 (after closing): Summary "Tomorrow by 18:30", note "Lines still out at 18:30 tomorrow", success "Due back by 18:30 tomorrow"; with closing 23:30 the "Today" wording + automated |  |
| TC-BRW-41 | BRW-3 | PASS | browser at 320, 360, 768, 900, 1100 px with a 100-char room selected and an item line: page never wider than the window (only the 15 px scrollbar), room picker inside the window, only the lines box scrolls (scrollWidth 760 in a 215 to 663 px box) + automated |  |
| TC-SEC-01 | SEC-1 | PASS | API through nginx: 80 parallel GET: 30x200 + 50x 429 JSON RATE_LIMITED, Retry-After 1; login: 429 JSON, Retry-After 12 (browser and API) + `npm run test:nginx` 9/9 (owner run, file carries the IDs) | CSV limit part N/A (MD-6 not built). |
| TC-SEC-02 | SEC-1 | PASS | API: 200 KB body to /api/auth/login: 413 application/json PAYLOAD_TOO_LARGE + test:nginx |  |
| TC-SEC-03 | SEC-1 | PASS | sockets: 30 held-open requests from one IP, the next 6 connections got 429 JSON RATE_LIMITED with Retry-After + test:nginx | My first attempt used incomplete headers, which nginx does not count; that was my test, not a defect. |
| TC-SEC-04 | SEC-1 | PASS | curl -I on /assets/index-*.js: exactly one Cache-Control: public, max-age=31536000, immutable + test:nginx |  |
| TC-SEC-05 | SEC-1 | PASS | API: 64 `GET /api/items?q=ab`: 60x200 then 4x 429 RATE_LIMITED, Retry-After 48 + automated request-limits.test.ts (global 600/min) | The global 600/min limit cannot be reached through nginx (10 r/s): automated only. |
| TC-SEC-06 | SEC-1 | PASS | API: rotating fake X-Forwarded-For does not bypass the limit (31x200, 49x429) + test:nginx + automated | Two genuinely different client IPs not testable (one PC). |
| TC-SEC-07 | SEC-1 | PASS | code check apps/api/src/server.ts (15000/30000/5000) + automated request-limits.test.ts |  |
| TC-SEC-08 | SEC-1 | PASS | automated: request-limits.test.ts (unhandled rejection/exception exit), qa-regression-flows.test.ts (route failure returns INTERNAL_ERROR), errors.test.ts | TEST_CASES names errors.test.ts, which has no INTERNAL_ERROR test; that one is in qa-regression-flows.test.ts and only asserts the code. Not provoked live. |
| TC-SEC-09 | SEC-1 | PASS | live: 200 KB POST sent from inside the api container straight to Express: 413 PAYLOAD_TOO_LARGE + automated auth.test.ts |  |
| TC-SEC-10 | SEC-1 | PASS | automated packages/shared/src/limits.test.ts + qa-sec1-limits.test.ts; live boundary probes: pageSize 100/101, search 2/100/101, quantity 0/10000/10001, 50/51 lines, note 500/501, thresholds 1/100 | Override reason, report range and CSV rows: N/A, not built. |
| TC-HRD-09 | HRD-6 | PASS | manual: `npm run build` in the clean clone | No chunk-size warning; Home, ChangePassword, Rooms, Borrowers, Settings, Inventory, Checkout are separate chunks; entry chunk 477 kB. |
| TC-HRD-10 | HRD-6 | PASS | automated: page tests call renderApp on /, /inventory, /borrowers, /rooms, /settings, /password, /login (+ qa-regression-routes.test.tsx); all 747 pass; every route also rendered in my browser pass |  |
| TC-HRD-11 | HRD-6 | PASS | browser with network events: login page loads only the entry chunk; each menu item fetches its own chunk on first visit and not on revisit; "Loading..." shown on a throttled network |  |
| TC-DOC-01 | DOC-1 | PASS | doc check | All real ticket IDs in BACKLOG.md appear in the TEST_CASES Ticket column. "FND-30" appears in BACKLOG only as the case ID TC-FND-30 (the ticket is FND-7). |
| TC-DOC-02 | DOC-1 | PASS | doc check of the coverage table | BR 1 to 16 and S1 to S21 each list at least one case. |
| TC-DOC-03 | DOC-1 | PASS | doc check + suite: every test file named in "Automated by" exists; full suite 68 files 747/747 in my clean clone | 4 path references use `web/pages/...` (RoomsPage, BorrowersPage, SettingsPage, qa-md7-r2-gaps) which the file legend would resolve to a folder that does not exist; the files are in apps/web/src/pages/. |

## Totals

In-scope IDs found in TEST_CASES.md: 142. PASS 141, FAIL 0, N/A 1. Rows written: 142.

## Additional tests run (outside single TC rows)
- Exploratory pass of every screen as admin, handler and viewer at 1000 and 400 px (and 1280 for table headers): Home, Checkout, Inventory (items and categories), Borrowers, Rooms and labs, Settings and semesters, Change password. No horizontal page scroll (only the 15 px scrollbar), no failed API call, no "Loading..." stuck, menus per role as expected. Screenshots in D:\edgetmp-reg2\shots.
- Regression of known bug LXHOTPZY (Low): "Checkout saved / not saved banners scroll away instead of staying in the sticky message area": STILL REPRODUCES. At 1000 x 500, after a refused checkout (REG2-Cable 99 requested) and scrolling 400 px: "Room ... added." notification top = 21 px (stays visible, sticky area at top 0), "Checkout not saved..." banner top = -144 px (scrolled away). No new card needed; add a comment to the existing card if the owner wants.
- Two simultaneous returns of 2 on a line with 3 outstanding: one 201, one 409 RETURN_EXCEEDS_OUTSTANDING.
- HTML in a borrower name is rendered as text; school ID is trimmed on save.
- Malformed JSON 400 JSON, unknown API path 404 JSON, page=0/-1/abc refused.
- Concurrent semester creates: exactly one saved. Concurrent unit checkout: exactly one wins.
- Settings, semesters: closing time restored to 17:00, thresholds 3/4/5, "Sample semester" current again (checked at the end).
- qa-viewer password was changed twice (API and browser) and changed back; sign-in with QA_PASSWORD verified afterwards through the API (t1 logins, 200).

## Defects
No new defects. Known Low bug LXHOTPZY re-confirmed (see above).

## Observations (not bugs)
1. Inventory items table has no "Available" column, but the approved mockup (Inventory.dc.html) has one ("Out", "Available", "8 of 20"). No acceptance criterion asks for it and the API already returns `available`. Owner to decide whether to add it.
2. An admin may lower a QUANTITY item's total below what is currently out (REG2-Twenty 20 -> 1 with 5 out): saved with 200, and `available` shows 0. BR 1 does not forbid it; the result hides the discrepancy. Restored to 20.
3. Every page has the same document title "Borrowers Monitoring System" (tab and screen-reader title do not change per screen).
4. After a session expires the sign-in page shows no "your session expired" message; the user just lands on login (TC-AUTH-29 only requires the return to the same page).
5. At 1000 px the Inventory Name column breaks words ("Extensio n cord").
6. TEST_CASES.md details: four paths use `web/pages/...` (should be `web/...` by the file's legend); TC-SEC-08 lists errors.test.ts, but the INTERNAL_ERROR route test is in qa-regression-flows.test.ts and asserts only the code, not the absence of internals; TC-FND-30 lists qa-md1-r5-fnd7-merge.test.tsx, the ID tag is in Field.test.tsx and qa-fnd7-gaps.test.tsx.
7. DAMAGED items can still be checked out; a GOOD return never repairs the condition (round 1 observation 8, still open). Home page text still says "Checkout, returns, and reports will appear in the menu as they are built." Raw validation texts ("Invalid input: expected string...") reach API clients for missing fields (round 1 observation 1).
8. A native date input could not be typed into by headless Edge key events, so TC-BRW-19 did not fill the optional date by keyboard.
9. Headless Edge crashed three times on my first runs (Crashpad dumps, password-manager related; fixed with `--password-store=basic` flags). Browser problem, not the app.
10. Test output of `npm test` prints MaxListenersExceededWarning noise.

## Not done / limits
- TC-FND-06 (down/up persistence): not run, stack restart not allowed.
- TC-FND-03 not rebuilt from scratch (see row).
- Two real client IPs, 503 SERVER_BUSY, inactive-user login, NO_CURRENT_SEMESTER, Manila-midnight date boundary, hidden-prompt password reset: automated tests only.
- CSV, flagging, strikes, blocking, Return screen, Dashboard, Users, Reports, Audit screen: not built.

## Test data and cleanup
Created (all REG2-): category REG2-Audio (has items), about 30 items (several with history, many RETIRED), borrowers REG2-S1, REG2-E1 (inactive), REG2-S5 (inactive), REG2-XSS, rooms REG2-CL-201B, REG2-Quick (inactive), REG2-Room Q, REG2-Sticky 7590, a 100-char REG2-WWW... room, semesters REG2-Sem A/B/E1/F (not deletable), about 30 transactions, audit rows. I also set flag_status to FLAGGED by SQL on 6 REG2 lines (BRW-23, BRW-26) and ran a rolled-back SQL probe set (no data kept). Seed run twice on the throwaway test database (db-test) only. Browser: headless Edge killed with `taskkill /T /F`, profile and cache folders deleted. Scratch scripts and screenshots remain in D:\edgetmp-reg2 (please delete the folder when done).
