# BRW-3 Manual Test Report, round 2
Date / build or commit: 2026-11-07 (Manila, about 15:55 to 16:05), branch feature/BRW-3-checkout-ui, head bd83671 (the owner says the running containers were built from it; I did not rebuild).
Environment: Windows 11, Docker Compose stack (db, api, web) at http://127.0.0.1:8080, dev database. Browser: headless Microsoft Edge 156 driven with puppeteer-core, own temporary profile, `--disable-extensions`, real mouse and key events. API set-up and checks used a Node script with a cookie session and the `X-Requested-With: fetch` header. I did not run `npm test` and did not touch db-test. I did not re-read the mockup this round (no layout change was asked for; round 1 compared it).
Verdict: FAIL (BUG-1 from round 1 is only partly fixed; 1 Medium and 2 Low defects; all 6 acceptance criteria still pass)

## Limits of this run

- `qa-handler` and `qa-viewer` still return 401 with `QA_PASSWORD` (checked by API). Everything was done as **admin** (admin may check out, SPEC 3). Handler and viewer access: Not tested this round (nothing in the round 2 change touches it; TC-BRW-36 and TC-BRW-38 cover it).
- Test data I added (all prefixed QA2-): items QA2-Last cord, QA2-Cord plenty (20), QA2-Laptop A to E, QA2-Long item name ..., a 100-character room "QA2 Very Long Room Name ..." (now deactivated), room "QA2 Room 42597". Several open QA transactions were created. Closing time is back at 17:00 and thresholds are 3/4/5 (checked with GET /api/settings and /api/closing-time).

## Round 2 focus items

| Item | Result | Notes |
|---|---|---|
| BUG-1 / TC-BRW-41 sideways scroll | **FAIL** | See BUG-1 (still open) and BUG-2. The fieldset now shrinks and the table scrolls inside its box, but a hidden "Remove" label still makes the page scroll sideways at some widths. |
| TC-BRW-18 availability after INSUFFICIENT_QUANTITY | Pass | QA2-Cord plenty (20 in stock), cart quantity 20, another checkout took 5, then Confirm: "Checkout not saved. Only 15 of QA2-Cord plenty available, 20 requested. Nothing was issued." and the line now reads "Quantity item · 15 available" with "Only 15 available" under it. Round 1 showed the stale number. Focus moved to the quantity field. |
| TC-BRW-17 focus after save | Pass | After a successful Confirm, focus is on "Start a new checkout" (`#start-over`). Enter starts a clean form (borrower, room and items empty) and focus lands on the borrower search. |
| TC-BRW-17 empty Confirm focuses the first missing field | **FAIL** (partly) | See BUG-3. The first press leaves focus on the Confirm button; a second press works. |
| TC-BRW-40 after closing | Pass | Manila time about 15:58. Set closing time to 15:50 (a time already past): helper text reads "Lines still out at 15:50 tomorrow are flagged anyway." and Summary reads "Due back: Tomorrow by 15:50". The saved message reads "Due back by 15:50 tomorrow." Restored to 17:00 afterwards (verified). |
| TC-BRW-19 keyboard only | Pass | Real key events only: 10 Tabs to the borrower search (skip link, top bar, menu), typed "QA-Borrower Two", Tab to "Choose QA-Borrower Two", Enter, Tab to the room list, ArrowDown to "Room 101", Tab (past "+ Add a new room or lab") to the item search, typed "QA2-Laptop C", Tab, Enter on "Add QA2-Laptop C" (focus returns to the item search), Tab to the line's Note field and typed a note, 4 more Tabs to "Confirm checkout", Enter. Result: "Checkout saved. 1 item issued to QA-Borrower Two for Room 101 at 15:59. Due back by 17:00 today." Focus then on "Start a new checkout"; Enter went to the borrower search. No mouse used. |

## Acceptance criteria results (regression)

| # | Criterion | Result | Notes |
|---|---|---|---|
| 1 | Borrower lookup shows name, type, and department | Pass | "ga" lists "Ana Garcia, E-0001 · Employee · Registrar". "zzzz": "No borrower matches "zzzz". Check the spelling or search by school ID." An inactive borrower shows the "Inactive borrower ..." panel and Confirm checkout is disabled. Handler/viewer: Not tested. |
| 2 | Room or lab picker with add-new | Pass | Empty name: "Enter a room or lab name." with no request. "room 101": ""Room 101" already exists. Names are compared without regard to case." Valid new name: `Room "QA2 Room 42597" added.` and it is selected. |
| 3 | Item search with quantity entry for quantity items | Pass | Rows show name, asset tag or "Quantity item · N in total", and "15 available", "0 available", "Available", "Out". Quantity 0, -1, 1.5 and empty each show "Enter a whole number from 1 to 10,000." and send nothing. |
| 4 | Optional note and expected return date per line | Pass | Date picker `min` is 2026-11-07 (today in Manila). Notes typed and saved. Past-date refusal not re-run (no code change); it passed in round 1. |
| 5 | Confirmation summary; double submission is prevented | Pass | Summary shows "2 × QA2-Cord plenty", borrower, room, "Issued by Administrator (you)", "Due back Today by 17:00". Two `click()` calls in the same moment sent exactly one POST /transactions; the button then reads "Saved". |
| 6 | API errors are shown with their messages | Pass | INSUFFICIENT_QUANTITY (above) and ITEM_UNAVAILABLE ("Checkout not saved. QA2-Laptop D QA2-LT-D is already borrowed. Nothing was issued." on the banner and on the line). |

## Additional tests run

- **Widths with borrower chosen and one or two lines added** (page `scrollWidth` against `clientWidth`):
  - Normal data (QA2-Last cord, QA2-Laptop A): 320, 360, 400, 480, 600, 700 px: sideways scroll (page 714 px wide). 740, 760, 768 px: fits. 780, 800, 820, 850, 900 px: sideways scroll (page 934 px). 950, 975, 1000, 1020, 1050, 1280 px: fits.
  - With a long item name (QA2-Long item name Very-Long-Equipment-Name-Without-Spaces-... plus a 41-character asset tag): the lines table and the fieldset behave the same as with normal data (the table scrolls inside its box, the name wraps or is clipped inside the table). At 1000 px it fits; at 360 px the same 714 px page width as with normal data.
  - With no line added (borrower only), the page fits at 360 and 768 px.
  - Hard check at 360 px: `window.scrollTo(2000, 0)` gives `scrollX` 354 and a blank screen (screenshot taken), so the sideways scroll is real, not only a measurement.
- **Very long room name** (100 characters, no unbroken spaces): see BUG-2.
- **Closing time left restored**: `PUT /api/settings` with 17:00 and 3/4/5, verified.
- **Clean-up**: 22 headless Edge profile folders created by my runs were removed (retrying), the browser process trees were killed with `taskkill /T /F`; no `edge-*` folder is left in the temp folder.

## Defects

### BUG-1: Checkout page still scrolls sideways once an item line is added (round 1 BUG-1 only partly fixed)
- Severity: Medium
- Steps to reproduce:
  1. Sign in as admin and open http://127.0.0.1:8080/checkout.
  2. Make the browser window 360 px wide (also 400, 480, 600, 700 px, or 780 to 900 px).
  3. In "1. Borrower" search "QA-Borrower One" and click Choose.
  4. In "3. Items" search "QA2-Last cord" and click Add (any item gives the same result).
  5. Try to scroll the page sideways (or run `document.documentElement.scrollWidth` in the console).
- Expected: the page is as wide as the window. Only the lines table scrolls sideways inside its own box.
- Actual: the page is 714 px wide (at 780 to 900 px: 934 px) and scrolls sideways into a blank area (`scrollX` reaches 354 at a 360 px window). It does not happen at 740 to 768 px or at 950 px and wider, so a spot check at 768 px or 1000 px passes. The fieldset and table now behave (table scrolls in its own box); the cause is a `<span class="sr-only">Remove</span>` in the lines table header. It is positioned absolutely and none of its ancestors (the table's scroll `div`, fieldset, main) has `position: relative`, so the table's `overflow-x: auto` box does not clip it, and the page scrolls to reach it. The span sits at the "Remove" column, which lies beyond the window edge in the widths above.
- Role / data used: admin; QA-Borrower One; QA2-Last cord (also QA2-Laptop A).
- Notes: probable fix is `relative` on the scroll wrapper of the lines table (the span is then clipped by it). TC-BRW-41's jsdom test cannot see this. The department PC at half-screen width (about 960 px) is just outside the failing range, but a narrower window or a tablet is not.

### BUG-2: A very long room name widens the page and makes it scroll sideways
- Severity: Low
- Steps to reproduce:
  1. As admin, create a room whose name is 100 characters long, for example `POST /api/rooms` with `{"name":"QA2 Very Long Room Name Building-Annex-Wing-Building-Annex-Wing-Building-Annex-Wing-Building-Annex-W"}` (a handler can also add it with "+ Add a new room or lab" at checkout).
  2. Open http://127.0.0.1:8080/checkout at a window width of 1100 px (nothing else chosen, no lines).
  3. Check `document.documentElement.scrollWidth`.
- Expected: the room picker stays inside the window and the long name is cut off inside the list.
- Actual: the "Where will the items be used?" select is 854 px wide, so the page is 899 px wide at 360 and 768 px windows and 1119 px wide at 1100 px. It fits at 1400 px. It happens with no borrower and no items, and goes away when the room is deactivated.
- Role / data used: admin; room name of 100 characters.
- Notes: likely `max-w-full` / `min-w-0` is missing on the select. Low because a 100-character room name is unusual.

### BUG-3: First press of Confirm checkout with nothing chosen does not move focus to the borrower search
- Severity: Low
- Steps to reproduce:
  1. Open http://127.0.0.1:8080/checkout (fresh load, nothing chosen).
  2. Click "Confirm checkout" (or Tab to it and press Enter).
  3. Look at which element has focus (`document.activeElement`), after 100 ms, 600 ms and 1.5 s.
  4. Click "Confirm checkout" a second time.
- Expected: after step 2, focus is on the borrower search (the first missing field), as FND-7 does and as the card comment says.
- Actual: after step 2 the messages "Choose a borrower.", "Choose a room or lab.", "Add at least one item." show and the three fields are marked invalid, but focus stays on the Confirm button (same with the mouse and the keyboard). After the second click, focus does move to the borrower search.
- Role / data used: admin; no data.
- Notes: the focus runs in an effect that looks for `[aria-invalid="true"]`; on the first press the attributes are probably not on the page yet when it runs. The jsdom test cannot show this (the card says so too). This was round 1 observation 6.

## Observations (not bugs)

1. The helper text and Summary after closing time match the owner's wording (TC-BRW-40). Before closing time the text and Summary read "today" as before.
2. Whether Add is still disabled for Out and 0-available items was not re-checked this round (round 1 passed it).
3. With search results of many QA items the list still shows at most 10 rows with no hint (round 1 observations 1 and 2, owner chose not to change).
4. The success message still counts lines ("1 item issued") not units, as the owner decided.

## Not tested

- Handler and viewer accounts (sign-in fails with `QA_PASSWORD`).
- `npm run lint`, `typecheck`, `npm test` (not run, by instruction).
- The past-date refusal and the other refusals (LOCATION_INACTIVE, BORROWER_INACTIVE) were not re-run, because round 2 did not touch them.
- Re-comparison with the mockup this round.
- Blocked borrower and strike banners (FLG-3).
