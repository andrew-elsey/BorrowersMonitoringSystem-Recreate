# Business Rules

The source of truth for system behavior. Each rule has a number; reference it in code comments and test names (for example `// Rule 7`). The worked scenarios in section 3 are meant to become automated tests.

All times below are `Asia/Manila` unless stated. Default closing time is 17:00.

## 1. Glossary

- **Transaction**: one checkout event for one borrower, containing one or more lines.
- **Line**: one item within a transaction, with a borrowed quantity. Unit items always have quantity 1.
- **Outstanding**: quantity borrowed minus quantity returned on a line. A line is **open** while outstanding is greater than 0.
- **Flag**: a mark on a line, set automatically, meaning "was still outstanding at closing time". Values: `NONE`, `FLAGGED`, `OVERRIDDEN`.
- **Strike**: a transaction in the current semester that has at least one `FLAGGED` line. A borrower's strike count is the number of such transactions.
- **Override**: an admin action that changes a line from `FLAGGED` to `OVERRIDDEN`, so it no longer counts.
- **Current semester**: the semester marked `is_current`.

## 2. Rules

### Checkout

1. **Availability.** A `UNIT` item can be issued only if it has no open line. A `QUANTITY` item can be issued only up to total quantity minus the outstanding quantity on all open lines. Items whose status is not `ACTIVE` cannot be issued.
2. **Who and when.** Every transaction records the borrower, the room or lab, the issuing handler (from the login, never typed), the issue time, and the current semester. If there is no current semester, checkout is rejected (`NO_CURRENT_SEMESTER`).
3. **Eligible borrowers.** Inactive borrowers cannot borrow (`BORROWER_INACTIVE`). A borrower at or above the block threshold cannot borrow (`BORROWER_BLOCKED`, rule 11).
4. **Atomic and safe.** A transaction and all its lines are created together or not at all. Availability is re-checked inside the database transaction after locking the item rows, so two handlers cannot issue the same unit item at once.

### Returns

5. **Return events.** A return is recorded per line with quantity, time, condition, and the receiving handler (from the login). The receiving handler can differ from the issuing handler. Partial returns are allowed. The returned quantity cannot exceed the outstanding quantity (`RETURN_EXCEEDS_OUTSTANDING`).
6. **Returning never touches flags.** Recording a return changes quantities only. A flagged line stays flagged after it is fully returned, until an admin overrides it.

### Notes

7. **Notes are informational.** A handler can add or edit a note and an expected return date on an open line (for example, "returning tomorrow"). Notes never prevent flagging and never change strikes. Edits are audited.

### Flagging

8. **End-of-day flagging.** At each closing time, every line that is open, has `flag_status = NONE`, and was issued before that closing time becomes `FLAGGED` (`flagged_at` is set). Lines already `FLAGGED` or `OVERRIDDEN` are skipped. A line issued after today's closing time is first evaluated at the next closing time. The job is idempotent: running it twice flags nothing new the second time.
9. **Catch-up.** If the service was down at a closing time, the job runs at startup and flags every line that should have been flagged at any missed closing time. It can also be triggered manually by an admin.

### Strikes and blocking

10. **Strike count.** A borrower's strikes are the number of their transactions whose semester is the current semester and which have at least one `FLAGGED` line. A transaction counts once no matter how many flagged lines it has. When every flagged line of a transaction has been overridden, it stops counting.
11. **Thresholds** (from settings, defaults shown):
    - 3 strikes: checkout shows a **warning**.
    - 4 strikes: checkout shows a **stricter notice**.
    - 5 or more strikes: checkout is **blocked** (enforced in the API). Returns are never blocked.
12. **Semester reset.** Strikes are counted per semester through the transaction's semester, so a new current semester starts every borrower at zero. No cleanup job exists or is needed.

### Overrides

13. **Override.** Only an admin can override. A reason of at least 5 characters is required. Overriding is allowed at any time, whether or not the item has been returned. It sets `flag_status = OVERRIDDEN` with the admin, time, and reason, and is audited. An overridden line is never flagged again, even if it is still outstanding at a later closing time.

### Audit

14. **Audit.** Every state change (checkout, return, note edit, flag, override, and all administration) writes an audit entry in the same database transaction as the change.

### Retention

15. **No deletion of history.** Items, borrowers, users, and rooms that appear in any transaction are deactivated or retired, never deleted.

### Abuse limits

16. **Failed logins are throttled, never locked.** Repeated failed logins from one address for one username are refused with `RATE_LIMITED` and a retry time. The account itself is never locked, and the same user signing in from another address is unaffected. Input limits in `SPEC.md` section 7 apply to every request.

## 3. Worked scenarios

Notation: "Day 1" is a normal working day with closing time 17:00 and a current semester set. A new borrower has 0 strikes.

**S1. Same-day return.** Ana borrows a projector at 10:00 and returns it at 15:00. At 17:00 the job runs. The line is not open, so nothing is flagged. Ana has 0 strikes.

**S2. Unit item not returned.** Ben borrows a laptop at 10:00 and does not return it. At 17:00 the line becomes `FLAGGED`. Ben has 1 strike.

**S3. Partial return of a quantity item.** Cara borrows 5 extension cords at 09:00 and returns 3 at 14:00. At 17:00 the line (2 outstanding) is flagged. Cara has 1 strike. The next morning she returns the last 2. The line stays `FLAGGED` and she still has 1 strike (rule 6).

**S4. Handler note does not prevent the flag (James).** James borrows 5 extension cables and tells the handler he will return them tomorrow. The handler adds a note with tomorrow's date. At 17:00 the line is flagged anyway and James has 1 strike. Next day James returns the cables. The flag and the strike remain. An admin overrides the line with a reason. James has 0 strikes.

**S5. One transaction, many flagged lines.** Dan borrows a laptop, a mouse, and a projector in one transaction and returns none. At 17:00 all three lines are flagged. Dan has 1 strike, not 3.

**S6. Two transactions, same day.** Eva borrows a camera at 09:00 (transaction A) and a tripod at 13:00 (transaction B), returning neither. At 17:00 both are flagged. Eva has 2 strikes.

**S7. Partial override.** A transaction has two flagged lines. An admin overrides one. The transaction still has a `FLAGGED` line, so it still counts as 1 strike. After the admin overrides the second line, it counts as 0.

**S8. Thresholds.** Fil reaches 3 strikes: the next checkout screen shows the warning, and checkout works. At 4 strikes it shows the stricter notice, and checkout works. At 5 strikes checkout is rejected with `BORROWER_BLOCKED`, but Fil can still return items. An admin overrides one of Fil's flagged transactions, so Fil has 4 strikes and can borrow again.

**S9. Semester reset.** Gio has 4 strikes in semester 1. An admin sets semester 2 as current. Gio now has 0 strikes. Gio's semester 1 transactions still show their flags in history.

**S10. Checkout after closing time.** Hana borrows a laptop at 17:30 (closing is 17:00). Tonight's job does not flag it. If it is still out at tomorrow's 17:00, it is flagged then.

**S11. Service down at closing time.** The API is stopped from 16:30 to 18:00. On startup the catch-up runs and flags every line that was open and issued before 17:00. A line issued at 18:10, after the restart, is not flagged until the next closing.

**S12. Idempotent job.** The job runs twice in a row at 17:00. The second run flags nothing and changes nothing.

**S13. Overridden lines stay overridden.** A line is flagged, then overridden while the item is still out. At the next closing time the item is still out. It is not flagged again.

**S14. Checkout validations.**
- Issuing a unit item that is already out fails with `ITEM_UNAVAILABLE`.
- Issuing 4 of a quantity item with 3 available fails with `INSUFFICIENT_QUANTITY`.
- Issuing an item with status `UNDER_REPAIR`, `LOST`, or `RETIRED` fails with `ITEM_UNAVAILABLE`.
- Issuing to an inactive borrower fails with `BORROWER_INACTIVE`.
- With no current semester, checkout fails with `NO_CURRENT_SEMESTER`.
- A failed checkout creates no transaction and no lines.

**S15. Return validations.** Returning 3 when 2 are outstanding fails with `RETURN_EXCEEDS_OUTSTANDING`. Returning on a line with nothing outstanding fails the same way.

**S16. Concurrent checkout.** Two handlers issue the same unit item at the same moment. Exactly one succeeds. The other gets `ITEM_UNAVAILABLE`.

**S17. Damaged return.** A handler returns a unit laptop with condition `DAMAGED`. The return event records `DAMAGED` and the item's condition becomes `DAMAGED`. The item's status stays `ACTIVE` until an admin changes it.

**S18. Permissions.**
- A handler calling the override endpoint gets 403.
- A view-only user calling checkout gets 403.
- A handler cannot open user management.
- A view-only user can load the dashboard and all four reports.

**S19. Retiring versus deleting.** An admin tries to delete an item that appears in past transactions. The request is rejected with `HAS_HISTORY` and the admin is told to retire it. Deleting an item with no history is allowed.

**S20. Login flood.** An attacker sends hundreds of login attempts for the admin's username from one machine. Once the limit is reached, that machine gets `RATE_LIMITED` responses and no more password hashing is done for it. The admin signs in normally from another machine. When the throttle window passes, the attacker's machine can try again.

**S21. Oversized input.** A request body over 100 KB, a CSV over 2 MB or 5,000 rows, a checkout with 51 lines, or a report range over 366 days is rejected (`PAYLOAD_TOO_LARGE` or `VALIDATION_ERROR`) before any business logic runs.

## 4. Reports (read-only)

- **Unreturned and flagged**: open lines and borrowers with strikes in the current semester, with notes and expected return dates.
- **History per borrower**: filter by date range; show room, issuing and receiving handlers, return details, and flag status.
- **History per item**: lookup by item or asset tag, same detail.
- **Usage summary**: most borrowed items in a chosen period, with counts by category and by room or lab.
