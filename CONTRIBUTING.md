# Contributing

One maintainer, kept to the standard of a team's repository: every change lints, typechecks,
formats, respects the architecture rules and passes every test before it lands.

## Run it

```bash
pnpm install
cp .env.example .env                       # DATABASE_URL, AUTH_SECRET; everything else is optional
docker compose up -d db redis              # or your own Postgres and Redis
pnpm --filter @daysheet/domain build && pnpm --filter @daysheet/db build
pnpm db:migrate && pnpm db:seed            # the synthetic world for 2026-04-20
pnpm dev                                   # web on :3100, api on :3101
```

## Before a commit

```bash
pnpm verify                                # lint, format, typecheck, architecture rules, every test, the builds
```

CI runs the same on every push and pull request, then boots both apps and runs the Playwright
journeys. `pnpm verify:report` writes the counts the honesty page shows.

## Where things live

- `apps/api` — NestJS. `platform/` is the machinery: config, persistence, audit, codes, clock, events and the
  outbox, the job ledger, resilience, cache, observability, messaging. `modules/` is one folder per bounded
  context — reproduction, veterinary, billing, accounting, operations, ask, lab — each with `api/`,
  `application/`, `domain/` and `infrastructure/`. Contexts talk through domain events, never through
  another context's services.
- `apps/web` — Next.js. `app/` holds the routes, `components/` one folder per surface plus `ui/`, `lib/` the
  API client, sessions and helpers, `e2e/` the Playwright journeys.
- `packages/domain` — every business rule as a pure function, its tests beside it. Money is integer cents.
- `packages/db` — the Prisma schema, the migrations (append-only guards are database triggers), the
  deterministic seed.
- `docs` — architecture, the decision records in `decisions/`, assumptions, the domain, security,
  deployment, research with citations, the AI build ledger.
- `scripts` — the verify report, the film, the copy and licence checks.

## Rules that do not move

The non-negotiables in [AGENTS.md](AGENTS.md): synthetic data only, public sources only,
test-mode and sandbox keys only, no secrets committed, money in integer cents, no scope beyond
the listed surfaces. Facts about the operation are cited in `docs/research/`; everything else is
labelled an assumption.

## Commits

One change per commit. The first line says what changed, in plain words, short enough to read
in a log. Meaningful AI contributions and rejections go in
[docs/AI_BUILD_LEDGER.md](docs/AI_BUILD_LEDGER.md).

## Decisions

An architectural choice gets a numbered record in [docs/decisions](docs/decisions) with the
alternatives it rejected. An assumption promoted to a fact needs a citation first.
