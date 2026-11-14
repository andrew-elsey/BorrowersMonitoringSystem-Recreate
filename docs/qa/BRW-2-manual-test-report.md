# BRW-2 Manual Test Report
Date / build or commit: 2026-11-05, branch feature/BRW-2-checkout, head ed3135e
Environment: docker app at http://127.0.0.1:8080, tested with curl (session cookie + X-Requested-With: fetch). No UI exists (BRW-3).
Verdict: PASS

Doc check: card AC, BACKLOG and TEST_CASES (TC-BRW-04 to 13, 34, 35) agree. Mockup not compared (no screen in this ticket).

## Acceptance criteria results
| # | Criterion | Result | Notes |
|---|---|---|---|
| 1 | Creates transaction and lines atomically | Pass | 2-line checkout, line 2 UNDER_REPAIR: 409 ITEM_UNAVAILABLE; row counts in transactions, transaction_items and audit_log CHECKOUT unchanged |
| 2 | Issuing handler from the session | Pass | Handler login with body issuedById = admin id: reply and DB issued_by are the handler |
| 3 | Stamps current semester | Pass | semesterId = "Sample semester" (current). NO_CURRENT_SEMESTER: Not tested live (would need changing the current semester in the shared DB); covered by TC-BRW-09 |
| 4 | Locks item rows before re-check (S16) | Pass | 6 parallel requests for the last unit: one 201, five 409 ITEM_UNAVAILABLE, one line in DB. Quantity item (3 units), 6 parallel qty 1: three 201, three 409 |
| 5 | Rejects unavailable, over-quantity, inactive borrower (S14) | Pass | UNDER_REPAIR, LOST, RETIRED, unit already out: 409 ITEM_UNAVAILABLE. 4 of 3: 409 INSUFFICIENT_QUANTITY available 3. 0 left: available 0. Inactive borrower: 409 BORROWER_INACTIVE |
| 6 | Audited | Pass | One CHECKOUT row per success (entity transaction, actor = issuer, reply in after); none for refusals |
| 7 | S14 and S16 as integration tests | Not tested | Did not run the suite (QA scope was the running app) |

## Additional tests run
- Owner decisions: inactive room gives 409 LOCATION_INACTIVE for handler and admin, nothing created. Date yesterday (Manila) 400 on fields lines.0.expectedReturnDate; today 201; 2026-02-30 400. Same item twice 400. 51 lines 400 ("At most 50"); 50 lines pass the schema (reached NOT_FOUND on fake item). Quantity item with 0 left gives INSUFFICIENT_QUANTITY available 0.
- Quantity 0 and -1: 400. Unit item qty 2: 400. No lines: 400. Bad uuid: 400. Unknown borrower: 404 NOT_FOUND. Upper-case ids accepted.
- Signed out: 401 UNAUTHENTICATED. Viewer: 403 FORBIDDEN. All errors use the standard format.
- Handler role created by inserting a user row with an argon2 hash (no user admin endpoint exists); the viewer likewise.
- Not tested: APP_TIMEZONE startup check (config.test.ts covers it), room deleted mid-checkout, NO_CURRENT_SEMESTER live, BORROWER_BLOCKED (FLG-3), narrow-window layout (no UI).

## Defects
None found.

## Observations (not bugs)
- Unit quantity error is VALIDATION_ERROR under fields.lines (not per-line key), as the card notes for BRW-3.
- Baseline DB already had 1 transaction and 126 audit rows from earlier work; unaffected.

## Test data left behind (all prefixed QA-BRW2-)
- 8 items (QA-BRW2-Laptop, Laptop2, Cord, Cord2, Repair, Lost, Retired, Race): all set to RETIRED.
- Borrowers QA-BRW2-S1, QA-BRW2-E1, QA-BRW2-X1: inactive. Rooms QA-BRW2-Room A, Room Closed: inactive.
- Users qa-brw2-handler, qa-brw2-viewer: deactivated.
- 7 transactions with open lines for those items, and their audit rows, cannot be removed (history).
