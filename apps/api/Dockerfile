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
RUN npm run build -w @bms/shared -w @bms/api

FROM node:24.11.1-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# Production dependencies of the api only, plus the @bms/shared workspace link.
RUN npm ci --omit=dev -w @bms/api && npm cache clean --force
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist
# Run as the image's built-in non-root user (ARCHITECTURE.md 12.6).
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
