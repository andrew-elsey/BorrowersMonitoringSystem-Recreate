# REG-1 Manual Test Report
Date / build or commit: 2026-11-09, branch fix/REG-1-regression-followups, head ce24615 (web image built from 164d2b4; ce24615 changes only a test and docs)
Environment: Windows 11, docker compose stack at http://127.0.0.1:8080 (db, api, web), dev database. Headless Edge driven over the DevTools protocol (screenshots, DOM measurements), data created through the API from the signed-in page, SQL through psql in the db container. Roles: admin, qa-handler, qa-viewer.
Verdict: FAIL (1 Medium defect against acceptance criterion 4)

Not run by me: `npm run lint`, `typecheck`, `npm test` (criterion 6 and the "full suite" part of criterion 7) and the TEST_CASES.md grep checks (criterion 5). The task scope was the browser checks only.

## Acceptance criteria results
| # | Criterion | Result | Notes |
|---|---|---|---|
| 1 | Available column on Inventory items, as in the mockup | Pass | Mockup read (project/Inventory.dc.html). Column order matches: Name, Category, Tracking, Asset tag, Available, Condition, Status, Actions. Quantity item "10 of 10", after checking out 3 it shows "7 of 10", after returning 1 it shows "8 of 10", after returning the rest "10 of 10". Unit item shows "Available", "Out" while checked out, "Available" after return. Unit items Under repair, Lost, Retired and a Retired quantity item show "—". |
| 2 | Each route has its own tab title | Pass | See table below. Titles also update on sidebar navigation (client side). |
| 3 | Expired-session message only after expiry | Pass (see OBS-1) | Real expiry by deleting the session rows with psql. See details below. |
| 4 | Wrapping at 1000/400/320 px, no sideways page scroll | FAIL | No word split anywhere, long room and category names wrap and buttons stay in view, but the Items page scrolls sideways when a category has a long name (BUG-1). |
| 5 | TEST_CASES.md paths | Not tested | Outside the browser scope of this run. |
| 6 | No MaxListenersExceededWarning in npm test | Not tested | Same. |
| 7 | Suite, lint, typecheck, Docker check | Partly | Docker stack up and healthy: `/api/health` and `/` both 200. Suite, lint and typecheck not run by me. |

### Criterion 2 detail: tab titles (all end with " · Borrowers Monitoring System")
| Route | admin | qa-handler | qa-viewer |
|---|---|---|---|
| /login (signed out) | Sign in | - | - |
| / | Home | Home | Home |
| /checkout | Checkout | Checkout | Not allowed |
| /checkout/ (trailing slash) | Checkout | Checkout | Not allowed |
| /inventory and /inventory/ | Inventory and categories | Not allowed | Not allowed |
| /borrowers | Borrowers | Not allowed | Not allowed |
| /rooms | Rooms and labs | Not allowed | Not allowed |
| /settings | Settings and semesters | Not allowed | Not allowed |
| /password | Change password | Change password | Change password |
| /nonexistent | redirects to /, Home | Home | Home |

Signed-out /inventory redirects to /login and shows "Sign in".

### Criterion 3 detail: session expiry (admin, real expiry)
- Signed in on /inventory, deleted all admin rows from `session` with psql, clicked the Categories tab: lands on /login, alert reads "Your session has expired. Please sign in again." Result: pass.
- The alert is `role="alert"` (the "wait" style), so it is announced. Pass.
- Signed in again: lands back on /inventory, no message. Pass.
- Sign out: login page, no alerts. Pass.
- Wrong password on a clean login page: only "Incorrect username or password." Pass.
- Fresh browser profile opening /inventory, / and /login: no message. Pass.
- Expiry, then a full page reload (F5) of /inventory: login page with no message (the in-memory flag is lost). Not specified by the ticket; see OBS-2.
- Deactivated-user wording was not tested (only the expiry route above).

### Criterion 1 detail
Test data: QA-REG1-Unit active/repair/retired/lost and QA-REG1-Qty active (total 10) and QA-REG1-Qty retired. Screenshots in the scratchpad (`avail-before.png`, `avail-out.png`).

### Criterion 4 detail: measurements (admin, no long category present unless stated)
Words split across lines: none found in any table at 1000, 400 or 320 px on Items, Categories, Borrowers, Rooms, Settings and Semesters (checked every word with a DOM range, short words only).

| Width | Page | Page scroll | Long name (100 chars, no spaces) |
|---|---|---|---|
| 1000 | Categories | no | wraps in a 331 px cell, Rename and Delete visible at x 672 to 815 |
| 1000 | Rooms | no | wraps in a 288 px cell, Rename/Deactivate/Delete visible at x 837 to 929 (table scrolls inside its box by 29 px) |
| 1000 | Items | no without a long category, yes with one (BUG-1) | Item name wraps in a 288 px cell. The table is wider than its box, so Edit/Delete are reached by scrolling inside the box. |
| 400 and 320 | Categories, Rooms | no | table scrolls inside its own box, page does not |
| 1000, 400, 320 | Borrowers, Settings, Semesters | no | table scrolls inside its own box at 400 and 320 |
| 1280, 1000, 400, 320 | Items with a long category name | YES | BUG-1 |
| baseline | Items without the long category | no at 1280, 1000, 400, 320 | |

Criterion 5 of the task list (BRW-3 regression): Checkout with an item added, widths 1280, 1049, 1000, 400 and 320 px, with a 100-character room present in the room list: no sideways page scroll at any width. Pass.

## Additional tests run
- Retired, Lost and Under repair units and a Retired quantity item show "—" (see criterion 1).
- Partial return of a quantity line updated the Available figure immediately on reload (10 of 10, 7 of 10, 8 of 10, 10 of 10).
- Checkout page: 100-character room name does not widen the page, at all five widths.
- Added-item layout and mockup comparison: the "Actions" header is visible text in the app; in the mockup it is visually hidden. Minor (OBS-3).

## Defects
### BUG-1: Inventory page scrolls sideways when a category has a long name
- Severity: Medium
- Steps to reproduce:
  1. Sign in as admin at http://127.0.0.1:8080.
  2. Go to Inventory and categories, Categories tab, and add a category named QA-REG1- followed by 92 letter A (100 characters, no spaces).
  3. Open the Items tab (/inventory) at 1280, 1000, 400 or 320 px wide.
  4. In the console run `document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth`.
- Expected: false. The page never scrolls sideways at 1000, 400 or 320 px (criterion 4).
- Actual: true at every width. scrollWidth is 1312 at 1280 and 1000 px, and 1092 at 400 and 320 px. The widest element is the Category filter select (`id="category-filter"`), which grows to fit its longest option. After deleting the category the problem is gone (scrollWidth equals clientWidth at all four widths).
- Role / data used: admin; category "QA-REG1-AAAA..." (100 characters). Probably older than REG-1, but criterion 4 and TC-MD-35 require it.
- Trello: the bug card could not be created. The Trello write call was denied by the permission system, so no card exists. Suggested list: "Sprint 4: Returns and flagging (19 pts)". Suggested title: `[BUG][Medium] Inventory page scrolls sideways when a category has a long name (found in REG-1)`.

## Observations (not bugs)
- OBS-1: Expiry message plus wrong password: with the expiry message showing, a failed login shows both the expiry message and "Incorrect username or password." The ticket says "only the normal error"; the message is still true, but the owner may want it cleared on a failed attempt. TC-AUTH-37 only covers a failed login on a first visit, so this case is not tested by the suite.
- OBS-2: After expiry, a manual reload of the page (F5) shows no message, because the flag is kept in memory. Matches "does not show on a first visit"; just noting it.
- OBS-3: The Items table's "Actions" heading is visible; the mockup hides it. Pre-existing.
- OBS-4: Rooms at 1000 px: the table scrolls inside its box by about 29 px, so the "Used in N transactions" hint under Delete is partly clipped until scrolled. Buttons stay in view as required.
- OBS-5: Items at 1000 px: the 8-column table is wider than its box (about 743 px against 715 px, more with a long item name), so Edit and Delete need an inner scroll. The ticket only asks for room and category rows to keep their buttons in view, so this is not a failure, but the new Available column adds to it.
- Not tested: the Add item dialog category select with a long category (likely the same cause as BUG-1); the "deactivated user" message path; a quantity item with 0 available ("0 of N").

## Cleanup
- QA-REG1- categories and rooms: deleted. Items: the 100-character item and the four items without history were deleted. Two items with history cannot be deleted and were set to Retired: "QA-REG1-Unit active" and "QA-REG1-Qty active" (their transaction from the test is returned in full).
- Headless Edge: process trees killed, `edge-reg1-*` profile folders removed from the temp folder (none left).

---

# Round 2 (head f11ef36)
Date: 2026-11-09. Web container rebuilt from f11ef36 (health and `/` return 200). Same method as round 1 (headless Edge over DevTools, psql for session expiry, network latency emulation for the slow reply).
Verdict (round 2): PASS. BUG-1 is fixed and the expiry message no longer appears after a failed login. Not re-run by me: lint, typecheck, npm test.

| Check | Result |
|---|---|
| BUG-1: 100-character QA-REG1- category present, Items page `scrollWidth <= clientWidth` at 1280, 1000, 400, 320 px | Pass (ok at all four) |
| Add item form (inline form, not a dialog) with the long category | Page does not scroll at any of the four widths |
| Edit item dialog with the long category | Pass: dialog 440 px (1280, 1000), 347 px (400), 267 px (320); content width equals client width, category select 390/297/240 px fits inside the dialog, no page scroll |
| Filter labels not cut off | Pass: the filter selects (category 180 px, status 160 px, tracking 180 px) are wider than their selected text at all widths (measured text plus padding, 167 px needed for the tracking label). Note: the tracking filter's first option in this build reads "Unit and quantity" (as in the mockup), not "All tracking types". |
| Other selects unchanged and no page scroll: Borrowers filters, Checkout room picker (with a 100-character room), Settings, Rooms | Pass at 1280, 1000, 400, 320 (selects sized 180/244 px on Borrowers, room picker 456/462/295 px). The Borrowers page at 1000 px has no select visible in my measure (form closed). I did not compare against pixel screenshots of round 1. |
| Expiry, then a wrong password: only the login error | Pass: with a 2.5 s latency, while the reply was pending no alerts were shown; after the reply only "Incorrect username or password." |
| Press Sign in again: expiry message does not come back | Pass: only the normal error and the "Enter your password." field message (the form had cleared the password field); no expiry message. |
| Correct sign in afterwards | Pass: lands on /inventory, no alerts. Sign out then shows no message; a plain wrong password shows only the normal error. |
| Round 1 spot checks | Pass: Items header order and Available values ("8 of 10", "Out", "—" for retired), tab titles (Home, Checkout for /checkout/, Inventory and categories, Borrowers, Rooms and labs, Settings and semesters, Change password); Checkout page with a 100-character room did not scroll at 1280, 1000, 400, 320 px. |

Observation (not a defect): once, the title of `/` read "Borrowers Monitoring System" (without "Home ·") when read right after a login in my script; three later loads of `/` each read "Home · Borrowers Monitoring System" immediately and after 1.5 s. I believe it was my script reading the title during the post-login redirect, but could not reproduce it.

Round 2 cleanup: QA-REG1- category, room and the r2 item deleted. The two round 1 QA-REG1- items with history ("Unit active", "Qty active") remain, set to Retired. Edge processes killed and no `edge-reg1-*` folders left.
