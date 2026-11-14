# FLG-4 Manual Test Report
Date / build or commit: 2026-11-10, branch feature/FLG-4-flag-override, head ef289bb
Environment: Docker stack on http://127.0.0.1:8080 (built from ef289bb, not rebuilt), dev DB with sample data, closing 17:00, thresholds 3/4/5, headless Edge 157 driven over DevTools (1280/1000/400/320 px), Node scripts for API calls, psql for data and audit checks. Accounts: admin, qa-handler, qa-viewer.
Verdict: PASS

Scope note: lint, typecheck and `npm test` (948) were not re-run by QA; the card reports them green. Steps 3 to 12 of the card's How to QA were run by hand. Steps 1 and 2 were not.

## Documents check
Card AC, docs/BACKLOG.md FLG-4, TEST_CASES.md rows and SPEC 5/7 agree (the card adds the owner-approved extras: Run now, Issued column, strikes, danger submit). BR 13 and S4/S7/S13 match what was tested. No disagreement found.
Mockup read OK (FlagReview.dc.html). Compared: title, Run flagging now button, search and Returned? filter, columns (Borrower, Item, Issued, Flagged, Now, Note, Expected return, Action), strikes under borrower, run confirm dialog, refusal banner, success banner, override dialog, dark red submit, empty state text. Differences are listed under Observations.

## Acceptance criteria results
| # | Criterion | Result | Notes |
|---|---|---|---|
| 1 | Admin list shows borrower, item, note, expected return | Pass | Also strikes, asset tag, Issued (Manila time, e.g. 9 Nov 10:00 for 02:00Z), Flagged, Now ("Still out", "2 still out", "Returned"). Only current-semester FLAGGED lines listed; a line moved to an older semester is not listed (API and UI). Search by borrower name, item name, asset tag (case-insensitive) works; "Still out"/"Returned" filter works (a partly returned cord line counts as still out). Pagination (pageSize=2, pages 1 to 3) works with stable order. |
| 2 | Override needs reason of at least 5 characters | Pass | 4 chars, only spaces, and "  abc  " (3 after trim) refused with "Enter a reason of at least 5 characters." on the field (aria-invalid, aria-describedby set). 5 chars accepted. 500 accepted, 501 refused ("Too long: at most 500 characters."). Reason is stored trimmed. Submit is dark red (rgb 76,10,10). Success text exactly "Flag overridden. <name>'s <item> line no longer counts. <name> now has N strikes." ("1 strike", "0 strikes" correct). |
| 3 | Overridden lines stop counting | Pass | S7: Bob had 2 strikes (one 2-line transaction plus one 1-line transaction). Overriding the single line gave 1; overriding one of the two lines left 1; the second gave 0. Alice at "5 strikes . blocked": after one override the reply said 4 strikes and the "blocked" label was gone. "blocked" follows the setting: with thresholds 1/2/3, Cara at 3 showed "3 strikes . blocked"; restored to 3/4/5 afterwards. |
| 4 | Works at any time, including after return | Pass | Override of a line still out and of a returned line (Alice Unit2, S4 data: note plus expected date, flagged, returned, overridden) both worked. S13: a line flagged by Run now and then overridden while still out was not flagged again by a later run (stayed OVERRIDDEN). |
| 5 | Audited; handler and viewer get 403 | Pass | 9 overrides gave 9 FLAG_OVERRIDDEN rows in audit_log (actor admin, entity transaction_item, before {flagStatus: FLAGGED}, after has reason, OVERRIDDEN, overrideAt). The race produced exactly one audit row. Handler and viewer: GET /api/flags and POST override both 403; no "Flag review" menu item (handler: Home, Checkout, Return; viewer: Home); /flags shows "You can't open this page" (tab title "Not allowed"). Anonymous 401. Request without the X-Requested-With header 403. Handler cannot POST /api/flagging/run (403). |
| 6 | Scenarios S4 and S7 pass | Pass | See rows 3 and 4. |

## Test cases
| TC | Result | Notes |
|---|---|---|
| TC-FLG-04 (S7) | Pass | By hand, see AC 3 |
| TC-FLG-22 | Pass | AC 1 |
| TC-FLG-23 | Pass | 4, whitespace, 501 refused; 5 and 500 accepted |
| TC-FLG-24 (S4) | Pass | Before and after return; danger button; success text |
| TC-FLG-25 | Pass | AC 5 |
| TC-FLG-31 (S13) | Pass | See AC 4 |
| TC-FLG-32 | Pass | Already overridden: 409 LINE_NOT_FLAGGED; unknown id: 404; no extra audit row. A NONE line was not tried separately. |
| TC-FLG-33 | Pass | Two browser tabs and two parallel API calls: one 200, one 409 "Only a flagged line can be overridden." One audit row. Losing tab: dialog closes, line leaves the list after reload, focus on search. |
| TC-FLG-34 | Pass | Old-semester flag not listed. With no current semester the screen says "No current semester is set." (API total 0, hasCurrentSemester false). Current semester restored. |
| TC-FLG-35, 36 | Not tested | Automated only (101+ borrowers, cap above 5000), as the card says |
| TC-FLG-37 | Pass | Strike counts 2, 1, 0 in replies (Bob) |
| TC-FLG-38 | Not tested | Function-level test only. Counts shown in the UI matched my SQL data every time. |
| TC-FLG-39 | Pass | "3 strikes", "5 strikes . blocked", Issued in Asia/Manila |
| TC-FLG-40 | Pass | Focus on search after an override, after Retry (fetch failure injected) and after a refused or lost race |
| TC-FLG-41 | Pass | Cancel sent no request. Confirm showed "Flagging run finished. 1 line flagged." (real run, flagged a backdated QA line). Second run within a minute: "Flagging was run less than a minute ago. Try again in 59 seconds." Reopening the dialog cleared the refusal. Dialog has aria-describedby. |

## Additional tests run
- Layout at 1280, 1000, 400, 320 with a 100-character borrower name, 100-character item name, 500-character unbroken note and a long multi-word note: no page-level sideways scroll (scrollWidth equals clientWidth at every width); the table scrolls inside its own card. Override dialog at 400 and 320: no scroll, long names wrap, buttons stack.
- Keyboard only: tab order Run flagging now, search, Returned select, Search, row Override buttons. Enter in the search field searches. Enter or Space on Override opens the dialog with focus in the reason field. Tab to Override flag and Enter submits; Escape closes and returns focus to the row's Override button. Cancel returns focus to the row button.
- Network failure during override (fetch rejected): "Could not reach the server. Please try again." banner, dialog stays open with the typed reason; pressing submit again after recovery worked.
- Search of 1 character: inline "Search text must be 2 to 100 characters."; list stays unfiltered.
- XSS: a note of `<img src=x onerror=...><b>bold</b>` is shown as plain text, not run.
- API bounds: page=0, pageSize=0 or 1000, bad returned value, q of 300 characters all 400 with field messages; non-GUID id 400; reason missing 400.
- Regression: Checkout and Return worked as the handler to set up the data (new checkout, partial return, return of a flagged line). Run flagging (POST /api/flagging/run) still skips overridden lines. Settings update still works.
- Health 200 throughout.

## Defects
None found.

## Observations (not bugs)
1. API reply for a missing `reason` is the raw Zod text "Invalid input: expected string, received undefined" (the UI never sends this). Cosmetic; API only.
2. Differences from the mockup: no "Last flagging run ... Next run" line (card lists it as known, no endpoint); the run dialog does not name the last closing time ("issued before the last closing time (2 Nov 2026, 17:00)" in the mockup); the "Now" column says "Returned" without the return date and time ("Returned 3 Nov, 08:10" in the mockup); success banners stack until dismissed (mockup shows one); the menu says "Home", not "Dashboard", and has no Users or Audit log entries yet (other tickets).
3. The run dialog says "The run is recorded in the audit log", but a run writes one LINE_FLAGGED row per flagged line and nothing for a run that flags 0 lines. Owner may want the copy changed or a run-level entry (FLG-2 area).
4. Long unbroken notes (500 characters) make table rows very tall because the Note column is narrow. Usable, but a max height or wrap might be nicer.
5. The browser added a Grammarly element after the dialog buttons, so Tab from the last dialog button left the page (native modal behavior plus extension). Not an app issue.
6. Over-cap note (TC-FLG-36) not run by QA; automated only.

## Data and cleanup
All data used the prefix QA-FLG4-. Done: open lines returned, 15 items retired, 4 borrowers and the room deactivated, remaining FLAGGED QA lines set back to NONE, 9 lines left OVERRIDDEN (with audit rows). Settings back to 17:00 and 3/4/5; Sample semester is current again. Left behind because they cannot be removed: semester "QA-FLG4-Old semester" (not current, holds one moved QA transaction), and audit rows. Headless Edge killed with taskkill /T and its profile folder deleted.

# Round 2 (merge recheck)
Date / build or commit: 2026-11-10, branch feature/FLG-4-flag-override, head 11c02ac (merge of main with FLG-3), Docker 8080 stack as rebuilt (not restarted).
Environment: same as round 1. Data prefix QA-FLG4R2-: 3 borrowers (5, 3 and 4 flagged transactions, one unit item each), 14 unit items, one room. Flags set by psql, one statement per line.
Verdict: PASS

Not run by QA: step 1 (lint, typecheck, npm test, expect 1088).

| # | Check | Result | Notes |
|---|---|---|---|
| 1 | Flag review after merge | Pass | Lists, search, override, reason refusal (4 chars) with dark red submit, success text with strike count, focus to search, Run now ("Flagging run finished. 0 lines flagged."), handler and viewer 403 on GET /api/flags and override, menu item for admin only, no page scroll at 320 px. |
| 2 | Checkout banners and block | Pass | 3 strikes "Warning: 3 strikes.", 4 strikes "Notice: 4 strikes.", 5 strikes "Blocked: 5 strikes." with the Confirm checkout button disabled and "Checkout is blocked for this borrower (5 strikes)." API checkout for the 5-strike borrower: 409 BORROWER_BLOCKED. |
| 3 | Return badges | Pass | Return lists the open lines with "Warning: 3 strikes", "Notice: 4 strikes", "Blocked: 5 strikes" badges, the note that returns are always allowed, and a "Flag overridden" label on an overridden line. |
| 4 | TC-FLG-51 through the screens | Pass | Alice at 5 strikes: Blocked banner on Checkout. Admin overrode one line on /flags: "Flag overridden. ... now has 4 strikes." Checkout then showed "Notice: 4 strikes." and the checkout saved ("Checkout saved. 1 item issued to ... at 06:03. Due back by 17:00 today."). The 4-strike borrower stayed at 4 strikes after the new unflagged checkout. One FLAG_OVERRIDDEN audit row per override. |
| 5 | Strike counts agree | Pass | Same borrower on Checkout, Return and Flag review (screen and API): Alice 5 then 4, Bob 3 (2 after one override), Cara 4. All three screens matched each time. |

Defects: none. Observations: none new.

Cleanup: all QA-FLG4R2- lines returned, remaining FLAGGED lines set to NONE, 2 lines OVERRIDDEN by QA (with audit rows), 14 items retired, 3 borrowers and the room deactivated. Settings 17:00 and 3/4/5; Sample semester current. Edge process tree killed and profile folder deleted.
