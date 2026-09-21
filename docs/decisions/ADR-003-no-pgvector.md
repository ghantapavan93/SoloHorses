# ADR-003 — Typed tools are the retrieval layer

**Situation.** The original plan proposed pgvector for the assistant. The synthetic world has about 60 embryos, 140 horses and 70 invoices, and the real operation's records are structured: codes, dates, statuses, amounts.

**Decision.** No vector store. The assistant retrieves through seven typed, read-only tools (`getEmbryo`, `getContract`, `getHorse`, `getCustomer`, `getDaySheet`, `searchRecords`, `lookupTerm`) that run the same services and permissions as the UI. Free-text search is `ILIKE` on codes and names. Every tool result carries record codes, which is what makes verification possible.

**Cost.** Questions that need semantic recall over long free-text notes are not served. There are no long free-text notes in this data model.

**Would change it.** Thousands of unstructured documents (vet reports, scanned contracts). Then Postgres full-text search first; pgvector only if recall measurably needs it, and only once Prisma's migration handling of `vector` columns is stable.
