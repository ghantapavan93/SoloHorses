# ADR-002 — BullMQ on Redis, with an inline fallback

**Situation.** The role names Redis + BullMQ. The development laptop had Redis 3.0 on 6379 (too old for BullMQ, which needs 5+) and a Docker Desktop that would not start that day.

**Decision.** `JobsService` probes `REDIS_URL` at boot. If a Redis of version 5 or newer answers, it creates BullMQ queues and workers (exponential back-off, a per-queue limiter, `worker.rateLimit` on provider 429s). If not, the same registered handlers run inline with the same retry policy, and `/health` reports `jobsMode: inline`. Tests always run inline (`NODE_ENV=test`), which is also why they can assert on the full pipeline synchronously.

**Cost.** Inline mode means a webhook response waits for processing (still fast; the demo is fine). Two execution paths exist, but they share handlers, job ids and options, so a job that works inline works on the queue.

**Would change it.** In production Redis is mandatory; the fallback exists so a reviewer can run the whole thing with one Postgres. BullMQ 6 can also run on Postgres, which would remove Redis entirely; not chosen because the role names Redis.
