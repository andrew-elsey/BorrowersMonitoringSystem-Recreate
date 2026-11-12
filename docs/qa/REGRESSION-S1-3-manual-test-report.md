# REGRESSION-S1-3 Manual Test Report
Date / build or commit: 2026-11-07, main at 995c803 (BRW-3 checkout UI, BRW-4 return API and SEC-1 edge limits merged together), stack rebuilt by the owner, not by QA.
Environment: docker compose stack at http://127.0.0.1:8080 (web, api, db healthy). Node 24 scripts (API, cookie jars) and headless Edge driven over CDP (own profile on D:, killed with its process tree and deleted). Windows 11. Dev database used as it was; all new records prefixed "REG-".
Verdict: PASS (no High or Medium defects; 1 Low deviation and several observations)

Mockup comparison: the Artifact read of https://claude.ai/artifact/9FampTJnZj8twygeqD8iao returned only the type wrapper; I read `project/Checkout.dc.html` as a file and compared wording and layout with the app (matches: headings "1. Borrower / 2. Room or lab / 3. Items", "Where will the items be used?", "+ Add a new room or lab", "Add and select", table columns, Summary rows, "Checkout saved.", "Checkout not saved. ... Nothing was issued.", "Inactive borrower. ... An admin can reactivate ...", "Due back Today/Tomorrow by 17:00", note under the lines). Known accepted differences only (no strike banners yet, FLG-3; Out row without borrower name, TC-BRW-37; the trailing sentence "Fix the line marked below and try again." is not in the app's banner).

Environment warning (not an app defect): the C: drive of this PC was at 0 MB free when I started (223G of 223G used) and stayed near 100 percent (about 500 MB free at the end). My first headless run died with "Disk full". Postgres and the api kept working, but a full disk can corrupt writes, so please free space on C:. I put the browser profile on D:.

## Acceptance criteria results (by area)
| # | Area | Result | Notes |
|---|---|---|---|
| 1 | Sign-in, sign-out, change password, throttle, no anonymous session (AUTH) | Pass | Details below |
| 2 | Screens, menu and route access per role, 403 format | Pass | Matrix below |
| 3 | Master data round trips | Pass | Categories, items (UNIT and QUANTITY), borrowers, rooms, semesters, settings |
| 4 | Checkout in browser, return API, availability | Pass | One Low deviation (BUG-1) |
| 5 | SEC-1 at the edge | Pass | 413 JSON, 429 JSON with Retry-After, search 60/min, lookup unlimited |
| 6 | Keyboard, focus on errors, error format | Pass | Observations only |

## 1. AUTH (all three roles)
- Sign-in through the UI works for admin, qa-handler (HANDLER) and qa-viewer (VIEWER). No forced password change. Empty submit shows "Enter your username." / "Enter your password." and focus goes to Username. Wrong password: "Incorrect username or password." Tab order on the sign-in page: username, password, Sign in.
- Anonymous visitors: `GET /` and `/login` set no cookie. Anonymous `GET` on items, borrowers, rooms, settings, semesters, categories, auth/me: 401 UNAUTHENTICATED, no Set-Cookie. Failed login and validation error: no Set-Cookie. Anonymous `POST /auth/logout` returns 204 and only sends an expiring cookie (no session created). A page deep link (`/inventory`) while signed out goes to `/login`.
- State-changing call without `X-Requested-With: fetch`: 403 FORBIDDEN "Missing the X-Requested-With: fetch header." (login included).
- Sign-out: `/login`, `GET /api/auth/me` 401 afterwards, browser Back stays on the sign-in page. A session killed on the server while a page is open: the next action redirects to the sign-in page (checked on Borrowers).
- Change password (UI, as qa-viewer): empty submit shows "Enter your current password." and "Too short: 0 of at least 10 characters."; 5 characters shows "Too short: 5 of at least 10 characters." (focus on New password); mismatch shows "The two new passwords do not match." (focus on Confirm); wrong current shows "The current password is incorrect." (focus on Current password); success shows the success message and clears the three fields. I changed the password and changed it back; qa-viewer signs in with QA_PASSWORD again. Same checks by API: 400 VALIDATION_ERROR with `details.fields`.
- Throttle (UI, username `reg-flood`): nginx stage "Too many requests. Try again in 12 seconds." (429 JSON, Retry-After 12); after 10 failures the Express stage "Too many failed sign-in attempts. Try again in 809 seconds." counting down; the real accounts were unaffected afterwards (BR 16, admin/handler/viewer logins still 200).

## 2. Role matrix (API, A = admin, H = handler, V = viewer)
| Call | A | H | V |
|---|---|---|---|
| GET items (also with q) | 200 | 200 | 200 (owner decision 2026-11-03) |
| POST/PATCH/DELETE items | 400/404 (allowed) | 403 | 403 |
| GET/POST/PUT/DELETE categories | allowed | 403 | 403 |
| GET /borrowers, POST/PATCH borrowers | allowed | 403 | 403 |
| GET /borrowers/lookup | 200 | 200 | 403 |
| GET /rooms, POST /rooms (quick add) | allowed | allowed (active rooms only) | 403 |
| PATCH/DELETE rooms | allowed | 403 | 403 |
| settings and semesters (GET, PUT, POST, current) | allowed | 403 | 403 |
| POST /transactions, POST /returns | allowed | allowed | 403 |
| GET /closing-time | 200 | 200 | 200 |
All refusals use `{"error":{"code":"FORBIDDEN","message":"You do not have permission to do this.","details":{}}}`. Unknown API path: 404 NOT_FOUND JSON.

UI menu and routes: viewer sees Home and Change password; handler adds Checkout; admin adds Inventory and categories, Borrowers, Rooms and labs, Settings and semesters. Forbidden routes show "You can't open this page. Your role, <role>, does not have access to <page>. ..." (viewer: checkout, inventory, borrowers, rooms, settings; handler: inventory, borrowers, rooms, settings). `/password` opens for all three. Unknown route `/nope` goes to Home.

## 3. Master data round trips
- Categories (API and UI): add, duplicate in another case (409 DUPLICATE_VALUE, shown under the field), empty, whitespace, 201 characters, control character; rename in a dialog (duplicate refused inside the dialog, Enter saves, Escape closes and focus returns to the row's Rename button); a category in use has an aria-disabled Delete with "Used by N items"; an unused one deletes after the confirm dialog.
- Items: UNIT needs a unique asset tag (duplicate in other case 409, empty/missing 400, quantity 2 400); QUANTITY: 0 accepted, -1, 10001, 1.5, "abc", empty refused with "Enter a whole number from 0 to 10,000."; QUANTITY with a tag refused; tracking type cannot change on PATCH; edit dialog (Enter saves, Escape closes); status, tracking and category filters; search of 1 and 101 characters refused (400); page size 0, 101 and page -1 refused. Delete without history works; delete with history gives "Cannot delete REG-LT-1. This item appears in past transactions. Set its status to Retired instead." with a working Retire link (HAS_HISTORY, S19).
- Borrowers: add, edit, duplicate school ID in other case (409), empty form shows 4 errors with focus on the first, bad type; Type and Status filters, search; deactivate, reactivate, inactive shown in lookup with "Inactive".
- Rooms: add, duplicate (case), empty, rename dialog, deactivate, reactivate; handler list shows only active rooms (REG-Room C inactive: not visible to the handler); delete with history is disabled ("Used in N transactions"); delete without history works; quick-add at checkout (see 4).
- Semesters and settings: add; duplicate name 409; overlap 409 SEMESTER_OVERLAP (end date equals start of another); end before start 400; empty form 3 errors with focus on the first; set REG-Sem current (confirm dialog, Escape leaves it unchanged), edit the current one, switch back to "Sample semester" (exactly one current at all times). Settings: 4/4/5, 3/5/4, 0, 101, 2.5-type values, closing time 24:00, "5pm", empty all refused with clear text and focus on the offending field; valid save "Settings saved." (values restored to 17:00, 3, 4, 5).

## 4. Checkout and returns
Browser, as qa-handler:
- Borrower lookup (min 2 characters; 1 character shows no search; no match shows "No borrower matches ..."); results show name, school ID, type, department; inactive borrower shows "Inactive borrower. ... An admin can reactivate the record in Borrowers." and Confirm is disabled.
- Room picker lists active rooms only; "+ Add a new room or lab": empty ("Enter a room or lab name."), duplicate ("\"REG-Room A\" already exists. Names are compared without regard to case."), then a new room is created and selected (created by QA Handler).
- Item search shows availability: "8 available", "Available", "Out" (Add disabled), "Under repair" (Add disabled), "0 available" (Add disabled). After a partial return of 1 of 2 cords the list shows "7 available".
- Lines: unit line has fixed quantity 1; quantity checks "", 0, -1, 1.5 each give "Enter a whole number from 1 to 10,000." with focus on the field; 9 of 8 gives server error marked on the line ("Only 8 available"); expected return date in the past is refused ("Choose today or a later date.", focus on the date field); note and date saved (verified in the database: note "REG note UI", date 2026-11-09).
- Empty Confirm: three messages, focus on the borrower search on the first press (BRW-3 BUG-3 still fixed).
- Confirm with a double click in the same tick: exactly one transaction created (checked in the database), message "Checkout saved. 2 items issued to REG Student Edited for REG-Room Q at 18:20. Due back by 17:00 tomorrow. Start a new checkout" (18:20 Manila is after closing, so "tomorrow" is correct, S10), focus on "Start a new checkout".
- Stale availability: another user took 3 cords after the lines were added; Confirm shows "Checkout not saved. Only 4 of REG-Cord available, 7 requested. Nothing was issued." and marks the line "Only 4 available", nothing issued.
- Layout: page width equals window width (no horizontal scroll) at 1000, 400 and 320 px, empty and with lines and an error (BRW-3 BUG-1 and BUG-2 still fixed). Also no horizontal scroll at 1000 and 400 px on Home, Inventory, Categories, Borrowers, Rooms, Settings, Change password.
- Keyboard only: skip link, menu, borrower search, Tab to "Choose", Enter, room select with ArrowDown, item search, Add, line fields, Remove, Confirm all reachable in a sensible order.

API (`POST /api/transactions`, `POST /api/returns`):
- Handler checkout of a unit plus 3 of 8 cords: 201, `issuedById` is the handler, semester is the current one. Same unit again: 409 ITEM_UNAVAILABLE "REG-Laptop REG-LT-1 is already borrowed."; 6 of 5: 409 INSUFFICIENT_QUANTITY with `details.available`; 5 of 5 ok then 1 of 0: 409; total-0 item: 409; quantity 0, -1, 1.5, "2", 10001, null: 400; unit quantity 2: 400; same item twice: 400; 0 lines and 51 lines: 400; yesterday: 400 on `lines.0.expectedReturnDate`; note of 501: 400; unknown borrower, room, item: 404; inactive borrower: 409 BORROWER_INACTIVE; inactive room: 409 LOCATION_INACTIVE for handler and admin; UNDER_REPAIR item: 409 ITEM_UNAVAILABLE. Viewer: 403.
- Concurrency: 3 simultaneous checkouts of one unit: one 201, two 409 ITEM_UNAVAILABLE.
- Returns: partial 1 of 3 by handler (outstanding 2, receiver = handler), 1 by admin (receiver = admin), last 1 as DAMAGED on a QUANTITY item (item condition unchanged, S17); 4 of 3: 409 RETURN_EXCEEDS_OUTSTANDING; on a closed line: same; quantity 0/-1, bad condition, same line twice, empty: 400; unknown line 404; a batch with one bad line records nothing (atomic); unit returned DAMAGED sets the item to DAMAGED with status ACTIVE; viewer 403. Availability on the Checkout and Inventory API (`available`) updated after every return.

## 5. SEC-1 at the edge
- 413 JSON `{"error":{"code":"PAYLOAD_TOO_LARGE","message":"The request is too large.","details":{}}}` (content-type application/json) for bodies of 102,500 B, 200 KB and 2 MB on POST items, transactions, returns and PUT settings, and for a 200 KB text/plain body. 101,000 B and 99 KB bodies pass nginx (the limit is 100 KiB = 102,400 B).
- 70 parallel `GET /api/auth/me`: 30 x 200, 40 x 429 JSON `RATE_LIMITED` with `Retry-After: 1`. 70 parallel `GET /` all 200. Health 200.
- Search limit: 65 requests `GET /api/items?q=ab` in about 9 seconds: requests 1 to 60 are 200, 61 to 65 are 429 JSON (application/json, `RATE_LIMITED`, `Retry-After: 51`). The admin borrower list has its own bucket (200 right after).
- Owner decision: 70 requests to `GET /api/borrowers/lookup?q=ana` as handler in 9 seconds: all 200. Admin lookup, items without `q` also never limited.
- Login: nginx 429 JSON with Retry-After 12 and Express 429 as above.

## 6. Keyboard, focus and error format
- Focus goes to the first invalid field on empty or invalid submit for sign-in, change password, add item, add category, add borrower, add room, settings, semester form, new-room form at checkout. After closing a dialog with Escape focus returns to the row button that opened it (categories, rooms, borrowers, items, semesters). Enter submits dialogs.
- API errors always use `{"error":{"code","message","details"}}`; field errors under `details.fields`; stable codes seen: VALIDATION_ERROR, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, DUPLICATE_VALUE, SEMESTER_OVERLAP, ITEM_UNAVAILABLE, INSUFFICIENT_QUANTITY, BORROWER_INACTIVE, LOCATION_INACTIVE, RETURN_EXCEEDS_OUTSTANDING, RATE_LIMITED, PAYLOAD_TOO_LARGE. Malformed JSON: 400 "The request body could not be read."

## Regression of earlier fixed bugs
BRW-3 round-1/2/3 BUG-1 (sideways scroll), BUG-2 (long room name; checked only through the 320 to 1000 px widths, no long-name room selected this time) and BUG-3 (first empty Confirm focus): still fixed. MD-7 BUG-1 wording ("Strikes count only in the current semester. Flags from other semesters stay in history.") still present. MD-2 delete/retire flow still works. BRW-4 returns behave as in its report. No regression found.

## Defects
### BUG-1: Checkout success and failure banners are not in the sticky message area
- Severity: Low (could also be argued as a documented design choice)
- Ticket: BRW-3 (ARCHITECTURE 14.1 "the shared message area ... is pinned ... so success and error messages stay visible on long pages", TC-BRW-39)
- Steps to reproduce:
  1. Sign in as qa-handler, open Checkout at 1000 x 700 (or 400 x 700).
  2. Choose a borrower and a room, add REG-Cord, enter quantity 99, press Confirm checkout.
  3. Scroll the page down a few hundred pixels.
- Expected: the message "Checkout not saved. ..." (and, after a save, "Checkout saved. ...") stays pinned at the top of the window like the notifications (for example "Room ... added.").
- Actual: the banners are inline under the "Checkout" heading (`CheckoutPage.tsx`), so they scroll away: the shared sticky area (`[aria-live=polite]`, position sticky, top 0) is empty (height 0) and the banner's top is at -428 px after scrolling 600 px at 1000 px wide (-203 px at 400 px wide). Only "Room ... added" style messages use the sticky area.
- Impact is small: after an error focus moves to the failing field, which shows its own message, and after a save focus moves to "Start a new checkout".
- Role / data used: qa-handler; REG-S1 borrower, REG-Room Q, REG-Cord.

## Observations (not bugs)
1. Raw validation text for missing fields reaches API clients, for example `POST /api/auth/login {}` gives "Invalid input: expected string, received undefined", `PUT /api/auth/password {}` the same, `PATCH /api/items/not-a-uuid` gives "Invalid GUID", `POST /api/items` with `[]` or a text/plain body gives "Some fields are invalid." with an empty `fields` object. The UI never triggers these (same class as MD-2 BUG-2 and MD-3 observations).
2. `PUT /api/auth/password` ignores `confirmPassword` (the check is only in the browser); the card says the API gets only current and new password, so this is by design. A new password equal to the current one is accepted.
3. Checkout and returns validation errors for a bad quantity, date format or note all come back keyed on `lines` (not `lines.0.quantity`), except the past expected date which is `lines.0.expectedReturnDate`. The UI copes (it marks the line), BRW-5 may want the path (same as BRW-4 observation 1).
4. After a server refusal (for example "Only 8 of REG-Cord available, 9 requested") the red banner stays when the quantity is edited to another invalid value; it clears only on the next successful submit.
5. Wording: the mockup banner ends with "Fix the line marked below and try again."; the app shows only "Nothing was issued." The return error reads "Only 3 of REG-Cord still out, 4 returned." although nothing was returned (the number is the requested quantity).
6. A one-character search on Borrowers shows the full list instead of a hint about the 2-character minimum.
7. The SPA pages served by nginx (`GET /`) carry no security headers (helmet applies to API responses only: CSP, X-Frame-Options, nosniff). Not in any acceptance criterion; mention for HRD tickets.
8. DAMAGED items can still be checked out and a GOOD return never repairs the condition (BRW-4 owner question still open). Returns at 5 strikes (TC-BRW-26 by hand), flagging, strike banners and blocking were not testable (FLG-2, FLG-3 not built).
9. Home page text for all roles still says "Checkout, returns, and reports will appear in the menu as they are built."
10. The checkout was completed after closing time (18:20 Manila) so the "Tomorrow by 17:00" wording and S10 were exercised for real.

## Not tested
- `npm test`, lint, typecheck, build (not asked). Playwright suite.
- Two genuinely different client IPs limited independently (one PC).
- Strikes, flagging, override, blocked borrower in the browser (features not built). Returns after end of day (no flagging job yet).
- CSV import, Users screen, Reports, Return screen, Audit log (do not exist yet).
- A checkout with a 100-character room name was not repeated this round (covered in BRW-3 round 3).
- Slow-network and screen reader behaviour; the table body below the fold at 320 px.

## Test data and cleanup
Created (all prefixed REG-): category REG-Cat2 (stays: it has items); items REG-Laptop, REG-Cord, REG-Zero, REG-Repair, REG-UI Laptop, all now RETIRED (several have history); borrowers REG Student Edited (REG-S1), REG Employee (REG-E1), REG Dup (REG-F9), now inactive; rooms REG-Room A, REG-Room Q (inactive; REG-Room C was already inactive; REG-Room B and D were deleted); semesters REG-Sem (2035-01-01 to 2035-06-30) and REG-Sem UI (2036-01-01 to 2036-05-31), not current and not deletable; about 8 transactions and 20 return events; audit entries. The current semester is again "Sample semester". Settings are back to 17:00 / 3 / 4 / 5. qa-viewer and qa-handler passwords are as before. A temporary category "x" created by a 99 KB body test was deleted.
Browsers: headless Edge killed with `taskkill /T /F`, no process of mine remains, no `edge-*` profile in the temp folder. Left behind: folder `D:\edgetmp-reg` (screenshots and the downloaded mockup file, no browser profile); my cleanup command for it was blocked by the safety check, so please delete it by hand. Scratch scripts are in the session scratchpad.
