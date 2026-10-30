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
| Check out and return items | yes | yes | no |
| Add a room or lab at checkout | yes | yes | no |
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

**users**: name, username (unique), password_hash, role (`ADMIN`, `HANDLER`, `VIEWER`), active.

**borrowers**: school_id (unique), name, type (`STUDENT`, `FACULTY`, `EMPLOYEE`), department, active.

**categories**: name (unique).

**locations** (rooms and labs): name (unique, case-insensitive), active, created_by (user).

**items**: name, category, description, tracking_type (`UNIT` or `QUANTITY`), asset_tag (unique, required for UNIT, null for QUANTITY), total_quantity (always 1 for UNIT), condition (`NEW`, `GOOD`, `FAIR`, `DAMAGED`), status (`ACTIVE`, `UNDER_REPAIR`, `LOST`, `RETIRED`).
- Status describes the item's lifecycle, not whether it is currently out. "Borrowed" or "available" is always calculated from open transaction lines and never stored.

**semesters**: name, start_date, end_date (dates in `Asia/Manila`), is_current (exactly one true at a time).

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
| Dashboard | all | Currently unreturned items and flagged borrowers, with notes and expected return dates |
| Checkout | admin, handler | Borrower lookup, room or lab picker with add-new, item search with quantity, per-line note and expected return date, strike banners |
| Return | admin, handler | Find open borrowings by borrower, item, or asset tag; return all or part; select condition |
| Flag review | admin | List of flagged lines; override with a reason |
| Inventory and categories | admin | Item and category management |
| Borrowers | admin | Management, search, CSV import |
| Rooms and labs | admin | Management |
| Users | admin | Management |
| Settings and semesters | admin | Closing time, thresholds, semester dates |
| Reports | all | History per borrower, history per item, usage summary, unreturned and flagged |
| Audit log | admin | Filterable viewer |

## 6. Borrower CSV import format

Header row required: `school_id,name,type,department,active`. `type` is one of `STUDENT`, `FACULTY`, `EMPLOYEE` (case-insensitive). `active` is `true` or `false` and defaults to `true` if blank. Rows are matched on `school_id`: existing borrowers are updated, new ones created. Invalid rows are rejected individually and reported with a reason.

## 7. Input limits

Enforced on the server in the shared Zod schemas and mirrored in the forms. They exist so one request cannot use up the server (see `ARCHITECTURE.md` section 12).

- JSON request body: 100 KB. CSV upload: 2 MB, one file, at most 5,000 rows.
- Lists: page size at most 100. Search text: 2 to 100 characters.
- Checkout: at most 50 lines per transaction. Quantity per line is a whole number from 1 to 10,000 and never above what is available.
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
