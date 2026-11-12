# REGRESSION-S4 Manual Test Report
Date / build or commit: 2026-11-11 (run 03:30 to 04:50 Manila). Stack at http://127.0.0.1:8080 runs main d2b6531 (fresh `docker compose up --build` by the owner; db, api, web healthy). Repo documents read from main; a clean clone of d2b6531 on D:\edgetmp-reg4\clone was used for lint, typecheck, build, doc checks and code checks.
Environment: Windows 11, Node 24 scripts (API calls through nginx at :8080 with the `X-Requested-With` header; `psql` through `docker exec` on the dev database `bms` only), headless Edge 157 driven over the DevTools protocol (window emulation 1280/1000/400/320 px, key events, request interception for forced failures), roles admin, qa-handler, qa-viewer. No password was printed or written. Not touched: the stack (no restart/rebuild/stop), bms_test and any other *_test database. All test records are prefixed "REG4-".
Verdict: PASS (0 FAIL rows, 0 new defects; 23 cases N/A with reasons; see Totals and the coverage limits at the end)

Settings and semester, before and after (identical):
| Item | Before my run | After my run |
|---|---|---|
| Closing time | 17:00 | 17:00 (changed many times to trigger flagging, restored last) |
| Thresholds warning / notice / block | 3 / 4 / 5 | 3 / 4 / 5 |
| Current semester | Sample semester (1 Nov 2026 to 30 Apr 2027) | Sample semester |

Documents check: CLAUDE.md, SPEC.md/BUSINESS_RULES.md (as quoted by the tickets), TEST_CASES.md and the earlier report REGRESSION-S1-3 round 2 were read. TEST_CASES.md on main has 238 case IDs; 207 are in scope here (tickets built: FND-1 to 7, AUTH-1/2/4/5, DOC-1, MD-1 to 5 and 7, BRW-1 to 5, SEC-1, HRD-6, FLG-1 to 4, REG-1). The 31 cases of unbuilt tickets (AUTH-3, MD-6, BRW-6, RPT-1 to 4, HRD-1 to 5, SEC-2) were not run. No disagreement between the documents found for the behaviours tested. Mockup: the Artifact read of https://claude.ai/artifact/9FampTJnZj8twygeqD8iao works but returns only the Design-type wrapper (no page content, as in earlier rounds). I did not open the project/*.dc.html files this round; the screens were compared with the mockup in the earlier per-ticket reports, and this run checked layout, wording and behaviour against the test cases.

## Headline results (end-to-end flow, all observed in the browser unless marked API)
1. Checkout, then closing, then flagging, then strikes, then warning/notice/block (borrower REG4-Fil Dizon, 5 separate checkouts, thresholds 3/4/5):
   - 3 transactions left open, closing set to the current minute (moved earlier than the old 17:00): flagging ran at once, Fil = 3 strikes (a transaction with 2 and one with 3 flagged lines each count once). Checkout screen: "Warning: 3 strikes ... Checkout is allowed." Checkout works.
   - 4th checkout saved, flagged: 4 strikes, "Notice: 4 strikes ... at 5 strikes ... will be blocked", checkout works.
   - 5th checkout saved, flagged: 5 strikes, "Blocked: 5 strikes ...", Confirm checkout disabled; API checkout 409 BORROWER_BLOCKED. Return screen shows the badge "Blocked: 5 strikes" and every Return button stays enabled.
   - Admin on Flag review: Override with 4 characters refused ("Enter a reason of at least 5 characters."), valid reason accepted ("Flag overridden. ... now has 4 strikes."), focus to the search field; Fil can check out again (201).
   - Thresholds changed to 2/3/4 in Settings: Fil (4 strikes) is blocked at once on the screen and in the API; restored to 3/4/5.
   - Semester switch: QA-FLG4-Old semester made current from the Settings screen (dialog, Cancel focused): Fil 0 strikes everywhere, Flag review empty; Sample semester current again: Fil back to 4 strikes, flags listed again.
2. Return screen: search by borrower, item and asset tag (case-insensitive); partial QUANTITY return (2 of 5, row shows "Out: 3 of 5", then the rest); a line for an item set to LOST and one set to RETIRED while out are both returnable (items keep their status); returning with condition FAIR on a NEW unit item leaves the item NEW, DAMAGED lowers it to DAMAGED (unit) and leaves a quantity item unchanged; a blocked borrower can return; refusals ("Return not saved ... Nothing was recorded.") mark the row (aria-invalid, focus) and stay in the sticky message area.
3. The scheduled run was seen firing by itself: closing set to a future minute (04:00), the line issued after the previous run stayed NONE and was flagged with flagged_at 04:00:00.01 Manila. A line issued after the closing time was not flagged by that closing (S10). An overridden line that was still out was not flagged again at the next closing (S13).

## Regression of earlier fixed bugs (all confirmed fixed)
| Bug | Check | Result |
|---|---|---|
| BRW-3 BUG-1 Checkout scrolls sideways with an item line | 1000, 400, 320 px, 100-char room and borrower, item line | not present (page width = window width) |
| BRW-3 BUG-2 100-char room widens the page | Checkout and Rooms at 1000, 400, 320 | not present |
| BRW-3 BUG-3 first press of Confirm with nothing chosen does not focus the borrower search | 17 first presses (5 in the checkout runs at 1000x500 and 400, 8 on one session with delays of 0 to 2.1 s, 4 fresh browsers) | focus on the borrower search in 16 of 17; one press showed focus on BODY and did not repeat (see Observation 6) |
| MD-7 BUG-1 Semesters text promises 0 strikes | Settings screen | text now "Strikes count only in the current semester. Flags from other semesters stay in history."; confirm dialog wording matches |
| LXHOTPZY checkout banners scroll away | 1000x500 and 400x500, refused checkout, scroll 400 | banner stays at top 22 px; success and refusal banners are in the sticky area; the Return refusal also stays at 22 px after 800 and 1600 px scroll |
| REG-1 BUG-1 100-char category widens Inventory | 1000, 400, 320 px, Items and Categories tabs, filter and item form | not present |
| BRW-5 BUG-1 Search box collapses on narrow windows | Return at 400 and 320 px | Search is full width (295 px at 400, 215 px at 320), button wraps below |
| BRW-5 BUG-2 refusal says "N returned" | over-return refused by the server | now "You entered 4 of <item>, but the amount still out on this line is 2. Nothing was recorded." |

## Screen pass (3 roles x 10 screens x 3 widths)
Every screen was opened as admin, handler and viewer at 1000, 400 and 320 px (admin: Home, Checkout, Return, Flag review, Inventory and categories, Borrowers, Rooms and labs, Settings and semesters, Change password and an unknown path; handler and viewer: the same paths, refused ones showing "You can't open this page"). Results: no sideways scroll on any page (page width = window width) even with the 100-character category, room, borrower, department and item names and a 440-character note in the data; no console-visible error text or stuck "Loading..."; tab titles correct; the first Tab press focuses "Skip to main content" for all roles; menus per role: admin = Home, Checkout, Return, Flag review, Inventory and categories, Borrowers, Rooms and labs, Settings and semesters; handler = Home, Checkout, Return; viewer = Home. Interactive states (dialogs, forced failures, refusals, long data) were checked at 1280/1000/400/320 for Return, Checkout, Flag review, Inventory, Categories, Borrowers and Rooms.

## Traceability table (one row per in-scope TC)
"How" says what I did: API = scripts against :8080; psql = dev DB queries (rolled-back transactions for constraint probes); browser = headless Edge; doc/code/npm = checks on the clean clone. Results are about what I exercised; a row says so when only part could be run.

| ID | Ticket | Result | How | Notes |
|---|---|---|---|---|
| TC-FND-01 | FND-1 | N/A | npm (clone) | PARTIAL, so counted N/A: fresh `git clone` of main d2b6531 into D:\edgetmp-reg4\clone, then `npm install` (exit 0), `npm run lint` (0), `npm run typecheck` (0), `npm run build` (0) all pass. `npm test` NOT run: it needs the test database that the automated tester is using right now |
| TC-FND-02 | FND-1 | PASS | doc | every "npm run" command in CLAUDE.md "available now" exists in package.json: lint, typecheck, test:db, test:nginx, build, format, dev:db, db:migrate, db:seed; admin:reset-password exists in apps/api; "npm run dev" listed only under "Not yet created" |
| TC-FND-03 | FND-2 | PASS | docker compose config | `docker compose config -q` on the clean clone passes with dummy secrets and refuses without them ("Set ADMIN_PASSWORD in .env...", "Set SESSION_SECRET..."); the running stack (fresh build by owner) shows db, api, web healthy. Not rebuilt from scratch by me (stack must not be touched) |
| TC-FND-04 | FND-2 | PASS | API | /api/health 200, /healthz 200, unknown API path 404 JSON, SPA served at / |
| TC-FND-05 | FND-2 | PASS | docker inspect | only the web container publishes a port: /borrowersmonitoringsystem-db-1 ports=[] mem=1024M cpu=1.5 restart=unless-stopped user= tz=TZ=Asia/Manila health=healthy // /borrowersmonitoringsystem-api-1 ports=[] mem=512M cpu=1 restart=unless-stopped user=node tz=TZ=Asia/Manila health=healthy // /borrowersmonitoringsystem-web-1 ports=["8080/tcp->127.0.0.1:8080"] mem=128M cpu=0.5 restart=unless-stopped user=nginx tz=TZ=Asia/Manila health=healthy |
| TC-FND-06 | FND-2 | N/A | - | N/A: needs docker compose down/up (stack restart not allowed in this run); owner to run. Data is on named volume borrowersmonitoringsystem_db-data |
| TC-FND-07 | FND-2 | PASS | sockets | 20 KB header: "HTTP/1.1 400 Bad Request"; 102,500-byte body: 413 {"error":{"code":"PAYLOAD_TOO_LARGE","message":"The request is too lar (client timeouts not re-measured; limits match nginx.conf by test:nginx, owner run) |
| TC-FND-08 | FND-3 | PASS | psql | tables present: _prisma_migrations,categories,settings,borrowers,transaction_items,transactions,returns,semesters,users,items,session,locations,audit_log |
| TC-FND-09 | FND-3 | PASS | psql+API | DB refuses UNIT without tag, QUANTITY with tag, UNIT qty 2 (items_unit_or_quantity_check); API 400/400/400 |
| TC-FND-10 | FND-3 | PASS | psql | second current semester: semesters_one_current_key; end before start: semesters_dates_check |
| TC-FND-11 | FND-3 | PASS | psql+API | psql duplicate of "REG4-Lab 1" in other case: locations_name_lower_key; API 409 DUPLICATE_VALUE |
| TC-FND-12 | FND-3 | PASS | psql+API | second settings row refused (settings_single_row_check, pkey); one settings row (closing time at that moment was my temporary flagging value; 17:00 and 3/4/5 restored at the end and verified in the database) |
| TC-FND-13 | FND-3 | PASS | psql | return quantity 0: returns_quantity_check; returned above borrowed: transaction_items_quantity_check |
| TC-FND-14 | FND-3 | PASS | psql | deleting a user who issued transactions fails: ERROR ... violates RESTRICT setting of foreign key constraint "transactions_issued_by_fkey" (transaction rolled back) |
| TC-FND-15 | FND-3 | PASS | psql | audit actions with counts (action,rows,rows with actor): SEMESTER_SET_CURRENT/2/2; ITEM_CREATED/44/39; RETURN/62/62; LINE_FLAGGED/12/3; FLAG_OVERRIDDEN/13/13; SETTINGS_UPDATED/11/11; CHECKOUT/65/65;  / columns id,actor_id,before,after,created_at,action,entity,entity_id |
| TC-FND-16 | FND-3 | PASS | psql | enum types in the database: role,borrower_type,tracking_type,item_condition,item_status,return_condition,flag_status (name-level check vs shared enums; the test.each is automated only) |
| TC-FND-17 | FND-4 | PASS | psql | dev DB seed state (users,categories,rooms,items,borrowers,current semesters,settings) = 3/5/8/44/20/1/1; 3 users with argon2id hashes (not re-seeded: would write to the dev DB) |
| TC-FND-18 | FND-4 | N/A | - | N/A: re-running the seed would write to the dev database; a clean scratch database is needed (the *_test databases are off limits). Owner/automated seed tests cover it |
| TC-FND-19 | FND-4 | PASS | npm (clone) | seed in a clean clone with no admin credentials: "Seed failed: ADMIN_USERNAME and ADMIN_PASSWORD must be set (see .env.example). The seed creates the first admin from them."; with a 5-char password: "Seed failed: ADMIN_PASSWORD: Password must be at least 10 characters." (fails before connecting) |
| TC-FND-20 | FND-4 | N/A | - | N/A: production seed needs an empty database; not available without touching the shared databases. Containers do run NODE_ENV=production |
| TC-FND-21 | FND-4 | PASS | docker exec | non-interactive run refuses: "Run this in an interactive terminal (docker compose exec gives one)."; hidden-prompt reset itself not run (no TTY, would change the real admin password) |
| TC-FND-22 | FND-5 | PASS | browser | Add item with everything empty: messages under the fields ("Enter a name.", "Choose a category.", "Enter an asset tag."), fields aria-invalid; duplicate category name shows the API message under the Name field with aria-invalid=true. Component test not run |
| TC-FND-23 | FND-5 | PASS | browser | keyboard-only: sign-in, a whole checkout (Tab, Enter, typeahead in the room select, typing), Rename dialog (Enter opens, Escape closes, focus back on the row button, Enter saves), confirm dialog opens with Cancel focused; focus ends on "Start a new checkout". Component tests not run |
| TC-FND-24 | FND-5 | PASS | browser | Items table "Showing 1-25 of 92", Next gives "26-50 of 92", Previous returns to 1-25; search with no match shows "No item matches "zzzzqqq"."; the "Loading..." text between lazy chunk loads was not captured on a slow network this time (seen in earlier rounds) |
| TC-FND-25 | FND-5 | PASS | browser | Delete category opens "Delete category?" with Cancel focused; Cancel keeps the row; confirm deletes it and shows "Category ... deleted." |
| TC-FND-26 | FND-5 | PASS | browser | success notification after add ("Category ... added.") and rename ("... renamed to ..."), after delete, and API error (duplicate) text under the field; Flag review, Return and Settings show their own notices |
| TC-FND-27 | FND-6 | PASS | API+psql | API issuedAt 2026-11-10T19:51:25.811Z is within a minute of now and UTC; db row 2026-11-11 03:51:25.811+08; db timezone Asia/Manila |
| TC-FND-28 | FND-6 | PASS | psql | newest session expires in 07:59:51 (8 h TTL, rolling) |
| TC-FND-29 | FND-6 | PASS | docker exec | api container with DATABASE_URL ...?options=...: "DATABASE_URL must not set options; prisma.ts sets TimeZone=UTC (ARCHITECTURE.md 6)." |
| TC-FND-30 | FND-7 | PASS | browser | empty Add item submit: "Fix 3 fields below." and focus moves to the first errored field (new-name) |
| TC-FND-31 | REG-1 | PASS | browser | tab titles from the 3-role pass: Home, Checkout, Return, Flag review, Inventory and categories, Borrowers, Rooms and labs, Settings and semesters, Change password (all "<Page> · Borrowers Monitoring System"); a page the role may not open: "Not allowed"; unknown path /nope redirects to Home; signed out: "Sign in" |
| TC-AUTH-01 | AUTH-1 | PASS | API | 200, cookie bms.sid=...; Path=/; Expires=Wed, 11 Nov 2026 03:50:24 GMT; HttpOnly; SameSite=Lax; body has no hash |
| TC-AUTH-02 | AUTH-1 | PASS | API | unknown user and wrong password: identical 401 body {"error":{"code":"UNAUTHENTICATED","message":"Incorrect username or password.","details":{ (inactive user only automated: AUTH-3 not built, no way to deactivate a user) |
| TC-AUTH-03 | AUTH-1 | PASS | API | failed logins and anonymous GET set no cookie |
| TC-AUTH-04 | AUTH-1 | PASS | API | login with an old session cookie issues a new id; old id 401, new id 200 |
| TC-AUTH-05 | AUTH-1 | PASS | API | logout 204, then /auth/me 401 (browser Back after sign-out is in the UI pass) |
| TC-AUTH-06 | AUTH-1 | PASS | API | viewer changed password and changed back: 204/204; audit rows with a hash in them: 0 |
| TC-AUTH-07 | AUTH-1 | PASS | API | wrong current: 400 VALIDATION_ERROR; 5-char new: 400 |
| TC-AUTH-08 | AUTH-1 | PASS | API | login and password change without X-Requested-With: 403, 403 |
| TC-AUTH-09 | AUTH-1 | N/A | - | N/A: timing of an unknown-user verify is only covered by the automated test (api/auth.test.ts); not measurable by hand |
| TC-AUTH-10 | AUTH-1 | PASS | API | 12 failures for username reg4-flood: 401,401,401,401,401,401,401,401,401,429,429,429; real qa-viewer still signs in (200); other-IP part not testable (one PC) |
| TC-AUTH-11 | AUTH-1 | PASS | API | failed logins for many different usernames from one IP (about 30 in 15 minutes; the response header "ratelimit" showed the 30-in-15min counter running down to r=0): the app answered 429 RATE_LIMITED "Too many failed sign-in attempts" at the next failure ({"error":{"code":"RATE_LIMITED","message":"Too many failed sign-in attempts. Try again later.","deta Retry-After 491); a brand-new username was then also refused (429). Pacing was one attempt per 12.5 s because nginx allows 5 logins per minute per IP; the first try straddled the fixed 15-minute window, so I topped it up. This PC cannot sign in for about 15 minutes after this test (existing sessions keep working). Also run directly in the api container with a fake client IP: 30 failures, 31st refused |
| TC-AUTH-12 | AUTH-1 | PASS | API | admin, handler, viewer sign-ins and /auth/me all 200 in a row, none throttled |
| TC-AUTH-13 | AUTH-1 | N/A | - | N/A: 503 SERVER_BUSY (hash queue full) cannot be produced by hand; automated api/password.test.ts only |
| TC-AUTH-14 | AUTH-1 | PASS | API | all stored hashes start $argon2id$v=19$m=19456 (psql) |
| TC-AUTH-15 | AUTH-1 | PASS | API | api container TRUST_PROXY_HOPS=1; throttle keys on the real client IP behind nginx (429 hit this PC only) |
| TC-AUTH-16 | AUTH-2 | PASS | doc+API | packages/shared/src/permissions.ts read against SPEC 3, and the live matrix above agrees |
| TC-AUTH-17 | AUTH-2 | PASS | API | 83 role x endpoint calls: every refusal is 403, no allowed call got 401/403 |
| TC-AUTH-18 | AUTH-2 | PASS | API | 28 protected endpoints signed out: all 401 |
| TC-AUTH-23 | AUTH-4 | PASS | browser | signed out /inventory goes to /login; after sign-in lands on /inventory (deep link), a plain sign-in lands on Home showing name and role badge (admin, handler, viewer) |
| TC-AUTH-24 | AUTH-4 | PASS | browser | empty submit: "Enter your username." and "Enter your password."; no /api/auth/login request (0 resource entries); focus in username |
| TC-AUTH-25 | AUTH-4 | PASS | browser | wrong password: "Incorrect username or password." and the password field is empty afterwards |
| TC-AUTH-26 | AUTH-4 | PASS | browser | six rapid failures: page shows "Too many requests. Try again in 12 seconds." (nginx 429); 503 text only in the automated test |
| TC-AUTH-27 | AUTH-4 | PASS | browser | reload on /borrowers stays signed in on /borrowers |
| TC-AUTH-28 | AUTH-4 | PASS | browser | Sign out lands on /login and Back stays on /login; the next sign-in (no deep link) lands on Home; a stale deep link is not reused (checked with reload and without) |
| TC-AUTH-29 | AUTH-4 | PASS | browser | session killed on the server while on /checkout, then a menu click: sent to /login with "Your session has expired. Please sign in again."; after signing in again lands on /return (the page that was requested). A wrong password afterwards shows only "Incorrect username or password." and Sign out shows no expiry message |
| TC-AUTH-30 | AUTH-4 | PASS | browser | Change password (viewer): empty current "Enter your current password."; 5-char new "Too short: 5 of at least 10 characters."; mismatch "The two new passwords do not match."; none sent a request (0 requests) |
| TC-AUTH-31 | AUTH-4 | PASS | browser | wrong current: "The current password is incorrect."; valid change: "Password changed." and the three fields are cleared; changed back and sign-in with the QA password verified after |
| TC-AUTH-32 | AUTH-4 | PASS | browser | handler on /flags /inventory /borrowers /rooms /settings and viewer on /checkout /return /flags /inventory /borrowers /rooms /settings: "You can't open this page"; /password opens for both (3-role pass at 1000, 400, 320) |
| TC-AUTH-33 | AUTH-4 | PASS | browser | all browser work was through http://127.0.0.1:8080 (nginx), including sign-in and password change |
| TC-AUTH-34 | AUTH-5 | N/A | - | N/A: the limiter key length is observable only in automated api/login-rate-limit.test.ts (a 5000-char username gets 400 live: see TC-AUTH-35) |
| TC-AUTH-35 | AUTH-5 | PASS | API | 5000-character username: 400 {"error":{"code":"VALIDATION_ERROR","message":"Some fields are invalid.","details":{"fields":{"username":["Too |
| TC-AUTH-36 | AUTH-4 | PASS | browser | menus: admin = Home, Checkout, Return, Flag review, Inventory and categories, Borrowers, Rooms and labs, Settings and semesters; handler = Home, Checkout, Return; viewer = Home; "Change password" in the header for all |
| TC-AUTH-37 | REG-1 | PASS | browser | (a) session killed on the server, next request 401: sign-in page shows "Your session has expired. Please sign in again."; (b) Sign out: no such message; (c) first visit redirected to /login: no such message (true); (d) wrong password after the expiry message: only "Incorrect username or password.", expiry message gone (all seen in the AUTH-29 run) |
| TC-MD-01 | MD-1 | PASS | API | create 201, rename 200; empty, blank, 201 chars, control character: 400,400,400,400 |
| TC-MD-02 | MD-1 | PASS | API | unused categories deleted (204, 204); REG4-Cat (has items): 409 HAS_HISTORY |
| TC-MD-03 | MD-1 | PASS | API | handler POST /categories 403, viewer 403, signed out 401 |
| TC-MD-04 | MD-2 | PASS | API | UNIT with no tag, blank tag, duplicate tag in other case, qty 2, qty 0: 400/VALIDATION_ERROR, 400/VALIDATION_ERROR, 409/DUPLICATE_VALUE, 400/VALIDATION_ERROR, 400/VALIDATION_ERROR; valid UNIT 201 |
| TC-MD-05 | MD-2 | PASS | API | QUANTITY with tag, -1, 10001, 2.5, "3", null, missing: 400,400,400,400,400,400,400; 0 and 10000 accepted 201,201 |
| TC-MD-06 | MD-2 | PASS | API | filters ok (true,true,true); q 1/2/100/101 chars: 400,200,200,400; pageSize 100/101: 200,400; page 0/-1/abc: 400,400,400; q=%% matches 0 |
| TC-MD-07 | MD-2 | PASS | API | delete item with history 409 HAS_HISTORY ("This item appears in past transactions. Set its status to Retired instead."); item without history 204, again 404 |
| TC-MD-08 | MD-2 | PASS | API+psql | create and edit of eee002c2-820b-4296-b747-6de7e7b10722 audited: ITEM_CREATED/1; ITEM_UPDATED/2;  |
| TC-MD-09 | MD-3 | PASS | API+psql | create/rename/deactivate/reactivate 201,200,200,200; audit rows 4 |
| TC-MD-10 | MD-3 | PASS | API | handler quick-add 201 createdBy "QA Handler"; handler PATCH 403 |
| TC-MD-11 | MD-3 | PASS | API | create other-case dup 409 DUPLICATE_VALUE; rename to other-case dup 409; own-case rename 200 |
| TC-MD-12 | MD-3 | PASS | API | room with transactions delete 409 HAS_HISTORY; unused room deleted 204 (UI shows disabled Delete and "Used in N transactions": seen in the Rooms screen pass below) |
| TC-MD-13 | MD-4 | PASS | code | code check (git grep on main): borrower table queried in: apps/api/src/services/borrowers.ts; checkout calls borrowerService.isEligible |
| TC-MD-14 | MD-4 | N/A | - | N/A: the test-double substitution is only observable in automated api/borrower-service.test.ts (interface read by code check, not run by me) |
| TC-MD-15 | MD-5 | PASS | API+psql | create (school ID trimmed to "REG4-B-86242") 201, edit 200, duplicate ID other case 409, empty ID/type ALUMNI/empty name/empty dept: 400,400,400,400; audit BORROWER_CREATED,BORROWER_UPDATED (HTML name shown as text in Borrowers screen: UI pass) |
| TC-MD-16 | MD-5 | PASS | API | q 1/2/100/101 chars: 400,200,200,400; by school ID found 1, by name found 1, page 2 of size 1 ok (first run of this check used a wrong search string; my script error, not an app defect) |
| TC-MD-17 | MD-5 | PASS | API | deactivate 200; lookup returns active:false; checkout 409 BORROWER_INACTIVE; reactivate then checkout 201 (UI "Inactive borrower." message checked in the UI sweep) |
| TC-MD-21 | MD-7 | PASS | API | one current at a time: REG4-Sem A 86242 / REG4-Sem B 86242 / Sample semester; handler create and viewer set-current: 403,403; semester audit rows 4; current restored to Sample semester |
| TC-MD-22 | MD-7 | PASS | API | thresholds 4/3/5, 3/3/5, 3/5/4, 0, 101, 2.5: 400,400,400,400,400,400; closing 24:00, 17:60, 5pm, empty, 17:00:00: 400,400,400,400,400 |
| TC-MD-23 | MD-7 | PASS | API | saved 18:30/2/3/4, handler read /closing-time {"closingTime":"18:30"}, restored to 03:35 3/4/5; SETTINGS_UPDATED audit rows 13 |
| TC-MD-24 | MD-1 | PASS | API | create other-case duplicate 409 DUPLICATE_VALUE; rename other to that name in other case 409; own-case rename 200 |
| TC-MD-25 | MD-1 | PASS | browser | categories GET forced to 500 (devtools interception): "Something went wrong." with Retry, no "No categories yet." and no row count; Retry loads the 5 categories |
| TC-MD-26 | MD-1 | PASS | browser | Rename opens with the name filled and focused; Escape closes and focus returns to the row Rename button; Enter saves; the delete button of a category in use has aria-disabled=true, is described "Used by 55 items" and clicking it opens nothing |
| TC-MD-27 | MD-5 | PASS | API | own ID in other case saved as typed 200; create duplicate of REG4-S-001 409; edit to other-case duplicate 409 |
| TC-MD-28 | MD-5 | PASS | API | type=ALUMNI 400, active=yes 400; type and active filters return only matching rows |
| TC-MD-29 | MD-2 | PASS | API | edit tag to another item's tag in other case 409; create duplicate in other case 409; own tag in other case saved 200 |
| TC-MD-30 | MD-3 | PASS | API | handler list shows only active (even with ?active=false: 5 rooms), admin sees inactive; pageSize 101 400; viewer 403 |
| TC-MD-31 | MD-7 | PASS | API | start on another semester's end date, and inside one: 409 SEMESTER_OVERLAP, 409 SEMESTER_OVERLAP; a day after the end: 201; edit to overlap: 409 SEMESTER_OVERLAP |
| TC-MD-32 | MD-7 | PASS | API | create same name other case 409 DUPLICATE_VALUE; own name lower-cased saved 200 |
| TC-MD-33 | MD-7 | PASS | browser | Set as current opens "Change the current semester?" with Cancel focused and "Only flags from transactions in <name> will count as strikes. Flags from other semesters stay in history."; Cancel changes nothing; confirm switches ("... is now the current semester.") and focus moves to the new current semester name; Sample semester restored |
| TC-MD-34 | REG-1 | PASS | browser | Items tab Available column between Asset tag and Condition: quantity item "34 of 40"/"20 of 20", unit out "Out", free unit "Available", lost unit "—" |
| TC-MD-35 | REG-1 | PASS | browser | at 1000, 400 and 320 px no sideways page scroll with the 100-char category and room names; selects stay inside the window; table scrolls inside its own box at 400/320 and Edit/Delete are in view at 1000. See Observation 1: names wrap on spaces/hyphens (the 24-char "REG4-Extension cord, 5 m" takes 3 lines at 1000 px because the Name column is only ~100 px), so the TC wording "stays on one line" is not literally true; no word is split in the middle |
| TC-BRW-01 | BRW-1 | PASS | API | unit item available 1 -> out 0 -> returned 1 (item list "available") |
| TC-BRW-02 | BRW-1 | PASS | API | cord total 20: 3 out 17, +5 out 12, 3 returned 15, 2 of 5 returned 17, rest returned 20 (fully returned line adds nothing) |
| TC-BRW-03 | BRW-1 | PASS | API | UNDER_REPAIR, LOST, RETIRED items (UNIT and QUANTITY) all refused: UUNDER_REPAIR:409 ITEM_UNAVAILABLE, QUNDER_REPAIR:409 ITEM_UNAVAILABLE, ULOST:409 ITEM_UNAVAILABLE, QLOST:409 ITEM_UNAVAILABLE, URETIRED:409 ITEM_UNAVAILABLE, QRETIRED:409 ITEM_UNAVAILABLE; item list shows available 0 for all (UI shows Under repair/Lost/Retired in the Checkout screen sweep) |
| TC-BRW-04 | BRW-2 | PASS | API | handler checkout of 2 items: one transaction, 2 lines (db 2), issuedById = the session handler although the body sent the admin id, semester = current (Sample semester), issuedAt now; CHECKOUT audit rows 1 |
| TC-BRW-05 | BRW-2 | PASS | API | unit item already out: 409 ITEM_UNAVAILABLE |
| TC-BRW-06 | BRW-2 | PASS | API | cord total 8: 6 ok; then 3 when 2 available: 409 INSUFFICIENT_QUANTITY details.available 2; exactly the remaining 2: 201; 1 more when 0 left: 409 INSUFFICIENT_QUANTITY; 1 of a total-0 item: 409 (first run of this check had a wrong script expectation) |
| TC-BRW-07 | BRW-2 | PASS | API | same six refusals (409 ITEM_UNAVAILABLE) as admin-or-handler checkout; for UNIT and QUANTITY |
| TC-BRW-08 | BRW-2 | PASS | API | inactive borrower: handler 409 BORROWER_INACTIVE, admin 409 |
| TC-BRW-09 | BRW-2 | N/A | - | N/A: there is no way to have zero current semesters (the system always keeps one); NO_CURRENT_SEMESTER is covered only by automated api/checkout.test.ts |
| TC-BRW-10 | BRW-2 | PASS | API | line 2 refused (409 ITEM_UNAVAILABLE): line 1 item still available 1 and no transaction line created (0) |
| TC-BRW-11 | BRW-2 | PASS | API | 3 simultaneous checkouts of one unit: 201 / 409 ITEM_UNAVAILABLE / 409 ITEM_UNAVAILABLE |
| TC-BRW-12 | BRW-2 | PASS | API | 51 lines, no lines, repeated item, qty 0/-1/1.5/10001, 501-char note: all 400; unit with qty 2: 400; unknown item/borrower/room: 404,404,404 |
| TC-BRW-13 | BRW-2 | PASS | API | viewer checkout 403, signed out 401 |
| TC-BRW-14 | BRW-3 | PASS | browser | lookup shows name, school ID, type, department ("REG4-S-003 · Student · REG4 Dept"); an inactive borrower shows "Inactive borrower. ... cannot borrow." and Confirm checkout is disabled |
| TC-BRW-15 | BRW-3 | PASS | browser | room picker; "+ Add a new room or lab": empty gives "Enter a room or lab name.", duplicate "REG4-Lab 1 already exists. Names are compared without regard to case.", new room added, selected and shown in the Summary |
| TC-BRW-16 | BRW-3 | PASS | browser | item search; quantity "", 0, -1, 1.5 each give "Enter a whole number from 1 to 10,000." with focus on the quantity; unit line has no quantity field; note and expected date saved (db: "REG4 UI note", 2026-11-12); past date: "Checkout not saved. Choose today or a later date." |
| TC-BRW-17 | BRW-3 | PASS | browser | Summary panel (borrower, room, items, issued by, due back); a double click on Confirm created exactly 1 transaction (db count 1); "Checkout saved. 2 items issued to ... Due back by ... tomorrow." |
| TC-BRW-18 | BRW-3 | PASS | browser | requested 99 of an item with 32 available: "Checkout not saved. Only 32 of <item> available, 99 requested. Nothing was issued." and the line shows "Only 32 available" with aria-invalid |
| TC-BRW-19 | BRW-3 | PASS | browser | whole checkout with keys only (Tab, Enter, typing, typeahead in the room select): borrower, Choose, room, item, quantity, note, Confirm; focus lands on "Start a new checkout". Native date input not typed (headless limit) |
| TC-BRW-20 | BRW-4 | PASS | API+psql | full return as admin: 201, received_by = session user (admin), condition GOOD, returned_at set; RETURN audit rows 1 (db: 165d1734-709a-4e91-ada6-f6772e7b9ba1/GOOD/t) |
| TC-BRW-21 | BRW-4 | PASS | API+psql | line issued by handler (11c3171d) returned by admin (165d1734): receiver differs from issuer in the database |
| TC-BRW-22 | BRW-4 | PASS | API | return 1 of 2 leaves outstanding 1; the next return closes the line (not listed any more) |
| TC-BRW-23 | BRW-4 | PASS | API+psql | flagged line returned in full: quantities complete, flag_status stays FLAGGED (FLAGGED/2026-11-11 03:57:02.281+08/0) |
| TC-BRW-24 | BRW-4 | PASS | API | return on a closed line 409 RETURN_EXCEEDS_OUTSTANDING; 6 of 5 409; qty 0 / bad condition / duplicate line: 400,400,400; mixed batch with a bad line: 409 and the good line was NOT recorded (outstanding still 5); two simultaneous returns of 3 on 5: 201,409 |
| TC-BRW-25 | BRW-4 | PASS | API | unit returned DAMAGED: item condition DAMAGED, status ACTIVE; quantity item returned DAMAGED: item condition stays GOOD, return event condition DAMAGED |
| TC-BRW-26 | BRW-4 | PASS | API+UI | borrower deactivated after checkout: the return still works (201, borrower active=false); a blocked borrower (Fil, 5 strikes) returned lines through the Return screen and API (FLG-50). The "blocked cannot check out" half is TC-FLG-19 |
| TC-BRW-27 | BRW-5 | PASS | browser | Return screen finds open lines by borrower (name), by item (any case) and by asset tag (any case); matching lines only |
| TC-BRW-28 | BRW-5 | PASS | browser | Return 2 of 5 cord with condition Good: "Return recorded", row shows "Out: 3 of 5"; full return of unit lines with condition choice; request carries the chosen quantity/condition (db conditions checked in BRW-25) |
| TC-BRW-29 | BRW-5 | PASS | browser | flagged lines carry a "Flagged" badge with the word; the borrower header shows "Blocked: 5 strikes" for Fil |
| TC-BRW-34 | BRW-2 | PASS | API | inactive room: handler 409 LOCATION_INACTIVE, admin 409 LOCATION_INACTIVE |
| TC-BRW-35 | BRW-2 | PASS | API | expected return date: yesterday:400, today:201, tomorrow:201, 2099-01-01:201, 2026-13-45:400 (today in Manila = 2026-11-11); Manila-midnight boundary only in the automated faked-clock test |
| TC-BRW-36 | BRW-3 | PASS | API | lookup keys: active,department,id,name,schoolId,type; admin 200; missing/1/101-char q and pageSize 101: 400,400,400,400; viewer 403; signed out 401 |
| TC-BRW-37 | BRW-3 | PASS | API | handler item search returns available for each item, no borrower info (fields: id,name,category,description,trackingType,assetTag,totalQuantity,condition,status,available); UI labels checked in the Checkout sweep |
| TC-BRW-38 | BRW-3 | PASS | browser | closing time 23:30 (set in Settings): Checkout showed "Today by 23:30", "Lines still out at 23:30 are flagged anyway" and the success text "Due back by 23:30 today"; handler 403 on /settings (matrix) |
| TC-BRW-39 | BRW-3 | PASS | browser | at 1000x500 after scrolling, the "Room ... added." notification stays at top 21 px (sticky area); "Checkout not saved" refusal stays at 22 px after 400 px scroll; Return refusal stays at 22 px after 800 and 1600 px scroll; focused field lands below the area |
| TC-BRW-40 | BRW-3 | PASS | browser | after closing (04:06 had passed): Summary "Tomorrow by 04:06", "Lines still out at 04:06 tomorrow are flagged anyway", success "Due back by 04:06 tomorrow"; with closing 23:30 the "Today" wording |
| TC-BRW-41 | BRW-3 | PASS | browser | 320, 400 and 1000 px wide with a 100-char room selected, a 100-char borrower and an item line: no sideways page scroll; room picker inside the window |
| TC-BRW-42 | BRW-5 | PASS | API | open lines: by borrower name 3 (Dan2: 3 open lines, overridden, none returned), by school ID 3, by item (lower case) 1, by asset tag (case-insensitive) 1, page 2 of size 1 -> 1, "%%" matches 0, retired item line listed 1 with flag FLAGGED; fields: lineId,transactionId,borrower,item,location,issuedBy,issuedAt,expectedReturnDate,note,quantityBorrowed,outstanding,flagStatus,flaggedAt,strikes |
| TC-BRW-43 | BRW-5 | PASS | API | handler 200, viewer 403, signed out 401; 1-char q, 101-char q, pageSize 101, page 0, by=nope, NUL in q: 400 VALIDATION_ERROR, 400 VALIDATION_ERROR, 400 VALIDATION_ERROR, 400 VALIDATION_ERROR, 400 VALIDATION_ERROR, 400 VALIDATION_ERROR |
| TC-BRW-44 | BRW-5 | PASS | browser | server refusal (line returned in another session): top message "Return not saved. You entered 4 of <item>, but the amount still out on this line is 2. Nothing was recorded." row aria-invalid=true and focused; (BRW-5 BUG-2 wording fixed) |
| TC-BRW-45 | BRW-5 | PASS | browser | Return with a 100-char borrower/item and a long note at 1280, 1000, 400, 320 px: no sideways scroll; Search field full width on its own line under 640 px (295 px at 400, 215 px at 320) with the button below (BRW-5 BUG-1 fixed) |
| TC-BRW-46 | BRW-5 | PASS | API | 102 borrowers match "REG4-Smith", the only one with an open line sorts last: Return search by borrower finds it (2 open lines, both of Zz) |
| TC-BRW-47 | BRW-5 | PASS | browser | unit line returned elsewhere, then Return clicked: "Return not saved. ... is already fully returned. Nothing was recorded."; reload no longer lists it and focus goes to the Search field; after returning the last cord quantity focus also goes to Search |
| TC-BRW-48 | BRW-5 | N/A | - | N/A: needs more borrowers with open lines than the cap (5,000 in production; the test uses a stand-in) - not practical by hand. Automated only |
| TC-FLG-01 | FLG-1 | PASS | API | Ben: one transaction with one flagged line = 1 strike |
| TC-FLG-02 | FLG-1 | PASS | API | Dan: one transaction, three flagged lines = 1 strike (not 3) |
| TC-FLG-03 | FLG-1 | PASS | API | Eva: two transactions, both flagged = 2 strikes |
| TC-FLG-04 | FLG-1 | PASS | API | Dan2: one transaction with 3 flagged lines (1 strike); overriding the lines one by one: replies 1,1,0 (1 strike until the last flagged line is overridden, then 0) (S7, BR 13) |
| TC-FLG-05 | FLG-1 | PASS | UI+API | Fil (4 strikes in Sample semester): QA-FLG4-Old semester set current via the Settings screen -> Fil 0 strikes on Checkout, Return and the API, Flag review empty; Sample semester set current again -> 4 strikes, flags listed again (S9, MD-33 confirm dialog and focus checked) |
| TC-FLG-06 | FLG-2 | PASS | API+psql | Ana borrowed and returned before closing: line NONE//0, strikes 0 |
| TC-FLG-07 | FLG-2 | PASS | API+psql | Ben kept the laptop: line FLAGGED/2026-11-11 03:57:02.281+08/1, 1 strike; LINE_FLAGGED audit rows for the line: 1 |
| TC-FLG-08 | FLG-2 | PASS | API | Cara: 5 cords, 3 returned, flagged at closing with 2 out (1 strike); returned the last 2: line FLAGGED/2026-11-11 03:57:02.281+08/0, still 1 strike (BR 6) |
| TC-FLG-09 | FLG-2 | PASS | API+psql | Hana borrowed at 03:58 after tonight's closing 03:57: NONE after the run (NONE//1); flagged at the next closing 04:00 (FLAGGED/2026-11-11 04:00:00.01+08/1) |
| TC-FLG-10 | FLG-2 | N/A | - | N/A: needs the API stopped across a closing time; stopping the stack is not allowed in this run (the scheduled run itself was observed firing at 04:00:00 in FLG-13) |
| TC-FLG-11 | FLG-2 | PASS | API | running the job again right after the closing run changed nothing: strikes before {"Ana":0,"Ben":1,"Cara":1,"Dan":1,"Eva":2,"Hana":0,"James":1} after {"Ana":0,"Ben":1,"Cara":1,"Dan":1,"Eva":2,"Hana":0,"James":1}; manual run reply {"run":{"flagged":0,"skipped":false}} |
| TC-FLG-12 | FLG-2 | PASS | API | same live check as FLG-31 (S13): overridden line still out stays OVERRIDDEN after the next closing |
| TC-FLG-13 | FLG-2 | PASS | API+psql | closing time changed to 04:00 through Settings (a future time, so no catch-up): the job fired by itself at that time in Asia/Manila and flagged Hana's line (FLAGGED/2026-11-11 04:00:00.01+08/1); injected clock part is automated only |
| TC-FLG-14 | FLG-2 | N/A | - | N/A: advisory-lock overlap of a scheduled and a manual run needs a held lock; not reproducible live (the manual limiter refused the second run in FLG-15) |
| TC-FLG-15 | FLG-2 | PASS | API | admin run: 200; second admin run within a minute: 429 RATE_LIMITED ("Too many requests. Try again later.", Retry-After 60); handler 403, viewer 403 (first attempt in my sweep looked like 200 because my helper auto-retried the 429) |
| TC-FLG-16 | FLG-2 | PASS | docker logs | api log lines about flagging runs: Flagging run at 2026-11-10T19:38:46.555Z: {"flagged":0,"skipped":false} // Flagging run at 2026-11-10T19:53:23.618Z: {"flagged":0,"skipped":false} // Flagging run at 2026-11-10T19:53:23.907Z: {"flagged":0,"skipped":false} // Flagging run at 2026-11-10T19:57:02.281Z: {"flagged":11,"skipped":false} // Flagging run at 2026-11-10T19:57:11.306Z: {"flagged":0,"skipped":false} // Flagging run at 2026-11-10T19:58:11.790Z: {"flagged":0,"skipped":false} / audit: FLAG_OVERRIDDEN/13;  |
| TC-FLG-17 | FLG-3 | PASS | browser | Fil at 3 strikes: Checkout shows "Warning: 3 strikes. ... has 3 flagged checkouts this semester. Checkout is allowed." and the checkout was saved |
| TC-FLG-18 | FLG-3 | PASS | browser | Fil at 4 strikes: "Notice: 4 strikes. ... Checkout is allowed, but at 5 strikes ... will be blocked from borrowing." and the checkout was saved |
| TC-FLG-19 | FLG-3 | PASS | browser | Fil at 5 strikes: API 409 BORROWER_BLOCKED ("An admin can override a flag to unblock them."), Checkout screen shows "Blocked: 5 strikes ..." and Confirm is disabled with "Checkout is blocked for this borrower (5 strikes)." |
| TC-FLG-20 | FLG-3 | PASS | browser | thresholds saved as 2/3/4 in Settings: with Fil at 4 strikes the Checkout screen and API (BORROWER_BLOCKED) treat 4 as blocked; restored to 3/4/5; with 6 the open-lines reply carries block 6 (TC-FLG-58) |
| TC-FLG-21 | FLG-3 | PASS | browser | Checkout for borrowers at 3, 4 and 5 strikes: warning banner, stricter notice banner, blocked message (see FLG-17 to 19) |
| TC-FLG-22 | FLG-4 | PASS | API+UI | flag list (James already overridden above; Fil/Emp lines from the earlier flow) fields: lineId,transactionId,borrower,item,issuedAt,flaggedAt,quantityBorrowed,outstanding,strikes,note,expectedReturnDate; the screen shows Borrower, Item, Issued, Flagged, Now, Note, Expected return (note and date visible, e.g. "REG4 returning tomorrow" 12 Nov 2026 in the earlier screen dump) |
| TC-FLG-23 | FLG-4 | PASS | API | reason 4 chars: 400; 501 chars: 400; 2 chars plus spaces: 400; 5 chars: 200 |
| TC-FLG-24 | FLG-4 | PASS | API+psql | override before return (Ben, still out) 200 and after return (Cara, fully returned) 200 (OVERRIDDEN): both OVERRIDDEN with override_by/at/reason; audit rows 1 each |
| TC-FLG-25 | FLG-4 | PASS | API | handler 403, viewer 403, signed out 401 |
| TC-FLG-26 | FLG-2 | N/A | - | N/A: fake clock needed (automated only); a real scheduled run at the set closing time was observed in FLG-13 |
| TC-FLG-27 | FLG-2 | PASS | API | closing was 17:00 and at 03:32 (after that new time had passed) an admin saved 03:32: PUT /api/settings flagged the lines issued before it at once (Fil 3 strikes seconds later, no manual run). Repeated at 03:34, 03:35, 03:57, 04:06 |
| TC-FLG-28 | FLG-2 | N/A | - | N/A: needs the lock held at closing time (automated only) |
| TC-FLG-29 | FLG-2 | N/A | - | N/A: needs the API stopped over days (automated only) |
| TC-FLG-30 | FLG-2 | N/A | - | N/A: needs a throwing scheduled run (automated only) |
| TC-FLG-31 | FLG-4 | PASS | API | James line (S4 / S13): flagged, overridden while still out (OVERRIDDEN); after the next closing ran it is OVERRIDDEN (not flagged again) and still out: OVERRIDDEN/2026-11-11 03:57:02.281+08/5 |
| TC-FLG-32 | FLG-4 | PASS | API | override a NONE line 409 LINE_NOT_FLAGGED, an already overridden line 409 LINE_NOT_FLAGGED, unknown id 404 NOT_FOUND; no extra audit rows (0, 1) |
| TC-FLG-33 | FLG-4 | PASS | API | two simultaneous overrides of one line: 200 / 409 LINE_NOT_FLAGGED; audit rows 1 |
| TC-FLG-34 | FLG-4 | PASS | API | with the other semester current: flag list total 0, Zz strikes 0; back on Sample semester: 14 flagged lines again (the old flags are kept). The "no current semester" half is automated only (cannot be reached live) |
| TC-FLG-35 | FLG-4 | PASS | API | 101 borrowers named "REG4-Smith 001..101" sort before the flagged "REG4-Smith ZZZ": flag search for "REG4-Smith" still finds the flagged one (total 2, borrowerSearchSkipped false) |
| TC-FLG-36 | FLG-4 | N/A | - | N/A: needs more flagged borrowers than the name-search cap (production cap is large); automated only |
| TC-FLG-37 | FLG-4 | PASS | API | Eva2 (2 transactions): list shows strikes 2,2 and blockThreshold 5; override replies 1 then 0 (2 -> 1 -> 0) |
| TC-FLG-38 | FLG-4 | N/A | - | N/A: calls the internal functions countStrikesForBorrowers and countStrikes; live equivalence (list/open-lines strikes = /strikes endpoint for every borrower) is TC-FLG-59 |
| TC-FLG-39 | FLG-4 | PASS | browser | Flag review shows "1 strike", "2 strikes", "4 strikes" and "5 strikes · blocked"; Issued and Flagged times are Manila ("11 Nov, 03:34"). The text "3 strikes" itself was not on screen but uses the same wording |
| TC-FLG-40 | FLG-4 | PASS | browser | override then a forced failed reload ("Something went wrong." with Retry): after Retry focus goes to the search field |
| TC-FLG-41 | FLG-4 | PASS | browser | Run flagging now: Cancel sent nothing; confirm: "Flagging run finished. 0 lines flagged."; again at once: "Flagging was run less than a minute ago. Try again in 58 seconds."; reopening the dialog no longer shows the old refusal; dialog described by run-flagging-help |
| TC-FLG-50 | FLG-3 | PASS | browser | Fil blocked at 5 strikes returned his lines through the Return screen (Lost and Retired item lines, 2 of 5 cords): "Return recorded"; Return buttons stay enabled for blocked borrowers |
| TC-FLG-51 | FLG-3 | PASS | browser | Fil at 5 strikes: one flag overridden on Flag review ("Fil now has 4 strikes."), checkout works again (201) |
| TC-FLG-52 | FLG-3 | N/A | - | N/A: calls isEligible with a semester id (automated only); live equivalent is the semester switch-back in TC-FLG-05 |
| TC-FLG-53 | FLG-3 | PASS | API | strikes endpoint: viewer, unknown id, bad id, signed out = 403,404,400,401; Zz strikes 2 |
| TC-FLG-54 | FLG-3 | N/A | - | N/A: no current semester cannot be reached live (the system always keeps one) |
| TC-FLG-55 | FLG-3 | N/A | - | N/A: needs two database transactions racing on the borrower row (automated only) |
| TC-FLG-56 | FLG-3 | PASS | browser | Return screen for a borrower at 5 strikes: badge "Blocked: 5 strikes" shown with 0 requests to /strikes (resource entries); all Return buttons enabled |
| TC-FLG-57 | FLG-3 | PASS | browser | /strikes forced to 500 on Checkout: "Something went wrong." with Retry, "0 strikes" is not shown; after Retry the real count shows. (Confirm checkout stays enabled meanwhile: the server still enforces the block) |
| TC-FLG-58 | FLG-3 | PASS | API | with block threshold set to 6 the open-lines reply carries warning/notice/block 3/4/6 and a strikes number on each of 25 lines (thresholds restored) |
| TC-FLG-59 | FLG-3 | PASS | API | strikes on 25 open lines (13 with strikes>0) equal /borrowers/:id/strikes for all 12 borrowers: no mismatch (no-current-semester half: automated only) |
| TC-SEC-01 | SEC-1 | PASS | API | 80 parallel GETs: {"200":31,"429":49}; 429 body {"error":{"code":"RATE_LIMITED","message":"Too many requests. Try again later.","details": Retry-After 1 (login limit 429 JSON + Retry-After 12 seen in the browser run; CSV part N/A: MD-6 not built) |
| TC-SEC-02 | SEC-1 | PASS | API | 200 KB body to /api/auth/login: 413 application/json |
| TC-SEC-03 | SEC-1 | PASS | sockets | 30 connections held open (headers sent, body never finished): the next 6 requests from this IP: 429,429,429,429,429,429 (429 JSON RATE_LIMITED, Retry-After 1); after closing them: 200 |
| TC-SEC-04 | SEC-1 | PASS | curl | JS asset Cache-Control: "public, max-age=31536000, immutable" (one header); index.html Cache-Control: "no-cache" |
| TC-SEC-05 | SEC-1 | PASS | API | 70 searches ?q=ab at ~9/s: {"200":60,"429":10} (search limiter 60/min per IP; global 600/min cannot be reached through nginx 10 r/s: automated only) |
| TC-SEC-06 | SEC-1 | PASS | API | 40 searches with a different spoofed X-Forwarded-For each: {"200":40} (all counted against the real IP; the limit of 60/min is shared with SEC-05, which ran a minute earlier). Two genuinely different client IPs: not testable on one PC |
| TC-SEC-07 | SEC-1 | PASS | code | code check apps/api/src: apps/api/src/server.ts:8:  server.headersTimeout = 15_000; // apps/api/src/server.ts:9:  server.requestTimeout = 30_000; // apps/api/src/server.ts:10:  server.keepAliveTimeout = 5_000; |
| TC-SEC-08 | SEC-1 | N/A | - | N/A: unhandled rejection/exception exit and INTERNAL_ERROR without internals are automated-only (cannot be provoked live without breaking the running API) |
| TC-SEC-09 | SEC-1 | PASS | docker exec | 200 KB POST from inside the api container straight to Express: 413 {"error":{"code":"PAYLOAD_TOO_LARGE","message":"The request is too large.","deta |
| TC-SEC-10 | SEC-1 | PASS | API | live probes {"ps100":200,"ps101":400,"q2":200,"q100":200,"q101":400}; quantity 0/10000/10001, 50/51 lines, note 500/501, thresholds 1/100 and closing-time limits were probed in the BRW/MD sweeps above (all as specified); override reason 4/5/501 in FLG-23; report range and CSV rows: N/A not built |
| TC-HRD-09 | HRD-6 | PASS | npm (clone) | `npm run build` in the clean clone: no chunk-size warning; Home, ChangePassword, Rooms, Borrowers, FlagReview, Settings, Return, Inventory, Checkout are separate chunks; entry chunk 479 kB |
| TC-HRD-10 | HRD-6 | PASS | browser | all 7 routes (/, /inventory, /borrowers, /rooms, /settings, /password, /login) plus /checkout, /return, /flags rendered inside the app shell in the browser pass; component tests not run |
| TC-HRD-11 | HRD-6 | PASS | browser | after sign-in only index, Alert and HomePage chunks are loaded; each menu item fetched its own chunk on first visit (Checkout, Return, FlagReview, Inventory, Borrowers, Rooms, Settings) and a revisit fetched nothing new |
| TC-DOC-01 | DOC-1 | PASS | doc | every ticket ID in docs/BACKLOG.md appears in the TEST_CASES Ticket column; "FND-30" appears in BACKLOG only as the case ID TC-FND-30 (the ticket is FND-7) |
| TC-DOC-02 | DOC-1 | PASS | doc | coverage table lists BR 1 to 16 and S1 to S23 each with at least one case |
| TC-DOC-03 | DOC-1 | N/A | doc | N/A for the run itself: `npm test` shares the test database the automated tester is using, so I did not run it. File check: all test files named in "Automated by" exist on main (the entries "packages/shared/src/limits.test.ts" and "apps/web/src/pages/*.test.tsx" are written with a path or glob, not the short legend form) |

## Totals
In-scope IDs: 207. PASS 184, FAIL 0, N/A 23. Rows written: 207 (every in-scope ID has a row; 31 IDs of unbuilt tickets are out of scope and have none).
N/A cases and why (23): FND-01 (npm install, lint, typecheck, build passed; `npm test` not run), FND-06 (needs stack restart), FND-18 and FND-20 (seed re-runs need a scratch or empty database), AUTH-09, AUTH-13, AUTH-34 (timing, hash queue full, limiter key length: automated only), MD-14 (test double), BRW-09 (no zero-semester state reachable), BRW-48 and FLG-36 (cap stand-ins), SEC-08 (provoking an unhandled exception), FLG-10, FLG-14, FLG-26, FLG-28, FLG-29, FLG-30 (API down, held lock, fake clock, throwing run), FLG-38 (internal functions), FLG-52, FLG-54, FLG-55 (internal calls, no-semester state, racing transactions), DOC-03 (`npm test`).
Cases the owner asked me to mark N/A for a restart: TC-FND-06 (down/up persistence; data is on the named volume `borrowersmonitoringsystem_db-data`). Please run it yourself.

## Additional tests run (outside single TC rows)
- Sprint 4 flow end to end (see Headline results), including the real scheduled run at 04:00 and the S10 and S13 scenarios.
- Worked scenarios S1 to S13 by hand through the API: Ana (returned before closing, 0 strikes), Ben (1), Dan (3 flagged lines = 1 strike), Eva (2 transactions = 2), Cara (5 cords, 3 returned, flagged with 2 out, rest returned, flag stays, 1 strike), James (note and expected date do not stop the flag; overridden while still out; not flagged again), Hana (checkout after closing, flagged at the next closing).
- Two simultaneous overrides of one line: one 200, one 409 LINE_NOT_FLAGGED, one audit row. Two simultaneous returns of 3 on 5 outstanding: 201 + 409. Three simultaneous checkouts of one unit: one 201, two 409.
- 102 borrowers named "REG4-Smith ...": the one flagged / open-line borrower sorting last is still found by Flag review and Return searches.
- Permission matrix: 27 endpoints x 3 roles (81 calls) plus flagging/run and signed-out calls: every refusal is 403, signed out is 401 everywhere.
- Login throttling: per user+IP limit (429 after 9 to 10 failures, real accounts unaffected), per-IP limit of 30 (header `ratelimit: "30-in-15min"` counted down to 0, then 429, then a brand-new username also refused), nginx login limit (5/min), 429 text in the page "Too many requests. Try again in 12 seconds."
- nginx: 80 parallel requests, 30 held-open connections (6 further refused with 429), 200 KB body (413 JSON), 20 KB header (400), cache headers, spoofed X-Forwarded-For does not bypass the limit.
- Forced failures with request interception: categories list 500 (Retry works), flag list reload 500 after an override (Retry, focus to search), strikes 500 on Checkout (Retry, no "0 strikes").
- HTML in a borrower name is shown as text; school ID is trimmed; room, category and borrower names of 100 characters wrap without widening the page.
- Seed state, constraints and audit rows checked in the dev database (13 tables, 7 enum types, argon2id hashes only, audit rows for every change type with the actor; system flagging rows have no actor).

## Defects
No new defects found. All eight earlier fixed bugs stay fixed. (One unreproducible focus observation is under Observations.)

## Observations (not bugs)
1. Inventory "Name" column is only about 100 px wide at 1000 px (the table gives the 8 columns similar widths), so a 24-character name like "REG4-Extension cord, 5 m" takes 3 lines (it breaks after "REG4-" and at the spaces) at 1000, 400 and 320 px. No word is split in the middle and nothing overflows, but TC-MD-35 says "Extension cord, 5 m stays on one line", which is only true for short names. I marked MD-35 PASS on the no-overflow and no-mid-word-split parts; owner may want the wording changed or the Name column widened.
2. When the strikes request fails on Checkout the page shows "Something went wrong. Retry", but "Confirm checkout" stays enabled. The server still enforces the block, so no wrong checkout is possible; it only means the handler sees the refusal after pressing Confirm.
3. Home page still says "Checkout, returns, and reports will appear in the menu as they are built." although Checkout, Return and Flag review exist (known from earlier rounds).
4. After "Checkout saved" the strike banner from before the checkout (for example "Warning: 3 strikes") stays on screen under the success message until "Start a new checkout" is pressed. The count is not updated until the next flagging run anyway, so it is correct, just visually busy.
5. A native date field (expected return date) cannot be typed into with headless key events; I set it with a script, so TC-BRW-19 did not fill that field by keyboard.
6. One first press of "Confirm checkout" (BRW-3 BUG-3 check) left focus on BODY instead of the borrower search; 16 other presses, including 12 immediately afterwards, behaved correctly. Probably my script clicking before the lazily loaded Checkout chunk finished wiring up; noted in case it shows up again.
7. Flagging a borrower to 5 strikes needs 5 separate transactions; each separate flag run was triggered by moving the closing time to the current minute, which works (S22) and shows the "moved earlier" catch-up path clearly. The manual "Run flagging now" button is limited to once a minute for everyone (a second press shows "Flagging was run less than a minute ago. Try again in N seconds.").
8. After the keyboard-only checkout the focus lands on "Start a new checkout"; after cancelling the "Set as current" dialog from a script click, focus was on the top of the page (the click came from a script that never focused the button; a real keyboard Cancel was not separately measured).
9. The Return screen shows a "Quantity item" label under the item name and a "Flagged" badge; there is no column header row (mockup has one, noted in the BRW-5 report).

## Coverage limits / not done
- `npm test` (automated suite) was not run by me: it shares the test database with the automated tester. Lint, typecheck and build passed on a clean clone of d2b6531.
- Needed a restart, a stopped API or a fake clock: FND-06, FLG-10, FLG-14, FLG-26, FLG-28, FLG-29, FLG-30 (see N/A list). The scheduled run itself was observed live once (FLG-13).
- Seed re-run and production seed (FND-18, FND-20) need a database I may not touch. The hidden-prompt password reset (FND-21) was only checked for its non-interactive refusal.
- Two genuinely different client IPs (AUTH-10/SEC-06 other-IP halves), 503 SERVER_BUSY, the Manila-midnight date boundary, a state with no current semester: not reachable by hand.
- BRW-48 / FLG-36 caps: no way to create thousands of borrowers by hand.
- Screens were compared with the mockup by behaviour and wording; I did not re-open the mockup's project files this run (the Artifact read returned only the wrapper).
- Screen pass is headless Edge only (no real phone or other browsers). The "Loading..." text on a slow network was not re-captured.
- Fixed-window quirk: the per-IP login limit (30 failures per 15 minutes) uses a fixed window, so a run of failures that straddles the window start needs topping up (my first AUTH-11 attempt did exactly that). This is how the limiter is built, not a defect.
- After the AUTH-11 test this PC cannot sign in through nginx for up to 15 minutes (existing sessions are not affected). Sign-in with all three QA accounts was re-verified before that test.

## Test data and cleanup (left in the dev database)
Created, all prefixed "REG4-" and now inactive/retired (nothing deleted if it has history):
- 2 categories: REG4-Cat and REG4-LongCat-AAAA... (100 characters). Both hold retired items, so they cannot be deleted. The categories I created only for CRUD checks were deleted.
- 58 items (units with asset tags, quantity items, lost / retired / under-repair variants, a 100-char one), all RETIRED. A few more were created and deleted again in the delete checks.
- 118 borrowers (students, employee, faculty, 102 "REG4-Smith ..." search-bound names, an inactive one, an HTML-in-name one, a 100-char one), all deactivated.
- 6 rooms/labs, all inactive: REG4-Lab 1, REG4-Quick-86242, REG4-UIRoom 367, REG4-Sticky 33563, REG4-Inactive room 72681, REG4-LongRoom-AAAA... (100 characters). Temporary rooms for CRUD checks that had no history were deleted.
- 3 semesters that cannot be deleted: "REG4-Sem B 86242", "reg4-sem a 86242", "REG4-Next 86242" (none current; Sample semester is current).
- 51 REG4 transactions, all lines returned. 13 lines are still FLAGGED (kept as history; their borrowers are deactivated). They still appear on the Flag review screen and the admin can override them if a clean list is wanted; I did not, to avoid more audit rows.
- Audit rows for all of the above, session rows from many sign-ins, one extra audit trail of settings changes (SETTINGS_UPDATED) and flagging runs. QA accounts' passwords unchanged (viewer was changed twice and changed back).
- Scratch files: D:\edgetmp-reg4 (scripts, results.json, small screenshots, the clean clone and node_modules). Please delete the folder when done. The Edge profiles were removed after each run (taskkill /T /F, folder deleted); no edge-* profile folders are left in the temp folder.
