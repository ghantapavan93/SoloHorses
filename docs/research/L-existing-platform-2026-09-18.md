# L · The existing platform as its builder describes it publicly (2026-09-18)

**Source.** The "Full Story" panel of the same public portfolio page research I cites (ismailbrkic.com, the Solo Select Horses project), pasted into the build session on 2026-09-18; it extends research I's one-paragraph reading with the page's own detail. No person is named in this file and none should be: a candidate does not narrate someone else's employment. Every row below is FACT only as far as that page is public and current, and it describes at least one generation of the estate — not necessarily the one the posting names (research K).

## What the page says the operation has

| Fact | Status |
|---|---|
| The operation manages over 2,500 recipient mares. The platform replaced spreadsheets, obsolete technology and manual processes across breeding operations, customer billing and reproductive program tracking | FACT (as published) |
| A multi-service monolith: a React/Vite front end, a Node/Express core service, a separate billing service for Stripe webhooks; Supabase for Postgres, JWT auth, realtime, RPC functions and file storage | FACT (as published) — a different generation from the NestJS / Prisma / Redis / BullMQ / Next.js stack the posting names |
| The breeding lifecycle: mare breeding events, embryo transfers, semen collections and shipments, pregnancy checks, frozen embryo and semen inventory across liquid-nitrogen tanks; a ⌘K spotlight search across thousands of horses; a calendar schedule that refreshes every 30 seconds | FACT (as published) |
| Billing: an invoice lifecycle (draft → closed → paid → refunded → voided) with amendments; closing an invoice materialises charges into an immutable ledger and schedules an automated charge against a stored card or ACH; Stripe webhooks through a batched queue with distributed locking and idempotency, covering charge success and failure, ACH returns, 3-D Secure and disputes; FIFO allocation of payments to invoices with a composite unique index; twelve allocation sources; unidirectional reconciliation to QuickBooks Online through an async, dependency-ordered sync runner with distributed locking, OAuth refresh and back-off | FACT (as published) |
| ACH settlement state blocks reopening, voiding and refunding while settlement is in progress; stale 3-D Secure intents are cancelled by a daily job; resume links let a customer finish an interrupted payment | FACT (as published) |
| Reopening a closed invoice enforces nine preconditions and atomically reverses the charge schedule, the allocations, the ledger entries, the Stripe invoice and the QuickBooks documents | FACT (as published) |
| A customer portal behind hashed, expiring, use-counted tokens; PDF invoices; DocuSign e-signatures with webhook status; Postmark mail with open tracking; Google Maps address verification; admin / staff / customer roles; audit logs with IP; rate limiting on public endpoints; Upstash Redis for webhook de-duplication and rate limits; AWS SNS; Swagger; Sentry; Jest / Vitest; Cypress end-to-end suites over the billing workflow | FACT (as published) |
| The way it was built: tests first, Claude Code inside the loop, a person owning design and domain architecture | FACT (as published) |

## What this changes in the build

- **A1 stops being an assumption.** Stripe and QuickBooks Online are the operation's payment and accounting systems by the platform's own public description (now F26). The adapters stay where they are.
- **ADR-021 is confirmed twice over.** The estate holds at least two generations of internal software — this one on Supabase and Express, the posting's on NestJS, Prisma and BullMQ — plus a vendor sale platform and a separate veterinary application. A control plane over a mixed estate is the right shape.
- **The existing platform already owns the money.** Idempotent webhooks, ACH state that gates operations, an immutable ledger, allocation, QuickBooks sync: all there, all described in detail. Nothing in this build competes with that, and the demonstration must not be read as "how to do idempotent webhooks". The Reliability Lab exercises the platform layer this build's own consumers need; it is not a proposal to replace theirs.
- **What the description does not mention is what this build is about.** The sale's published conditions as deterministic rules (papers wait for cleared funds; a mare leaves on a video; a fee waits on the vet's assessment); exceptions from every source — veterinary, reproduction, billing, accounting, the sale — in one shape, priced by what they hold up; the assistant behind a policy gate, over projections, with a verifier, proposals a person approves and an eval set; one correlation id from a click to the books across systems. The layer above, not a rewrite of the layer below.
- **Vocabulary.** The page uses "embryo transfers", "semen collections and shipments", "pregnancy checks", "frozen embryo and semen inventory", "recipient mares". The build's words match.

## What was not done

No person named. No employment narrated. No claim about which generation is in production today, or how the two relate. Nothing behind a login was accessed; the page was pasted, not fetched.
