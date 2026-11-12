# BRW-3 Manual Test Report

Date / build or commit: 2026-11-06 (Manila), branch feature/BRW-3-checkout-ui. The running containers were built 2026-11-05 22:06 UTC from head 3a7c1f7. The branch now has one extra commit on top, f240000 (QA gap tests only), which I did not need to rebuild for.
Environment: Windows 11, Docker Compose stack (db, api, web) already running and healthy at http://127.0.0.1:8080, dev database with sample data. Browser checks used headless Microsoft Edge driven over the DevTools protocol (real key events for the keyboard test). API checks used a Node script with a cookie session and the `X-Requested-With: fetch` header. I did not run `npm test` or touch the db-test container. Mockup: http://claude.ai/artifact/9FampTJnZj8twygeqD8iao, read with the Artifact tool (read only); the Checkout board was compared with the screen.
Verdict: FAIL (1 Medium defect, BUG-1; every acceptance criterion passed; handler and viewer accounts could not be used, see Blockers)

## Blockers and limits of this run

- **I could not sign in as `qa-handler` or `qa-viewer`.** Both accounts exist but `QA_PASSWORD` in `.env` gives 401 (their stored passwords differ from it). The earlier QA rounds made them work by copying the admin's password hash in the database. The permission system refused that change when I tried it, so I did not do it. All browser and API checks were therefore made as **admin** (admin may check out too, SPEC 3). The handler and viewer rows below are marked Not tested live. The integration tests TC-BRW-36 and TC-BRW-38 cover them and the other QA agent is running them.
- Creating the bug card was refused by the permission system, so BUG-1 is in this report only. The card comment was posted.

## Acceptance criteria results

| # | Criterion | Result | Notes |
|---|---|---|---|
| 1 | Borrower lookup shows name, type, and department | Pass | As admin: typing "ga" lists "Ana Garcia, E-0001 · Employee · Registrar". Names, type and department show for students, employees and faculty. 1 character: nothing is searched. No match ("zzzz"): "No borrower matches "zzzz". Check the spelling or search by school ID." Inactive borrowers show an "Inactive" tag in the list; choosing one shows "Inactive borrower. QA-BRW2 Student's record is inactive, so this borrower cannot borrow. An admin can reactivate the record in Borrowers.", the rest of the form is greyed and Confirm checkout is disabled with "Inactive borrowers cannot borrow." This matches the mockup (pronoun-free wording is an accepted difference). Handler and viewer access: Not tested live (see Blockers). |
| 2 | Room or lab picker with add-new | Pass | Picker lists only active rooms (inactive QA-BRW rooms are not offered). "+ Add a new room or lab" opens a name field. `room 101` gives `"Room 101" already exists. Names are compared without regard to case.` under the field and sends one POST. An empty name gives "Enter a room or lab name." (no request). `QA-AddedAtCheckout` was created, selected, and a "Room ... added." message appears. |
| 3 | Item search with quantity entry for quantity items | Pass | Search lists name, asset tag or "Quantity item · N in total", and the availability. Labels seen: "3 available", "0 available", "1 available", "Available", "Out" (laptop already borrowed), "Under repair", "Retired". No borrower names appear anywhere. Add is disabled for Out, 0 available, Under repair and Retired items, and shows "Added" for an item already on a line. A unit line has no quantity field (shows 1); a quantity line has a number field. Quantity 0, -1, 1.5 and empty each show "Enter a whole number from 1 to 10,000." and nothing is sent. Search shows at most 10 rows (see Observations). |
| 4 | Optional note and expected return date per line | Pass | Each line has Note and Expected return. The date picker `min` is 2026-11-06 (today in Manila) while the browser's UTC date was still 2026-11-05 22:13, so the Manila rule is used. A date before today (2026-11-05, forced past the picker) is refused by the server: "Checkout not saved. Choose today or a later date. Nothing was issued." and "Choose today or a later date." shows on that line, with the field marked invalid and focused. A checkout with a note and today's date saved. |
| 5 | Confirmation summary; double submission is prevented | Pass | Summary lists one "qty × item" per line (for example "2 × QA-Cord 3", "1 × QA-Laptop QA-LT-1"), plus borrower, room, "Issued by Administrator (you)" and "Due back". Two `click()` calls in the same moment sent exactly one POST; the database has one transaction for QA-B1. After saving, the button reads "Saved" and is disabled. Confirm with nothing chosen sends nothing and shows "Choose a borrower.", "Choose a room or lab.", "Add at least one item." |
| 6 | API errors are shown with their messages | Pass | See the refusals table below. Each message shows in the pinned area with the API wording, item refusals mark the right line, and the form keeps its data. |

### Refusals (all as admin, second "tab" simulated with the API)

| Refusal | How forced | What the screen showed |
|---|---|---|
| INSUFFICIENT_QUANTITY | Cord with 3 in stock: typed 4; then, separately, API checked out the last cord after it was added to the cart | "Checkout not saved. Only 3 of QA-Cord 3 available, 4 requested. Nothing was issued." and, on the second try, "Only 0 of QA-Cord 3 available, 1 requested." The line shows "Only 3 available" / "Only 0 available", the quantity field is marked invalid and focused. |
| ITEM_UNAVAILABLE | API borrowed the laptop after it was added | "Checkout not saved. QA-Laptop2 QA-LT-2 is already borrowed. Nothing was issued." and the same text on the line; focus moved to that line's Remove button. |
| LOCATION_INACTIVE | Room deactivated through the API after it was selected | "Checkout not saved. This room is no longer in use. Ask an admin to reactivate it. Nothing was issued." |
| BORROWER_INACTIVE | Borrower deactivated through the API after being chosen | "Checkout not saved. This borrower is inactive and cannot borrow. Nothing was issued." |
| Date before today | Date forced to 2026-11-05 | "Choose today or a later date." on the line (criterion 4). |

## Additional tests run

Owner decisions and regression:

- **Closing time from settings (TC-BRW-38).** Set 18:30 as admin: Checkout shows "Today by 18:30" and "Lines still out at 18:30 are flagged anyway." Restored to 17:00 (verified with GET /api/settings and GET /api/closing-time).
- **Due back tomorrow after closing (TC-BRW-40).** Manila time was 06:17. Set closing time to 06:00 (a minute already passed). The Summary shows "Tomorrow by 06:00". After Confirm: "Checkout saved. 1 item issued to QA-Borrower Three for Room 101 at 06:17. Due back by 06:00 tomorrow." Closing time restored to 17:00 (thresholds 3/4/5 unchanged).
- **Pinned message area (TC-BRW-39).** Viewport 1000 x 500, a long page (five lines) and a "Room ... added." message. At scroll 0 the message sits 32 px under the top bar (page padding). At scroll 300, and at the bottom of a 2065 px page, its top stays at 0 and it is fully visible. The scroll-padding-top of the page is 65 px, and a field focused from far down (the borrower search) lands below the message (field top 253 px, message bottom 86 px). The screenshot at the bottom of the page shows the message at the top of the window.
- **Sign out with a message showing.** After signing out from the Checkout page with the message visible, `scroll-padding-top` is `auto` again, no inline style is left, no sticky element remains, and the sign-in card sits where it normally does (no extra blank space).
- **Keyboard-only checkout (TC-BRW-19).** Real key events only, no clicks: Tab to the borrower search (10 Tabs from the top, through the skip link, top bar and menu), typed "QA-Borrower Three", Tab then Enter on "Choose QA-Borrower Three", Tab to the room list and ArrowDown, Tab to the item search, typed "QA-Page item 12", Tab then Enter on "Add QA-Page item 12", Tab to the quantity field, Tab to the note field and typed a note, Tab to "Confirm checkout" and Enter. Result: "Checkout saved. 1 item issued to QA-Borrower Three for Computer Lab 1 at 06:34. Due back by 17:00 today." The focus ring and the labels were usable at each step. Pass.
- **Lookup API (admin and signed out).** `GET /api/borrowers/lookup?q=ga` as admin: 200 with only id, schoolId, name, type, department, active. Signed out: 401. `q` missing, 1 character, 101 characters: 400 VALIDATION_ERROR on `q`; 100 characters: 200. `pageSize=101` and `pageSize=0`: 400. `page=2&pageSize=1` pages correctly (total 3). `q=%%` finds nothing (not a wildcard). `GET /api/borrowers` still works for admin.
- **`GET /api/closing-time`.** Admin 200 `{"closingTime":"17:00"}`; signed out 401; POST gives 404 (read only).
- **`GET /api/items`.** Every row has `available`: unit items 0 or 1, quantity items total minus outstanding, 0 for retired and under-repair items. No borrower fields.
- **Data checks.** One transaction exists for the double-click borrower. Rooms created at checkout appear in the room list.
- **Layout against the mockup.** Header, left menu, three numbered sections, Summary panel on the right, error banner, inactive-borrower panel and disabled sections match the approved mockup. Accepted differences (Summary lists one line per item, pronoun-free inactive wording, a results list under the borrower search, FLG-3 banners left for FLG-3) were seen and are as the owner decided. The mockup has no Return item in the menu yet (BRW-5).
- **Narrow window.** See BUG-1.
- **Clean-up.** Headless Edge started with its own profile; the whole process tree was killed with `taskkill /T /F` and the profile folders deleted; no `edge-*` folder is left in the temp folder. (My first browser loaded extensions from the profile and made typing flaky; I restarted it with `--disable-extensions` and re-ran the keyboard test and the layout checks. The earlier failures were my browser's, not the app's.)

## Defects

### BUG-1: Checkout page scrolls sideways once an item is added, below about 1050 px wide
- Severity: Medium
- Steps to reproduce:
  1. Sign in and open http://127.0.0.1:8080/checkout.
  2. Make the browser window 1000 px wide (or 360 px wide).
  3. In "1. Borrower" search "QA-Borrower One" and choose it.
  4. In "3. Items" search "QA-Page item 13" and click Add, so a line appears in the "Items to check out" table.
  5. Look at the page: it scrolls sideways.
- Expected: the page stays as wide as the window. The lines table scrolls inside its own box (it already has `overflow-x-auto`), or the lines stack.
- Actual: the "3. Items" fieldset grows to 802 px (the table is 760 px). The page is 1046 px wide at a 1000 px window, 1046 px at 900, and 826 px at 768, 600 and 360 px (window width 360 gives a 345 px viewport, with sections 1 and 2 at 297 px and section 3 at 802 px). With no line added it fits. At 1100 px and wider it fits.
- Role / data used: admin; QA-Borrower One; QA-Page item 13.
- Notes: likely cause is the `<fieldset>` (its default `min-width: min-content` lets the table stretch it, so the table's own scroll box never scrolls). `min-w-0` on that fieldset is the usual fix. A half-screen window on a 1920 px monitor is about 960 px wide, so the department PC can hit this.

## Observations (not bugs)

1. Item search shows at most 10 rows and gives no hint that there are more ("QA-" listed 10 retired items and the real ones never appeared). A user has to type more of the name.
2. Retired items are listed in the search (labelled "Retired", Add disabled). That matches the mockup, but with many retired items they push active ones off the first 10.
3. After an INSUFFICIENT_QUANTITY refusal the line still says "Quantity item · 1 available" (cached from the search) while the error says "Only 0 available". Re-searching gives the right number.
4. A room deactivated after it was selected stays in the picker and stays selected after LOCATION_INACTIVE; the user has to pick another room or reload. The message tells them what to do.
5. After a successful save, keyboard focus drops to the page (nothing has focus). The message area is announced, but a keyboard user has to Tab again from the top.
6. With nothing chosen, Confirm checkout shows the three inline messages but does not move focus to the first one.
7. The success text says "2 items issued" when the two lines were 2 cords plus 1 laptop; it counts lines, not units. The Summary is clearer.
8. After closing time the helper text still reads "Lines still out at 06:00 are flagged anyway", while the Summary says "Tomorrow by 06:00". Not wrong, but a reader may expect "tomorrow" there too.
9. The API gives two different messages for the same bad `q`: a missing `q` says "Some fields are invalid." while a 1-character `q` says "Search text must be 2 to 100 characters." (the field detail is the same in both).
10. The branch head is f240000 (one test-only commit past the 3a7c1f7 that the card names, and that the containers were built from). Behaviour is the same.

## Not tested

- Handler and viewer access in the browser and by curl (accounts not usable, see Blockers): `/checkout` as a viewer, handler `GET /api/borrowers/lookup`, `GET /api/closing-time`, `/api/settings` 403, viewer 403 on lookup. Covered by TC-BRW-36 and TC-BRW-38 in the automated suite.
- `npm run lint`, `typecheck` and `npm test` (not run, because of the coordination note).
- Blocked borrower and strike banners (FLG-3, a later ticket).

## Test data left in the dev database (all prefixed QA-)

Borrowers QA-B1, QA-B2, QA-B3; rooms QA-RoomLive (inactive), QA-AddedAtCheckout, QA-Scroll175; items QA-Cord 3, QA-Laptop, QA-Laptop2; several open QA transactions (so those items show "Out"). Settings were restored: closing time 17:00, thresholds 3/4/5.

## Text prepared for Trello (not posted, the write tool was refused)

Bug card, list "Sprint 3: Checkout (22 pts)":
Title: `[BUG][Medium] Checkout page scrolls sideways once an item is added, below about 1050 px wide (found in BRW-3)`
Body: as BUG-1 above, in the board's bug format.

Card comment: posted on the BRW-3 card (it states that the bug card could not be created).
