# BRW-1 Manual Test Report
Date / build or commit: 2026-11-05, feature/BRW-1-availability @ 815ffc3
Environment: worktree .claude/worktrees/agent-aea8b249e90d359fa; test DB bms_brw1_test (container borrowersmonitoringsystem-db-test-1); docker app at 127.0.0.1:8080
Verdict: PASS

BRW-1 is a service with no endpoint or UI, so this was a code and data check. Card and BACKLOG/TEST_CASES AC are consistent (no disagreement found with card text; BR 1 matches the code).

## Acceptance criteria results
| # | Criterion | Result | Notes |
|---|---|---|---|
| 1 | Unit items available only when not on an open line | Pass | Data check: open line -> 0; never borrowed -> 1; fully returned line -> 1 |
| 2 | Quantity items available for total minus outstanding | Pass | Total 10, lines 4/0, 3/1, 5/5 -> hand-computed 4, service 4. Total 3 with 3 outstanding -> 0 |
| 3 | Retired, lost, under-repair unavailable | Pass | LOST UNIT -> 0, UNDER_REPAIR QUANTITY with free stock -> 0 (RETIRED covered by the test file) |
| 4 | Unit tests cover partial returns and non-ACTIVE | Pass | availability.test.ts: 10 of 10 pass |

## Additional tests run
- Code read of availability.ts against BR 1: open-line filter (returned < borrowed) matches the glossary definition; clamp at 0; unknown id omitted (confirmed: Map.get returns undefined). No gaps found.
- Hand-built rows via psql, service run through tsx against the test DB: all 7 items matched hand-computed values.
- EXPLAIN with enable_seqscan=off on the service's query: Index Scan using transaction_items_open_by_item_idx.
- GET /api/health returned {"status":"ok"}.
- Test data removed afterwards; item count 0 and no leftover rows in the test DB. Temporary script deleted; worktree git status clean.

## Defects
None.

## Observations (not bugs)
- Clamp at 0 case (outstanding above total) cannot be created through the check constraint alone for this data and was not reproduced by hand; it relies on the unit test.
- Open owner question from the card (MD-2 lowering a QUANTITY total below checked-out quantity) is unchanged; clamping handles it.
- Full suite, lint, typecheck, and docker rebuild were not re-run by me (the app was left untouched as instructed).
