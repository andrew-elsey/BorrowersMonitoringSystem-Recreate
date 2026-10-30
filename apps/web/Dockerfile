# Build context is the repo root (npm workspaces).
FROM node:24.11.1-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @bms/web

# nginx-unprivileged runs as a non-root user and listens on 8080 (ARCHITECTURE.md 12.6).
FROM nginxinc/nginx-unprivileged:1.30.6-alpine
USER root
# tzdata so TZ=Asia/Manila applies to nginx log timestamps.
RUN apk add --no-cache tzdata
USER nginx
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
