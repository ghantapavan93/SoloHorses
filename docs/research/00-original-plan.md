# 00 — The original plan (as brought in on 2026-09-16, before research)

Source: a strategy document Pavan brought into the session (drafted with another AI after reading Solo's public site and a job description Pavan holds). This file records the claims so the critic can attack them. Nothing here is verified.

## Claims about the role
- Title: "Senior Full Stack Software Developer / AI-First". Works directly with founder Melanie Smith as a primary developer.
- The internal AI is called **Spade AI** (a correction from an earlier "Speed AI").
- "The stack Solo explicitly gave you": TypeScript, React, NestJS, PostgreSQL, Redis, BullMQ. Also Stripe and QuickBooks Online integration experience.
- An older public listing wanted 4+ years, practical AI/ML, DB design, self-direction, communication with non-technical people, equine experience preferred.

## Product thesis
"One horse. Every handoff. Nothing lost between them." Spade is a layer INSIDE an operating system, not the operating system.

## V1 surfaces (only five)
1. TODAY — morning operational board ("11 items need a human today").
2. HORSE 360 — longitudinal synthetic horse record + lifecycle timeline.
3. SPADE — grounded AI (⌘K sheet), five typed tools (getHorse, getHorseTimeline, getDailyExceptions, getFinancialReconciliation, proposeOperationalAction), read + propose only, human approval gate, abstain when evidence is missing, report conflicts.
4. MONEY INTEGRITY — Stripe test mode ↔ QuickBooks sandbox reconciliation, duplicate-webhook proof, retry, exceptions.
5. EVAL LAB — visible AI evaluation suite (Promptfoo), 60 cases across grounding/missing-info/permissions/financial/veterinary/conflicts.

## Experience
- Candidate landing: black screen, "UNOFFICIAL CANDIDATE BUILD", the thesis, "ENTER SPADE OPS", card-fold transition into the app.
- One 3D moment: three ranch nodes (South / North / Recip Farm) over a dark topographic plane, state-driven; lazy loaded; no 3D horse.
- Design: premium, dark, quiet, architectural; banned: purple gradients, neon grids, robots, orbs, glassmorphism, particles.
- Spade is invisible until useful (⌘K / "Ask Spade").
- Bottom of landing: "What I would do next — spend a morning with the people using the current systems…"

## Locked stack (pre-research)
Turborepo + pnpm; Next.js + React + TS strict + Tailwind + shadcn/ui + Framer Motion/GSAP; Three.js + R3F + drei + gltfjsx; NestJS; PostgreSQL + Prisma + pgvector; Redis + BullMQ; Auth.js; Vercel AI SDK + Zod; Promptfoo; Sentry (+ optional Langfuse); stripe-node + Stripe CLI; intuit-oauth + QBO sandbox; Vitest + Jest + Playwright; GitHub Actions.

## Repo structure
apps/{web,api}; packages/{ui,domain,database,integrations,ai,evals,config}; docs/{ARCHITECTURE,DECISIONS,DOMAIN,SECURITY,RESEARCH,ASSUMPTIONS}.md; CLAUDE.md; AGENTS.md.

## Domain model (proposed)
Horse, Mare, Stallion, RecipientMare, Customer, BreedingContract, BreedingCycle, Aspiration, Embryo, EmbryoShipment, RecipientMatch, EmbryoTransfer, PregnancyCheck, LabResult, VeterinaryEvent, Invoice, Payment, PaymentAllocation, AccountingMapping, IntegrationEvent, OperationalException, SpadeConversation, SpadeFinding, SpadeMemory, SpadeEvaluation, AuditEvent.

## Build order
Repo audit → tokens → schema → seed → API → Today → Horse 360 → Spade retrieval → approval → Stripe → BullMQ → QBO → evals → 3D → animation → mobile → a11y → perf → 90-second demo.

## Explicitly postponed
Voice, native mobile, auction platform, fine-tuning, knowledge graph, multi-agent swarm, computer vision, predictive vet models, blockchain, full accounting, digital twin, GPS/IoT, real customer data, automated vet recommendations.

## Boundaries
Public sources only. No portal/admin/login access. No scraping customer data. Synthetic horses. Stripe test mode. QBO sandbox.
