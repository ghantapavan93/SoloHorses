# Architecture

The thesis, in the order it has to be built: **truth → reliability → observability → AI.** An assistant over untrustworthy state makes wrong answers easier to find, so it comes last.

## Shape

```
 browser ──(session cookie)──▶ apps/web (Next.js 16)  server components, server actions, one SSE proxy
                                  │  x-correlation-id per render/action · 2-minute HS256 token per request
                                  ▼
                              apps/api (NestJS 11, one process, a modular monolith)
                                  │  correlation middleware → JwtAuthGuard → PermissionGuard → RateLimitGuard
                                  │
   modules/  ┌─────────────┬────────────┬───────────┬────────────┬────────────┬─────────┬───────┐
             │ reproduction│ veterinary │  billing  │ accounting │ operations │   ask   │  lab  │
             └──────┬──────┴─────┬──────┴─────┬─────┴──────┬─────┴──────┬─────┴────┬────┴───┬───┘
                    │            │            │            │            │          │        │
   platform/  ──────┴────────────┴────────────┴────────────┴────────────┴──────────┴────────┘
   config · persistence · security · audit · codes · clock · events (outbox, dispatcher) · queue (ledger, BullMQ)
   resilience (breakers, rate limits) · cache · observability (correlation, bus, metrics, SSE, trace) · messaging
                                  │
                                  ▼
                 PostgreSQL 17 via Prisma 7 (append-only triggers on audit and inbox rows)
                                  ▲
                    BullMQ on Redis 7 ─┘ (inline fallback on a laptop; same handlers, same ledger)
```

Only the API touches the database. The web app is a client of the API and holds no business rules. Contexts talk through domain events; none imports another's services except through its public Nest module (ADR-011).

## Bounded contexts

| Context          | Owns                                                                                                             | Produces                                                                                   | Reacts to                                                                                                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reproduction** | Embryo, Transfer, Recipient (planned and actual), Contract, SemenOrder, the Day Sheet projection, intake by text | `EmbryoExpected`, `IntakeConfirmed`, `ContractStatusChanged`, `HorseUpdated`               | `PaymentSucceeded`/`PaymentRefunded`/`InvoicePaid` → derives the contract's status and releases held orders; `HorseUpdated`/`CheckRecorded` → invalidates the horse cache    |
| **Veterinary**   | PregnancyCheck; the milestone → invoice rule (day 24 → lease fee, day 45–60 → ICSI fee)                          | `CheckRecorded`, `MilestoneInvoiced`                                                       | —                                                                                                                                                                            |
| **Billing**      | Invoice, Payment, Refund; Stripe behind an adapter; the write-once webhook inbox                                 | `PaymentSucceeded`, `PaymentProcessing`, `PaymentFailed`, `PaymentRefunded`, `InvoicePaid` | —                                                                                                                                                                            |
| **Accounting**   | AccountingMapping, SyncAttempt, Discrepancy; QuickBooks behind a port with a durable simulator; reconciliation   | `EntitySynced`, `DiscrepancyRaised`, `DiscrepancyResolved`                                 | `InvoicePaid`/`PaymentSucceeded`/`PaymentRefunded` → enqueues a sync job inside the consumer's transaction                                                                   |
| **Operations**   | OperationalException; the detectors; the board                                                                   | —                                                                                          | `JobDeadLettered` → exception; `JobRecovered` → resolved; `Discrepancy*` → exception/resolved; every business event → a detector sweep; breaker signals → degraded/recovered |
| **Ask**          | Conversation, Feedback, Memory, Eval cases and runs                                                              | — (read-only)                                                                              | —                                                                                                                                                                            |
| **Lab**          | Nothing; a surface that drives the other modules through their public services                                   | —                                                                                          | —                                                                                                                                                                            |

The pure rules — cutoffs, the contract state machine, the milestone engine, the SMS parser, the answer schema and verifier, the RBAC matrix, reconciliation, arrival resolution — live in `packages/domain` with their own tests, framework-free.

## One fact, end to end

A card payment on `INV-26-0029`, as the trace endpoint shows it:

```
audit       payment.simulated            Invoice INV-26-0029          ← the click (web mints corr_…)
webhook     STRIPE invoice.paid          evt_sim_…                    ← write-once inbox; duplicates counted, never processed
job         stripe-event completed       stripe_evt_sim_…             ← ledger row + BullMQ job, id = event id
event       PaymentSucceeded             Payment PAY-26-0057          ← outbox rows, same transaction as the payment
event       InvoicePaid                  Invoice INV-26-0029
job         domain-event completed       evt_…                        ← consumers, each in its own transaction:
                                                                        reproduction.contract-status → SHIPPABLE, orders released
                                                                        accounting.sync-payment      → qbo-sync job (in the same tx)
                                                                        operations.re-detect         → detector sweep
job         qbo-sync completed           qbo_INVOICE_INV-26-0029_paid ← breaker-guarded push; 429 pauses the queue, spends no attempt
integration INVOICE ok 200               INV-26-0029
event       EntitySynced                 AccountingMapping …
audit       accounting.synced            INVOICE INV-26-0029
```

Nothing in that chain enqueues a job after a commit. If the process dies between any two lines, the next tick picks up where the tables say it stopped.

## The platform, and the question each part answers

| Part             | The question a senior review asks                                                 | The answer here                                                                                                                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `events/`        | What happens when the database commit succeeds and the publish fails?             | It cannot: the event is a row in the same transaction; the publisher retries every two seconds; consumers are idempotent by primary key (ADR-012)                                                                                            |
| `queue/`         | What jobs exist, when do retries stop, how does failed work reach a person?       | Six queues, all listed with their attempts and back-off in `jobs.service.ts`; exhausted attempts dead-letter into an exception; retry from the board; recovery closes it; the ledger reconciles itself against Redis after a crash (ADR-014) |
| `resilience/`    | What happens when QuickBooks is unavailable for an afternoon?                     | Three transient failures open the breaker; sync jobs park without spending attempts; everything else is unaffected; one probe after the cooldown closes it and the queue drains — run it in the lab                                          |
| `resilience/`    | Is `@Throttle()` enough?                                                          | No: limits by endpoint risk — search 100/min/user, ask 20/min/user, payment mutations 5/min/user, login 10/min per e-mail; webhooks are signature-verified instead                                                                           |
| `cache/`         | What is cached, why is it safe, how is it invalidated?                            | Horse summaries and assistant projections; nothing correctness-sensitive; domain events invalidate, TTL is the safety net; the lab poisons an entry and shows both                                                                           |
| `observability/` | Can I trace one payment across the web, the API, Stripe, the queue and the books? | One correlation id from the click to the books; `GET /platform/trace/:id`; logs and Sentry carry it; the error envelope returns it (ADR-015)                                                                                                 |
| `security/`      | Who can call me?                                                                  | A two-minute HS256 token minted from the session (ADR-010); the RBAC matrix at the service and tool layer; customers see only their rows                                                                                                     |
| `audit/`         | Can a row be edited after the fact?                                               | No: `AuditEvent` and `IntegrationEvent` are append-only by database trigger                                                                                                                                                                  |

## The assistant's place in this

Authorization → policy → tools over projections → model → schema validation → evidence verification → policy again → UI (ADR-016). Known invariants stay in code; the assistant explains the exceptions the detectors raised instead of scanning tables for what might be wrong. Every answer stores model, prompt version, tool versions and the state hash it saw; a cached answer is served only against that same state. Without a model key a deterministic composer answers the front door's question shapes from the same tools, labeled `offline-deterministic`. The assistant's only path to a change is a `Proposal` (ADR-017): a row a person approves, executed by the rule-checked service the UI calls, which may still refuse.

## The front door

`GET /story` builds one recipient mare's season for the reviewer identity: the embryo's timeline from the records service, the exceptions related to her, audit rows for correlation ids, accounting mappings and sync attempts, the sync jobs from the ledger, the Stripe inbox rows for her invoices. Rows carry the system they came from. Two lab controls are scoped to the story (`POST /lab/story/redeliver-webhook`, `POST /lab/story/books`); the QuickBooks outage restores itself after a minute. The page needs no session: the web app mints the token for a seeded reviewer user when nobody is signed in, only for the story, the honesty page and the routes they call (ADR-018).

## Packages

| Package            | Responsibility                                                                                                                                | Tests                                                                                                                                                                                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@daysheet/domain` | Pure rules with no I/O                                                                                                                        | Vitest, 77 cases                                                                                                                                                                                                                                                                             |
| `@daysheet/db`     | Prisma schema, migrations (append-only guards, the platform tables), deterministic seed                                                       | Vitest, 3 guard cases                                                                                                                                                                                                                                                                        |
| `api`              | Everything with I/O, organized as above                                                                                                       | Jest: integration against a sibling test database (money, checks, RBAC, transfers and clearances, the assistant with a scripted model, the front door without a model through the eval grader, the outbox/dispatcher/dead-letter path, the cache's JSON contract) and unit (breaker, policy) |
| `web`              | Harness UI: the story and the honesty page (public), Day Sheet, Operations, records, Intake, Money, Ask, Reliability Lab, Architecture, Evals | Playwright, 18 cases (desktop + phone): the story's exceptions, drawer, both failure controls and all four assistant questions; the lab's duplicate-webhook scoreboard; every role                                                                                                           |

## Codes and time

Every entity a person cites has a human-readable code as its primary key (E-26-2041, R-0347, OX-26-0012), handed out by an atomic sequence, never a row count. Money is integer cents. The barn day is America/Chicago; `DEMO_CLOCK` freezes the calendar date so the synthetic world stays coherent on any real date, and detectors measure age from that date.

## Decisions

Every non-obvious choice has a record in [decisions/](decisions/README.md).
