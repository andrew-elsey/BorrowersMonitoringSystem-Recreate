# Inventory & Borrowing System

Guide for Claude Code. Read this file first, then the documents listed below.

## What this project is

A web app for a college department's handout room. Staff record which items are borrowed, by whom, for which room or lab, and which staff member handled each checkout and return. Borrowers never log in: they ask for items in person and staff do the data entry.

Items are either individually tracked equipment (laptops, projectors, each with an asset tag or serial number) or quantity-based supplies that are returned (for example extension cords). Everything is expected back the same day. Items still out after closing time are flagged, and flagged transactions become strikes against the borrower: warning at 3, stricter notice at 4, blocked at 5, reset each semester.

This is a recreation of a system the owner built in college. It runs in Docker on the owner's machine first, then on a department PC on the local network.

## Read these documents

| File | Contents |
|---|---|
| `docs/SPEC.md` | Requirements, roles and permissions, data model, screens |
| `docs/BUSINESS_RULES.md` | Every rule with worked scenarios. The source of truth for behavior and test cases |
| `docs/ARCHITECTURE.md` | Stack, repo layout, conventions, auth, time handling, API format, Docker, testing |
| `docs/BACKLOG.md` | Tickets with acceptance criteria, dependencies, and the sprint plan |

If documents disagree about behavior, `BUSINESS_RULES.md` wins, then `SPEC.md`, then `ARCHITECTURE.md`. If something is unclear or missing, ask the owner. Do not guess on business rules.

## Stack

TypeScript (strict) everywhere. Backend: Node, Express 5, Prisma, PostgreSQL, Zod. Frontend: React, Vite. Tests: Vitest, Supertest, Playwright. Docker Compose for everything. Details and versions are in `docs/ARCHITECTURE.md`.

## Commands

These scripts are created by tickets FND-1 to FND-4. Keep this section accurate as the project grows.

Available now (FND-1):

```
npm install                 # install all workspaces
npm run lint
npm run typecheck
npm test                    # unit and integration tests
npm run format              # Prettier (Markdown is excluded)
```

Not yet created (ticket in brackets):

```
docker compose up --build   # run db, api, and web  [FND-2]
npm run dev                 # api and web in watch mode (db from docker)  [FND-2]
npm run db:migrate          # create/apply a migration in development  [FND-3]
npm run db:seed             # seed sample data (safe to re-run)  [FND-4]
npm run admin:reset-password  # emergency password reset (run inside the api container)  [FND-4]
```

## Working agreement

- Work on one ticket at a time. The ticket ID goes in the branch name (`feature/FND-3-schema`) and every commit message (`FND-3: add Prisma schema`).
- Before starting, read the ticket's acceptance criteria in `docs/BACKLOG.md` and the sections of the other documents it points to. For anything beyond trivial, state a short plan before coding.
- Meet every acceptance criterion and the Definition of Done below. Do not add features nobody asked for. If you spot a worthwhile addition, note it for the owner instead of building it.
- Make small, focused commits.
- When behavior, setup, or commands change, update the relevant document in the same change.
- Ask before adding a dependency that is not named in `docs/ARCHITECTURE.md`.

## Rules that are never broken

1. **Borrowers are read only through `BorrowerService`.** Nothing outside its implementation queries the borrowers table. This keeps a future external school database a one-file change.
2. **Business rules live in the service layer.** Route handlers stay thin and the UI never enforces a rule on its own: the server always enforces it.
3. **Never hardcode settings.** Closing time, strike thresholds, timezone, and the current semester come from settings or environment variables.
4. **Time:** store timestamps as UTC. Business logic (closing time, "end of day", semesters) and display use `Asia/Manila`. Details in `docs/ARCHITECTURE.md`.
5. **Migrations are append-only.** Never edit a migration that has been applied. Add a new one.
6. **Every state change writes an audit log entry** using the shared audit helper, inside the same database transaction as the change.
7. **Never delete records that have history.** Deactivate users, borrowers, and rooms; retire items.
8. **Business logic needs automated tests.** Integration tests run against a real PostgreSQL database, not mocks.
9. **No secrets in the repo.** Only `.env.example` is committed.
10. **API errors use the standard format** in `docs/ARCHITECTURE.md`, with a stable error code.
11. **Hash only through the limiter.** All password hashing and verifying goes through the shared hashing limiter (`ARCHITECTURE.md` 12.4). Never call `argon2` directly from a route.
12. **Every endpoint has bounds.** New endpoints enforce the input limits in `docs/SPEC.md` section 7 (body size, page size, field lengths, date ranges) and never do unbounded work in a request.
13. **Throttle, never lock accounts.** Failed logins are rate limited per IP and username. Do not add account lockout.
14. **No sessions for anonymous visitors.** A session is created only after a successful login.
15. **Stay behind the proxy settings.** Rate limits depend on `trust proxy` being configured. Do not remove or bypass it, and do not publish the api or db ports.

## Definition of Done

- All acceptance criteria are met
- Business logic is covered by tests, and the full suite passes
- `npm run lint` and `npm run typecheck` are clean
- Works under `docker compose up` from a clean checkout
- Audit entries are written for state changes
- Documents and the Commands section are updated if anything changed

## Quality bar

Code should be easy for a student to read: small functions, descriptive names, comments at integration points and wherever a business rule is applied (reference the rule number from `docs/BUSINESS_RULES.md`). Prefer simple and obvious over clever.
