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

More commands (Docker, database, seed) are added by later tickets; `CLAUDE.md` lists them.
