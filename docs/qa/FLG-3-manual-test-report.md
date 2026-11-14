# FLG-3 Manual Test Report
Date / build or commit: 2026-11-10, branch feature/FLG-3-strike-blocking, head e1fa3d4
Environment: Docker stack on http://127.0.0.1:8080 (built from e1fa3d4, not rebuilt), dev DB reseeded 2026-11-10, headless Edge over DevTools, Windows 11. Roles used: qa-handler, admin, qa-viewer. Test data prefixed QA-FLG3-.
Verdict: PASS

Scope: How to QA steps 3 to 12 of the card comment. Steps 1 and 2 (npm test, lint, typecheck) were not run by me. TC-FLG-52 and TC-FLG-55 are automated only and were not exercised by hand.

## Acceptance criteria results
| # | Criterion | Result | Notes |
|---|---|---|---|
| 1 | Warning at the warning threshold (BR 11, S8; TC-FLG-17, 21) | Pass | Fil at 3 strikes: box shows "3 strikes / Sample semester". Banner: "Warning: 3 strikes. <full name> has 3 flagged checkouts this semester. Checkout is allowed." Confirm checkout enabled; a checkout through the UI (Ma. Teresa Lim) and through the API (Fil) saved. |
| 2 | Stricter notice at the notice threshold (TC-FLG-18, 21) | Pass | 4 strikes: "Notice: 4 strikes. ... Checkout is allowed, but at 5 strikes <name> will be blocked from borrowing." API checkout returned 201. |
| 3 | Blocked at the block threshold, enforced in the API with BORROWER_BLOCKED (TC-FLG-19, S8) | Pass | 5 strikes: banner "Blocked: 5 strikes ... can still return items.", Confirm checkout disabled, room and item sections disabled, text "Checkout is blocked for this borrower (5 strikes)." No "Inactive borrower" alert for an active blocked borrower. API: POST /api/transactions returns 409 BORROWER_BLOCKED with its own message ("This borrower is blocked from borrowing this semester because of too many strikes. An admin can override a flag to unblock them."). Admin is blocked too. 4 parallel checkouts with an upper-case borrower id: 4 x 409. Refused calls created no transaction row and no CHECKOUT audit entry (CHECKOUT audit count equals the successful checkouts). |
| 4 | Thresholds come from settings (TC-FLG-20) | Pass | Settings 2/3/4: Ma (3 strikes) shows Notice with "at 4 strikes"; a borrower with 4 strikes shows Blocked and checkout gives 409. Settings 1/2/3: Ma blocked at 3. Restored to 3/4/5 (confirmed in DB). See Observation 1. |
| 5 | Returns are never blocked (TC-FLG-50, TC-BRW-26) | Pass | Fil at 5 strikes: a return on the Return screen and a return through POST /api/returns both gave 201; the flag stayed FLAGGED and the strike count stayed 5. Also true while the borrower was inactive. |
| 6 | Override brings borrower down and checkout works again (TC-FLG-51, S8) | Pass | SQL set one of 5 flagged lines to OVERRIDDEN: strikes 4, checkout 201. Flagging another line: 5 again, 409. |
| 7 | Return strike badges, no /strikes requests (TC-FLG-56, 58) | Pass | Return screen with 4 borrowers out (19 lines, 17 transaction headers): each header shows a badge ("Blocked: 5 strikes", "Notice: 4 strikes", "Warning: 3 strikes", "0 strikes"). Network log: only GET /api/auth/me and GET /api/returns/open. The open reply carries the three thresholds and per-line strikes. Return button stays enabled for the blocked borrower. |
| 8 | Retry when strikes fail (TC-FLG-57) | Pass | DevTools Fetch failed the /strikes request: Checkout showed "Could not reach the server. Please try again. Retry" and no "0 strikes". After lifting the failure, Retry loaded "5 strikes" and the blocked banner. With the load still failing, Confirm checkout was enabled but the server still refused ("Checkout not saved. This borrower is blocked ..."). |
| 9 | Roles and errors on GET /api/borrowers/:id/strikes (TC-FLG-53) | Pass | handler 200, admin 200, viewer 403, signed out 401, unknown id 404 NOT_FOUND "Borrower not found.", malformed id 400 VALIDATION_ERROR. Viewer POST /transactions 403; viewer GET /returns/open 403; signed out 401. |
| 10 | No current semester (TC-FLG-54, 59) | Pass | With is_current set false by SQL: strikes endpoint 200 with strikes 0 and semesterName null; checkout 409 NO_CURRENT_SEMESTER; Checkout shows "0 strikes"; Return badges show 0. Semester restored. |
| 11 | Layout: no sideways scroll at 1280, 1000, 400, 320 with banners and a 100-character name without spaces | Pass | Checked Checkout (100-char name at 4 strikes, Fil at 5, Ma at 3) and Return at all four widths: scrollWidth equals clientWidth and no element is wider than the viewport. The long name wraps in the borrower box and banner. |
| 12 | Keyboard and screen reader | Pass with notes | Banners are role="alert" with an aria-hidden icon and the text "Warning/Notice/Blocked: N strikes." first, so colour is not the only signal; they announce when they appear. Choose button is reachable by Tab and Enter. See Observations 2 and 3. |

Test cases confirmed by hand: TC-FLG-17, 18, 19, 20, 21, 50, 51, 53, 54, 56, 57, 58, 59 and TC-BRW-26. Not tested by hand: TC-FLG-52 and TC-FLG-55 (automated only).

## Additional tests run
- Inactive and blocked at once (Fil deactivated): Checkout shows both the Blocked banner and the "Inactive borrower" alert, locked text "Inactive borrowers cannot borrow."; API gives BORROWER_INACTIVE. Reactivated afterwards. Acceptable.
- Upper-case GUID in the strikes URL and in the checkout body works (200 and 409).
- Happy path through the UI at 3 strikes: room, item, Confirm checkout gave "Checkout saved ..." and the warning banner stayed.
- Settings validation: 3/4/4 refused with "Thresholds must go up: warning, then ..." (400).
- Regression: ordinary checkout at 0 to 2 strikes unchanged; the return message "The flag on this line stays until an admin overrides it." still shows.
- Cleanup done: all QA-FLG3- lines returned, flags set to NONE, 4 borrowers deactivated, 2 items retired (PATCH status RETIRED), room QA-FLG3-Room1 deactivated, settings 3/4/5, semester current. No Edge profile folder left in temp. No application code changed.

## Defects
None found.

## Observations (not bugs)
1. The card says "set the block threshold to 4". Settings must go up (warning < notice < block), so block 4 can only be set with warning 2 and notice 3; 3/4/4 is refused. Worth a wording fix in the QA steps.
2. After choosing a borrower by keyboard (Tab to Choose, Enter), focus falls to the page body because the result list closes, so a keyboard user must Tab through about 8 elements to get back to the form. This comes from BRW-3 code (chooseBorrower is unchanged by FLG-3). Suggest a follow-up: move focus to the room select after choosing.
3. Known and accepted by the owner: the Blocked banner is the light-red alert, not the mockup's solid dark red; warning and notice banners use role="alert" (assertive) rather than polite.
4. With no current semester, a blocked borrower shows "0 strikes" on Checkout and Return (as TC-FLG-54 and 59 specify). Checkout is still refused with NO_CURRENT_SEMESTER.
5. The Return screen shows one badge per transaction header, so a borrower with many open transactions repeats the same badge. Matches the design.
6. Blocked banner says "unless an admin overrides a flag"; the mockup says "one of his flags". Fine.
7. DELETE on an item or room with history returns 409 (BR 15); retiring and deactivating through PATCH worked.
