# The API image. One image, two roles: `api` (HTTP + workers) and `worker` (WORKERS=on, no port).
# Build from the repository root: docker build -f apps/api/Dockerfile .
FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@12.4.2 --activate
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/domain/package.json packages/domain/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm --filter @daysheet/domain build && pnpm --filter @daysheet/db build && pnpm --filter api build

FROM node:22-bookworm-slim
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@12.4.2 --activate
WORKDIR /repo
COPY --from=build /repo ./
# Migrations run once at start by the api role; the worker waits for the api's health.
EXPOSE 3101
CMD ["sh", "-c", "cd packages/db && pnpm exec prisma migrate deploy && node scripts/seed-if-empty.mjs && cd ../../apps/api && node dist/main.js"]
