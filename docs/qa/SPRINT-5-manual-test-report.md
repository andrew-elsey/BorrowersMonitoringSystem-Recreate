# SPRINT-5 Manual Test Report (batch QA)
Date / build: 2026-11-14, branch `feature/SPRINT-5` at 42948b9, already running under docker compose.
Environment: http://127.0.0.1:8080 (nginx, api, db healthy), Windows 11, headless Edge driven over CDP for screens, Node scripts for the API. Run time about 07:55 to 08:45 Asia/Manila. Accounts: admin, qa-handler, qa-viewer (passwords not recorded).
Tickets: BRW-6, RPT-1, RPT-2, RPT-3, RPT-4, AUTH-3, MD-6.
Trello: not read or written (writes blocked); criteria taken from `docs/BACKLOG.md` and `TEST_CASES.md`. No disagreement between them found, except BUG-1 against SPEC 5.
Mockup: read with the Artifact tool (Main, Reports, Users, Borrowers boards).

Verdict: FAIL (1 Medium, 1 Low). Everything else passed. BUG-1 becomes "accepted" if the owner confirms the Dashboard replaces the fourth report (then the docs and TC-RPT-07 need updating).

## Acceptance criteria results
| # | Ticket | Criterion | Result | Notes |
|---|---|---|---|---|
| 1 | BRW-6 | BR 7: handler adds or edits note and expected date on an open line | Pass | API as handler and admin; UI "Edit note and date" dialog on Return |
| 2 | BRW-6 | Edits audited | Pass | `LINE_NOTE_UPDATED` with before and after |
| 3 | BRW-6 | Notes show on the dashboard | Pass | Note and Expected return columns |
| 4 | BRW-6 | Notes do not affect flagging (S4) | Pass | Lines with a note and today's or tomorrow's date were flagged by the closing run; strikes normal. Next-day return not tested (no time travel) |
| 5 | RPT-1 | Unreturned items and flagged borrowers with notes and dates, all roles | Pass | 1024 and 375 px, no sideways page scroll; strike pills Warning 3, Notice 4, Blocked 5, Below warning match the mockup |
| 6 | RPT-2 | Range capped at 366 days, paginated, room, issuing and receiving handler, return details, flag | Pass | |
| 7 | RPT-3 | Lookup by item or asset tag, same detail, paginated | Pass | |
| 8 | RPT-4 | Usage summary, period capped at 366 days, categories and rooms | Pass | Counts checked by hand against my data |
| 9 | AUTH-3 | Create, edit, deactivate users, reset passwords | Pass | |
| 10 | AUTH-3 | Users with transactions deactivated, never deleted (BR 15) | Pass | No DELETE route (404); deactivated handler's name stays on history |
| 11 | AUTH-3 | Admin cannot deactivate self | Pass | 409 `CANNOT_DEACTIVATE_SELF` (also upper-case id); UI shows the message |
| 12 | AUTH-3 | Changes audited | Pass | USER_CREATED, USER_UPDATED, USER_PASSWORD_RESET; no password or hash in any user audit row |
| 13 | MD-6 | Format per SPEC 6, create or update by school ID, counts and reasons | Pass | |
| 14 | MD-6 | Audited | Pass | BORROWER_CREATED, BORROWER_UPDATED, one BORROWER_IMPORT |
| 15 | MD-6 | Limits before parsing, `PAYLOAD_TOO_LARGE` | Pass | 2.1 MB, 5,001 rows, two files, extra form field all 413 |
| 16 | MD-6 | Parsing does not block other requests | Not tested | Only timing: 5,000-row import answered in about 0.2 s |
| 17 | SPEC 5 | Reports screen has all four reports incl. "Unreturned and flagged" | Fail | BUG-1 |

## TEST_CASES.md results
| TC | Ticket | Result | Notes |
|---|---|---|---|
| TC-AUTH-19 | AUTH-3 | Pass | Create, edit, deactivate, reset work and are audited. Low defect BUG-2 (focus) |
| TC-AUTH-20 | AUTH-3 | Pass | |
| TC-AUTH-21 | AUTH-3 | Pass | |
| TC-AUTH-22 | AUTH-3 | Pass | Handler and viewer 403 on all four endpoints, signed out 401; screen shows "You can't open this page", no Users menu item |
| TC-AUTH-38 | AUTH-3 | Pass | Admin reset ends both sessions of the user; own change keeps the session used and ends the other; admin resetting own password keeps the session; other users stayed signed in |
| TC-AUTH-39 | AUTH-3 | Pass | 409 `CANNOT_CHANGE_OWN_ROLE`; same role accepted; dialog shows the role locked |
| TC-AUTH-40 | AUTH-3 | Partial | Create and rename clash in another case give `DUPLICATE_VALUE` on `username`. Not tested: own case-only change, exact-case sign-in, migration with duplicates |
| TC-MD-18 | MD-6 | Pass | Case-insensitive match, case-only id stored as typed, unchanged row counted, repeated id rejected, bad header or no file refused with nothing saved, handler 403, viewer 403, signed out 401; UI shows counts and rejected rows and reloads the list |
| TC-MD-19 | MD-6 | Pass | 2.1 MB, two files, 5,001 rows all 413. nginx import limit seen: 429 with `Retry-After: 30` |
| TC-MD-20 | MD-6 | Not tested | Event-loop blocking only covered by the automated test |
| TC-BRW-30 | BRW-6 | Pass | |
| TC-BRW-31 | BRW-6 | Pass | 501 chars `VALIDATION_ERROR` on `note`; closed line 409 `LINE_NOT_OPEN`; past date refused; passed stored date kept (also with a note edit) and cleared; changing it to another past date refused |
| TC-BRW-32 | BRW-6 | Partial | Flagged despite note and date, strikes as usual. Next-day return keeping the flag not run |
| TC-BRW-33 | BRW-6 | Pass | |
| TC-RPT-01 | RPT-1 | Pass | Returned lines left out, overridden line stops counting (5 to 4), most strikes first, paged |
| TC-RPT-02 | RPT-1 | Pass | Admin, handler, viewer 200; signed out 401; pageSize 101 and page 0 `VALIDATION_ERROR` |
| TC-RPT-03 | RPT-2 | Pass | |
| TC-RPT-04 | RPT-2 | Pass | 2026-01-01 to 2027-01-01 (366) ok; to 2027-01-02 (367) `VALIDATION_ERROR` |
| TC-RPT-05 | RPT-3 | Pass | By name and by asset tag |
| TC-RPT-06 | RPT-4 | Pass | |
| TC-RPT-07 | RPT-1 to RPT-4 | Fail | API allows the viewer on every endpoint, but only three report tabs exist (BUG-1) |

## Additional tests run
- Shared reports rate limit: 30 a minute counted together across usage, borrower history and item history; request 31 gives 429 `RATE_LIMITED`, `Retry-After` 60, JSON. While limited, the dashboard lists, borrower picker, item search and `/auth/me` still answered 200. The limit is per IP, so another role from the same address is limited too.
- Dashboard API bounds: page 0, -1, abc, pageSize 0, 101, 1.5 all 400 in the standard format; page 99999 empty list; POST, PUT, DELETE, PATCH 404; signed out 401.
- History and usage API: missing, malformed, impossible dates (Feb 30, month 13, year 0000) 400; unknown borrower or item 404; non-UUID id 400; SQL-looking input 400. Date filter respects Manila days (a line issued 07:57 Manila on 14 Nov, which is 13 Nov UTC, appears on 14 Nov and not on 13 Nov).
- Notes: 500 chars ok, 501 refused, control characters and tab refused, HTML stored and shown as text, empty clears, missing field 400, bad or unknown id 400 or 404, 120 KB body 413, missing `X-Requested-With` 403, upper-case id accepted.
- Users: password 9 chars refused, 10 ok, 201 refused, non-string refused; name or username 201 chars refused; blank name refused; bad role refused; body over 100 KB 413; list page-size bounds; role change signs the user out and the new role applies at next login; deactivated user cannot sign in (same generic message as a wrong password); no hash in list or audit.
- CSV import: BOM, CRLF, header with spaces and mixed case, blank `active` defaulting to true, quoted commas, trimming, 8 kinds of bad row each rejected with a reason, empty file, header only, wrong header, binary junk, unclosed quote, 5,000 invalid rows (200, 0.2 s, 512 KB reply).
- Screens at 1024 and 375 px: Dashboard (3 roles), Reports (3 tabs), Users, Borrowers with import result, Return dialog. No sideways page scroll; wide tables scroll inside their own container.
- Keyboard: Reports tab order; Enter on an empty lookup keeps focus on the field with the error; Return dialog Esc closes; a field error in the note dialog moves focus to the date field.
- Screen permissions: handler and viewer opening `/users` get the "not allowed" page with tab title "Not allowed"; menus per role correct.
- Regression smoke: checkout, partial return, damaged return received by admin, return of a flagged line (stays flagged), override as admin (handler 403), flagging by moving the closing time (BR 9), Checkout banners at 3 and 4 strikes, Return strike badges. All fine.
- Browser cleanup: Edge process trees killed, `edge-profile-qa` folder removed, no `edge-*` folders left in Temp.

## Defects
### BUG-1: Reports screen has no "Unreturned and flagged" report
- Severity: Medium
- Ticket / rule: RPT-1 to RPT-4, TC-RPT-07, SPEC 5 (Reports), BR section 4
- Steps to reproduce: 1. Sign in as qa-viewer. 2. Open Reports. 3. Look at the tabs.
- Expected: four reports, as in SPEC 5, BR section 4, TC-RPT-07 ("all four reports") and the approved mockup (first tab "Unreturned and flagged" with Strikes, Item, Out, Room, Issued, Note, Expected return, Flag).
- Actual: three tabs only (History per borrower, History per item, Usage summary). The same data is on the Dashboard, but no document says that replaces the report.
- Role / data used: viewer; any data.

### BUG-2: Add user form focuses the last invalid field, not the first
- Severity: Low
- Ticket / rule: AUTH-3, TC-AUTH-19, FND-5 (focus on first errored field)
- Steps to reproduce: 1. Sign in as admin, open Users. 2. Press "+ Add user". 3. Leave everything empty and press Enter in Full name.
- Expected: four errors and focus on Full name (first in form order). The Borrowers add form does this (focus on School ID).
- Actual: four errors show, focus lands on Starting password (last).
- Role / data used: admin; empty form.

## Observations (not bugs)
- An invalid month or format in a report date also makes the `to` field show "range can be at most 366 days" or "end date cannot be before start date" (confusing extra messages). Example: `from=2026-13-01&to=2026-11-14`.
- The History range error does not say how many days were chosen (the mockup does, and the Usage tab does).
- Report tabs use `role=tab` but each tab is a Tab stop and Arrow keys do not move between them.
- Usage charts sit against the filter row with no gap. On the History tabs at 1024 px the Show report button wraps to its own row.
- Usernames may contain spaces inside ("qa s5 sp" was accepted). Tab characters are refused in notes.
- A CSV request with an extra form field answers 413 `PAYLOAD_TOO_LARGE` ("Upload one CSV file of at most 2 MB"); the import also accepts a CSV sent as `image/png`.
- Choosing a file starts the import at once, with no confirm (matches the mockup flow).
- Notices on Users stack until dismissed; an old "cannot deactivate your own account" error stayed above later success notices.
- No-op note edits (same values) are still audited.
- The "Due today" state of the dashboard was not seen because every test line was flagged.
- Focus after closing the note dialog with Esc could not be judged (my script clicked without focusing the button).

## Test data left in the dev DB
- Borrowers: QA-S5-1001, 1002, 1003 (strikes now 4, 3, 4), QA-S5-2001, 2002, qa-s5-2003 (inactive), 2009, 2011, 4003, 5001.
- Items: QA-S5 Laptop (QA-S5-LAP-1), QA-S5 Projector (QA-S5-PRJ-1), QA-S5 Camera (QA-S5-CAM-1), QA-S5 Cord (20 units, several still out).
- Transactions: about 17 by qa-handler and one by QA-S5-hand1b; most lines still open and FLAGGED (one OVERRIDDEN). They show on the dashboard and Return screens.
- Users (cannot be deleted): QA-S5-hand1b (inactive, has a transaction), QA-S5-admin2 (active, admin), QA-S5-view1 (inactive), qa-s5-ui1, qa-s5-html (name is an HTML string), qa-s5-pad, "qa s5 sp".
- Existing data changed: Lupin's Laptop line (LAP-001) lost its expected return date 2026-11-12 (cleared in the "passed date can be cleared" test; cannot be restored because a past date is refused). Closing time was set to 07:58 for a few seconds to trigger flagging, then put back to 17:00.
