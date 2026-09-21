# Daysheet — working rules for coding agents

This is an unofficial candidate prototype for a performance-horse breeding operation. Read this before touching code.

## The thesis

Truth → reliability → observability → AI, in that order. The build demonstrates how an existing multi-application estate would be strengthened: domain boundaries, a transactional outbox with idempotent consumers, a durable job ledger with dead letters, circuit breakers, rate limits, event-invalidated caching, correlation ids, an Operations board, and an assistant over projections behind a policy layer. Do not add horse-management features to demonstrate things the operation likely already has. The Reliability Lab must never fake an outcome. The front door is one mare's story (`/story`, no sign-in, a fixed reviewer identity) with an honesty page (`/build`); the engineering surfaces sit behind it. Visual references are locked (ADR-019): Linear for the shell, Raycast for ⌘K/Ask, Midday for money, Palantir-style readouts for the lab; the operation's identity is a palette and a register, never a mark, a photograph or a name. Dark by default, light by cookie. Before adding a card, a chart or an animation, ask whether it says something; if not, it does not go in.

Since ADR-023 (2026-09-18): the operation already has the body — its own platform records breeding, vet checks, invoices, Stripe, QuickBooks, contracts and a portal (research L). Daysheet is the synthetic estate that stands in for it; the product is the assistant over it: understand what is happening across the systems, notice what matters, explain with evidence, remember stated preferences, prepare the next step, and let the right person approve it. Retrieval is for documents only; live truth comes from typed tools; hard rules stay in code; a person owns medical, financial and consequential decisions. Everything runs free by default: a local Ollama model behind `ModelPort` when no key is set, permissive licenses only. Do not polish the body; build the brain, and label each capability built, prototype or hypothesis.

## Non-negotiables

- All data is synthetic. Never add a real horse, person, phone number, address, logo, photo or brand mark. Never reproduce another company's copy. The product is `Daysheet` and the assistant is `Ask`; the operation's own names for its business and its assistant stay theirs.
- Public sources only. Never access, probe, or reference a private portal, login, admin page, or customer record.
- Stripe is test mode only; the client refuses live keys. QuickBooks is sandbox only; the lab runs only against the simulator. Never commit secrets; `.env` is git-ignored.
- Money is integer cents everywhere. Never a float.
- Do not add scope. Surfaces: Story, Build, Day Sheet, Operations, Records, Intake, Money, Ask, Reliability Lab, Architecture, Evals. Anything else is a doc note.

## Architecture in one breath

`packages/domain` holds every rule as pure functions with tests. `apps/api` is a modular NestJS monolith: `platform/` (config, persistence, security, audit, codes, clock, events/outbox, queue/ledger, resilience, cache, observability, messaging) under `modules/` organized by bounded context (reproduction, veterinary, billing, accounting, operations, ask, lab). Contexts talk through domain events and never import another context's services except through its public Nest module. `apps/web` (Next.js) is a harness that calls the API with a per-request HS256 token minted from the session and a correlation id; the browser never holds an API token. See `docs/ARCHITECTURE.md` and `docs/decisions/`.

## Rules that must not regress

- Append-only audit: `AuditEvent` rows are never updated or deleted (DB trigger). Every consequential mutation writes one, inside the same transaction.
- No "commit then enqueue". A business fact is a `DomainEvent` appended in the producer's transaction (`OutboxService.append(tx, …)`); side effects are consumers; a consumer that needs the outside world enqueues a job inside its own transaction (`jobs.enqueue(…, { tx })`).
- Consumers are idempotent by the `ProcessedEvent` primary key and re-read state; they never trust the payload's view of the world.
- Every job is a `JobRecord` row before it is a BullMQ job. Deterministic ids. Rate limits and open circuits park a job without spending an attempt. Exhausted attempts dead-letter into an `OperationalException`; never swallow a failure.
- Anything scheduled from inside a scoped unit of work (`flushScope`, `publishScope`) is scheduled with `AsyncLocalStorage.exit`; async context follows timers.
- Idempotent inbound: `IntegrationEvent` is unique on (provider, externalId); duplicates are counted, never processed.
- Codes come from `CodesService` (atomic sequence), never from row counts.
- Exceptions are raised by deterministic detectors and consumers, deduplicated on `openKey`; conditions that clear resolve their own exception with a reason. The assistant may explain one, never open or close one.
- The assistant is read-only: policy gate before the model, projections (no PII) with state hashes, verifier after; every answer stores model, prompt version, tool versions and context version; the answer cache is served only against the same state. The one exception is a `Proposal`: a row a person approves, executed by the same rule-checked service the UI calls (ADR-017). Never a generic mutation.
- Customers see only their own rows, enforced in the services, not in the UI.
- Cache only slow-changing, read-heavy projections; invalidate on domain events; TTL is the safety net. Never cache balances, settlement state, reconciliation results or clearances. The cache is JSON in every backend: a cached value never carries a `Date`, and `CacheService.wrap` returns `Jsonified<T>` so the compiler says so.
- The seed and the detectors must agree: an exception the seed writes uses the detectors' dedupe key, rule and title. The seed stamps its fingerprint; the test database reseeds before every run.

## Labels

Facts about the operation come from public pages and are cited in `docs/research/`. Anything else is HYPOTHESIS or ASSUMPTION and lives in `docs/ASSUMPTIONS.md`. Do not promote an assumption to a fact in code comments or UI copy.

## Style

Match the surrounding code. Comments explain why, not what. No `any` without a justification comment. No placeholder buttons, lorem ipsum, or TODOs on primary screens. Lint, typecheck and tests must be green before a commit (`pnpm verify`). Bash heredocs with quotes or backticks fail in this environment; write patch scripts to a file first.

## Working with the agent

Record meaningful AI contributions and rejections in `docs/AI_BUILD_LEDGER.md`. Prefer small commits with real messages.
