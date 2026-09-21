# ADR-014 — Retries, dead letters, circuit breakers, rate limits and cache invalidation: one policy, written down

**Situation.** "Redis makes it faster" and "BullMQ makes it scalable" are not answers. The questions are: what is cached and why it is safe; what jobs exist, whether consumers are idempotent, when retries stop, how failed work reaches a person; what happens when a dependency is down for four hours.

**Decision.**

- _Jobs._ Every job is a row in `JobRecord` before it is a BullMQ job, in either queue mode. Ids are derived from the thing being processed, so a duplicate enqueue while in flight is a no-op and a finished job can be re-armed. Retries use exponential back-off per queue (`stripe-event` 3 × 2s, `qbo-sync` 5 × 2s, `domain-event` 5 × 1s). A provider's 429 pauses the whole queue for the window it named and spends no attempt; an open circuit does the same. Exhausted attempts dead-letter: `DEAD` in the ledger and a `JobDeadLettered` event in the same transaction, which becomes an exception a person can retry; recovery closes it. Every few seconds the ledger asks Redis about rows in flight too long and corrects itself, so a process crash cannot leave a lie in the table.
- _Circuit breaker._ One per dependency, per process (as resilience4j and Polly do): three consecutive transient failures open it; a cooldown; one probe decides. Validation and auth errors do not count — the dependency is healthy and disagrees with us, which is a discrepancy, not an outage.
- _Rate limits._ Per endpoint, by risk: search 100/min/user, ask 20/min/user, payment mutations 5/min/user, login 10/min per attempted e-mail (the web app calls it server-to-server, so its IP is shared). Webhooks are signature-verified rather than user-limited. Counters in Redis when reachable (one limit across instances), memory otherwise.
- _Cache._ Cached: horse summaries and the assistant's projections. Never cached: balances, ACH settlement state, reconciliation results, clearances. Invalidation is by domain event (`HorseUpdated`, `CheckRecorded` → delete the horse's entry); TTL is the safety net, never the business model. The assistant's answer cache is keyed by a hash of the state the tools saw, so a stale answer is unreachable rather than merely short-lived.

**Cost.** More moving parts than `@Throttle()` and a `cache.get`. Each part is small, tested, and shown live on the Reliability Lab and Architecture pages.

**Not built, on purpose.** Distributed locking. One process runs the sync cycle here, and BullMQ's job ids plus the ledger's unique ids already make every job at-most-one-active; a second API instance would need a lock around the reconcile sweep and the outbox publisher before it could run safely, and the breaker state would have to move to Redis. Both are one afternoon, named here so nobody assumes they exist.

**Would change it.** Multi-instance deployments would move breaker state to Redis if instances must agree; they need not. A real 4-hour QuickBooks outage would raise the cooldown and add an alert on the open-circuit exception; nothing else changes.
