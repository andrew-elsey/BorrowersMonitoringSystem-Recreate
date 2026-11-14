# FLG-2 Manual Test Report
Date / build or commit: 2026-11-09, branch feature/FLG-2-flagging-job, head 77a81e6
Environment: Docker stack at http://127.0.0.1:8080 (db, api, web), dev database freshly reseeded; driven with curl (cookie sessions, X-Requested-With: fetch) and psql. Closing time restored to 17:00 at the end. Test data is under the note prefix QA-FLG2- (T1 to T5) and was left in the dev database. No browser was used.
Verdict: PASS (live-stack checks only; the automated suite and the UI Settings screen were not run by me)

Note: the host clock runs UTC; Manila = UTC+8, so "closing 20:20 Manila" = 12:20 UTC.

## Acceptance criteria results
| # | Criterion | Result | Notes |
|---|---|---|---|
| 1 | Runs at configured closing time in Asia/Manila; reschedules on settings change | Pass | Closing set to 20:20 Manila. Log "Flagging run at 12:20:00.013Z: flagged 3"; lines flagged_at 20:20:00.013+08. Settings change re-armed the timer (see 2). |
| 2 | Owner decision A (closing moved earlier than now) | Pass | T4 issued 20:20:41, closing moved to 20:21 at 20:21:16: T4 FLAGGED at once, log "flagged:1". |
| 3 | Idempotent; skips FLAGGED and OVERRIDDEN | Pass | A line set to FLAGGED (flagged_at 2026-01-01) kept its flagged_at; the OVERRIDDEN line stayed OVERRIDDEN; repeated runs and restarts flagged 0 and wrote no extra audit rows (LINE_FLAGGED stayed 5). |
| 4 | Lines issued after closing wait for next closing | Pass | T4 (issued 20:20:41, after the 20:20 closing) stayed NONE after the closing and after a manual run; T5 stayed NONE after a restart. |
| 5 | Admin-only manual trigger, once per minute | Pass | admin 200 {"run":{"flagged":0,"skipped":false}}, second call 429 RATE_LIMITED with Retry-After: 60. qa-handler and qa-viewer 403 FORBIDDEN (and did not use up the minute). Signed out 401 UNAUTHENTICATED. POST without X-Requested-With gives 403 FORBIDDEN, GET gives 404. All errors use {"error":{code,message,details}}. |
| 6 | Advisory lock, no overlap | Not tested | Test-only (TC-FLG-14, TC-FLG-28); I did not run the suite. |
| 7 | Catches up on startup; logs each run; audited | Pass | Restart logs "Flagging run at ...: {flagged:0}" with nothing to do, no double flagging. After backdating T5's issued_at by 1 h (sql), restart logged flagged:1 and T5 became FLAGGED. Scheduled runs write LINE_FLAGGED audit rows (actor null, before NONE, after FLAGGED + flaggedAt), one per line, 3 at 20:20:00.022. Runs that flag nothing write no audit row. |
| 8 | Injected clock in tests | Not tested | Code reading of api/flagging.test.ts not done by me. |
| 9 | Scenarios S1, S2, S10 to S13 | Partly | Behaviour matching S10/S11 (after-closing line waits) and S22 seen live; the rest only by test. |

## Additional tests run
- Returned line (HDMI fully returned) stayed NONE: pass.
- Partially returned line (cord, 1 of 2 back) was flagged: matches the rule that open quantity is flagged.
- Restore of closing to 17:00 saved without error; the resulting run flagged 0.
- api restart: /api/health returned 200 right away; no 502 (FND-8) seen this time.

## Defects
None found.

## Observations (not bugs)
- On the 20:20 closing the log shows two runs: 12:19:59.995Z (flagged 0, timer fired about 5 ms early) then 12:20:00.013Z (flagged 3). Harmless: the second run flagged correctly. Worth knowing when reading logs.
- Retry-After is a fixed 60 even when seconds of the window have passed.
- Not tested: Settings screen in the browser, mockup comparison (no UI change in this ticket), narrow-window layout, advisory lock under real concurrency, failure retry (60 s), weekend catch-up.
