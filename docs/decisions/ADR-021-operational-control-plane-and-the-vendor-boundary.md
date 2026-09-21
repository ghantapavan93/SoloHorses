# ADR-021 — An operational control plane over a mixed estate; the auction vendor behind an adapter

**Situation.** The public record shows the operation's software is not one application but a mixed estate: a sale platform that is a vendor's white-labelled product (the public sale site says "Powered by … Auction Software by …"; research A §103, §158), internal operational software, and the current generation named in the role — an API stack, a separate veterinary application on Supabase, a mobile application, and an assistant. A second critique (2026-09-18) drew the conclusion the first had missed: the senior problem is not building a horse application; it is making several generations and kinds of software behave like one dependable operation.

**Decision.** This build is an operational control plane, not a system that owns everything. It holds canonical operational state as _projections_ of the systems that own the writes — the sale platform, the equine records, the veterinary record, Stripe, the books — runs the published rules over them, raises what disagrees or needs a person as one shape (the operational exception), explains it in two registers, proposes, and leaves the decision to a person in the system that owns the record.

```
existing applications (own the writes)
  auction vendor · equine records · veterinary · Stripe · QuickBooks
            │ adapters: the vendor's words become the sale's
            ▼
  canonical operational state (Solo's language: Payment · Settlement · SaleLot ·
  RegistrationReleaseEligibility · RecipientReturn · VeterinaryAssessment)
            │ published rules, deterministic
            ▼
  operational exceptions → signals (one list, three coats: ring, dock, board)
            │ explain (Ask, over projections) · propose (a row a person approves)
            ▼
  a person decides · the rule-checked service executes · the audit row says who
```

**The vendor boundary, made real.** A lot sold on the vendor's platform enters through the same write-once inbox as a Stripe event (`IntegrationEvent`, provider `AUCTION`, unique on the vendor's event id) and is translated by `AuctionAdapter` into the sale's own words — a `SaleLot`, a settlement invoice, the buyer's payment as far as it has got, a certificate to hold. Nothing downstream sees the vendor's field names; a redelivered result finds its lot and is counted, not processed twice. The lab's "start a new sale" and the seeded scene both go through it. ASSUMPTION A16: the vendor payload shape is invented for the simulation; no vendor feed, API or portal was accessed. A real integration replaces one Zod schema and one function.

**Language.** The outside systems' vocabularies stop at the adapters: Stripe's intent statuses become the ledger's (`ledgerStatusOf`), the vendor's result becomes `AuctionResult`, the books' documents become mappings and discrepancies. Reproduction logic never sees a QuickBooks invoice; billing never sees a vendor lot number except as a label.

**Cost.** One more provider, one more adapter, three columns on the lot, a job. Two front-door surfaces (the ring and the dock) that must agree with the board — they read the same endpoint, so they cannot disagree.

**Would change it.** Learning what the estate's real boundaries are. If the sale platform pushes results, the adapter listens; if it must be polled, the adapter polls; if the office keys lots in by hand, the adapter is a form. The canonical state and the rules do not move.
