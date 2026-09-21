# ADR-011 — A modular monolith organized by bounded context, not by technical layer

**Situation.** The role maintains several applications with real integration and asynchronous complexity. The temptation in a prototype is either one flat `services/` folder or a fleet of microservices to look distributed.

**Decision.** One NestJS process, organized by the operation's own language: `modules/reproduction`, `veterinary`, `billing`, `accounting`, `operations`, `ask`, with `api/ · application/ · domain/ · infrastructure/` inside a module only where that separation clarifies responsibility (billing and accounting have adapters; veterinary does not). Everything the contexts stand on lives in `platform/`: config, persistence, security, audit, codes, clock, events, queue, cache, resilience, observability, messaging. Contexts talk through domain events; a context never imports another's services except through its public Nest module.

**Cost.** Some ceremony for small contexts; a few files that are mostly wiring. Cross-context reads (the assistant's projections, the lab) import several modules explicitly, which is visible in `AskModule` and `LabModule`.

**Would change it.** Two teams shipping on different cadences, or one context needing its own scaling profile. Then the boundary already exists to cut along; the event contract is the interface.
