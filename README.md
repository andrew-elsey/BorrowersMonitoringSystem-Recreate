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

## Commands

Run from the repo root:

```
npm install         # install all workspaces
npm run lint        # ESLint
npm run typecheck   # tsc in every workspace
npm test            # Vitest across all workspaces
npm run format      # Prettier
```

More commands (Docker, database, seed) are added by later tickets; `CLAUDE.md` lists them.
