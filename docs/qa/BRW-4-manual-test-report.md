# BRW-4 Manual Test Report
Date / build or commit: 2026-11-05, branch feature/BRW-4-return-api, head dd02c20
Environment: docker compose stack at http://127.0.0.1:8080 (running dd02c20, not rebuilt), tested through the API with curl (session cookie plus `X-Requested-With: fetch`). One UI check of Inventory in headless Edge. No return UI exists yet (BRW-5).
Verdict: PASS

Backlog and card agree (BR 5 and 6; per-line return event with quantity, condition, receiving handler, time; partial returns; DAMAGED on UNIT updates item; flags untouched; S3, S15, S17). TEST_CASES.md TC-BRW-20 to 26 match the card. I did not re-run `npm test`; I only exercised the running app.

## Acceptance criteria results
| # | Criterion | Result | Notes |
|---|---|---|---|
| 1 | Return event per line with quantity (not above outstanding), condition, receiving handler, time | Pass | 201 reply has id, lineId, quantity, condition, receivedById, returnedAt (UTC, now), outstanding. Handler A issued, handler B returned: receivedById = B. A body `receivedById` set to A was ignored. A client-supplied time is not accepted. |
| 2 | Partial returns; line complete when outstanding is 0 (S3) | Pass | 5 cords: return 3 gives outstanding 2, return 2 more gives outstanding 0. DB `quantity_returned` = 5, 2 return rows. Conditions GOOD and FAIR are stored per event. |
| 3 | DAMAGED return on a unit item updates item condition (S17) | Pass | Laptop A, B, C each went GOOD to DAMAGED, status stayed ACTIVE. Inventory UI shows "Damaged" and "Active" for all three. Quantity item (cable, 5 returned DAMAGED) kept condition GOOD. |
| 4 | Returning never changes flag status | Pass | Both lines set to FLAGGED in psql (a unit and a quantity line), then returned in full: flag_status stays FLAGGED, flagged_at untouched. |
| 5 | S3, S15, S17 pass | Pass | S15 both cases: return 3 with 2 out, and return 1 on a line with 0 out, both 409 RETURN_EXCEEDS_OUTSTANDING with `details: { lineId, outstanding }` (2 and 0). |

## Additional tests run
- Atomicity: 2-line request (cord line 2, valid; laptop line 2, too many) gave 409 for the laptop line. Cord `quantity_returned` stayed at 3 and no return row was written for either.
- Audit: one RETURN row per event (actor = receiving handler, `after` holds the reply), one ITEM_UPDATED row for the DAMAGED laptop (before GOOD, after DAMAGED, entity = item id). No ITEM_UPDATED for the DAMAGED quantity item.
- Permissions: viewer 403 FORBIDDEN; signed out 401 UNAUTHENTICATED; cookie without `X-Requested-With` 403. Admin and handler both can return.
- Validation (all 400 VALIDATION_ERROR, nothing recorded): quantity 0, -1, 10001, 1.5, "2"; condition BROKEN, lowercase "good", missing; same line twice (also with different id case); empty lines; missing `lines`; non-uuid id; 51 lines; malformed JSON. Unknown but valid uuid gives 404 NOT_FOUND. An uppercase uuid is accepted.
- Concurrency, same line: two parallel returns of 6 with 9 out gave one 201 and one 409. Three parallel returns of 4 with 10 out gave two 201 and one 409 (r = 8). No over-return.
- Concurrency, opposite line order: two parallel 2-line requests with the lines in opposite order, one containing a DAMAGED laptop. No deadlock or 500. One succeeded, the other got a correct 409 (laptop already returned), and nothing partial was left.
- Return and checkout of the same item at the same moment: 3 rounds checking out 20 cables (19 available) against a return of 1, and 6 rounds of a checkout of a unit laptop against its DAMAGED return. Every round was consistent (no negative availability, never more than total out, no 500). The checkout lost every time (INSUFFICIENT_QUANTITY or ITEM_UNAVAILABLE), so the order where the return wins was not seen. API logs had no deadlock or error lines.
- Sequential: a DAMAGED unit laptop is still checkable out (status ACTIVE). Returning it later as GOOD leaves it DAMAGED.
- Regression: BRW-2 checkout still works throughout, with correct availability after returns.

## Defects
None found.

## Observations (not bugs)
1. Validation field errors for a return are all keyed on `lines` (no per-line path such as `lines.0.quantity`), so BRW-5 cannot highlight the failing row from `details.fields`. A missing `lines` gives the raw message "Invalid input: expected array, received undefined". Low priority, worth a look when BRW-5 is built.
2. A very large body (about 200 KB) is rejected by nginx with an HTML 413 page, not the standard JSON error format. This is the edge proxy, so it belongs to SEC-1 and not BRW-4.
3. Owner question 1 on the card is still open. Today a GOOD or FAIR return never changes a DAMAGED item, so a repaired laptop stays DAMAGED until an admin edits it, and DAMAGED items can still be checked out. I agree with the dev's recommendation that a return should never upgrade the condition.
4. TC-BRW-26 (returns never blocked at 5 strikes) was not exercised by hand because strike counting and blocking (FLG-1, FLG-3) do not exist. Only the code path "no borrower check" holds: I returned for an active borrower with FLAGGED lines, and (per the card) the test also covers an inactive borrower. Re-check after FLG-3.
5. Returns after closing time were not tested: end-of-day flagging (FLG-2) does not exist yet, and S3 only covers "before closing". The return time is stored in UTC only.
6. Mockup: the Artifact read returned only the canvas wrapper and file index, not screen content. BRW-4 adds no screen, and the only screen touched is the existing Inventory list, which shows Condition and Status columns correctly.

## Test data and cleanup
All data is prefixed `QA-BRW4`. Created: room QA-BRW4-Room; borrower QA-BRW4-S1 (QA-BRW4 Student); items QA-BRW4 Laptop A, B, C (unit, tags QA-BRW4-LT1 to LT3), QA-BRW4 Cord and Cable (quantity); users qa-brw4-handlera, qa-brw4-handlerb, qa-brw4-viewer; 18 transaction lines and 24 return events.
Cleaned up: every open QA-BRW4 line was returned (3 extra return events), all 5 items retired, room and borrower deactivated, the 3 users deactivated. Remaining (cannot be deleted, they have history): those inactive or retired rows, their transactions, returns and audit entries. The three laptops stay at condition DAMAGED. Headless Edge was killed with its process tree and its profile folder deleted; no `edge-qa-brw4` folder is left in the temp folder.
