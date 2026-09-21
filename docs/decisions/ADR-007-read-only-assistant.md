# ADR-007 — The assistant reads and proposes; it never mutates

**Situation.** The role asks for human review wherever mistakes have consequences. An earlier plan had the assistant propose operational actions through an approval gate.

**Decision.** The assistant has no write tools. It answers with statements that cite record codes, abstains with a reason (no record, field empty, access denied, veterinary judgment, financial action, out of scope, unverifiable), reports conflicts between records, and offers "Send to team", which creates a `Request` that a person handles. There is nothing to gate because nothing can be triggered. Human mutations — a vet recording a check, staff confirming an intake, billing resolving a discrepancy — are audited, not approved.

**Cost.** Staff still do the typing for corrections. Today that is a feature: the records stay theirs.

**Would change it.** A specific, frequent, low-risk mutation (for example, marking a recip "set up") where an approval UI would save real time. It would be added as one narrowly typed tool with a `Proposal` row and an explicit approve step — not a general "propose action" tool.
