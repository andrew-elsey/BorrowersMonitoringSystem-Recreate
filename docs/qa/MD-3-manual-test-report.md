# MD-3 Manual Test Report
Date / build or commit: 2026-11-03, branch feature/MD-3-rooms, commit 9c62ebc
Environment: Windows 11, Docker Compose (db, api, web) rebuilt from this branch with `docker compose up --build -d` (checked again after the coordinator's message: images current, all healthy), app at http://127.0.0.1:8080, headless Microsoft Edge driven over the DevTools protocol, API checks with curl. Dev database with seed rooms Computer Lab 1, Room 101 (used in 1 transaction), Room 102. Accounts admin, qa-handler, qa-viewer. I did not run `npm test` or touch db-test, as instructed.
Verdict: PASS

## Acceptance criteria results
| # | Criterion | Result | Notes |
|---|---|---|---|
| 1 | Admins have full CRUD | Pass | Add (name trimmed), rename from the row dialog, deactivate, reactivate and delete an unused room all work in the browser, each with a toast and the list refreshed. Delete asks for confirmation (Cancel has focus). Delete of Room 101 is unavailable ("Used in 1 transaction"); API returns 409 HAS_HISTORY and the room stays. Unused room delete returns 204, a second delete 404. |
| 2 | Handlers add a room through the quick-add endpoint | Pass | `POST /api/rooms` as qa-handler: 201, `createdBy` = QA Handler even when the body sends a `createdBy` of another id. Handler PATCH and DELETE: 403. Viewer: 403 on GET and POST. Signed out: 401. Missing `X-Requested-With` header: 403. |
| 3 | Duplicate names rejected case-insensitively (DUPLICATE_VALUE) | Pass | "cl-201" vs "CL-201" gives 409 DUPLICATE_VALUE for admin and handler, and on rename to another room's name in any case. Message appears under the field, focus moves to the field, `aria-invalid` is true. A room can change the case of its own name. |
| 4 | created_by recorded | Pass | "Added by" shows Administrator or QA Handler. Audit rows (LOCATION_CREATED, LOCATION_UPDATED, LOCATION_DELETED) have the right actor. |
| 5 | Admins can deactivate rooms | Pass | Deactivate and Reactivate work; row shows Inactive badge and greyed text; button text swaps. Audit rows before/after `active`. |

## Test cases
| Case | Result | Notes |
|---|---|---|
| TC-MD-09 | Pass (manual) | Admin create, rename, deactivate, reactivate; audited. A save with no change wrote no audit row. Failed requests wrote none. |
| TC-MD-10 | Pass (manual) | Handler quick-add 201 with `createdBy`; handler rename, deactivate and delete 403; viewer 403; signed out 401. |
| TC-MD-11 | Pass (manual) | Both admin and handler messages for an active duplicate; see inactive messages below. |
| TC-MD-12 | Pass (manual) | Room 101: Delete unavailable with "Used in 1 transaction"; HAS_HISTORY; record and transaction kept. Unused room deleted and audited. |
| TC-MD-30 | Pass (manual) | Handler `GET /api/rooms` returns active rooms only, `total` counts only active (4 of 5 while one was inactive), also with `?active=false`. Admin sees inactive rooms. `pageSize=101` 400, `pageSize=0` 400, `page=0` 400. Viewer 403, signed out 401. |

## Owner decisions
- Delete kept for never-used rooms: Pass (see above).
- Handler can list active rooms: Pass.
- Inactive-duplicate messages: Pass, exact wording. Admin: `"CL-201" exists but is inactive. Reactivate it instead.` Handler (API): `"CL-201" exists but is inactive. Ask an admin to reactivate it, or choose another room.` The room stayed inactive; nothing was reactivated. The admin message also appeared under the field in the browser.
- "Added" date in Manila time: Pass. A room created at 23:35 UTC on 2 Nov shows "3 Nov 2026"; seeded rooms created at 08:10 UTC show "2 Nov 2026".

## Additional tests run
- Validation: empty, whitespace-only, 201 characters ("Too long: at most 200 characters."), control character ("Remove the control characters."), missing name, bad id (400), unknown id (404). 200-character names accepted, both with spaces and as one unbroken word.
- Mockup (project/Rooms.dc.html, read via the Artifact tool, source and screenshot compared): heading, add form label and button wording, hint paragraph, columns Name / Added by / Added / Status / Actions, Active/Inactive badges, Rename / Deactivate-Reactivate / Delete, "Used in N transaction(s)" text, and duplicate error wording match. Row actions and the add form are laid out as in the mockup. Menu shows Home, Inventory and categories, Borrowers, Rooms and labs for admin.
- Keyboard only: Tab order is Add button, then Rename, Deactivate, Delete per row in order. Enter on Rename opens the dialog with focus in the name field; Escape closes it and returns focus to the row's Rename button. Empty save keeps focus in the field, error has `role=alert`, `aria-invalid` true. After saving a rename, focus stays on that room's Rename button. After Deactivate, focus stays on the same button, now labelled Reactivate. Delete dialog opens with focus on Cancel; Escape returns focus to the Delete button. The disabled Delete on Room 101 is focusable, has `aria-disabled` and a description pointing at "Used in 1 transaction", and Enter does nothing. Success toasts use `role=status`.
- 360 px wide: no page horizontal scroll (page 345 of 345). The table scrolls inside its own container. Long names wrap. Only the top of the page and the first rows were viewed in screenshots.
- 200-character names at 1280 px: the unbroken 200-character name wraps and does not push buttons out of view; actions stack vertically in that row. Not a defect.
- Two sessions: (a) dialog open, other session renames the room, first session saves another name: saved with no warning, last write wins (observation). (b) dialog open, other session deletes the room, first session saves: toast "Room not found.", dialog closes, row gone. Pass.
- Roles in the browser: signed out `/rooms` goes to `/login`; qa-handler and qa-viewer see only Home in the menu and "You can't open this page" naming their role on `/rooms`.
- Regression: Borrowers page loads with filters, Status badges and Edit/Deactivate, same as before. Inventory and categories page loads.
- Test data removed afterwards (rooms back to the 3 seed rooms). Audit rows from testing remain by design.

## Defects
None found.

## Observations (not bugs)
- After a failed add (for example a duplicate), the error stays under the field until the next submit or edit, even if the cause is gone (for example the other room was deleted meanwhile). Minor.
- Two admins editing the same room: last write wins with no conflict warning. Low risk with one or two admins.
- `POST /api/rooms` with no `name` returns the raw message "Invalid input: expected string, received undefined". Only reachable through the API; the form never sends that.
- `GET /api/rooms?active=maybe` is accepted and treated as no filter instead of a 400.
- The handler list also returns `createdBy` and `transactionCount` for each room. Handlers do not need these; low sensitivity.
- `PATCH /api/rooms/:id` with an empty body returns 200 and changes nothing.
- At 360 px the "Add room or lab" button wraps below the field with a large gap above it (spacer for the label). Cosmetic.
- Not tested: a room gaining a transaction while the Delete confirm is open (needs checkout, BRW tickets); the handler quick-add in the checkout UI (BRW-3); screenshots of the table body at 360 px; rebuilding the web image with a different `APP_TIMEZONE`; the automated tests (not run by instruction).
