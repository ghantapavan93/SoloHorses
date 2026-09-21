# ADR-008 — Every external system sits behind a port with a labeled simulator

**Situation.** Stripe, QuickBooks Online, Twilio, Resend, the ICSI laboratory, the auction platform and e-signature all live outside this codebase. None of them should stop a reviewer from running the prototype, and none should be faked silently.

**Decision.** Ports with two implementations each: `AccountingProvider` (QuickBooks adapter or a durable simulator with fault injection and a tamper control), `MessagingService` (Twilio and Resend, or logged sends), `StripeService` (test mode, or a simulator that feeds the same webhook inbox and job). The laboratory, auction and e-signature are simulated at the seed level (`LabBatch.provider = GENETECH_SIM`, `esignEnvelopeId = env_sim_…`). `/health`, the UI banner and the About page list which integrations are live.

**Cost.** Simulators can drift from real behaviour. The accounting simulator deliberately mirrors the behaviours that bite in production: no idempotency key, SyncTokens, 429 throttling, 21-character references, duplicate display names.

**Would change it.** Nothing — this is also how the real integrations should be tested.
