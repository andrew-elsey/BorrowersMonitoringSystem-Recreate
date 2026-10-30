# Borrowers Monitoring System

Inventory and borrowing system for a college department's handout room. See `CLAUDE.md` and `docs/` for requirements and architecture.

## Requirements

- Node.js 24.11.1 (see `.nvmrc`)
- Docker (from FND-2 onward)

## Layout

npm workspaces monorepo:

```
apps/api/          Express API (routes, services, Prisma)
apps/web/          React + Vite front end
packages/shared/   Zod schemas, enums, and types used by api and web
docs/              SPEC, BUSINESS_RULES, ARCHITECTURE, BACKLOG
```

Shared TypeScript settings live in `tsconfig.base.json` (strict mode). Each package extends it. ESLint and Prettier are configured once at the root. `vitest.config.ts` runs every package's tests.

### Compile step

`apps/api` and `packages/shared` are compiled with `tsc` (each package's `tsconfig.build.json`) and run as plain JavaScript under Node. They use `NodeNext` modules, so relative imports end in `.js`: `import { x } from './x.js'`. `apps/web` is bundled by Vite.

`@bms/shared` exports a `source` condition that points at its TypeScript files. TypeScript, Vite, and Vitest use it, so development and tests never need a build first. Plain Node uses the compiled `dist/`, so run `npm run build` before starting the api with Node.

## Commands

Run from the repo root:

```
npm install         # install all workspaces
npm run lint        # ESLint
npm run typecheck   # tsc in every workspace
npm test            # Vitest across all workspaces
npm run build       # compile shared and api to dist/, build web with Vite
npm run format      # Prettier
```

More commands (database, seed) are added by later tickets; `CLAUDE.md` lists them.

## Running with Docker

```
cp .env.example .env        # then set POSTGRES_PASSWORD (letters and digits only), ADMIN_PASSWORD, and SESSION_SECRET
docker compose up --build   # or add -d to run in the background
```

Open http://127.0.0.1:8080. Three containers start:

- **db**: PostgreSQL 18. Data lives in the `db-data` volume and survives `docker compose down`. `docker compose down -v` deletes it.
- **api**: the compiled Express API. Not published to the host; nginx reaches it on port 3000.
- **web**: nginx serving the React build and proxying `/api` to the api.

Only the web port is published, and by default only to this machine. To reach the app from other machines on the LAN, set `WEB_BIND_ADDRESS` in `.env` to this PC's LAN address. All variables are described in `.env.example` and `docs/ARCHITECTURE.md` section 10.
