# The web image: Next.js, calling the API over the compose network.
# Build from the repository root: docker build -f apps/web/Dockerfile .
FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@12.4.2 --activate
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/domain/package.json packages/domain/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile
COPY packages ./packages
COPY apps/web ./apps/web
# Build-time env: the web only needs to know where the API is at request time, but Next reads the schema at build.
ARG API_URL=http://api:3101
ARG AUTH_SECRET=build-time-placeholder-secret
ENV API_URL=$API_URL AUTH_SECRET=$AUTH_SECRET NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @daysheet/domain build && pnpm --filter @daysheet/db build && pnpm --filter web build

FROM node:22-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@12.4.2 --activate
WORKDIR /repo
COPY --from=build /repo ./
EXPOSE 3100
CMD ["pnpm", "--filter", "web", "start"]
