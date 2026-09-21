# Kubernetes: not yet, and why

The stack is one HTTP process, one worker process, Postgres and Redis. `docker compose up --build`
runs it; a single small host runs it in production with the same compose file, a reverse proxy in
front of the web and the API, and managed Postgres and Redis if the operator prefers not to run
them. That is the whole deployment, and it is deliberately the whole deployment.

## What would earn a cluster

- **More than one worker host.** BullMQ already lets the `worker` service scale horizontally
  (`docker compose up --scale worker=3`); a cluster is warranted when that scaling needs to
  happen on demand across machines, not when a second worker is a second container.
- **Rolling deploys with zero downtime as a requirement**, not a nicety. Today a deploy is a
  short restart; the outbox and the job ledger make it safe (nothing in flight is lost), which is
  a stronger property than a rolling deploy on its own.
- **Several applications sharing one platform** — the veterinary application, the customer
  portal and this API on one control plane with shared secrets, networking and observability.
  That is the estate's real shape and the honest reason a cluster might one day be right.

## What it would look like when it is

- One Deployment for `api` (replicas: 1–2, `WORKERS=off`), one for `worker` (replicas: n, HPA on
  queue depth via a BullMQ metrics exporter), one for `web`.
- Postgres and Redis managed outside the cluster. The LangGraph checkpoints live in Postgres
  (`ask_graph` schema) and need nothing extra.
- A Job for `prisma migrate deploy` before the api rolls; the seed only on an empty database.
- Secrets from the operator's secret manager; never in the manifests.

Until one of the three reasons above is true, a Helm chart would be complexity with no business
value — and senior judgment includes saying so.

## A public demo is one shared world

The seed is deterministic and every control on the public pages writes to the same rows: one
reviewer can settle the sale, take QuickBooks down or approve the proposal while another is
following the walkthrough. Locally that is what `pnpm demo:reset` is for. Publicly, two ways
to keep reviewers from leaving each other a broken scene, in order of cost:

- **A scheduled reset.** A sidecar on the api image (it carries the Prisma CLI and the seed)
  that runs `pnpm demo:reset` every N minutes, with the next reset shown on `/build`. Cheap
  and honest; the ninety-second journey fits inside the window. Not built yet: before it goes
  on a schedule the api has to be shown to tolerate a reseed underneath it — a Redis cache and
  queued jobs that still name the dropped rows, sessions whose user ids no longer exist.
- **A world per reviewer.** Session-scoped copies of the seed behind a tenant column in every
  service. The only version that isolates the simulators too, and a schema change touching
  every module; earned only if the demo outlives the interview.

Until one is built, the demo script says the world is shared and the honesty page says which
environment you are looking at.
