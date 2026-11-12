# MD-5 Manual Test Report
Date / build or commit: 2026-11-02, branch feature/MD-5-borrowers, commit cf05cad7d1a91542ebc4eacc99965484cd1be893
Environment: Windows 11, Docker Compose (db, api, web) rebuilt from a wiped database volume, app at http://127.0.0.1:8080, headless Microsoft Edge driven over the DevTools protocol. Seed users admin, qa-handler, qa-viewer; 4 seed borrowers. Sample data was loaded by running the compiled seed inside the api container with NODE_ENV=development, because the Docker image runs the seed in production mode without sample data.
Verdict: PASS (with the Not tested items below)

## Acceptance criteria results
| # | Criterion | Result | Notes |
|---|---|---|---|
| 1 | Fields per SPEC 4: school ID, name, type, department, active | Pass | Add, edit, deactivate and reactivate all work as admin. Empty form shows four field errors. Whitespace-only name rejected. 200 characters accepted, 201 rejected ("Too long: at most 200 characters."). Audit rows written per change; a save with no change writes no audit row. |
| 2 | Duplicate school ID rejected | Pass | Case-insensitive, on add and on edit ("qa-2026-a01" vs "QA-2026-A01", "e-0001" vs "E-0001"). Error shown under School ID with focus moved to the field. |
| 3 | Search by name or school ID returns quickly | Pass | Case-insensitive on name and school ID. One letter keeps the page and shows the hint "Type at least 2 characters". Two or more letters goes to page 1. `%` and `_` are searched as plain text. No-match message matches the mockup wording. Space-only search shows the full list. Search box limited to 100 characters. |
| 4 | Inactive borrowers cannot be selected at checkout | Not tested | Checkout does not exist yet (Sprint 3). Only the active flag and the Status filter were checked. |
| 5 | All reads go through BorrowerService | Pass (code check only) | Only apps/api/src/services/borrowers.ts uses the borrower model in app code besides the seed script. I did not run the automated tests for this. |

## Additional tests run
- Type filter (All, Student, Faculty, Employee) and Status filter (Active and inactive, Active, Inactive): correct rows, combined filters work, counts consistent (33 active, 6 inactive of 39). Pass.
- Paging with 39 rows: "Showing 1-25 of 39, Page 1 of 2", Previous disabled on page 1, page 2 shows 14 rows. Changing a filter on page 2 goes back to page 1. Pass.
- Roles: qa-handler and qa-viewer get 403 on GET, POST and PATCH /api/borrowers, the menu shows only Home, and /borrowers shows "You can't open this page" naming their role. Signed out: 401 on API, /borrowers redirects to /login. No data changed. Pass.
- Retry state: with the borrowers request failing, the screen shows "Could not reach the server. Please try again." with role=alert and a Retry button; Retry restored the list. Pass.
- Keyboard: Tab order after search is Type filter, Status filter, then Edit and Deactivate per row in order. Edit dialog opens with focus in School ID and returns focus to the row's Edit button on close. Pass.
- Deactivating a row while the Status filter is Active: the row disappears, focus moves to the Status filter, toast "QA Pager 01 deactivated." Pass.
- Layout at 360px wide: no horizontal page scroll (page width 345 of 360). Top of the page viewed. Pass.
- Regression: category names and borrower names with control characters are rejected with VALIDATION_ERROR (400); category create, rename (PUT) and case-insensitive duplicate (409) work; Inventory and categories page loads. Pass.
- Mockup (project/Borrowers.dc.html, read only): filter row, option wording and empty-search message match. Known accepted differences: no Strikes column, no Import CSV, top add form, status badge. Source compared, not screenshots.

## Defects
None found.

## Observations (not bugs)
- Docker runs the seed without sample data (production mode) and without QA_PASSWORD, so a fresh Docker database has only the admin. Sample data and QA users need a separate step.
- One automated run showed the list one step behind the typed search when my script waited only 900 ms; runs with 1000 ms were correct. One earlier "100%" result looked unfiltered and did not reproduce. Likely script timing, but worth a glance if users report stale results.
- The handler role cannot read /api/borrowers; checkout will need its own borrower lookup (BRW tickets).
- Not tested: toast notifications covering row buttons, the table body at 360px (only the top of the page was viewed), the viewer role's behavior beyond the 403 above, screenshot-level mockup comparison.
- Test data was removed afterwards (borrowers back to the 4 seed rows). Audit rows from testing remain by design.
