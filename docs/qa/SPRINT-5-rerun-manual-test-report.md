# SPRINT-5 Rerun Manual Test Report (batch QA, second pass)
Date / build: 2026-11-14, about 08:55 to 09:30 Asia/Manila. Branch `feature/SPRINT-5` at 169fa3f, running under docker compose (api, web, db healthy).
Environment: http://127.0.0.1:8080 through nginx, Windows 11. API checked with Node scripts (fetch), screens with headless Edge over CDP (killed, profile folder removed). New accounts created by me: qa-s5r-hand (handler), qa-s5r-view (view-only); the first-pass accounts' passwords were not recorded, so the admin account was used from `.env`.
Tickets: BRW-6, RPT-1, RPT-2, RPT-3, RPT-4, MD-6, AUTH-3.
Trello: not read or written (instruction for this rerun). Criteria taken from `docs/BACKLOG.md` and `TEST_CASES.md`; no disagreement found between them.
Mockup: read with the Artifact tool (the read succeeded but returned only the type instructions, the page content was left out). I did not re-diff the boards in this pass; the first pass compared Main, Reports, Users, and Borrowers. Layout was only re-checked at 1024 and 375 px.

Verdict: PASS. All four first-pass items are resolved. 0 defects. Two observations for the owner (not defects).

## First-pass defects rechecked
| Item | Result | Notes |
|---|---|---|
| MD-6: 5,001 rows with CR-only, LF, CRLF | Pass | Each: 413 `PAYLOAD_TOO_LARGE`, "The file has more than 5000 rows. Split it into smaller files."; borrower total stayed 15 before and after each (and the `QA-S5R-CR`, `-LF`, `-CL` ids were not found) |
| MD-6: 5,000-row file imports | Pass | LF: created 5000. Same rows again as CR-only: 200, unchanged 5000, created 0. As CRLF: 200, unchanged 5000. So CR-only and CRLF parse to the right row count |
| RPT-4 defaults | Pass | At 08:57 Manila: From 2026-10-16, To 2026-11-14 (today in Manila). With the browser clock moved (date shim) across the Manila day change: 20:00Z on 14 Nov (04:00 on 15 Nov Manila) gives 10-17 .. 11-15; 16:05Z (00:05 on 15 Nov Manila) gives 10-17 .. 11-15; 15:55Z (23:55 on 14 Nov Manila) gives 10-16 .. 11-14; 2026-03-03 Manila gives 02-02 .. 03-03. See Observation 1 about "30 days earlier" |
| AUTH-3 focus | Pass | Opening the form focuses Full name. Focus placed on Starting password, then Enter with all empty: 4 errors, focus moves to Full name. Only Full name and Username filled, Enter: focus on Role (the Role select) |
| Owner decision: Dashboard is the 4th report | Pass, no longer a defect | SPEC 5 (Reports row: "The fourth report, unreturned and flagged, is the Dashboard (owner decision 2026-11-14)"), BR section 4 (first bullet says this report is the Dashboard, not a tab), BR scenario about view-only loading "all four reports: the Dashboard and the three tabs", and TC-RPT-07 ("the Dashboard (unreturned and flagged) and the three Reports tabs") all match the app: Reports has 3 tabs (History per borrower, History per item, Usage summary), Dashboard is `/` for all roles |

## Acceptance criteria results
| # | Ticket | Criterion | Result | Notes |
|---|---|---|---|---|
| 1 | BRW-6 | BR 7: handler adds or edits note and expected date on an open line | Pass | Handler and admin 200; viewer 403; signed out 401; also edited a line that was already flagged and still open |
| 2 | BRW-6 | Edits audited | Pass | `LINE_NOTE_UPDATED` rows with before and after (note, expectedReturnDate) |
| 3 | BRW-6 | Notes show on the dashboard | Pass | Viewer's `/dashboard/unreturned` returns note and expectedReturnDate; Dashboard and Return screens show them |
| 4 | BRW-6 | Notes do not affect flagging (S4) | Pass | Closing run (closing time moved to 09:03, then restored to 17:00): a line with note and date 16 Nov and a line with note "returning tomorrow" and date 15 Nov both became FLAGGED at 09:03:00; each borrower got 1 strike. Return of the flagged line left it FLAGGED. Next-day return not tested (no time travel on the server) |
| 5 | RPT-1 | Unreturned items and flagged borrowers with notes and dates, all roles | Pass | Admin, handler, viewer 200 on both endpoints; signed out 401; 1024 and 375 px no sideways page scroll (375 px page width 360 of 375) |
| 6 | RPT-2 | Range capped at 366 days, paginated, room, issuing and receiving handler, return details, flag | Pass | Line with 2 partial returns showed room, issuer, both receivers (admin and handler), condition, quantities, flag NONE; page 2 of 2 with pageSize 1; 2026-01-01 to 2027-01-01 ok, to 2027-01-02 `VALIDATION_ERROR` on `to`; to before from 400; signed out 401 |
| 7 | RPT-3 | Lookup by item or asset tag, same detail, paginated | Pass | Item lookup by asset tag and by name found the item; history by item id with asset tag; 367 days refused; pageSize 1 honoured |
| 8 | RPT-4 | Usage summary, period capped at 366 days, categories and rooms | Pass | Viewer, handler, admin 200; categories and rooms listed with times borrowed; 366 ok, 367 refused on `to`; missing dates 400; signed out 401; screen shows the three bar charts with "Show as table" |
| 9 | AUTH-3 | Create, edit, deactivate users, reset passwords | Pass | Create 201 (no password in reply), edit name and role, deactivate and reactivate, admin password reset; new password works |
| 10 | AUTH-3 | Users with transactions deactivated, never deleted (BR 15) | Pass | `DELETE /api/users/:id` is 404; no Delete button on the screen |
| 11 | AUTH-3 | Admin cannot deactivate self | Pass | 409 `CANNOT_DEACTIVATE_SELF`, also with the id in upper case |
| 12 | AUTH-3 | Changes audited | Pass | USER_CREATED, USER_UPDATED, USER_PASSWORD_RESET rows; a query for "hash" or "password" in any user audit before and after found none |
| 13 | MD-6 | Format per SPEC 6, create or update by school ID, counts and reasons | Pass | Mixed CRLF file: created 2, updated 1 (department changed on QA-S5R-OK00001), 4 rejected with a reason and row number each (empty name, bad type, bad active, repeated id); quoted comma name and lower-case type accepted; blank active defaulted |
| 14 | MD-6 | Audited | Pass | One `BORROWER_IMPORT` row per accepted import (created 5000, 1, 0 seen); 413 imports left no row and no borrowers |
| 15 | MD-6 | Limits before parsing, `PAYLOAD_TOO_LARGE` | Pass | 5,001 rows in three line endings, 2.1 MB, and two files all 413 |
| 16 | MD-6 | Parsing does not block other requests | Pass (light) | `/auth/me` polled during the 5,000-row CR import: all 200, slowest 51 ms (only 3 samples, import takes under a second). The strict event-loop check stays with the automated test |

## TEST_CASES.md results
| TC | Ticket | Result | Notes |
|---|---|---|---|
| TC-AUTH-19 | AUTH-3 | Pass | Create, edit, deactivate, reset all work and are audited; duplicate username in other case `DUPLICATE_VALUE` on `username`; passwords of 9 chars refused, 10 ok in the form schema; 4 empty fields give 4 errors with first-field focus (first-pass BUG-2 fixed) |
| TC-AUTH-20 | AUTH-3 | Pass | |
| TC-AUTH-21 | AUTH-3 | Pass | |
| TC-AUTH-22 | AUTH-3 | Pass | Handler, viewer 403 and signed out 401 on all four user endpoints; viewer on `/users` sees "You can't open this page" and has no Users menu item |
| TC-AUTH-38 | AUTH-3 | Partial | Admin reset ends the user's session (user got 401 on the next call), role change and deactivation also sign the user out. The "own password change keeps this session, ends the other" part was not rerun (passed in first pass) |
| TC-AUTH-39 | AUTH-3 | Pass | 409 `CANNOT_CHANGE_OWN_ROLE`; Edit dialog on the admin's own row shows the role select disabled and "You cannot change your own role. Ask another admin to do it." |
| TC-AUTH-40 | AUTH-3 | Partial | Create with "QA-S5R-TEMP" while "qa-s5r-temp" exists gives `DUPLICATE_VALUE` on `username`. Not rerun: rename clash, own case change, exact-case sign-in, migration with duplicates |
| TC-MD-18 | MD-6 | Pass | New, updated, rejected with reasons, counts, audited; handler 403 (also seen earlier as viewer 403 and signed out 401 once the nginx limit window passed); UI Import CSV button present |
| TC-MD-19 | MD-6 | Pass | 2.1 MB, two files, and 5,001 rows (CR, LF, CRLF) all 413; two-file request saved nothing. The nginx import limit (2 a minute) answers 429 before authentication, so a viewer or signed-out call made right after an import got 429 until the window passed |
| TC-MD-20 | MD-6 | Partial | Light check only (see AC 16) |
| TC-BRW-30 | BRW-6 | Pass | |
| TC-BRW-31 | BRW-6 | Pass | 501 chars `VALIDATION_ERROR` on `note`; 500 ok; closed line 409 `LINE_NOT_OPEN`; past date 400 on `expectedReturnDate`; impossible date 400; unknown id 404; bad id 400; "passed stored date kept or cleared" not rerun (first pass) |
| TC-BRW-32 | BRW-6 | Partial | Flagged despite note and date, strikes as usual, flag kept after the return on the same day. The next-day return was not run |
| TC-BRW-33 | BRW-6 | Pass | |
| TC-RPT-01 | RPT-1 | Pass | Returned lines not in the unreturned list; overridden line stops counting (B1 went from 1 strike to not listed); borrowers with strikes listed |
| TC-RPT-02 | RPT-1 | Pass | Admin, handler, viewer 200; signed out 401; pageSize 101 and page 0 `VALIDATION_ERROR` |
| TC-RPT-03 | RPT-2 | Pass | |
| TC-RPT-04 | RPT-2 | Pass | 366 ok, 367 `VALIDATION_ERROR` (history and usage) |
| TC-RPT-05 | RPT-3 | Pass | |
| TC-RPT-06 | RPT-4 | Pass | |
| TC-RPT-07 | RPT-1 to RPT-4 | Pass | Viewer loads the Dashboard (both lists) and all three Reports tabs' endpoints; the app matches the updated case |

## Additional tests run
- Flagging regression: closing time moved to 09:03, lines flagged within the minute, closing time restored to 17:00 (confirmed by the PUT reply). Flagged line returned: stays FLAGGED (BR 8). Admin override with reason: 200; handler 403; viewer 403; history then shows OVERRIDDEN with who and why; the borrower stops counting.
- Checkout and return regression: handler checkout with two lines (a laptop and 4 cords); return quantity 0 refused, 5 of 4 refused, viewer 403; partial return of 1 by admin and 3 by handler recorded with each receiver.
- Notes: HTML text stored as text, empty note clears, 500 chars ok, editing a closed line refused.
- CSV: wrong header refused, empty file refused, nothing saved; 5,000 rows in CR-only and CRLF both re-parse to the same rows (unchanged 5000).
- Users: create with empty fields (4 field errors), name of 201 chars refused, role change and deactivation sign the user out, deactivated user cannot sign in, reactivation works, pageSize 101 refused, list has no hash.
- Screens at 1024 and 375 px (Dashboard, Reports, Users, Borrowers, Return): no sideways page scroll.
- Menus: viewer sees only Dashboard and Reports; viewer on `/users` sees the not-allowed page.
- Rate limits met (expected, not defects): login 429 when many API logins were made in a minute; reports 30 a minute shared (first batch of report calls hit 429 `RATE_LIMITED` and passed on rerun after the window).
- Browser cleanup: no edge process of mine left (checked by command line), `edge-s5r-profile` folder removed, no `edge-*` folder of mine in Temp.

## Defects
None.

## Observations (not bugs)
1. RPT-4 default From is 29 days before today (so the default period is 30 days counting both ends: 16 Oct to 14 Nov). The brief for this rerun said "30 days earlier", which would be 15 Oct. No document gives the default, and the test name says "last 30 days". If the owner wants From to be exactly 30 days earlier (31 days counted), the code and TC-RPT-06 wording would need to say so. Suggest writing the default in SPEC 5 or the RPT-4 card.
2. The own-row Deactivate button on Users is enabled for the signed-in admin; the server refuses with the message. Fine, but a disabled button or hint would be clearer.
3. First-pass observations still stand and were not retested: report tabs are not arrow-key navigable, validation messages on report dates can add a misleading range error, usernames can contain inner spaces.
4. The nginx CSV import limit (2 a minute per address, 429 before login check) means a viewer or signed-out test made soon after an import sees 429, not 403 or 401. Expected by design.

## Test data left in the dev DB
- Borrowers: 5,000 imported rows `QA-S5R-OK00001` to `QA-S5R-OK05000` (name "QA-S5R Person n", STUDENT, department QA; `QA-S5R-OK00001` has department "Changed Dept"); `QA-S5R-B1` (QA-S5R Student One), `QA-S5R-B2` (QA-S5R Employee Two), `QA-S5R-M1`, `QA-S5R-M5`. Borrowers cannot be deleted, so they remain; the 5,000 rows will make the Borrowers list long.
- Items: QA-S5R Laptop (QA-S5R-LAP-1), QA-S5R Laptop B (QA-S5R-LAP-2, checked out), QA-S5R Cord (10 units, all back).
- Transactions: 2. B1's (laptop and 4 cords, issued by qa-s5r-hand) is fully returned, laptop line OVERRIDDEN; B2's laptop B line is still open and FLAGGED (it shows on the Dashboard and Return screens, B2 has 1 strike).
- Users: qa-s5r-hand (handler), qa-s5r-view (view-only), qa-s5r-temp ("QA-S5R Temp Renamed", view-only, active after the reset and reactivate). Password of the first two is in my scratch script (not recorded here).
- Settings: closing time changed to 09:03 for about 2 minutes and restored to 17:00; during that minute the closing run flagged every open line in the system that was not flagged yet (including the "Due today" line of QA-S5-hand1b from the first pass).
- Audit log: about 5,000 BORROWER_CREATED rows from the import.
