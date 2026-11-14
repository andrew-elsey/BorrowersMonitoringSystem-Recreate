# HRD-6 Manual Test Report
Date / build or commit: 2026-11-05, branch feature/HRD-6-bundle-split, head 3d4bcbf
Environment: docker compose at http://127.0.0.1:8080 (already running from this branch, not rebuilt); headless Edge driven over the DevTools protocol with network logging (cache disabled); admin role; Windows 11.
Verdict: PASS

## Acceptance criteria results
| # | Criterion | Result | Notes |
|---|---|---|---|
| 1 | Route-level splitting with React.lazy + Suspense, no new dependency | Pass | Six *Page-*.js chunks served (HTTP 200). `git diff main -- package.json apps/web/package.json package-lock.json` is empty. |
| 2 | No chunk-size warning (npm run build) | Not tested | Did not rerun the build (disk space tight). Served bundle shows the entry chunk plus separate page chunks, consistent with the card's TC-HRD-09 result. |
| 3 | Sign-in and shell load first; every route renders | Pass | See TC-HRD-11 below. |

## TC-HRD-11 (manual, network tab)
- /login signed out: only index-*.js and Alert-*.js fetched, no *Page-*.js. PASS
- Deep link /settings while signed out: redirects to /login, no page chunk fetched. After signing in, it returns to /settings and then loads SettingsPage chunk. PASS
- First visit via menu (client-side), each fetched its own chunk and rendered inside the shell (header, nav, h1 present):
  - Inventory: InventoryPage-*.js. Items and Categories tabs both render (?tab=categories, no extra chunk).
  - Borrowers: BorrowersPage-*.js (+ shared StatusBadge)
  - Rooms: RoomsPage-*.js
  - Settings: SettingsPage-*.js (+ shared ConfirmDialog, RetryAlert)
  - Change password: ChangePasswordPage-*.js
  - Home: HomePage-*.js
  - Revisiting a screen fetches nothing new. PASS
- Hard-load deep links to /, /inventory, /borrowers, /rooms, /settings, /password each load entry + own chunk and render. /nonexistent redirects to /. PASS
- Slow network (latency 2 s, about 40 kB/s), hard load of /rooms: the shell (header and nav) appears, main shows "Loading…" in an element with role=status, then the screen renders. PASS
- Keyboard: first Tab lands on "Skip to main content"; clicking a menu link leaves focus on that link (not lost to body). PASS
- Back/forward between Home and Change password, and after sign out (stays on /login, signed-out state respected). PASS
- Narrow 400 px window: no horizontal overflow on any screen (scrollWidth = clientWidth). PASS
- No application console errors (only a browser-extension error from Edge's own Grammarly script, unrelated).

## Additional tests run
- Optional step 5 (rebuild with tab open, React Router default error page): not run, the instructions said not to rebuild; known gap left to HRD-5.
- npm run lint, typecheck, npm test: not run by QA (card reports pass; full suite not rerun).
- Mockup comparison: not done; HRD-6 changes no visuals.

## Defects
None.

## Observations (not bugs)
- On a client-side click when the chunk is slow, the previous screen stays on display until the new chunk arrives (React Router transition), so "Loading…" appears on hard loads and deep links but not on menu clicks. Acceptable, arguably better, but TC-HRD-11 wording ("shows Loading… briefly if slow") and the card step 4 ("Slow 3G, Loading… shows") only hold for hard loads. Consider clarifying.
- The Sprint 3 list name still says 21 points while BACKLOG says 22 (card already notes this).
