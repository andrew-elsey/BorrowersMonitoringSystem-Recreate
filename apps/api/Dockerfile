# Build context is the repo root (npm workspaces). Debian-based image so argon2 installs cleanly (ARCHITECTURE.md 5).
FROM node:24.11.1-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json tsconfig.build.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY packages/shared packages/shared
COPY apps/api apps/api
# The api build runs `prisma generate` before compiling.
RUN npm run build -w @bms/shared -w @bms/api

FROM node:24.11.1-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# Production dependencies of the api only (including the Prisma CLI for migrations),
# plus the @bms/shared workspace link.
RUN npm ci --omit=dev -w @bms/api && npm cache clean --force
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/
# Run as the image's built-in non-root user (ARCHITECTURE.md 12.6).
USER node
WORKDIR /app/apps/api
EXPOSE 3000
# Apply pending migrations, add any missing seed data (safe to re-run, FND-4), then start the API.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/prisma/seed.js && exec node dist/src/index.js"]
