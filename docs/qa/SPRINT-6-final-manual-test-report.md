# SPRINT-6 Final Manual Test Report (full re-run, 12 cards)

Date / build: 2026-11-26, branch feature/SPRINT-6 at c912e0a (git fetch run, no newer commits; `git diff 61fd6f1 HEAD -- apps packages` is empty, so the running images match the code).
Environment: Windows 11, Docker Desktop (engine 29.8.1), Node 24.11.1, Edge (headless, driven with Playwright) against the dev stack at http://127.0.0.1:8080 (compose project borrowersmonitoringsystem), plus the real scripts. Test data: dev/sample data and the qa-handler / qa-viewer accounts (passwords reset by me for the run, not recorded).
Verdict: **PASS**, with owner steps pending for HRD-4 (TC-HRD-07) and the typed-confirmation part of HRD-3 (TC-HRD-29). 0 Blocker / High / Medium defects, 1 Low documentation defect.

Automated suites: lint, typecheck, build, `npm test` (117 files / 1339 tests) and `test:nginx` (11/11) were NOT re-run by me (relied on the verification on c912e0a, as instructed). I ran `test:e2e` and the full load test myself.

## Per-card result

| Card | Result | TC IDs run by me (manual) | Notes |
|---|---|---|---|
| HRD-1 + bug p7KJ6mEV (audit log blank From) | PASS | TC-HRD-19, 55, 57, 58 behavior; 01-03, 12-18 not re-run (automated only) | See A1 below |
| HRD-1b | PASS | TC-HRD-20-24 | "No flagging run yet" first-run state could not be shown on real data (a run already exists, cannot clear); seen only with a mocked empty response |
| HRD-2 | PASS | TC-HRD-04, 60-68 via `npm run test:e2e`; TC-HRD-05 table check | 8 passed, exit 0, 45 s; run once (not twice) |
| HRD-3 + bug bRAFJyWW | PASS-with-owner-steps-pending | TC-HRD-25, 28, 56, 06, 29 (partly); 26, 27 partly | Typed confirmation exercised only with a faked TTY (owner to confirm in a real terminal) |
| HRD-4 | PASS-with-owner-steps-pending | docs review, icacls step, secret one-liner; TC-HRD-07 NOT RUN - owner | One Low doc defect (BUG-1) |
| HRD-5 | PASS | TC-HRD-45..54 API checks, TC-HRD-08 | See A3 |
| HRD-5b + bug wxTtqdMT (checkout focus) | PASS | TC-HRD-42, 30, 34, 35 (simulated), 36 (items), 44, 08 | Blocked-borrower focus, SEARCH_TOO_BROAD, NOT_FOUND on other pages: automated only |
| SEC-2 | PASS | TC-SEC-11..25 via `LOAD_FULL=1 LOAD_REQUIRE_HRD=1 npm run test:load` | 19 passed, 0 failed, 0 skipped |
| FND-8 | PASS | TC-FND-33 | api restart: /api/health 200 after 9 s; web StartedAt unchanged. TC-FND-32 via nginx suite (not re-run) |

TC-HRD-26 and 27 are listed only loosely: I confirmed the backup file is written, refusals work and a restore round trip returns data; I did not separately open the retention (14 days) logic. Marked partly tested.

## A. Details of manual checks

1. **HRD-1 / p7KJ6mEV (UI, Edge).**
   - Audit log: clear From, keep To, Filter -> only "Enter a start date." under From, nothing under To, result table hidden. From 2025-01-01 -> "The date range can be at most 366 days." (shown under To). Clear To -> only "Enter an end date.".
   - History per borrower, History per item and Usage summary: clearing From shows only "Enter a start date.", clearing To only "Enter an end date.".
   - Settings: new semester with empty end date -> only "Enter an end date."; end before start -> "The end date cannot be before the start date."; same-day end accepted.
   - API: `GET /api/audit?from=abc&to=2026-11-22` -> 400, single message on `from`. Missing from or to -> 400 with one message each. Handler and viewer: 403 on audit. `docker compose exec api npm run audit:sweep` -> "Audit sweep found no problems." (also after the restore).
2. **HRD-1b.** /flags shows "Last flagging run: 26 Nov, 07:51, 0 lines flagged. Next run: 26 Nov, 17:00." Run flagging now + confirm dialog (text matches: once per minute, audited) -> "Flagging run finished. 0 lines flagged." and the label updates. Audit log shows FLAGGING_RUN with actor Administrator. Settings save adds a System FLAGGING_RUN entry (expected). Handler and viewer: GET /api/flags and POST /api/flagging/run -> 403.
3. **HRD-5 (API).** PATCH `{}` on item, room, borrower, user -> 400 "Nothing to update." Handler GET /api/rooms returns only id and name. Settings warning >= notice (4/4 and 5/4) rejected with a clear message. Semester start 0000-01-01 -> 400 "Enter a real date."; 2026-02-30 -> 400 (message "Enter a start date.", see Observation 3). Viewer PATCH on item -> 403.
4. **HRD-5b / wxTtqdMT.**
   - Checkout keyboard: search "Ana", Tab to "Choose Ana Garcia", Enter -> focus on the room picker (`select#room`). Inactive borrower: Enter -> focus back on the borrower search, message "Inactive borrower ... cannot borrow".
   - Dismiss focus (TC-HRD-30): two "Settings saved." messages; dismissing the first leaves focus on the other Dismiss button; dismissing the last puts focus on `main`, not the page body.
   - TC-HRD-34: api stopped, Inventory search fails, api started, press Retry -> focus on "+ Add item". Note the error alert appears only after about 25 to 30 s with the api down (retries).
   - TC-HRD-36 (items): edit dialog open, item deleted elsewhere, Save -> "Item not found." message, dialog closed, focus on "+ Add item".
   - TC-HRD-35: a rebuild of unchanged source gives the same chunk file names, so a real stale-chunk case cannot be produced without a code change. I simulated it by returning 404 for the Reports chunk: page shows "This page could not load. Reload the page to try again." with a Reload button (the menu is not shown on that page).
   - TC-HRD-44 / 08: for the Dashboard, Return, Flag review, Inventory, Borrowers, Rooms, Users and Audit log, requests were held (loading), aborted (failed) and answered empty. Loading shows "Loading…", failed shows the Retry alert, empty shows the screen's own "No ... yet" text. Reports (Usage summary tab) not walked in the failed state.
5. **FND-8.** `docker compose stop api` -> /api/health 502; `docker compose start api` -> 200 after 9 s; web container StartedAt unchanged.
6. **HRD-3 (scripts, BACKUP_DIR set only in my shell to a scratchpad folder).**
   - `npm run backup` -> `bms-YYYYMMDD-HHMMSS.dump` written. BACKUP_DIR unset -> "BACKUP_DIR is not set..." exit 1. db stopped -> `service "db" is not running` / "Backup failed. Nothing was kept and no old backups were deleted." exit 1.
   - Bug bRAFJyWW / TC-HRD-56: `npm run restore -- C:\nope\x.dump`, `-- C:\Windows`, and the first with `< /dev/null` -> one line "That file does not exist. Nothing was changed.", exit 1 each; api stayed up.
   - Non-terminal stdin with a real file or a corrupt file -> "Restore needs a person at the keyboard..." exit 1.
   - TC-HRD-29 with a **faked TTY** (preload that sets `process.stdin.isTTY`, same technique as earlier QA): wrong name -> "Not confirmed. Nothing was changed." exit 1; corrupt file with correct name -> "That file is not a readable backup. Nothing was changed." exit 1; api stayed healthy both times.
   - TC-HRD-06: added a marker borrower after the backup, `docker compose down -v`, `up -d` (fresh empty database, admin only), restore with typed name -> "Restore finished. Everyone must sign in again." Marker gone, borrowers, items, handler login restored, old session cookies gave 401, audit:sweep clean, api healthy.
   - icacls step from DEPLOYMENT.md section 5 run on a scratch folder as a normal (non-elevated) user: succeeded, and `npm run backup` still wrote there. (`whoami` in Git Bash returned `andre`; in PowerShell it returns `DESKTOP-65N9LTN\andre`.)
7. **HRD-2.** `npm run test:e2e`: "8 passed (45.4s)", exit 0; afterwards no bms-e2e container, volume or network. TEST_CASES has TC-HRD-04 (e2e, TC-HRD-60 to 68) and TC-HRD-05. I checked every TC ID in the S1-S23 coverage table exists in TEST_CASES.md (310 IDs, none missing, all 23 scenarios listed).
8. **SEC-2.** Full run `LOAD_FULL=1 LOAD_REQUIRE_HRD=1 npm run test:load`: **19 passed, 0 failed, 0 skipped**. Started 2026-11-25T23:54Z, about 35 minutes. Included TC-SEC-11 login flood (p95 under 2 s, no failures), TC-SEC-12 slow connections, TC-SEC-13 and 24 oversized bodies (413 from nginx), TC-SEC-14 and 19 max-range reports and audit under 2 s, TC-SEC-15 and 25 flagging under load, TC-SEC-20 to 23 flood handled by nginx, memory (peak api 188 of 512 MiB, no restarts, no OOM), valid login after the throttle window. Afterwards nothing named bms-load/bms-e2e in `docker ps -a`, `docker volume ls` or networks; C: free about 19 GB (never under 17 GB). ARCHITECTURE 12.7 has the final result (no PRELIMINARY text); it records the date and machine of the run, which I took as intended. CLAUDE.md Commands lists `test:load` and `test:e2e`.
9. **HRD-4 documentation review (docs/DEPLOYMENT.md sections 1-9, README "Department PC").**
   - Covers: LAN setup, `COOKIE_SECURE=false` and why, `WEB_BIND_ADDRESS`, firewall rule with `-Profile Private` and subnet-only `-RemoteAddress`, why not the internet (section 1), backups, restore, settings in plain terms, day to day (duplicate-checkout note, backup check, `docker compose ps/logs`, admin reset, update), load test on the PC.
   - Task Scheduler text: full `npm.cmd` path from `Get-Command`, Start in = repo folder, "Run only when user is logged on", run as soon as possible after a missed start. Read only, not run.
   - Checked against the repo: node secret one-liner works (64 hex chars); `.nvmrc` is 24.11.1; `restart: unless-stopped` and `WEB_BIND_ADDRESS`/`COOKIE_SECURE`/`WEB_PORT`/`BACKUP_DIR`/`SESSION_TTL_HOURS`/`QA_PASSWORD` all exist in compose and `.env.example`; audit:sweep exits 1 on problems; every README anchor to DEPLOYMENT.md (`#2-set-up-env`, `#5-backups`, `#6-restore`, `#7-settings-in-plain-terms`, `#8-day-to-day`) matches a real heading. CLAUDE.md lists DEPLOYMENT.md. ARCHITECTURE section 3 (tree) and 12.6 name it; 12.1 does not (BUG-1).
   - `docker compose ps`, `docker compose logs` commands valid; `npm run backup` ran fine. Not run: the firewall rule, bind address change, Task Scheduler job.

## Defects

### BUG-1: ARCHITECTURE 12.1 has no pointer to docs/DEPLOYMENT.md
- Severity: Low (documentation)
- Steps: open `docs/ARCHITECTURE.md`, section 12.1 "Network exposure" (lines 224 to 228). Search the file for "DEPLOYMENT.md": hits are only at line 32 (section 3) and lines 282-283 (12.6).
- Expected (per the QA brief for HRD-4): sections 3, 12.1 and 12.6 point to the guide.
- Actual: 12.1 does not mention it. Note: BACKLOG HRD-4 does not itself require this; confirm with the owner whether it is wanted.
- Role / data: documentation only.

No other defects found. Both bug cards (p7KJ6mEV, bRAFJyWW) and wxTtqdMT could not be reproduced.

## Owner-only steps (NOT RUN - owner)

**TC-HRD-07 (second LAN device and firewall).** In an elevated PowerShell on the department PC:
1. Set `WEB_BIND_ADDRESS=<PC LAN IP>` and `COOKIE_SECURE=false` in `.env`; run `docker compose up -d --build`.
2. `New-NetFirewallRule -DisplayName "BMS web" -Direction Inbound -Protocol TCP -LocalPort 8080 -Profile Private -RemoteAddress <subnet>/24 -Action Allow`
3. From a phone or second PC on the same subnet open `http://<LAN IP>:8080`, sign in over HTTP, do a checkout.
4. Confirm `http://127.0.0.1:8080` on the PC no longer answers. Try from a device outside the subnet if possible (should fail).
5. Remove the rule (`Remove-NetFirewallRule -DisplayName "BMS web"`), reset `WEB_BIND_ADDRESS=127.0.0.1`, `docker compose up -d`.
6. Also run the Task Scheduler backup task once and check a new file appears (section 5, steps 4 and 5).

**TC-HRD-29 typed confirmation (real terminal).** In a real PowerShell: `npm run restore -- <valid dump>`; type a wrong database name (expect "Not confirmed. Nothing was changed.", api still up); then type the right name on a dump from the same version (expect restore finishes). I verified the logic only with a faked TTY.

## Observations (not bugs)
1. BACKLOG HRD-5b says "Items Retry moves focus to the first field"; the app and TC-HRD-34 move it to "+ Add item". Docs disagree, behavior matches the test case.
2. Usage summary tab: after clearing a date and pressing Show report, the error appears but the previous result ("Nothing was borrowed ...") stays on screen; the Audit log hides its result box in the same case.
3. Semester start date `2026-02-30` is refused with "Enter a start date." while `0000-01-01` gets "Enter a real date." The refusal is correct; the first message could say "Enter a real date." too.
4. The Items Retry alert takes about 25 to 30 s to appear when the api is down (query retries).
5. README Commands list omits `npm run test:e2e` (CLAUDE.md has it).
6. The "page could not load" error page replaces the whole screen, including the menu.
7. The audit "Change" column shows raw ISO strings (for example 2026-11-25T09:00:00.000Z for FLAGGING_RUN).

## Test-data side effects on the dev stack (for the owner)
- During a scripting slip I deleted the sample item "Extension cord" (no history) and recreated it (same name, 10 units, new id). The later restore returned the database to a backup taken after that recreation.
- Dev data added: semesters "QA same-day" and "QA ui sem", borrower "Qa Inactive" (inactive), borrower "Marker After Backup" was removed by the restore, a deleted "QA Temp Cord" item. qa-handler and qa-viewer passwords were reset to random values I did not keep; reset them again if needed.
- The dev database was wiped (`down -v`) and restored from a backup of itself; stack is healthy (`/api/health` 200, audit:sweep clean).
- I briefly created two empty stray files (`=notice`, `notice`) in the repo root through an unquoted shell redirect and removed them; `git status` shows only the pre-existing untracked files.

## Cleanup
Scratchpad dumps and cookie jars deleted; no bms-load or bms-e2e containers, volumes or networks; Playwright temp profiles removed; no commits, pushes or Trello writes; application code unchanged.
