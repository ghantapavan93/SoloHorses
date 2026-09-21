# ADR-013 — Operational exceptions as a first-class aggregate

**Situation.** Every system has its own word for failure: Stripe `payment_failed`, QuickBooks `sync_failed`, reproduction `recipient_missing`, veterinary `clearance_missing`, the queue `dead`. A person carries them between screens by phone and text, which is what the public material describes.

**Decision.** One aggregate, `OperationalException`, with a kind, a severity, a source, an entity, a dedupe key, an owner and a resolution. Deterministic detectors (queries with a rule: `plannedRecipientId === null` inside the transfer window; a milestone crossed with no check; an order holding on a collection day; a text parsed a day ago and never confirmed; two checks that disagree; a webhook that would not apply) raise them; event consumers raise the infrastructure ones (a dead job, books that disagree, an open circuit). `openKey` is the dedupe key while the exception is open and null afterwards, so a detector running every minute raises each condition once, and a condition that clears resolves its own exception with a reason. People acknowledge, assign, retry, resolve and ignore; every action is audited. The assistant may explain an exception through `getOpenExceptions`; it can never open or close one.

**Cost.** Detection is a scheduled sweep plus event-triggered sweeps, so a condition can be up to a minute late on a quiet system. Some detector thresholds (three days of grace on a milestone, one day on an unconfirmed text) are assumptions to be corrected by the people who do the work.

**Would change it.** Nothing about the shape. New sources (the lab, the auction platform, the mobile app) add detectors or consumers; the board does not change.
