# I — The existing estate, and what "strengthening it" has to mean

Addendum to A–H, written 2026-09-17 after the thesis changed from "an application they do not have" to "a demonstration of how their existing applications would be made more dependable, observable and safe to extend." Labels as in the other reports: **FACT** (public page, quoted or paraphrased closely), **HYPOTHESIS** (an inference from facts), **ASSUMPTION** (a modeling choice we made that they can correct).

## 1. Two public descriptions of the software, one operation

### 1.1 The earlier platform, as described by its former lead developer

Source: https://ismailbrkic.com — a personal Upwork portfolio; the "Solo Select Horses · Full Story" panel. This is one developer's self-description of work done "over a year" as "lead developer on 4 developers team." It is public and specific, but it is neither Solo's statement nor evidence of what runs today. Everything in this subsection is **FACT about the page**, not about the current system.

- Architecture: "a multi-service monolith architecture: a React/Vite frontend, a Node.js/Express core service handling business logic, and a separate billing service managing Stripe webhook processing. Supabase provides the Postgres database, authentication (JWT-based), and real-time capabilities."
- Breeding scope: "scheduling mare breeding events, tracking embryo transfers, managing semen collections and shipments, recording pregnancy checks, and maintaining frozen embryo and semen inventory across liquid nitrogen tanks"; "spotlight search (Cmd+K)"; "a calendar-based breeding schedule with 30-second auto-refresh."
- Billing: invoice lifecycle "draft, closed, paid, refunded, voided" with amendments; "an immutable financial ledger"; allocations "using a FIFO strategy with composite-index idempotency"; "Twelve distinct allocation sources"; ACH settlement state that "blocks certain operations (reopening, voiding, refunding) while settlement is in progress"; stale 3DS intents "auto-cancelled by a daily maintenance job"; reopening a closed invoice enforces "nine separate precondition checks."
- Stripe: "webhook events are processed through a batched queue with distributed locking and idempotency guarantees."
- QuickBooks: "a dependency-ordered runner with distributed locking to prevent parallel sync cycles"; "resolves QB customers by name"; "maintains bidirectional entity mappings"; "OAuth token refresh and exponential backoff for rate limits"; sync is "async" so "continuous syncing does not block frontend operations."
- Platform pieces: "Upstash Redis (webhook event deduplication, rate limiting)"; "Sentry (error tracking, cross-service debug tracing, rate-limit telemetry)"; Swagger/OpenAPI; DocuSign with "webhook-driven status tracking"; Postmark; Google Maps; AWS SNS; Cypress E2E, Jest/Vitest; "Role-based access control separates admin, staff, and customer permissions"; audit logs "including public portal access records with IP tracking"; a customer billing portal with "hashed tokens, expiration, use-count tracking."
- Process: tests-first with Claude Code — "a closed loop where the AI agent could implement features and immediately validate correctness."

### 1.2 The current posting

Source: the job description the candidate received (verbatim in the session) and its public mirrors (aijobsmap.com, bebee.com). **FACT.**

- "Maintain and improve multiple business applications, including Spade AI."
- Stacks named: TypeScript/React/Next.js/Tailwind; "Solo Equine backend: Node.js, NestJS, PostgreSQL, Prisma, Redis, BullMQ"; "Vet app: Next.js, Supabase, PostgreSQL, NextAuth"; "Mobile: React Native, Expo"; GitHub, deploy workflows, Playwright, Vitest, Jest, Sentry.
- Integration essentials: Stripe "card and ACH payments, refunds, webhooks, payment status"; QuickBooks Online "OAuth, customer and invoice mapping, payments, credits, sync"; "retries, duplicate prevention, error recovery, discrepancies."
- AI essentials: LLM APIs, prompts and structured outputs, "connecting AI to business records and terminology," feedback and memory systems, "realistic evaluation examples," fine-tuning judgment, human review.
- Ownership: troubleshooting across "frontend, backend, database and integrations," production support, hybrid on-site in Gainesville.

### 1.3 What can and cannot be concluded

- **HYPOTHESIS (strong):** the estate is now several applications with separate data stores (a NestJS/Prisma/Postgres backend, a Supabase-backed vet app, a mobile app, an assistant), and at least one asynchronous integration layer (Redis/BullMQ) — the posting says so directly.
- **HYPOTHESIS (weak):** the Express/Supabase platform described in §1.1 was rebuilt or is being rebuilt on NestJS/Prisma. The stacks differ; the domain (breeding lifecycle, billing, QBO) is the same. We cannot tell whether it was replaced, wrapped, or runs alongside.
- **FACT-shaped constraint:** whichever is true, the posting's integration language ("duplicate prevention, error recovery, discrepancies") and §1.1's language ("idempotency guarantees," "distributed locking," "exponential backoff") describe the same discipline. The prototype should demonstrate that discipline generally — outbox, idempotent consumers, dead letters, circuit breakers, correlation — not just at the Stripe webhook.
- **What we must not claim:** that we know their schema, their queue topology, their failure modes, or that anything in this repository resembles their code. The prototype is a vertical slice of *how* the work would be done, on synthetic data.

## 2. The operation as a routing problem

- **FACT** `/services`: "Breeding, foaling, development, fitting, and the sale ring. One operation, one standard." and "Tell us where you are in the process and we will route you to the right team." Eight entry points are listed (stallions, reproduction, recip leases, embryo sales, veterinary clinic — marked NEW, a mobile clinic —, sale fitting, consulting, the sale).
- **FACT** `/facilities` (report A §2): three sites, "400+" stalls, "2,500+" recipient mares; South holds the stallion station, the vet clinic and Solo Select Diagnostics; North is breeding/foaling; the Recip Farm is a separate legal entity with its own phone line and paper process.
- **FACT** `/labdiagnostics`: "a fully USDA-approved, in-house laboratory"; Coggins (AGID & ELISA, 1-hour rapid), rapid PCR for *Streptococcus equi* and *Salmonella*, SAA, serum progesterone (chemiluminescent immunoassay), CBC, chemistry panel, electrolytes, glucose; "From the horses that reside on-site to the embryos we manage from across the country."
- **HYPOTHESIS:** the hard software problem is not another table; it is keeping meaning and state consistent across the boundaries the business itself draws (stallion office ↔ recip farm ↔ vet ↔ lab ↔ billing ↔ books ↔ assistant). Every one of those boundaries is a place where a fact can be duplicated, lost, or contradicted.

## 3. Bounded contexts we can name from public material

| Context | Language (from A, D, and §2) | Owner in the operation |
|---|---|---|
| Equine identity | Horse, Stallion, Donor mare, Recipient mare (by pen number), Ownership, Location (South / North / Recip Farm) | Stallion office, recip farm |
| Reproduction | Breeding cycle, Semen order, Aspiration, Embryo, Transfer, Pregnancy check (day 14/24/45/60…), Recipient match, Frozen inventory | Stallion office, recip farm, repro vets |
| Veterinary & diagnostics | Encounter, Lab order, Specimen, Result (Coggins, PCR, progesterone, CBC…), Clearance | Vet clinic, Solo Select Diagnostics |
| Billing | Invoice, Charge, Payment (card / ACH), Credit, Refund, Allocation | Billing (kitty@) |
| Accounting integration | Entity mapping, Sync, Reconciliation, Discrepancy | Billing + books |
| Operational coordination | Exception, Work item, Assignment, Escalation, Acknowledgement, Resolution | Whoever "routes you to the right team" |
| Assistant | Evidence, Finding, Proposal, Conversation, Preference, Feedback, Evaluation | Spade AI's owner (this role) |

**ASSUMPTION:** "Operational coordination" is not a system they have described anywhere; it is the context we add, because the public material shows failures being surfaced per system (a Stripe failure, a QBO failure, a missing recip, a missing clearance) and a person carrying them between teams by phone and text.

## 4. Reliability patterns, and where each one is justified by their own language

| Pattern | Their language (§1) | What it protects |
|---|---|---|
| Transactional outbox | "async sync runner," BullMQ | A committed fact that never reaches the queue |
| Idempotent consumers | "idempotency guarantees," "duplicate prevention" | At-least-once delivery becoming double effects |
| Retry with back-off, then dead letter | "exponential backoff for rate limits," "error recovery" | A retry loop that never ends, or a failure nobody sees |
| Circuit breaker | "continuous syncing does not block frontend operations" | A QBO outage degrading everything else |
| Distributed locking | "distributed locking to prevent parallel sync cycles" | Two sync cycles interleaving |
| Rate limiting per endpoint | "Rate limiting protects public endpoints," "rate-limit telemetry" | Abuse of public and expensive endpoints |
| Correlation IDs | "cross-service debug tracing" | Production support across web, API, jobs, Stripe, QBO |
| Event-driven cache invalidation | "30-second auto-refresh" | Correctness resting on a timer |
| Assistant over a projection with a policy layer | "connecting AI to business records," "human review" | A model reading PII or billing internals, or acting |

**ASSUMPTION:** the prototype demonstrates every row on synthetic data with simulated dependencies, labeled as such. Nothing here connects to a Solo system.

## 5. What this changes in the build

- The narrative order is TRUTH → RELIABILITY → OBSERVABILITY → AI. The assistant is last because an assistant over untrustworthy state makes wrong answers easier to find.
- No new horse-management features. The Day Sheet, records, intake, money and Ask surfaces already exist; they become the *subjects* of the reliability work.
- Two new surfaces: **Operations** (unresolved exceptions across every source) and the **Reliability Lab** (the reviewer breaks the system and watches it recover, with nothing faked).
- One new backend shape: a modular NestJS monolith organized by the contexts in §3, with a platform layer (events/outbox, queue, cache, resilience, observability, security). Not microservices.

## 6. A second pass over the public record (2026-09-17, after two outside critiques)

Two reviews of the plan argued for a narrower, more honest front door: one synthetic mare, every handoff, the assistant that says what it cannot establish. Before acting on them, the facts they leaned on were re-checked against public pages. What could be re-fetched is labeled **FACT**; what came only from the reviews is labeled **REPORTED** and is not used in code or copy.

- **FACT** (teamropingjournal.com; quarterhorsenews.com, July 2023): Solo Select Horses purchased the Graves ranch and its recipient-mare herd in July 2023 — "famous 1,300-mare recipient herd" — giving Select Reproduction "more than 2,000 mares available for lease". Consequence for the build: the recipient farm is the largest moving part of the operation, so the front door tells a recipient mare's story rather than a stallion's or an invoice's.
- **FACT** (`/services`): a **Veterinary Clinic** is listed among eight services — "A mobile clinic, on-site for repro, lameness, and general medicine, or we come to you." Consequence: clearances (Coggins, culture, pre-transfer exam) have a real in-house owner; the rule that blocks a transfer on a missing or pending clearance names "veterinary review", not a department we invented.
- **FACT** (`/services`): the fee figures used in the domain are on the public page — "Embryo transfer/fresh flush: $5,000 plus a $1,000 recipient-mare fee per cycle"; "Fresh ICSI: $6,500 plus a $1,000 recipient-mare fee per cycle". The $1,000 per-cycle recipient-mare fee is **not** modeled (ASSUMPTION A6 fixes fees per program; the seed bills only the lease fee at the heartbeat). Correcting it is one row in `FEES`.
- **FACT** (`/services`): the sale record — "Crosby Ray Von at $1,700,000, the highest-selling Western performance horse prospect in history" — and "$100,000,000+ in horses have sold through Solo Select". Consequence: none in code. It says what the numbers on the Money page stand next to in the real business, and why integer cents and an append-only ledger are not pedantry.
- **FACT** (the job description the candidate holds, 2026-09): the posting opens on impatience with process and closes on "show us what you've built". Consequence: the front door needs no sign-in, and the honesty page ends with a request to be corrected, not a feature list.
- **FACT about a page** (ismailbrkic.com, fetched directly on 2026-09-17): the earlier-platform description in §1.1 is the former developer's own portfolio text. It is evidence of what one developer says was built, not of what runs today, and nothing in this repository is derived from it beyond the general discipline it names.
- **REPORTED, not verified:** a second high-value sale figure and specific headcounts quoted in the reviews. Not used.

## 7. What the second pass changed

- **The front door is one mare.** `/story` renders without a session as a fixed reviewer identity: one recipient mare, every handoff across every system on one timeline with a source badge and a correlation id per row, three exceptions interleaved (a payment the books cannot reconcile, a recipient held for two embryos, an overdue check), an evidence drawer that shows the rule that fired, and the two failure controls — redeliver the webhook, take QuickBooks down — placed on the rows they affect. The Reliability Lab, Operations, Architecture and Evals stay, demoted to an "Engineering" group in the navigation.
- **The assistant is judged on four questions.** Cleared for a transfer? — the rule's verdict, an abstention naming veterinary review. Bill the lease fee — refused before the model, with the milestone rule explained. An instruction hidden in a question — treated as data. Hold a different recip — a proposal, a person approves, the rule runs again at approval and may still refuse (ADR-017). All four are seeded eval cases and pass offline through the same grader (`front-door.spec.ts`).
- **The honesty page.** `/build`: real vs simulated, non-goals with a reason each, the eval set read live from the API, how AI was used, the decisions in one line each, and "This is a hypothesis. Tell me where I am wrong."
- **Vocabulary check.** flush, OPU/ICSI, the 14-day check, the day-24 heartbeat, Coggins, Regumate, "recip", "set up" — all from public pages or the price sheets; where a term is used the way the barn does not, the honesty page asks for the correction first.
- **Sensitive data, said first.** `/build` opens its technical half with what the assistant may not see or do about veterinary and financial records, each line naming the file that enforces it — the posting's own sentence about protecting sensitive information and keeping human review where mistakes have consequences, answered in code rather than in a prompt.
- **Respecting the channel.** The cover note goes to the addresses the posting gives and says so; it does not ask for a different process. On-site: the note states the candidate's real distance from Gainesville and what three days a week would actually mean, in one plain sentence, rather than implying proximity.
