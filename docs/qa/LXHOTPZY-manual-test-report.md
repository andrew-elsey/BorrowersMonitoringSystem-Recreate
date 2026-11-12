# LXHOTPZY Manual Test Report (BRW-3: checkout saved / not saved banners in the sticky message area)
Date / build or commit: 2026-11-08, branch fix/BRW-3-checkout-banners-sticky at dee4469
Environment: Docker stack at http://127.0.0.1:8080 (prepared by owner, not rebuilt). Headless Edge 156 driven over CDP with window emulation (1000x500, 1000x700, 400x700, 320x700). Node scripts, profile and screenshots on D: (D:\edgetmp-banner). Roles: qa-handler (checkout), admin (regression and test data). Test data prefixed "BAN-".
Verdict: PASS

## Acceptance criteria results
Measured with getBoundingClientRect. "Area" is the sticky [aria-live=polite] element.

| # | Criterion (card "How to QA") | Result | Notes |
|---|---|---|---|
| 1 | Refusal, quantity over available: "Checkout not saved." is in the sticky area, stays in sight after 400 and 600 px scroll, focused quantity field visible below the message | Pass | All four widths. 1000x500: message 8..57 px, area bottom 65, area scroll-padding 65px, quantity field top 416 (below area). After scroll 400 and 600 message stays at 8..57. 1000x700, 400x700 and 320x700 behave the same (message stays at top, one message, area height > 0). |
| 1b | Refusal, unavailable item (item retired by admin after it was added to the line): message pinned, focus on the line's Remove button, not under the message | Pass | Message "BAN-Retire cannot be issued: it is retired. Nothing was issued." pinned. 1000x500: Remove button (remove-0) top 460, area bottom 65. Stays pinned after scroll 500. Same at the other widths. |
| 2 | Save: "Checkout saved. ..." pinned, focus on "Start a new checkout", stays after scroll; pressing the button clears it and focuses borrower search | Pass | All widths. Focus on #start-over, visible. After scroll 500 the message is still in the area. Button press: area empty (height 0), focus on #borrower-search, scrollPaddingTop 0px. |
| 3 | Room quick-add notice plus a checkout message together: both visible, no overlap, page not covered more than needed | Pass | Both in the area, stacked without overlap. 1000x500: notice 8..57, refusal 65..113, area 121 px (24% of 500). 400x700: area 189 px (27%). 320x700: area 234 px (33%). Focused quantity field below the area in all. Both still in sight after scroll 500. Screenshot at 320 checked by eye. |
| 4 | Navigate away after a message: message gone, no gap or scroll-padding | Pass | Clicked Home after a refusal (SPA navigation): area height 0, text empty, documentElement.style.scrollPaddingTop = "0px". Checked at all widths. |
| 5 | Keyboard only: tab through after a refusal; focused fields scroll in below the pinned area | Pass | 10 Tab and 14 Shift+Tab presses per width after a refusal. No form field or button was ever under the pinned area. The only focus stops with a top above the area bottom were the page header links (Skip to main content, Change password, Sign out, Home, Checkout), which sit above the area when the page is at the top (the area is sticky, so at scroll 0 it sits below the header; screenshot at 400x700 confirms no overlap). |
| 6a | Regression: admin notices still pin and dismiss | Pass | Category added/deleted, room deactivated/reactivated, item "Changes to ... saved." all appear in the area, stay pinned after scroll (900 px on Rooms), Dismiss clears them and scrollPaddingTop returns to 0px. Checked at 1000 and 320/400 px. |
| 6b | No sideways scroll on Checkout at 320/400/1000 px (TC-BRW-41) | Pass | document scrollWidth was 305 / 385 / 985 at viewports 320 / 400 / 1000 (the difference is the scrollbar), in the refused, unavailable, saved and mixed states. |

## Additional tests run
- Item refused for quantity, then an unavailable item: the API's line error appears in the line and in the pinned message.
- Fresh checkout after "Start a new checkout" works; a second Confirm is not needed.
- Page header and nav are not covered by the area at scroll 0 (400x700 screenshot).
- At 400 px the area sits at its natural position until the page is scrolled past it (normal sticky behavior), not a defect.

## Defects
None found.

## Observations (not bugs)
1. At 320 px with both a room notice and a refusal, the pinned area takes 234 px of a 700 px window (33%). On a very short window (for example 320x500) it could take most of the screen. Not measured at that height. The notice has a Dismiss button, so the user can free the space.
2. The pinned checkout result has no Dismiss button (by design: the saved result carries the "Start a new checkout" action, and a refusal clears when the next attempt is made).
3. Headless Edge needed `--password-store=basic`.

## Test data and cleanup
Created: borrower BAN-0001 "BAN-Student One" (active, cannot be deleted), items BAN-Cord, BAN-Cord2, BAN-Laptop (BAN-LT-1), BAN-Retire (all retired at the end), 4 saved checkouts of BAN-Cord2 (qty 1 each, still open so BAN-Student One will be flagged at end of day), rooms and categories I created were deleted again. Headless Edge process tree killed, profile and cache folders deleted; scripts and screenshots remain in D:\edgetmp-banner (safe to delete).
