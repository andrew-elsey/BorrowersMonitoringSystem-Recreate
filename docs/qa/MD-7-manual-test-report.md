# MD-7 Manual Test Report

Date / build or commit: 2026-11-03, branch `feature/MD-7-semesters-settings`, head ba8cc1a (main with MD-3 merged in)
Environment: Windows 11, Docker Compose (db, api, web) from `docker compose up --build`, http://127.0.0.1:8080, dev database with sample data. UI driven with headless Edge over the DevTools protocol (real key events for Tab/Enter/Esc), API with curl. Users: admin, plus `qa-handler` (HANDLER) and `qa-viewer` (VIEWER) that were already in the dev database (their password hash was set to the admin's so they could sign in; no password written anywhere).
Verdict: PASS (one Low defect, several observations)

Not run by me: `npm run lint`, `typecheck`, `npm test` (427 tests); the card reports them green. Only manual checks below.

Documents compared: card acceptance criteria, `docs/BACKLOG.md` MD-7 and `TEST_CASES.md` (TC-MD-21 to 23, 31 to 33) agree. Mockup (Settings.dc.html) read OK.

## Acceptance criteria results
| # | Criterion | Result | Notes |
|---|---|---|---|
| 1 | Admins define semesters with start and end dates and exactly one current semester | Pass | Create, edit, set current work in UI and API. Only one current after sequential and 3 concurrent set-current calls (DB unique index `semesters_one_current_key` also refuses a second). No delete (DELETE gives 404) and `isCurrent` in PUT is ignored. |
| 2 | Settings for closing time and the three thresholds, validated (warning < notice < block) | Pass | 4/3/5 and 3/3/5 refused (also 3/4/4), 3/4/5 saved. Range 1 to 100, whole numbers, `HH:mm` enforced by the API. Reload keeps values; Asia/Manila shown. |
| 3 | Changes are audited | Pass | SEMESTER_CREATED, SEMESTER_UPDATED, SEMESTER_SET_CURRENT (old and new current in one entry), SETTINGS_UPDATED (before and after) seen in `audit_log` with the admin as actor. Failed requests, a no-change settings save, and re-setting the already-current semester wrote nothing. Cancelled confirm wrote nothing (SEMESTER_SET_CURRENT count unchanged). |
| 4 | Checkout reads the current semester | Not tested by hand | Checkout is BRW-2. Only observable: with no current semester (set via SQL) the screen shows the "No current semester. Checkout is unavailable..." alert. `requireCurrentSemester` is covered by the automated tests only. |

Test cases:
| TC | Result | Notes |
|---|---|---|
| TC-MD-21 | Pass | See criteria 1 and 3. |
| TC-MD-22 | Pass | UI: error under Notice at (aria-invalid, aria-describedby, role=alert), focus moves to that field. Block field for 3/4/4. |
| TC-MD-23 | Pass (UI/API part) | Saved, audited, read fresh on reload. Checkout and flagging reading it: not testable yet. |
| TC-MD-31 | Pass | Start 2027-04-30 (touching the end), end 2026-11-01 (touching the start), and a date inside all give 409 SEMESTER_OVERLAP under Start date naming "Sample semester". 2027-05-01 saved. Edit into overlap refused. DB exclusion constraint also refuses direct SQL. |
| TC-MD-32 | Pass | "SAMPLE SEMESTER", "SAMPLE semester", "qa-sem a" give DUPLICATE_VALUE under Name (create and edit). Editing "QA-Sem A" to "QA-SEM A" and "QA-SEM B" to "qa-sem b" saved. |
| TC-MD-33 | Pass | Dialog "Change the current semester?" with the text "Only flags from transactions in Sample semester will count as strikes. Flags from other semesters stay in history." Cancel focused, Enter on Cancel and Esc close it, focus returns to the Set as current button, nothing sent, current unchanged. Confirm switches it, only one current, a status message "is now the current semester" shows. |
| MD-3 regression (TC-MD-09, TC-MD-30) | Pass | Rooms API create, duplicate by case (409), rename, deactivate, reactivate, delete unused (204), audited; handler can list and add, viewer gets 403. Menu order: Home, Inventory and categories, Borrowers, Rooms and labs, Settings and semesters. |

## Additional tests run
- Roles, API: handler and viewer get 403 on GET/PUT /settings, GET/POST /semesters, POST set-current; signed out gets 401.
- Roles, UI: handler and viewer menu shows only Home; `/settings` and `/rooms` show "You can't open this page" with a Go to home link; signed out `/settings` redirects to `/login`.
- Semester validation (API and UI): empty name and dates (three field errors, focus on first), end before start (error under End date, focus there), start equal to end saved (owner decision), impossible date 2028-02-30 and `01/02/2029` refused, whitespace-only name refused, 200-character name accepted (SPEC allows 200).
- Settings validation: 0, 101, 2.5, string "3", missing fields, empty/invalid closing time, 23:59 and 00:00 accepted, extra `timezone` field ignored (response stays Asia/Manila).
- Edit dialog: field errors (overlap, duplicate name) show inside the dialog with focus on the field; Esc closes and returns focus to the Edit button.
- Keyboard: Tab order is Closing time, Warning, Notice, Block, Save settings, then row buttons. Row buttons have aria-labels "Edit <name>" and "Set <name> as current". Field errors are `role=alert` linked with aria-describedby; success messages are `role=status`.
- Narrow window (400 px): no horizontal scroll, form and edit dialog usable. Wide layout matches the mockup (cards, table, add row).
- Retry (stop of the page data through request interception, 502): Rooms focus goes to the name field, Settings focus goes to Closing time (settings failed) or New semester name (semesters failed), Borrowers focus goes to School ID. Inventory (Items tab) focus drops to the page start, see observation 4.
- Database: second current semester refused, overlapping insert refused, end before start refused (check constraint).
- State restored at the end: Sample semester current, settings 17:00 / 3 / 4 / 5.

## Defects
### BUG-1: Semesters card text still promises 0 strikes when a semester becomes current
- Severity: Low
- Steps to reproduce:
  1. Sign in as admin and open Settings and semesters.
  2. Read the sentence under the "Semesters" heading.
  3. Press Set as current on a semester that already has flagged transactions and read the confirm dialog.
- Expected: Text consistent with the owner-approved confirm wording. The dev removed the "0 strikes" promise from the dialog in commit 5b50208 because switching back to a semester with flags does not give 0.
- Actual: The paragraph still says "Strikes count only in the current semester. Making a new semester current starts every borrower at 0 strikes; old flags stay in history." This contradicts the dialog and is wrong when switching back to an older semester. (It is copied from the mockup, so the owner may want to update both.)
- Role / data used: admin, dev sample data.

## Observations (not bugs)
1. The card says focus moves to "the new current semester's name" after confirming. Actual: focus goes to the "New semester name" input of the add form (the code and test comment say the same). Reasonable, but the card wording differs.
2. Differences from the mockup (all stated on the card): a threshold error shows under its field instead of in a box at the top; Edit opens a dialog. The mockup's threshold message names the notice and block values; the app names the pair that is out of order.
3. API messages that are not user-friendly (UI does not trigger them): `PUT /semesters/xyz/current` returns "Invalid GUID"; `PUT /settings` with `{}` returns "Invalid input: expected string, received undefined" for closingTime.
4. Inventory and categories, Items tab: after a failed load and a working Retry focus drops to the page start (`InventoryItems.tsx` RetryAlert has no `onRetried`). This is MD-2 code, not changed by MD-7, but it is the only Retry of the four listed pages without a focus target.
5. The database has no check on threshold order (`UPDATE settings SET warning_threshold=5` with notice 4 succeeded in SQL). Enforcement is in the service and API only, as the CLAUDE.md rules say; noting it in case a DB check is wanted.
6. After `docker compose stop api` then `start api`, nginx kept returning 502 for every request (stale upstream address) until `docker compose restart web`. Existing infrastructure behaviour, not MD-7; relevant for the Retry "to check by hand" step on the card, which cannot be followed as written without restarting web. Also, while the api is down a full-page "Could not reach the server. Reload the page to try again." replaces the app when the session check fails (no Retry there).
7. Semesters and rooms cannot be deleted, so my test rows stay in the dev database: "QA-SEM A", "QA-oneday", "qa-sem b", a 200-character "aaaa..." semester (all non-current, dated 2027-05 and later), and rooms "QA-x" and "QA-Lab 1b" was deleted. Reset the dev database before the next QA round if clean data matters. Users `qa-handler` and `qa-viewer` exist.
8. Closing time input shows 12-hour format (06:30 pm) following the browser locale; the value saved is 24-hour `HH:mm`.

## Cleanup
Headless Edge processes killed with `taskkill /T /F`, profile folders removed (none left matching `edge-qa-*`). `docker compose down` run at the end.
