# FLG-1 Manual Test Report
Date / build or commit: 2026-11-07, origin/feature/FLG-1-strike-service a1e707f (on main 4614f54)
Environment: static review of `apps/api/src/services/strikes.ts` and `apps/api/tests/strikes.test.ts` against BUSINESS_RULES BR 10, 12, 13 and S2, S5-S9. No UI or endpoint exists. `npm test` and the dev DB were not run (another agent runs the suite).
Verdict: PASS

## Acceptance criteria results
| # | Criterion | Result | Notes |
|---|---|---|---|
| 1 | Returns a borrower's strike count for the current semester (distinct transactions with at least one FLAGGED line) | Pass (by reading) | `transaction.count` where borrowerId, `semester.isCurrent`, and `lines some flagStatus FLAGGED`. One row per transaction, so no double counting. |
| 2 | Tests cover S5, S6, S7, S9 | Pass (by reading) | TC-FLG-02 = S5, TC-FLG-03 = S6, TC-FLG-04 = S7, TC-FLG-05 = S9; TC-FLG-01 = S2. Each asserts the values the scenario states. |

## Scenario walk-through (by hand, through the query)
- S2: 1 transaction, 1 FLAGGED line -> count 1. Pass.
- S5: 1 transaction, 3 FLAGGED lines -> `some` matches the transaction once -> 1, not 3. Pass.
- S6: 2 transactions, each flagged -> 2. Pass.
- S7: 2 flagged lines; override one -> `some FLAGGED` still true -> 1; override both -> 0. Pass.
- S9: 4 flagged transactions in S1; current switched to S2 -> semester filter excludes them -> 0; flags remain on lines; switch back -> 4. Pass. Semester is read from DB on each call, not hardcoded (rule 3).
- BR 10/12 edges: NONE and OVERRIDDEN lines do not count; other borrowers' transactions do not count; no current semester -> 0. Pass.
- S8 (thresholds) belongs to FLG-3. Not applicable here.

## Rules check
- CLAUDE.md rule 1: query uses `transaction.borrowerId` only, never the borrowers table. Pass.
- Rule 3: no hardcoded thresholds or semester. Pass.
- Accepts a transaction client for FLG-3 use inside checkout. No endpoint, no migration. Pass.
- TEST_CASES.md TC-FLG-01..05 match the tests and rules (ticket, BR and S references correct; file column updated). Pass.
- BACKLOG FLG-1 acceptance matches the Trello card. No disagreement.

## Additional tests run
None executed. Optional read-only SQL check on the dev DB not done (the logic is a single count with a `some` filter; the by-hand walk-through was enough).

## Defects
None.

## Observations (not bugs)
- The "How to QA" mapping in the card comment is off by one: it says "TC-FLG-01 (S5) and TC-FLG-02 (S6)", "S7: TC-FLG-03 and 04". The tests and TEST_CASES.md are right: 01=S2, 02=S5, 03=S6, 04=S7, 05=S9. Comment text only.
- Owner questions already raised in the card: no current semester gives 0 (checkout refuses anyway); "Depends on: BRW-4" can be dropped; test setup fallback to shared `bms_test`. FLG-3 should count by the semester id recorded at checkout (reviewer note).

## Not tested
Full test suite run, lint, typecheck, behavior against real data (all outside this scope).
