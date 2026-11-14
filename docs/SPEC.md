# Product Spec

Version 1.1. Behavior rules are in `BUSINESS_RULES.md`. Technical decisions are in `ARCHITECTURE.md`.

## 1. Purpose

A web-based Inventory and Borrowing System for a college department. It tracks every borrowable item, who borrowed it, the room or lab where it will be used, and the staff member who handled each transaction. Borrowers never log in: they request items in person at the handout room, and staff record everything.

## 2. Scope and key decisions

- Users are department staff only, with three roles: admin, handler, view-only.
- Items are either individually tracked equipment (asset tag or serial number) or quantity-based supplies that are returned.
- Borrowing is same-day: everything is expected back by closing time.
- Borrower data is assumed accurate and is kept locally. There is no external database connection for now, but adding one later must be a small change (see `ARCHITECTURE.md`, BorrowerService).
- Runs in Docker on the owner's machine first, then on a department PC on the local network. Timezone is Philippine Standard Time (`Asia/Manila`).
- Expected scale is small: one department, a few staff users, hundreds of items, a few thousand borrowers.

## 3. Roles and permissions

| Capability | Admin | Handler | View-only |
|---|---|---|---|
| Check out and return items, including looking up borrowers for checkout (`GET /api/borrowers/lookup`) | yes | yes | no |
| Pick or add a room or lab at checkout (handlers see only active rooms; checkout in an inactive room is refused for everyone, `LOCATION_INACTIVE`, BR 2) | yes | yes | no |
| Add or edit a note on an open line | yes | yes | no |
| Dashboard and reports | yes | yes | yes |
| Manage inventory, categories, borrowers, rooms | yes | no | no |
| Manage users | yes | no | no |
| Manage settings and semesters | yes | no | no |
| Override flags | yes | no | no |
| Trigger the flagging job manually | yes | no | no |
| View the audit log | yes | no | no |
| Change own password | yes | yes | yes |

## 4. Data model

All domain tables use UUID primary keys and `created_at` / `updated_at` timestamps (UTC). Enum values are uppercase strings.

**users**: name, username (unique, case-insensitive; stored as typed; sign-in matches it exactly), password_hash, role (`ADMIN`, `HANDLER`, `VIEWER`), active.

**borrowers**: school_id (unique, case-insensitive; stored as typed), name, type (`STUDENT`, `FACULTY`, `EMPLOYEE`), department, active.

**categories**: name (unique, case-insensitive).

**locations** (rooms and labs): name (unique, case-insensitive), active, created_by (user). Checkout only uses an active room (BR 2).

**items**: name, category, description, tracking_type (`UNIT` or `QUANTITY`, fixed once the item is created), asset_tag (unique, case-insensitive; stored as typed; required for UNIT, null for QUANTITY), total_quantity (always 1 for UNIT; 0 or more for QUANTITY), condition (`NEW`, `GOOD`, `FAIR`, `DAMAGED`), status (`ACTIVE`, `UNDER_REPAIR`, `LOST`, `RETIRED`).
- Status describes the item's lifecycle, not whether it is currently out. "Borrowed" or "available" is always calculated from open transaction lines and never stored.

**semesters**: name (unique, case-insensitive), start_date, end_date (dates in `Asia/Manila`; the end is not before the start), is_current (exactly one true at a time). Semesters never overlap: start and end are both included, so one ending on the day another starts overlaps it (owner decision 2026-11-03). Never deleted.

**settings** (single row): closing_time (local time `HH:mm`, default `17:00`), warning_threshold (default 3), notice_threshold (default 4), block_threshold (default 5).

**transactions**: borrower, location, issued_by (user), issued_at, semester (the current semester when issued).

**transaction_items** (one row per item line): transaction, item, quantity_borrowed, quantity_returned (default 0), note (optional), expected_return_date (optional date), flag_status (`NONE`, `FLAGGED`, `OVERRIDDEN`), flagged_at, override_by (user), override_at, override_reason.
- Outstanding quantity = quantity_borrowed minus quantity_returned.
- A line is open while outstanding is greater than 0.

**returns** (one row per return event): transaction_item, quantity, returned_at, received_by (user), condition (`GOOD`, `FAIR`, `DAMAGED`).
- quantity_returned on the line is the sum of its return events.
- Returning an item as `DAMAGED` also sets the item's condition to `DAMAGED` for UNIT items. For QUANTITY items the condition is recorded on the return event only.

**audit_log**: actor (user), action, entity, entity_id, before (JSON), after (JSON), created_at.

**session**: managed by the session store package (see `ARCHITECTURE.md`).

## 5. Screens

| Screen | Roles | Purpose |
|---|---|---|
| Login, change password | all | Sign in and change own password |
| Dashboard | all | Currently unreturned items and flagged borrowers, with notes and expected return dates (read-only; notes are edited on Return). The menu entry and the page at `/` are "Dashboard". Endpoints: `GET /api/dashboard/unreturned`, `GET /api/dashboard/flagged-borrowers` |
| Checkout | admin, handler | Borrower lookup, room or lab picker with add-new, item search with quantity, per-line note and expected return date, strike count and banners (warning, stricter notice, blocked; `GET /api/borrowers/:id/strikes`) |
| Return | admin, handler | Find open borrowings by borrower, item, or asset tag; return all or part; select condition. Flagged lines are marked; a retired or lost item can still be returned (owner decision 2026-11-10); `GET /api/returns/open` feeds it; a strike badge sits next to each borrower, from the strikes and thresholds in the `GET /api/returns/open` reply (FLG-3); "Edit note and date" on each line opens a dialog to set its note and expected return date (BRW-6, `PATCH /api/lines/:id`) |
| Flag review | admin | List of the current semester's `FLAGGED` lines (an overridden line leaves the list; older semesters stay in the database for history and reports) with borrower and their strikes ("N strikes", plus "blocked" at the block threshold), item, issued, flagged, now, note, and expected return date; filter by returned or still out and by borrower or item text; override with a reason of 5 to 500 characters; "Run flagging now" with a confirm (once a minute). With no current semester the empty state says "No current semester is set." Endpoints: `GET /api/flags`, `POST /api/flags/:id/override`, `POST /api/flagging/run` |
| Inventory and categories | admin | Item and category management |
| Borrowers | admin | Management, search, Type and Status filters, CSV import |
| Rooms and labs | admin | Management |
| Users | admin | Management |
| Settings and semesters | admin | Closing time, thresholds, semester dates |
| Reports | all | History per borrower, history per item, usage summary. The fourth report, unreturned and flagged, is the Dashboard (owner decision 2026-11-14). Usage summary (RPT-4): From and To dates (at most 366 days, both ends counted), top 10 items, categories, and rooms or labs by times borrowed (one checkout line is one time), as bar charts with "Show as table"; `GET /api/reports/usage` |
| Audit log | admin | Filterable viewer |

## 6. Borrower CSV import format

Header row required: `school_id,name,type,department,active`. `type` is one of `STUDENT`, `FACULTY`, `EMPLOYEE` (case-insensitive). `active` is `true` or `false` and defaults to `true` if blank. Rows are matched on `school_id`: existing borrowers are updated, new ones created. Invalid rows are rejected individually and reported with a reason.

## 7. Input limits

Enforced on the server in the shared Zod schemas and mirrored in the forms. They exist so one request cannot use up the server (see `ARCHITECTURE.md` section 12).

- JSON request body: 100 KB. CSV upload: 2 MB, one file, at most 5,000 rows.
- Lists: page size at most 100. Search text: 2 to 100 characters. The checkout borrower lookup requires search text.
- Checkout: at most 50 lines per transaction, each item on one line only. Quantity per line is a whole number from 1 to 10,000 and never above what is available. An expected return date is today or later in the app timezone (BR 7), with no upper limit.
- Returns: at most 50 lines per request, each line once. Quantity per line is a whole number from 1 to 10,000 and never above what is outstanding (BR 5). Condition is `GOOD`, `FAIR`, or `DAMAGED`.
- Open lines search (Return screen): a borrower search looks through at most 5,000 borrowers with open lines; more than that is refused with `SEARCH_TOO_BROAD` and the user searches by item or asset tag.
- Flag review search: a borrower-name search looks through at most 5,000 borrowers with flagged lines in the current semester. Over that, the name part is skipped (not refused): item names and asset tags still match, the reply says `borrowerSearchSkipped: true`, and the screen says "Too many borrowers have flagged lines to search by name. Showing matches by item or asset tag only."
- Items: total quantity of a QUANTITY item is a whole number from 0 to 10,000.
- Settings: closing time is `HH:mm` (00:00 to 23:59); each strike threshold is a whole number from 1 to 100, and warning < notice < block.
- Text fields: names 200 characters, descriptions 1,000, notes 500, override reasons 500 (required, at least 5 characters).
- Reports: date range at most 366 days, results paginated or aggregated.
- Audit log viewer: always filtered by a date range and paginated.

## 8. Non-functional requirements

- Runs entirely from `docker compose up` with no external services.
- Data survives container restarts and rebuilds (named volume). A documented backup and restore script exists.
- Pages respond quickly on a department PC; list screens paginate.
- Basic accessibility: keyboard-friendly checkout, labeled form fields, sufficient contrast.
- Availability under abuse: the app must stay usable for staff while abusive traffic hits it (request floods, login spamming, oversized uploads, slow connections). Design is in `ARCHITECTURE.md` section 12 and is verified by ticket SEC-2.
- Failed logins are throttled and never lock an account, so nobody can lock staff out by guessing passwords.
- The app is reachable only from the department network. Remote access, if ever needed, goes through a VPN.
- Privacy: only staff accounts exist. Borrower records contain no more than school ID, name, type, and department.
