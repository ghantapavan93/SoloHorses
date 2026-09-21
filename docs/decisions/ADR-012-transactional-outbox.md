# ADR-012 — A transactional outbox and idempotent consumers, not "commit then publish"

**Situation.** The dangerous shape is `db.commit(); queue.add(...)`. The commit can succeed and the publish can fail, and the system disagrees with itself: a payment recorded, the books never told. The first version of this codebase had exactly that shape in three places.

**Decision.** A business fact is written to `DomainEvent` in the same transaction as the rows it describes (`OutboxService.append(tx, …)`). A publisher moves unpublished events to a `domain-event` job (id = event id) and marks them published; it runs after each commit and every two seconds as a safety net. Each consumer runs in its own transaction that begins by inserting `(consumer, eventId)` into `ProcessedEvent`; a second delivery hits the primary key and is skipped; a handler that throws rolls back its own work and the processed row, so the next delivery tries again. A consumer that needs the outside world enqueues a job inside that same transaction (`jobs.enqueue(…, { tx })`); the hand-off happens on the next flush.

**Cost.** Two extra tables and a publisher loop; events can be delivered out of order across workers, so consumers re-read state rather than trusting the payload's view of it. Cascades (a consumer appending events of its own) are handled by the publisher re-querying after each round rather than by recursion — a nested flush inside a flush would wait on itself.

**Would change it.** Event volume beyond a single Postgres table's comfort, or consumers in other processes. Then the same outbox feeds a log (Debezium into Kafka or Redis Streams); the consumer contract does not change.
