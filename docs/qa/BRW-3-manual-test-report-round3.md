# BRW-3 Manual Test Report, round 3
Date / build or commit: 2026-11-07 (Manila, about 16:10 to 16:20), branch feature/BRW-3-checkout-ui, head 1bc7f02 (stack rebuilt by the coordinator; `/api/health` ok).
Environment: Windows 11, Docker Compose stack at http://127.0.0.1:8080, dev database. Headless Microsoft Edge 156 driven with puppeteer-core, own temporary profile, `--disable-extensions`. Window sizes set with `Emulation.setDeviceMetricsOverride` (so 320 and 360 px are real). Tested as admin (qa-handler and qa-viewer still cannot sign in with QA_PASSWORD). I did not run `npm test`, lint or typecheck.
Verdict: PASS (BUG-1, BUG-2 and BUG-3 are fixed; all 6 acceptance criteria pass; no new defects)

## Round 3 checks

| Item | Result | Notes |
|---|---|---|
| BUG-1 sideways scroll with lines | Pass | Borrower chosen, the 100-character room selected, 3 lines (a quantity item, a unit item, a long-named item with a 41-character asset tag). Page `scrollWidth` equals the window width at 320, 360, 500, 700, 740, 780, 820, 900, 950, 1000, 1050 and 1100 px. Round 2 failed at 320 to 700 and 780 to 900. |
| BUG-2 100-character room | Pass | No lines: page equals window width at 320, 360, 768 and 1100 px. With that room selected: same at 320, 360, 768 and 1100 px. |
| BUG-3 first empty Confirm focus | Pass | Fresh load, one press: focus is on `#borrower-search` with the mouse and with Enter from the keyboard. With a borrower chosen and no room, one press focuses the room select. |
| TC-BRW-17 focus after save | Pass | Focus on "Start a new checkout" after save (two saves); Enter gives a clean form with focus on the borrower search. |
| TC-BRW-18 (re-check) | Pass | Cart quantity 13, another checkout took 5, Confirm: banner "Only 8 ... available", the line reads "Quantity item · 8 available", focus on the quantity field. |
| TC-BRW-19 keyboard only | Pass | No mouse: 10 Tabs to the borrower search, typed, Tab and Enter on Choose, room list with ArrowDown, item search, Add with Enter, Note, Confirm with Enter. Result "Checkout saved. 1 item issued to QA-Borrower Two for QA-Scroll175 ... Due back by 17:00 today." |

## Acceptance criteria (regression)

| # | Criterion | Result | Notes |
|---|---|---|---|
| 1 | Borrower lookup | Pass | "ga" shows "Ana Garcia, E-0001 · Employee · Registrar"; "zzzz" shows the no-match message; an inactive borrower shows the inactive panel and Confirm is disabled. |
| 2 | Room picker with add-new | Pass | Empty name: "Enter a room or lab name." (no request); "room 101": duplicate message; a new name is created and selected. |
| 3 | Item search and quantity | Pass | Quantity 0, -1, 1.5 and empty each show "Enter a whole number from 1 to 10,000." and send nothing. |
| 4 | Note and expected return date | Pass | Date `min` 2026-11-07; note saved. |
| 5 | Summary; no double submit | Pass | Summary correct; two clicks in the same moment sent one POST. |
| 6 | API errors shown | Pass | INSUFFICIENT_QUANTITY and ITEM_UNAVAILABLE shown on the banner and the line. |

## Defects
None.

## Observations (not bugs)
1. The room list now holds my 100-character test room, so the keyboard test landed on a different room than before; this is test data, not behaviour.

## Not tested
- Handler and viewer accounts (sign-in fails with QA_PASSWORD).
- `npm test`, lint, typecheck (by instruction).
- The past-date, LOCATION_INACTIVE and BORROWER_INACTIVE refusals and the mockup comparison were not repeated (no related change).

## Clean-up
Browser process trees killed; 6 Edge profile folders removed; no `edge-*` folder left in the temp folder. The 100-character room is deactivated again. Closing time was not changed this round (17:00). Test data is prefixed QA2-.
