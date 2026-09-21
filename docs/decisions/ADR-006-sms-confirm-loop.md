# ADR-006 — Deterministic intake parser plus a human confirm

**Situation.** Embryos are announced by text message. The published rule is that a text is not confirmed until the farm replies.

**Decision.** `parseIntakeMessage` is regular expressions, not a model, so the office can predict what it catches and what it misses; the parse carries `missing` and `confidence`. Nothing is created until a person confirms, with every field editable. Confirmation creates the embryo records and queues the reply that carries their codes — the reply is the confirmation. STOP and HELP are honoured automatically and are the only automatic replies.

**Cost.** The parser will miss unusual phrasings. That is the design: it asks rather than guesses, and the office corrects in the same screen.

**Would change it.** Evidence from real texts that a model extraction step (behind the same human confirm) meaningfully reduces office time. The confirm step would stay.
