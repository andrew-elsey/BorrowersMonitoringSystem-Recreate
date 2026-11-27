# SPRINT-6 Manual Test Report (batch QA)
Date / build or commit: 2026-11-22, branch `feature/SPRINT-6` at `3de01d5` (matches origin after `git fetch`)
Environment: Windows 11, Docker Desktop, headless Edge driven over the DevTools protocol (no Playwright installed). Throwaway compose project `bms-s6qa` (WEB_PORT 18480, POSTGRES_DB bms_s6qa, throwaway secrets in the shell environment only, no edits to docker-compose.yml or .env). Automated tests used database `bms_s6qa_test` in the existing db-test container. The dev stack on 8080 was not touched.
Verdict: PASS for all 7 cards, with 1 Low defect (BUG-1) that does not touch an acceptance criterion, and 1 Low defect in a script's error handling (BUG-2).

Note on Trello: this session had no Trello tools, so no card comments were posted. Ready-to-paste comments are at the end of this report. Card descriptions and "Ready for Testing" comments could not be read either, so the How to QA steps were taken from `docs/BACKLOG.md`, `TEST_CASES.md` and the lead's list. Please paste the comments or ask me to retry with Trello access.

## Automated checks (run on 3de01d5)
| Check | Result |
|---|---|
| `npm run lint` | PASS (exit 0) |
| `npm run typecheck` | PASS (exit 0) |
| `npm test` | PASS: 117 files, 1332 tests (the expected numbers) |
| `npm run test:nginx` | PASS: all 11 checks, including TC-FND-32 |

All automated TCs for the cards (TC-HRD-01 to 03, 12 to 27, 30 to 43, 45 to 54, TC-FND-32, TC-FND-34) live in these suites and passed. I did not read each test file; I rely on the full suite being green and the TC table in `TEST_CASES.md` mapping each TC to a file.

## Docs consistency
Backlog, TEST_CASES.md and the lead's card list agree on ticket scope. HRD-5 covers the API and validation (HRD-5a) and HRD-5b covers the screens. The Trello card text could not be compared (no Trello access).

## Mockup comparison
Mockup read with the Artifact tool (read only): AuditLog and FlagReview artboards. Audit log matches in structure (From/To required, Actor with System, Entity list, Filter, table Time/Actor/Action/Entity/Change with before/after details, "Showing x-y of n", empty text, narrow window no sideways scroll). Flag review matches (Last flagging run / Next run line under the title, Run flagging now button). See Observations for small wording differences.

## Per card results

### FND-8 nginx 502 after api restart: PASS
| # | Criterion | Result | Notes |
|---|---|---|---|
| 1 | After `docker compose restart api` the app works again without restarting web | PASS | Checked three times with `/api/health` through the web port (18480): 502 for 2 s, 200 on the third second (restart); again after stop then start: 502 for 1 to 3 s, 200 after 3 s. |
| 2 | Address really changed | PASS | Occupied the next addresses with two helper containers so the api came back on a new IP (172.19.0.3 to 172.19.0.6): 502 for 7 s, then 200 at 8 s (within the "about 10 s" in TC-FND-33). |
| 3 | Web container not restarted | PASS | Web `StartedAt` identical before and after. |
| 4 | `npm run test:nginx` still passes | PASS | 11 of 11, TC-FND-32 included. |
TC results: TC-FND-32 PASS (automated), TC-FND-33 PASS (manual, above), TC-FND-34 PASS (automated).

### HRD-1 Audit log viewer: PASS
| # | Criterion | Result | Notes |
|---|---|---|---|
| 1 | Admin filters by actor, entity, date, paginated | PASS | UI and API. Actor list: All, each staff member, System. Entity list is fixed and includes Flagging run. Request sent: `/api/audit?from=..&to=..&page=1&pageSize=25&actor=system&entity=flagging_run`. Entries are newest first with before and after in an expandable row. |
| 2 | Date range required, at most 366 days | PASS | API: no dates, one date, end before start, `from=0000-01-01` all 400 with plain messages. 2025-11-22 to 2026-11-22 (366 days) is 200; 2025-11-21 to 2026-11-22 is 400. UI refuses a longer range without sending a request. |
| 2b | Page size and page bounds, unknown entity or actor | PASS | `pageSize=101`, `page=0`, `entity=bogus`, `actor=abc` all 400 VALIDATION_ERROR. |
| 3 | Admin only | PASS | Handler and view-only: API 403; `/audit` page shows "You can't open this page"; no Audit log menu item. Not signed in: 401. |
| 4 | Shares the reports rate limit | PASS | 14 audit requests in a row OK, then 429 RATE_LIMITED; a usage report right after was also 429 (shared count). |
| 5 | Sweep `npm run audit:sweep` | PASS | Clean database after a restore: "no problems". After inserting a category by SQL and bumping another's `updated_at`: both reported (created-without-entry and changed-after-last-entry), exit code 1. Run inside the api container as the docs say. |
| 6 | Manila time display and day boundary | PASS (UI) | Entries show Manila time (06:36:19 for 22:36Z). Boundary logic is covered by TC-HRD-12 (automated). |
| 7 | Empty and narrow states | PASS | Empty text names the range. 400 px wide: no horizontal scroll. |
TC results: TC-HRD-01, 02, 03, 12 to 19 PASS (automated, in the green full run). TC-HRD-19 also exercised by hand above.
Defect: BUG-1 (Low).

### HRD-1b Last flagging run on Flag review: PASS
| # | Criterion | Result | Notes |
|---|---|---|---|
| 1 | Every run writes one FLAGGING_RUN audit entry, including 0 lines | PASS | Saw entries with `after.flagged` 0 and 2. Scheduled runs (actor System) and the admin "Run flagging now" (actor Administrator) both logged. A second admin run within a minute was refused with 429 and wrote no entry. |
| 2 | Flag review shows "Last flagging run" (Manila time, lines flagged) and "Next run" | PASS | "Last flagging run: 22 Nov, 06:36, 2 lines flagged. Next run: 23 Nov, 06:36." After the closing time was moved back to 17:00: "Next run: 22 Nov, 17:00." Next run follows the settings. |
| 3 | No run yet | PASS | After removing the run entries in the throwaway database: "No flagging run yet. Next run: 22 Nov, 17:00." |
| 4 | Read is bounded; admin-only | PASS | `/api/flags` handler and view-only: 403. Handler "Run flagging now": 403. |
| 5 | Mockup | PASS | Line sits under the title as in the mockup. |
TC results: TC-HRD-20 to 24 PASS (automated).

### HRD-3 Backup and restore: PASS
| # | Criterion | Result | Notes |
|---|---|---|---|
| 1 | `npm run backup` writes `bms-YYYYMMDD-HHmmss.dump` to BACKUP_DIR (outside the repo) | PASS | Files `bms-20261122-063218.dump` etc. in a folder in my scratchpad. |
| 2 | Refuses without BACKUP_DIR or with a wrong folder | PASS | "BACKUP_DIR is not set..." and "BACKUP_DIR does not exist: ...", exit 1. |
| 3 | With the db stopped: refuses, keeps nothing, deletes nothing | PASS | "service "db" is not running / Backup failed. Nothing was kept and no old backups were deleted." Folder unchanged. |
| 4 | Keeps 14 days, prunes only old `bms-*.dump` | PASS | A 20-day-old dump was deleted; a 5-day-old dump, a 40-day-old `notes-old.txt` and a 40-day-old `.partial` file were kept. |
| 5 | Restore refuses from a non-terminal | PASS | "Restore needs a person at the keyboard"; api left running. |
| 6 | Restore refuses a wrong or empty confirmation, a corrupt file | PASS (see note) | Wrong name and empty: "Not confirmed. Nothing was changed.", api not stopped. Corrupt file: "not a readable backup. Nothing was changed.", api not stopped. A missing path is BUG-2. Note: I have no pseudo-terminal in this session, so for these three runs I forced `process.stdin.isTTY` to true with a preload file and piped the typed answer. The script logic is the real one; the real-keyboard path is "not verified (manual)". |
| 7 | Restore replaces the data, restarts the api, and sessions are gone | PASS | Added a borrower after the backup, restored: borrower gone, original data back, audit log back, the old session cookie gave 401, admin could sign in again, the api ended healthy. |
| 8 | Clean-environment restore (TC-HRD-06) | PASS | `down -v`, `up`, restore the file: items (2), rooms (1) and the handler account came back and could sign in. |
| 9 | Files readable only by the admin account | not verified (manual) | This is an `icacls` setup step on the department PC, documented under HRD-4. I did not apply or check Windows permissions. |
TC results: TC-HRD-25, 26, 27 PASS (automated). TC-HRD-06 PASS, TC-HRD-28 PASS, TC-HRD-29 PASS with the fake-terminal caveat above (manual).
Defect: BUG-2 (Low).

### HRD-5 UX and error handling pass (HRD-5a, API and validation): PASS
| # | Criterion | Result | Notes |
|---|---|---|---|
| 1 | No raw validation messages | PASS | Empty bodies and wrong types return "Enter a valid value.", "Some fields are invalid.", "The request body could not be read." Never "Invalid input" or "expected/received". |
| 2 | Asset tag messages | PASS | UNIT with blank or missing tag: "Enter an asset tag."; QUANTITY with tag X: "Quantity items have no asset tag."; QUANTITY total quantity `"x"`: "Enter a whole number from 0 to 10,000." |
| 3 | Handler room list returns only id and name; admin gets all | PASS | Checked both. |
| 4 | Empty edit returns "Nothing to update." | PASS | `{}` and `{foo:1}` on items, rooms, borrowers, users: all 400 "Nothing to update." A QUANTITY item PATCH with the same name and a blank tag returned 200. |
| 5 | Database check on strike threshold order | PASS | API 400 with a plain message; direct SQL update `5,4,3` rejected by `settings_threshold_order`. |
| 6 | One shared real-date field | PASS | `0000-01-01` as semester start, report from, and expected return date: "Enter a real date." |
| 7 | `?page=abc` | PASS | 400 with a plain message, no 500. |
TC results: TC-HRD-45 to 54 PASS (automated).

### HRD-5b UX pass: UI fixes: PASS
| # | Criterion | Result | Notes |
|---|---|---|---|
| 1 | Items Retry moves focus to the first field | PASS | Forced `/api/items` to 500: "Something went wrong. Retry". Retry again while failing stayed on the alert; when it loaded, focus was on "+ Add item". |
| 2 | Return screen shows SEARCH_TOO_BROAD without Retry | PASS | Faked the 400 SEARCH_TOO_BROAD answer: shown as an alert, the only button is "Find open borrowings". |
| 3 | Flag review over-cap note is a status message, hidden when a search fails | PASS | Faked `borrowerSearchSkipped: true`: note appears as a `role=status`. Then a failing search: note gone, alert "Something went wrong. Retry" shown. |
| 4 | Friendly error page when a page fails to load | PASS | Blocked the lazy chunk: "This page could not load. Reload the page to try again." with a Reload button. |
| 5 | Focus after dismissing a message and after NOT_FOUND | PASS | Rooms: two delete attempts answered NOT_FOUND: both messages shown, focus went to the add field. Dismiss #1 by keyboard moved focus to the second message's Dismiss, scroll stayed 0. Dismiss #2 moved focus to the main area. |
| 6 | Checkout: focus moves on after choosing a borrower by keyboard | PASS | Search "Maria", Tab to Choose, Enter: focus on the room picker. For an inactive borrower: focus returned to the borrower search and the "Inactive borrower" message shows. |
| 7 | Consistent loading and empty states | PASS (sampled) | Items, Return, Flag review, Audit log and Rooms sampled; no odd patterns seen. Not every list screen was opened while loading, empty and failed (TC-HRD-44 is only partly done by hand). |
TC results: TC-HRD-30 to 43 PASS (automated). TC-HRD-08 and TC-HRD-44 are manual: sampled as above. TC-HRD-42 also done by hand.

### [BUG][Low] Checkout focus after choosing a borrower (card 6af240cb...): PASS
The fix is HRD-5b item 6 above (TC-HRD-42): after choosing a borrower with the keyboard, focus lands on the room picker; a blocked or inactive borrower returns focus to the search (inactive borrower checked; a blocked borrower was not set up by hand, covered by the component test).

## Additional tests run
- Handler, view-only and anonymous access to `/flags`, `/audit`, `/flagging/run`: correct 403 or 401.
- Rate limit on "Run flagging now" (429 on a second run within a minute) behaved as the mockup says.
- Narrow window (400 px) on Audit log and Flag review: no horizontal scroll.
- Startup catch-up runs: each api restart wrote a System `FLAGGING_RUN` entry for the missed closing time with 0 lines. Not a defect (see Observations).
- Regression: sign-in, dashboard, flag list with strikes, checkout, room delete, borrower and user create all worked.

## Defects

### BUG-1: Audit log shows a false "366 days" error when From is empty
- Severity: Low
- Steps to reproduce:
  1. Sign in as admin and open Audit log.
  2. Clear the From date (leave To as it is, for example today).
  3. Press Filter.
- Expected: only "Enter a start date." under From; no message on To; no table or empty-state text that looks like a result.
- Actual: under From "Enter a start date."; under To "The date range can be at most 366 days." (wrong, the range is not too long); the old "No audit entries match these filters in 2026-11-16 to 2026-11-22." box stays under the errors. The API returns the same To error for `GET /api/audit?from=0000-01-01&to=2026-11-22` (only for a 0000 start, which is fair), so the message for an empty From comes from the web form treating a blank start date as year 0.
- Role / data used: admin, throwaway project at 3de01d5.

### BUG-2: `npm run restore` with a missing file path shows a raw Node crash
- Severity: Low
- Steps to reproduce:
  1. In a terminal run `npm run restore -- C:\nope\x.dump` (a path that does not exist).
  2. Answer nothing (it fails before the prompt).
- Expected: one clear line such as "That file does not exist. Nothing was changed."
- Actual: a Node stack trace ("Error: ENOENT: no such file or directory, open 'C:\nope\x.dump' ... at runInDb (restore.ts:25)") and exit code 1. Nothing was changed and the api was not stopped, so only the message is poor. The corrupt-file and wrong-confirmation paths have proper messages.
- Role / data used: Windows host, throwaway project, fake-terminal preload (the check happens after the terminal check).

## Observations (not bugs)
- Audit log "Change" column shows the entity id (or "1" for Settings, or the UTC closing time `2026-11-21T22:36:00.000Z` for a flagging run) as the summary instead of a human line like the mockup's "closing_time" or "3 lines flagged". Details expand fine. Owner may want friendlier summaries and Manila time there.
- Audit empty-state text uses `2026-11-16 to 2026-11-22`, the mockup uses "2-3 Nov 2026".
- `POST /api/items` with a missing name returns "Enter a valid value." on `name` instead of "Enter a name." (an empty string gets the specific message). Fine for the criteria; slightly less helpful.
- The api runs a catch-up flagging run on every start when the last closing was missed; this adds `FLAGGING_RUN` entries with 0 lines on each restart. Expected per HRD-1b but may surprise whoever reads the log.
- Edge-level items: "Next run" shows "22 Nov, 17:00" where the mockup says "today, 17:00".
- Tests for the blocked-borrower checkout focus case and the Dismiss/NOT_FOUND focus on every list (items, categories, borrowers, users) are by component test only; I sampled Rooms.

## Not verified
- Real keyboard confirmation for restore (no pseudo-terminal; used a preload to mark stdin as a terminal).
- Windows file permissions (`icacls`) on the backup folder.
- Blocked (5 strikes) borrower focus case on Checkout (covered by a component test only).
- Every list screen in loading, empty and failed state (sampled).
- Trello: nothing read or posted (no Trello tools in this session).

## Cleanup
Throwaway compose project `bms-s6qa` removed with `down -v` (containers, volume, network gone). Helper containers removed. Database `bms_s6qa_test` dropped. Headless Edge processes killed and all `edge-s6qa-*` profile folders removed from the Temp folder (0 left). Throwaway backup files remain only in my scratchpad folder (I could not delete them because the safety check blocked a recursive delete; they hold only throwaway test data). The dev stack was untouched. No source, config or other docs were edited and nothing was committed.

## Ready-to-paste Trello comments
(Same text, one per card. Common footer: "Run on feature/SPRINT-6 at 3de01d5. Full report: docs/qa/SPRINT-6-manual-test-report.md. lint, typecheck, npm test (117 files, 1332 tests) and test:nginx all pass.")

- FND-8: QA PASS. restart api on a changed address: 502 for 2 to 8 s then 200, web start time unchanged; test:nginx 11 of 11. TC-FND-32 PASS, 33 PASS (manual), 34 PASS.
- HRD-1: QA PASS. Filters, 366 day limit, admin only, shared rate limit (429), sweep reports an unaudited category. TC-HRD-01 to 03, 12 to 19 PASS. Low issue: BUG-1 (empty From shows a false 366-day message on To).
- HRD-1b: QA PASS. FLAGGING_RUN entries for scheduled and manual runs, "Last flagging run ... Next run ..." and "No flagging run yet" shown. TC-HRD-20 to 24 PASS.
- HRD-3: QA PASS. Backup, prune (14 days, only bms-*.dump), refusals (no BACKUP_DIR, db stopped), restore in place and into a clean environment, sessions invalidated. TC-HRD-06, 25 to 29 PASS. Not verified: real-keyboard confirmation (used a fake terminal), icacls step. Low issue: BUG-2 (missing file path prints a Node stack trace).
- HRD-5: QA PASS. Validation messages, asset tag messages, handler room list, "Nothing to update.", threshold CHECK, real-date field. TC-HRD-45 to 54 PASS.
- HRD-5b: QA PASS. Items Retry focus, SEARCH_TOO_BROAD without Retry, status note, chunk-failure page, Dismiss and NOT_FOUND focus, checkout focus. TC-HRD-30 to 44 PASS (08 and 44 sampled by hand).
- [BUG][Low] Checkout focus after choosing a borrower: QA PASS. Verified with the keyboard (TC-HRD-42); locked borrower returns focus to the search.
