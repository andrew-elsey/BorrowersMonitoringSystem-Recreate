# MD-7 Manual Test Report, round 2 (focused re-check)
Date / build or commit: 2026-11-03, ba2f131 (branch feature/MD-7-semesters-settings)
Environment: Windows 11, `docker compose up --build`, http://127.0.0.1:8080, dev data. Headless Edge driven over the DevTools protocol (real Tab/Enter/Esc key events), API calls from the signed-in page. Admin only.
Verdict: PASS

## Acceptance criteria results (round-2 items)
| # | Criterion | Result | Notes |
|---|---|---|---|
| 1 | BUG-1: note under "Semesters" has the new wording, nothing promises 0 strikes | Pass | Page text reads exactly "Strikes count only in the current semester. Flags from other semesters stay in history." Confirm dialog: "Only flags from transactions in QA-SEM A will count as strikes. Flags from other semesters stay in history." No "0 strikes" string in non-test web source (grep). |
| 2 | Keyboard-only Set as current: focus on the semester name in its row, visible ring | Pass | Esc, then Cancel: focus returns to the Set as current button (ring 2px solid). Confirm: focus lands on span `semester-name-<id>` ("QA-SEM A"), :focus-visible true, outline 2px solid. Exactly one Current afterwards. Toast "QA-SEM A is now the current semester." Screenshot shows the ring around the name. |
| 3 | Screen-reader name | Pass (see observation 1) | Accessibility tree: role generic, name "QA-SEM A". |
| 4 | Fallback to "New semester name" when the reload fails | Pass | Patched page fetch to fail GET /semesters after the confirm (Set Sample semester as current). Alert "Could not reach the server. Please try again." appeared and focus was on input `new-name`. |
| 5 | Regression spot check | Pass | Thresholds 4/3/5 and 3/3/5 refused (400 on noticeThreshold, clear message); 18:30 with 3/4/5 saved and read back with Asia/Manila; overlap 409 SEMESTER_OVERLAP on startDate naming Sample semester; duplicate name in other case 409 DUPLICATE_VALUE on name; valid semester created 201; room added 201 and deleted 204. |

## Additional tests run
- Dialog opens with Cancel focused (focus ring visible).
- Cancel and Esc send nothing (current semester stayed Sample semester).
- Not run by me this round: npm test, lint, typecheck, narrow-window layout, role checks (unchanged API, covered in round 1), row-on-another-page fallback (same code path, test only).

## Defects
None.

## Observations (not bugs)
1. The semester name that receives focus is a plain span (tabIndex -1), so it is announced as generic text "QA-SEM A" without saying it is the current semester. The Current badge is in the next cell. Acceptable; a screen reader user hears the toast too.
2. Test data left behind: semesters cannot be deleted (owner decision), so "QA-R2 ok" (2031-01-01 to 2031-02-01) is now in the dev database along with round-1 leftovers (QA-SEM A, qa-sem b, QA-oneday, and a 200-character name). Sample semester is current again; settings are 17:00 / 3 / 4 / 5. The QA-R2 room was deleted.
3. My Edge profile loaded many extension tabs (ad blocker, etc.); the driver picked the wrong tab once, so one run was discarded with no effect on the app. Profile removed.

Cleanup: Edge process tree killed with taskkill /T /F, profile folder removed, no `edge-*` folders left in temp. `docker compose down` run (the network stays because the db-test container is still running).
