# ADR-015 — One correlation id from the click to the books

**Situation.** "Something went wrong" is not a support ticket. The role owns production support across web, API, database and integrations.

**Decision.** The web app mints a correlation id per page render or server action and sends it as `x-correlation-id`. The API adopts it (or mints one) in a middleware that runs every request inside an `AsyncLocalStorage` context; the outbox, the queue, the audit trail and the inbox read it from there, so a job carries the id of the request that caused it and a consumer's audit rows join the same story. Structured logs carry it on every line; Sentry is tagged with it; error responses return it so a toast can show it. `GET /platform/trace/:id` reconstructs every row that shares the id — audit rows, domain events, jobs, inbox rows, accounting attempts, exceptions — in time order. Metrics are in-process counters derived from the same bus the SSE stream reads, enough for a live Architecture page; a production deployment exports the same names.

**Cost.** Async context propagation has one sharp edge: it follows timers, so anything scheduled from inside a scoped unit of work must be scheduled outside the scope or it inherits "I am inside a flush" forever. That bug was found and fixed by a test that would not exit.

**Would change it.** OpenTelemetry would replace the hand-rolled context with spans and the counters with an exporter; the id and the trace endpoint would remain.
