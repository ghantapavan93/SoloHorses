# ADR-005 — Billing fires from recorded ultrasounds

**Situation.** Public price sheets tie money to clinical milestones that are not aligned with each other: the day-24 heartbeat (lease fee due, board starts), 45–60 days (ICSI stallion fee), 55 days (purchased embryo confirmed). Billing sits at a different site from the vets who see the ultrasound.

**Decision.** `evaluateCheck()` in the domain package turns a recorded check into invoice intents with deterministic idempotency keys (`${transferId}:LEASE_FEE`). `ChecksService` writes the check, the invoices and the audit rows in one transaction, so "which ultrasound created which invoice" is always answerable. UNCLEAR, OPEN and LOST never bill. The Day Sheet flags pregnancies crossing a milestone today.

**Cost.** Fee amounts are constants taken from public pages; real contracts vary. Board is computed from the heartbeat date, not invoiced daily.

**Would change it.** Per-contract fee schedules; then the constants move onto the contract record and the engine reads them from there.
