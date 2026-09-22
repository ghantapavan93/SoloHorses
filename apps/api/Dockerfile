# The API image. One image, two roles: `api` (HTTP + workers) and `worker` (WORKERS=on, no port).
# Build from the repository root: docker build -f apps/api/Dockerfile .
FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@12.4.2 --activate
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/domain/package.json packages/domain/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile
COPY packages ./packages
COPY apps/api ./apps/api
# The last verify run, committed with the code, so the honesty page can show it from a host that never ran the gate.
COPY docs/verify ./docs/verify
RUN pnpm --filter @daysheet/domain build && pnpm --filter @daysheet/db build && pnpm --filter api build

FROM node:22-bookworm-slim
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@12.4.2 --activate
WORKDIR /repo
COPY --from=build /repo ./
# The entrypoint checks the environment, migrates with patience, seeds an empty world once, then serves.
RUN chmod +x /repo/apps/api/docker-entrypoint.sh
EXPOSE 3101
CMD ["/repo/apps/api/docker-entrypoint.sh"]
