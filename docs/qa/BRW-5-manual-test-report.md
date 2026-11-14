# BRW-5 Manual Test Report
Date / build or commit: 2026-11-10, branch feature/BRW-5-return-ui, head 6a14671 (docker stack on http://127.0.0.1:8080 already built from it, not rebuilt)
Environment: Windows 11, docker compose stack (db, api, web), dev database. API driven with node scripts (session cookie plus `X-Requested-With: fetch`). UI driven in headless Edge over DevTools (typing, clicks, Tab/Enter/arrow keys, screenshots, DOM measurements). SQL through psql in the db container (flag_status only). Roles: admin, qa-handler, qa-viewer. I did not run `npm test` (the automated QA agent owns that).
Verdict: FAIL (minor): every acceptance criterion passes, but the Search box collapses to 26 px at 320 px and 105 px at 400 px (BUG-1, Medium), and the refusal message reads wrongly (BUG-2, Low).

Backlog and card agree: BRW-5 in `docs/BACKLOG.md` has the four criteria that the card lists. TEST_CASES.md rows TC-BRW-27 to 29 and 42 to 48 match the card. Mockup read worked (Return.dc.html); differences are listed under Observations.

## Acceptance criteria results
| # | Criterion | Result | Notes |
|---|---|---|---|
| 1 | Find open borrowings by borrower, item, or asset tag | Pass | By borrower (name, school ID, case-insensitive, extra spaces trimmed), by item (case-insensitive), by asset tag (case-insensitive) all return the right lines, in UI and API. Empty search lists every open line (UI showed 50 of 66 with the "Showing 50 of 66 ... narrow the list" note; page 2 via API gave the rest). One-character text is refused on the field ("Search text must be 2 to 100 characters.", aria-invalid, focus stays in Search). `100%` finds only the item named "100% pure_cable", `%%` and `_____` and `pure_x` find nothing, `pure_c` finds the cable (literal match). A SQL-looking string finds nothing and gives 200. Fully returned lines do not appear. TC-BRW-27, 42, 46. |
| 2 | Return all or part of a line | Pass | 1 of 3 cords: banner "Return recorded", row shows "Out: 2 of 3", quantity box resets to 2, focus goes to Search. A UNIT line has the quantity fixed at 1 and disabled, and disappears after the return. Quantity 0, -1, 1.5, 10001, 99999999999, "e" and blank are all stopped on the row ("Enter a whole number from 1 to 10,000.", aria-invalid, focus on the box, nothing sent). Two rapid clicks on Return recorded one return only. Refusal from two tabs: see Additional tests. TC-BRW-28, 44, 47. |
| 3 | Select condition | Pass | Default is Good on every row. UNIT laptop returned DAMAGED: Inventory/API shows the item DAMAGED (status ACTIVE). UNIT laptop (GOOD) returned FAIR: item stays GOOD. A FAIR item returned as Good stays FAIR (a return never raises it). A QUANTITY item returned DAMAGED keeps condition GOOD. FAIR stored on the return rows (psql). TC-BRW-29. |
| 4 | Flagged lines are clearly marked | Pass | Flagged line (flag_status set by SQL): pale red row tint plus a badge with a flag icon (aria-hidden) and the word "Flagged"; colours are dark red #4C0A0A on #F7ECEC (high contrast). The mark survives without colour. Overridden line shows the text "Flag overridden". Not flagged shows "Not flagged". Returning a flagged line shows "The flag on this line stays until an admin overrides it." Returning an overridden line shows no such sentence. A flagged line returned in full leaves the list (flag status untouched, per BRW-4). |

## Test case results
| TC | Result | Notes |
|---|---|---|
| TC-BRW-27 | Pass (manual check of the behaviour) | See criterion 1. Automated part not re-run. |
| TC-BRW-28 | Pass (manual) | See criterion 2. |
| TC-BRW-29 | Pass (manual) | See criterion 4. |
| TC-BRW-42 | Pass (API by hand) | Borrower name and school ID, item, tag, empty text, page 2, `%` literal, retired item not tested by hand (no retired line created). |
| TC-BRW-43 | Pass | Handler 200, admin 200, viewer 403 FORBIDDEN, signed out 401 UNAUTHENTICATED. q of 1 character, q of 101 characters, pageSize 101, pageSize 0, page 0, unknown `by`, NUL in q: all 400 VALIDATION_ERROR with a field message. q of exactly 100 characters: 200. |
| TC-BRW-44 | Pass | See Additional tests (two tabs). Row marked with aria-invalid and message, focused; top banner "Return not saved ... Nothing was recorded." (but see BUG-2 for the wording). |
| TC-BRW-45 | Pass on the stated check, with BUG-1 | `scrollWidth == clientWidth` at 1280 (1265 plus scrollbar), 1000, 400 and 320 px, no element extends past the viewport, with a 100-character room name and 100-character item names (also a 300-character unbroken note and a 480-character note). Long names and notes wrap. But at 320 and 400 px the Search box is nearly unusable (BUG-1). |
| TC-BRW-46 | Not tested by hand | Needs 105 borrowers. Automated only. |
| TC-BRW-47 | Pass | Unit line returned from tab 2, then Return in tab 1: refused, row gone after reload, focus in Search. Quantity line: refused row keeps focus on its quantity box. Window-switch check below. |
| TC-BRW-48 | Not tested by hand | Needs 5001 borrowers with items out. Automated only, as the card says. |

## Additional tests run
- Two-tab refusal, quantity line (5 cords, flagged, expected date): tab 2 returned 3; tab 1 (still showing 5) entered 4. Result: banner "Return not saved ... Nothing was recorded.", the row marked red with a message, focus on that row's quantity box, list reloaded to "Out: 2 of 5", box reset to 2. Then tab 2 returned the last 2 and tab 1 tried 1: banner shown, row gone, focus moved to Search, "No open borrowings match ..." text.
- Two-tab refusal, unit line (long-named projector): refused, row gone, focus in Search.
- Focus after a window switch: refused a row in tab 1, a second return removed the row in tab 2, in tab 1 I clicked into Search and typed "zz", then switched windows (Page.bringToFront to tab 2 and back; a real visibilitychange fired). The list refetched (row disappeared), focus stayed in Search and the typed text was kept. (The earlier attempts where I only dispatched a fake event did not refetch, so they proved nothing; the real switch did.)
- Keyboard only: focus Find by, Tab to Search, type, Enter runs the search; Tab to quantity, type 2; Tab to Condition, ArrowDown to Fair; Tab to Return button, Enter. The return was recorded (qty 2, FAIR in the database), focus returned to Search. Tab order skips the disabled quantity box of a unit line. A focus ring is visible on the controls.
- Roles in the UI: viewer menu has only Home; opening /return directly shows "You can't open this page. Your role, View-only, does not have access to Return." Viewer API: GET /returns/open 403 and POST /returns 403. Admin sees Return in the menu and the screen works; admin API 200. Signed out, /return redirects to /login. A handler POST without `X-Requested-With` gets 403.
- Time: issue time shown as Manila time ("10 Nov 2026, 02:18" for a 18:18 UTC checkout). Expected date "12 Nov 2026" shown as the stored calendar date.
- Paging: 66 open lines, empty search shows 50 and the "Showing 50 of 66 ..." note; narrowing with a borrower name worked (57 for Dan, first 50 shown with the same note); response about 1 s.
- Regression: Checkout page at 320 px keeps its search boxes at 215 px (the squeeze is only on Return). The existing QA-FLG2 flagged data still lists on Return and was not touched. A QUANTITY item and a UNIT item can still be checked out after returns (availability correct).
- Rate limit: 54 quick checkouts hit RATE_LIMITED (429) after 34 in a minute. That is the existing write limit, not a BRW-5 issue. Logins also gave 429 after about 9 logins in a minute while I wrote my script.

## Defects
### BUG-1: Search box collapses on narrow windows (under 640 px)
- Severity: Medium
- Steps to reproduce:
  1. Sign in as qa-handler and open http://127.0.0.1:8080/return.
  2. Make the window 320 px wide (DevTools device toolbar, or Edge window resized), then 400 px.
  3. Look at the Search form (Find by, Search, Find open borrowings).
- Expected: the Search field is full width on its own line, as the Find by field is, and the button wraps below it (the mockup form wraps with a 280 px minimum). The field must be usable on a phone-width window.
- Actual: the Search input is 26 px wide at 320 px and 105 px at 400 px (measured: 500 px gives 205, 639 px gives 344, 640 px gives 315). The "Find open borrowings" button sits beside it, overlapping the "Search" label at 320 px, and the hint text "Leave empty to list every open borrowing." wraps one word per line. You cannot see what you type. There is no sideways scroll, so TC-BRW-45 as worded passes, but the control is unusable.
- Role / data used: qa-handler, Chrome-based headless Edge, widths 320, 400, 500, 639, 640, 700. Suspected cause: the field wrapper in `apps/web/src/pages/ReturnPage.tsx` is `w-full ... flex-1 sm:min-w-64`; `flex-1` sets the flex basis to 0, so below the `sm` breakpoint it shrinks instead of wrapping. The Checkout page does not have this problem at 320 px.

### BUG-2: Refusal message says "N returned" when nothing was returned
- Severity: Low
- Steps to reproduce:
  1. Create a checkout of 5 extension cords (any borrower) as a handler.
  2. Open Return in two tabs and find the line in both.
  3. In tab 2, return 3 cords. In tab 1 (still showing Out: 5), enter 4 and press Return quantity.
- Expected: wording like the mockup: "You entered 4 extension cords, but only 2 are still out on this line. Nothing was recorded."
- Actual: the banner and the row say "Return not saved. Only 2 of QA-BRW5 Extension cord still out, 4 returned. Nothing was recorded." The "4 returned" reads as if 4 had already been returned, when 4 is the number the handler tried to return. With 0 left, a unit item shows "Only 0 of <item> still out, 1 returned." The text comes from the API (`apps/api/src/services/returns.ts` line 59, from BRW-4) and the screen shows it as is; the same sentence also appears twice (banner and under the box).
- Role / data used: qa-handler; extension cord quantity item.

## Observations (not bugs)
1. Mockup comparison (Return.dc.html): the same fields and actions are there (Find by, Search, flag badge with icon and word, quantity, condition, Return / Return quantity, pinned success and error messages, empty state). Differences: the mockup shows one heading per borrower ("Open borrowings for X", with a strike badge) and a column header row; the build groups by transaction with the borrower name and school ID in each transaction header, and has no column headers (the controls have aria-labels). The mockup's "Edit note and date" and strike badge belong to BRW-6 and FLG-3, so their absence is expected. The mockup's table keeps a 900 px minimum with its own scroll; the build wraps instead, which is better on narrow windows.
2. The success message for a quantity item does not say how many were returned ("Return recorded. QA-BRW5 100% pure_cable received from QA-BRW5 Cara Reyes at 02:23 (condition: good)."). A handler returning 2 of 5 cannot confirm the 2 from the banner; the row's "Out: 3 of 5" does show it. Same as the mockup text, so left for the owner.
3. The red "Return not saved" banner stays on screen after the row message is gone (row was removed by the reload). Harmless, and it clears on the next Find or return.
4. Empty-state text for a search with no matches says "Check the spelling, or search by something else." (mockup says "Check the asset tag, or search by borrower instead."). Fine.
5. Blocked-borrower returns ("returns are never blocked", BR 11) and strike badges were not exercised: blocking (FLG-3) does not exist yet. The explanatory line "Returns are always allowed, even for a blocked borrower" is shown.
6. A retired or LOST item's open line was not tested by hand (owner decision says it is returnable); covered by the automated test only.
7. The card lists the "Retry offered for SEARCH_TOO_BROAD" as a known item; not testable by hand.

## Not tested
- TC-BRW-46 and TC-BRW-48 (need 105 and 5001 borrowers; automated only).
- `npm install`, lint, typecheck and `npm test` (steps 1 and 2): not run, the automated QA agent covers them.
- Retired/LOST item lines by hand; blocked borrower returns (FLG-3 missing).

## Test data and cleanup
All data prefixed QA-BRW5: borrowers QA-BRW5 Cara Reyes (QA-BRW5-001) and QA-BRW5 Dan Cruz (QA-BRW5-002); rooms QA-BRW5-Room1 and a 100-character room; items QA-BRW5 Laptop A, B, C, a 100-character projector and cord, QA-BRW5 Extension cord, "QA-BRW5 100% pure_cable", QA-BRW5 Bulk tape; about 70 transaction lines. Cleaned up: every open QA-BRW5 line was returned (GOOD), all QA-BRW5 items retired, both rooms and both borrowers deactivated. Laptop B stays DAMAGED and Laptop C stays FAIR (retired). I changed flag_status in SQL on 3 QA-BRW5 lines only. QA-FLG2 and QA-REG1 data was not touched. Headless Edge: whole process tree killed with taskkill /T, profile folder `edge-qa-brw5` deleted, no `edge-qa-brw5` process or folder left (an older `edge-qa-pid.txt` from an earlier round is in the temp folder, not mine). Scratch scripts are in the session scratchpad.

---

# Round 2
Date / build or commit: 2026-11-10, branch feature/BRW-5-return-ui, head b104fed (stack on 8080 already rebuilt; not rebuilt by me). I did not run lint, typecheck or `npm test`.
Environment: as round 1 (headless Edge over DevTools, node API scripts, psql for flag_status on 2 lines). Data prefix QA-BRW5R2 (borrower, room, items, 100-character cord and projector names, 300-character note).
Verdict: PASS. BUG-1 and BUG-2 are fixed; the round 1 passes still hold. No new defects.

## BUG-1 recheck (Search field, inside the AppShell, handler, 5 open lines with long names and notes)
| Width | scrollWidth vs clientWidth | Search input width | Button overlaps label | Button on its own line below | Hint height |
|---|---|---|---|---|---|
| 320 | 305 / 305 (no sideways scroll) | 215 px (was 26) | no | yes | 2 lines, normal wrap |
| 400 | 385 / 385 | 295 px (was 105) | no | yes | 1 line |
| 639 | 624 / 624 | 534 px | no | yes | 1 line |
| 640 | 625 / 625 | 315 px (same as round 1) | no | yes | 1 line |
| 1000 | 985 / 985 | 265 px | no | no (same row) | 1 line |
| 1280 | 1265 / 1265 | 545 px | no | no (same row) | 1 line |
(The scroll width is 15 px less than the window because of the page scrollbar.) Screenshot at 320 px checked by eye: field full width, button below it, no overlap. Result: Pass. TC-BRW-45 now also passes in spirit.

## BUG-2 recheck (two tabs)
- Some left: 5 cords out, tab 2 returned 3, tab 1 entered 4. Banner: "Return not saved. You entered 4 of QA-BRW5R2 Extension cord, but the amount still out on this line is 2. Nothing was recorded." The row message is the same sentence without "Nothing was recorded." The phrase appears once on the page. Row marked, focus on its quantity box, quantity reset to 2. Pass.
- 0 left, unit item: tab 2 returned Laptop A, tab 1 pressed Return on it. Banner: "Return not saved. QA-BRW5R2 Laptop A QA-BRW5R2-LT1 on this line is already fully returned. Nothing was recorded." Phrase once, row gone, focus in Search. Pass.
- 0 left, 100-character unit item (same result, focus in Search) and 0 left, quantity item ("QA-BRW5R2 Extension cord on this line is already fully returned.", focus in Search): Pass. No message says "N returned" any more.

## Spot-check of round 1 (all still pass)
- Find by borrower, item and asset tag, 1 character refused (API 400), viewer GET and POST 403, viewer UI shows only Home and "You can't open this page".
- Partial return of 1 of 5 cords: success banner, row shows 4 left and the quantity box shows 4.
- Flagged line: Flagged badge with icon and word; overridden line shows "Flag overridden"; returning the flagged unit shows "The flag on this line stays until an admin overrides it."; returning the overridden line does not.
- A FAIR return of a GOOD unit laptop (the flagged one) leaves it GOOD; a DAMAGED return of a quantity item leaves it GOOD. (DAMAGED on a UNIT item was not re-run in round 2; BRW-4 logic is unchanged by these commits.)
- Keyboard-only and the window-switch focus check were not re-run (no change to that code in the three commits); the 0-left unit case confirmed focus goes to Search.

## Cleanup (round 2)
All open QA-BRW5R2 lines returned, items retired, room and borrower deactivated. Edge process tree killed (taskkill /T), profile folder deleted, no `edge-qa-brw5` process or folder left (`edge-qa-pid.txt` in temp is older and not mine).
