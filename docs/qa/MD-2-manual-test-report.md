# MD-2 Manual Test Report
Date / build or commit: 2026-11-03, branch feature/MD-2-items, commit 094c73d (head; working tree not changed by QA)
Environment: Windows 11, Docker Compose stack (db, api, web) already running and healthy, built from the branch, app at http://127.0.0.1:8080. Browser checks used headless Microsoft Edge driven over the DevTools protocol (1280 px and 360 px wide). API checks used a Node script with a cookie session and the `X-Requested-With: fetch` header. Accounts: admin (from .env), qa-handler, qa-viewer (both already existed). No secrets are in this report.
Verdict: PASS (all 5 acceptance criteria met; 2 Low defects, both API-only, no effect on the screen)

## Documents checked
- Card acceptance criteria match docs/BACKLOG.md MD-2 (same 5 criteria). SPEC 4 and SPEC 7 (quantity 0 to 10,000), BUSINESS_RULES 15 and S19 agree with the card and with the owner decisions comment. No disagreement found.
- Mockup read: https://claude.ai/artifact/9FampTJnZj8twygeqD8iao, `project/Inventory.dc.html` (read worked). Compared from the source markup and my own screenshots.

## Acceptance criteria results
| # | Criterion | Result | Notes |
|---|---|---|---|
| 1 | UNIT items require a unique asset tag and have total quantity 1 | Pass | UI: empty add form shows "Fix 3 fields below." plus "Enter an asset tag." under the field, focus moves to the first bad field. Total quantity is fixed at 1 and disabled ("Always 1 for unit items."). Duplicate tag in any case ("lap-001" when "LAP-001" exists) gives "Asset tag lap-001 is already used by another item." under Asset tag with focus on it, in the add form and in the edit dialog. API: no tag, empty tag, blank tag all 400; totalQuantity 5 gives 400 "Unit items always have a total quantity of 1."; totalQuantity 1 accepted; tag over 200 chars 400. Uniqueness: "QA-LT-001", "qa-lt-001" and " qa-LT-001 " all 409 DUPLICATE_VALUE; unicode "qa-ñé-1" collides with "QA-ÑÉ-1". Four parallel creates of the same tag in different cases gave 201, 409, 409, 409 (no 500). DB has unique index `items_asset_tag_lower_key` on lower(asset_tag). Tag is stored as typed ("qa-lt-001" after an edit showed as typed). Editing an item's own tag to a different case is allowed. |
| 2 | QUANTITY items have no asset tag and total quantity 0 or more | Pass | Quantity 0 accepted (UI and API), 10000 accepted, 10001, -1, 1.5, "5" (string), empty, "abc" all refused with "Enter a whole number from 0 to 10,000." (UI also focuses the field). Missing total gives "Enter the total quantity." API: an asset tag on a QUANTITY item gives 400 "Quantity items have no asset tag."; the asset tag field is hidden when Quantity is chosen. Same 0 to 10,000 limits on edit (10001 refused, 0 saved). |
| 3 | Fields: name, category, description, condition, status | Pass | All five save from the Add form and from the Edit dialog (checked in the database for the condition, status and a two-line description). Tracking type is not in the edit dialog; PATCH with trackingType (same or different value) gives 400 "The tracking type cannot be changed after the item is created." Name 200 ok, 201 refused; description 1000 ok, 1001 refused; control characters refused (name with NUL, description with U+0001); line breaks and tabs in a description allowed; non-existent category 400 "Choose a category that exists."; bad condition, status and tracking type values 400; malformed JSON 400. Whitespace-only name and tag refused in the UI. A name such as `<img src=x onerror=alert(1)>` is shown as plain text (0 img elements). |
| 4 | Search and filter by name, category, status, tracking type, paginated | Pass | 33 items, 25 per page: "Showing 1-25 of 33, Page 1 of 2", Next and Previous work, Previous disabled on page 1. Search by name and by asset tag (partial, any case); one letter keeps the list and shows an "at least 2 characters" hint; spaces only shows the full list; `%%` and `_` are matched as plain text (no match); no-match text `No item matches "..."`. Category, Status and Tracking filters combine (Unit + Active + Laptops gives 2). A filter or search change on page 2 goes back to page 1. API: pageSize 100 ok, 101 / 0 / abc give 400, page 0 gives 400, page far past the end returns an empty page, q of 1 or 101 chars or with a control character gives 400, bad status / trackingType / categoryId give 400. |
| 5 | Items with history are retired, never deleted | Pass | An item with no transaction line deletes (204, confirm dialog, toast "Item ... deleted.", row gone). An item on a transaction line gives 409 HAS_HISTORY "This item appears in past transactions. Set its status to Retired instead." for both a UNIT and a QUANTITY item, and again after it is retired. The screen shows the alert "Cannot delete QA-HIST-1. ... Set its status to Retired instead." with a Retire button; Retire sets Retired (badge shows "Retired", toast "Item QA-HIST-1 retired.", focus goes to + Add item). Retiring through the Status field in Edit works too. A retired item can be set back to Active. No row was deleted from the database for an item with history (the two history items still exist). Test data: no seeded transaction existed, so I inserted one transaction with two lines (one UNIT, one QUANTITY item, both "QA-History ...") through `docker compose exec db psql`. |

## Additional tests run
- **Roles (API):** qa-handler and qa-viewer: GET /api/items 200; POST, PATCH, DELETE 403 FORBIDDEN. Signed out: GET 401; POST without the CSRF header 403. Admin all allowed. Pass.
- **Roles (screen):** handler and viewer menu shows only Home; /inventory and /inventory?tab=categories show "You can't open this page ... Your role, Handler/View-only, does not have access to Inventory and categories." Pass.
- **Audit:** the audit_log shows ITEM_CREATED, ITEM_UPDATED (before and after hold only the changed fields) and ITEM_DELETED (before holds the item). A PATCH that changes nothing, a second Retire on a retired item, a refused delete and refused creates write no entry. Pass.
- **Keyboard:** the two tabs are links in a nav ("Inventory sections", aria-current on the current one) and Tab reaches them. Tab order on Items: tabs, search, Category, Status, Tracking, + Add item, then Edit and Delete per row (labels such as "Edit LAP-001"). Enter on + Add item opens the form with focus on the Tracking radio; Tab order Name, Category, Asset tag, Condition, Status, Description, Cancel, Save item. Enter in a text field submits. Cancel (Enter) returns focus to + Add item. Edit dialog: opens with focus in Name; Enter submits; Escape closes (also with errors showing) and focus returns to that row's Edit button; a successful save returns focus to that Edit button. Delete confirm: focus starts on Cancel, Escape and Cancel close it and focus returns to that row's Delete button; confirming moves focus to + Add item. Pass, with the two small notes below.
- **Narrow window (360 px):** no horizontal page scroll (page 345 of 360). The table sits in its own scroll box. Add form (with errors) and the edit dialog (307 x 691 in a 740 px high window) fit. Pass.
- **Layout vs mockup:** header, tabs, filter row (labels, option wording, + Add item), table headings, status badges, the add form (wording, "Always 1 for unit items.", "Fix N field(s) below."), delete refused alert wording and the Retire button match the mockup. Known and accepted differences: no Available column, retired rows not greyed. Other differences are listed under Observations.
- **Regression, Categories:** /inventory?tab=categories loads; add, case-insensitive duplicate ("qa-category x" refused), delete of an unused category (confirm, toast) work; categories used by items show "Used by N items" and the API refuses to delete one with 409 HAS_HISTORY "This category is used by items, so it cannot be deleted. Rename it instead." Item counts per category are right. Pass.
- **Regression, re-sign-in:** session lost while on /inventory?tab=categories (reload, and an action in the page) returns to /inventory?tab=categories after sign-in; an expired session while on Items (search typed, or edit dialog open and Enter pressed) returns to /inventory after sign-in. Pass.
- **Regression, Borrowers:** /borrowers loads with its form, filters and table. Pass.
- **Limits:** a 101 KB request body is refused with 413 (see Observations about its format).
- **Cleanup:** no msedge process of mine and no `edge-*` folder is left in the temp folder.

## Defects
### BUG-1: Duplicate "Enter an asset tag." message for an empty or blank asset tag on a UNIT item (API)
- Severity: Low
- Steps to reproduce:
  1. Sign in as admin and keep the session cookie, then send `POST /api/items` (header `X-Requested-With: fetch`).
  2. Body: `{"trackingType":"UNIT","name":"QA-Laptop A","categoryId":"<any category id>","assetTag":"","condition":"GOOD","status":"ACTIVE"}`. Repeat with `"assetTag":"   "`.
  3. Read `error.details.fields.assetTag`.
- Expected: `["Enter an asset tag."]`, one message (as when the tag is left out).
- Actual: `["Enter an asset tag.","Enter an asset tag."]`. The same message appears twice, from `textField` and from the unit rule in `trackingErrors`.
- Role / data used: admin; the screen does not show it because the form checks the field first and shows one message. Only API clients see the doubled text.

### BUG-2: Raw validation text for a null asset tag and a missing name (API)
- Severity: Low
- Steps to reproduce:
  1. As admin, send `POST /api/items` with `{"trackingType":"QUANTITY","name":"QA-Cord","categoryId":"<category id>","totalQuantity":3,"assetTag":null,"condition":"GOOD","status":"ACTIVE"}`.
  2. Send `POST /api/items` with `{}`.
- Expected: messages in the app's wording, as on the other fields (for example "Enter a name.").
- Actual: `assetTag: "Invalid input: expected string, received null"` (a QUANTITY item with `assetTag: null` is refused, although null is how the item is stored); `name: "Invalid input: expected string, received undefined"` when name is missing.
- Role / data used: admin; API only, the screen always sends strings. Decision for the owner: a null tag on a QUANTITY item could be accepted as "no tag".

No bug cards were created (both are Low and API-only; see the reply for the suggested list).

## Observations (not bugs)
- Out of scope per the owner and confirmed as such: no Available column, retired rows have a badge but are not greyed, and lowering a total below the checked-out amount is not checked (nothing can be checked out yet).
- Table layout: with a 200-character item name the Name column takes the width and the other columns squeeze, so asset tags wrap in the middle ("LAP-" / "001") at 1280 px. With normal names tags stay on one line. Cosmetic.
- Disabled "Total quantity" (1, unit items) is drawn like an enabled field (white). The mockup shows it grey. The helper text and the disabled state still make it clear.
- Tabs are links in a nav, not `role=tab` as in the mockup. This suits a page with its own address (?tab=categories) and works with the keyboard.
- Edit dialog and delete/retire messages name a unit item by its asset tag ("Edit qa-lt-001", "Cannot delete QA-HIST-1"), not by its name. Reasonable, but two units with the same name are only told apart by the tag, which is the point.
- After a refused delete, focus returns to the row's Delete button, not to the new alert or its Retire button. The alert is announced (role=alert), and the Retire link is above the filters, so a keyboard user must Shift+Tab back to it. Consider moving focus to Retire.
- The "Cannot delete ..." alert stays after the search or filter changes, even when that item is no longer in the list. Retire still works. It can be dismissed.
- The Add form does not close on Escape (it is an inline form with Cancel, like the mockup). Dialogs do close on Escape.
- The number field accepts "1e2" and saves 100. A valid whole number, so left alone.
- A PATCH body with unknown fields (for example `{"foo":1}`) is accepted and ignored. A 413 for a body over 100 KB comes from nginx as an HTML page, not the API's JSON error format. Both are API-only and only matter for non-browser clients.
- The Name and Asset tag inputs have no `maxlength`; over-length text is refused with "Too long: at most 200 characters." on save (description does have maxlength 1000).
- Duplicate error text uses the tag as trimmed and as typed in that request, not the stored tag's case.
- The category pickers load the first 100 categories (marked shortcut in the card). Not tested with more than 100.
- Test data left in the dev database (named "QA-..."): about 30 QA items, one inserted transaction with two lines ("QA-History Laptop", "QA-History Cord", needed to keep the HAS_HISTORY case), and the audit rows. No seed rows were changed or deleted, no sessions of other users were removed, no volume was touched.
- Not tested: `npm test`, lint and build (another agent runs them); screen reader output; more than 100 categories; a handler or viewer signing in through the UI to read items (GET checked through the API only); Playwright suite.
