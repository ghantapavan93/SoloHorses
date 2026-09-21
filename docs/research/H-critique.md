# H — Critique: why the plan fails, and the V1 that replaces it

Critic. 2026-09-16. Inputs: 00, A, B, C, D, E, F, G, G2. Nothing new was fetched; every claim cites a research file, which cites its source.

Ranking rule: probability she hits it × how fast it ends the read. Severity: **fatal** = she stops; **serious** = she discounts the whole thing; **cosmetic** = she notices and moves on.

Scenario key: **S1** = Pavan's "Senior Full Stack / AI-First" JD is real and newer (TS/React/NestJS/Postgres/Redis/BullMQ + Stripe + QBO). **S2** = only the public May-2026 posting exists (Next.js 15 / React 19 / TS / Supabase / Tailwind / Radix / Stripe / Resend / Twilio / Sentry / Netlify / Anthropic SDK). **Prior: S2.** Nothing in A–G corroborates S1. The 00 document was drafted with another AI (00 header), and NestJS/Redis/BullMQ is that AI's default "senior backend" (B §1.4). Everything Solo runs publicly is Next.js on Vercel/Netlify with Supabase storage (B §2, G §1.1).

---

## 1. Why Melanie closes the tab (ranked)

**1. Equine experience and North Texas are "firm requirements", and the plan never mentions either.** — fatal
Evidence: B §1.2 Facebook closing line; B §1.3 careers bullets 1–2; B §5.7 "silence here is the most likely rejection reason regardless of code quality"; A §10.9.
Fix: Not a code problem. Pavan answers two questions truthfully before anything is built (§5 Q2–Q3). The cover email leads with them (§4c). The artifact's job is to make the domain study visible — her cutoffs (5 PM / 8 AM), her fee milestones (24-day heartbeat, 45–60 days, 55 days), her intake rule ("a text is not confirmed until we reply"), her ID shapes — so "no hands-on experience" reads as "not yet, but did the homework" instead of "generic dev". If he is not local: a relocation commitment with a date and a self-funded on-site week. Skip this paragraph and nothing else in this file matters.

**2. The role may already be closed.** — fatal if true
Evidence: B §0.6 / §5.12: careers "No positions open at this time", LinkedIn "No longer accepting applications", Indeed none. Portal Terms (2026-08-23) and Privacy (2026-09-14) shipped since — she may have hired, or is building it herself with Claude Code.
Fix: Day 0, before code: four lines to mel@soloselect.com CC careers@ — is the developer role open; is an unsolicited backend prototype from public sources welcome; delivery date. Build regardless, capped at ten working days. If "closed", send it as a contribution ("a backend slice for the portal you are shipping; use anything"), not an application.

**3. The stack fork: NestJS/Postgres/Redis/BullMQ/QBO built against a JD nobody has seen.** — fatal in S2; serious in S1
Evidence: 00 "the stack Solo explicitly gave you"; B §0.2 verbatim LinkedIn stack, "No NestJS. No Redis/BullMQ. No QuickBooks"; B §1.4 the title and "Spade AI" appear nowhere public; B §5.1 "she will notice in 10 seconds… 'run your world over here'"; A §5.10 no public QBO mention; Stripe only in portal Terms (B §2).
Fix: Pavan pastes the JD (§5 Q1). Until then, build S2. **Does not change between S1 and S2:** domain model, surfaces, Stripe test mode, Twilio, Anthropic SDK, synthetic data, honesty layer, repo hygiene, light theme, no 3D, no landing, no Redis, no Turborepo, no pgvector. **Changes:** data/auth layer (Supabase RLS + Supabase Auth in S2 vs Postgres + Prisma 7.10 + Better Auth in S1); API layer (Server Actions / Route Handlers in S2 vs a thin NestJS app in S1 because the JD names it); jobs (Postgres jobs table in S2 vs BullMQ 6 on its Postgres backend in S1 — D §2.7); accounting (cut in S2 vs sandbox-behind-a-port in S1); hosting (Netlify vs Vercel). Table in §3.

**4. She already built this — and the plan's tagline paraphrases her copy.** — fatal as framed
Evidence: B §0.3 portal.soloselect.com "The Connected Solo Select Portal", nav HOME · MY HORSES · AGREEMENTS · ACCOUNT, Stripe, Sentry, "Ask Spade" BETA; B §2.1 "The work has always been connected. The records were not." vs 00 "One horse. Every handoff. Nothing lost between them."; B §5.2 "did not look at what we have"; B §0.4 Spade is customer-facing, so 00's "Spade AI… internal ops copilot" claims knowledge nobody has.
Fix: Reposition from "parallel product" to "the backend and missing pieces behind a portal like yours". The JD says she builds the frontend and wires it 80–85% (B §1.1): a prettier frontend competes with her; a backend she can plug into complements her. Drop "Spade" from the product and from the AI; the sheet is "Ask". Mirror the *shape* of her public sample-screen IDs (E-26-####, SS-26-####, Recip #NNN; B §2.1), never the values, so it is obvious the portal was read. Say in the README that Ask Spade's internals are unknown.

**5. A black landing page with a card fold is showing off; she asked for receipts.** — serious
Evidence: 00 "black screen, UNOFFICIAL CANDIDATE BUILD… ENTER SPADE OPS, card-fold"; B §1.1 "Show us what you've built. Live links, repos, shipped work."; G §5.1 "a red flag, not a feature… 3 seconds before anything useful"; G §5.2 "gimmick unless it explains something".
Fix: The URL opens on a login page with demo credentials per role printed on it (her /portal/learn uses sample data the same way; B §2) and lands on the Day Sheet. One-line banner. The README is the "about". The only motion is the Ask sheet sliding in (G2 §9: ≤300 ms, ease-out). Receipts that replace the landing: public repo with daily commits, green CI badge, Sentry event screenshot, CLAUDE.md, AI_BUILD_LEDGER.md, a three-minute phone-shot walkthrough.

**6. Scope: five surfaces, 25 entities, 3D, evals, QBO, a queue and a monorepo, for one person in ~10 days.** — serious; fatal through unfinished edges
Evidence: 00 §V1 surfaces, §Domain model (25 entities incl. SpadeMemory/SpadeEvaluation), §Build order (19 steps, payments and jobs *after* the AI); C §3 30 reuse items; D §3 ~60 pinned packages; B §5.6 "One broken link or lorem ipsum is a close-the-tab event"; B §3.3 "this is good, but it's not the best".
Fix: Four pages, one sheet, ≤16 entities, every surface demoable end-to-end or cut (§3). Out: memory subsystem, eval page, findings/conversation tables, 3D, landing, Turborepo, QBO-in-S2. Build order puts the JD's centre of gravity first — auth/RLS, SMS, payments (B §5.5) — not last.

**7. The Today board is generic "exceptions"; the real morning is a collection-day and a transfer-day manifest.** — serious
Evidence: 00 "11 items need a human today"; A §10.7 "dispatch problem, not a CRM problem… collection-day manifest (orders, paid-status, ship-to vet)"; A §3.1 orders by 5 PM day before, cancel by 8 AM, 100–150 orders/day, every other day Feb–Jul; A §3.3 30–40 recips set up per transfer day, embryos by 1 PM, "15 mares to get those 10", vet re-grades at thaw; A §10.6 "pregnancies crossing a billing milestone today".
Fix: Rename to Day Sheet, two tabs. *Collection day:* each order = mare, stallion, ship-to vet, container, contract paid-in-full? (HOLD if not — A §3.1 "all have to be paid before semen goes out the door"), placed before cutoff?, cancelled after 8 AM?. *Transfer day:* recips set up, embryos expected/arrived by 1 PM, which embryo went into which recip or stayed frozen, checks due, and the ones crossing day 24/45/55 flagged as billing events. Three site counters (South / North / Recip Farm) in the header replace the 3D map.

**8. There is no SMS anywhere in the plan; embryo intake is literally a text, and the JD lists Twilio.** — serious
Evidence: 00 (no Twilio, no SMS); A §3.3 "Text every cross to the Recip Farm… A text is not confirmed until we reply"; A §3.1 semen orders by call/text; B §1.1 "Twilio or similar VoIP/SMS in production"; B §3.5 per-client group texts, "getting lost in the group chat is not an answer"; B §2 portal Privacy lists SMS for shipment/contract/billing updates.
Fix: An Intake inbox: inbound SMS → parsed into her required fields (A §3.3: sire, dam, ICSI/ovulation date, count, storage, sending vet, ETA) → pending until a human confirms → reply SMS carrying the embryo IDs → record created. Outbound: the owner digest (#9) and STOP/HELP. Twilio test credentials outbound; inbound simulated by a signed webhook POST in dev, live on the deployed URL. No research file covered Twilio or Supabase — a two-hour spike each on day 1.

**9. Money Integrity is built on an unverified QBO assumption and misses where money actually leaks.** — serious
Evidence: A §5.10 "No public mention of QuickBooks or Stripe anywhere"; A §11 A1 labeled ASSUMPTION; E §4.1 "a 3-month product (Synder/Acodei exist)"; E §4.5 "the founder's Monday pain is cash, not books"; A §10.6 and §8.8 billing triggers are clinical events at three misaligned milestones, and billing sits at a different address.
Fix: Money in V1 = milestone → invoice → paid state, on Stripe test mode, real. The 24-day heartbeat creates the $5,000 / $6,500 lease invoice and starts $22/day board (A §3.3); day 45–60 creates the ICSI stallion fee (A §3.4); the audit row shows which ultrasound created which invoice. Idempotent webhooks with a replay proof (E §3.7 step 1) stay. QBO: S1 keeps E's `AccountingProvider` port, simulator by default, one recorded sandbox run as proof, Customer + Invoice + Payment only, below the cut line. S2 cuts it to a README paragraph.

**10. The Genetech round-trip is missing, and the plan gets the lab wrong.** — serious (the domain-fluency test)
Evidence: A §2 ICSI "not at any Solo site… Genetech, Purcell, Oklahoma"; A §10.1 "the single biggest cross-company handoff and the plan misses it"; A §3.2 aspirate every Monday, updates day 7–10, 2.1–2.2 embryos/cycle. Same family of error: A §10.2 the auction is Auction Mobility (vendor); A §10.4 2,500 mares live in pens, not "400 stalls".
Fix: A `LabProvider` port with a `GenetechSimulator`: aspiration (Monday) → batch shipped → count returned day 7–10 → fresh transfer or vitrify (Tank · slot, as her portal shows; B §2.1). Appears as timeline events on the Embryo record and as a "lab results due" row on the Day Sheet. Auction Mobility is a simulated CSV import or explicitly out of scope. Vocabulary check before send: pens, recips, chute fee, cultured clean, 24-day heartbeat, open.

**11. NestJS, Redis, Turborepo, pgvector, Auth.js, Promptfoo, Three.js: architecture theater that also does not run on this machine.** — serious in S2; cosmetic-to-serious in S1
Evidence: D §6.1–6.8 (NestJS "job-description theater"; Redis "dead weight"; pgvector "theater, and currently risky"; Auth.js "dead end"; Three.js 650 KB and R3F pins React <19.3; Promptfoo "wrong first eval harness"; Turborepo "premature"); E §4.2 local Redis 3.0.504 refused by BullMQ, Docker daemon stopped, no winget/scoop; B §5.1 NestJS+BullMQ signals "I will bring my own architecture".
Fix: S2: none of them. S1: thin NestJS API because the JD names it; BullMQ 6 on its Postgres backend (same API, one datastore; an ADR says the Redis swap is one connection line); Better Auth, not Auth.js; Prisma 7.10.0 pinned, never `latest`; no pgvector (F §3: typed tools *are* retrieval); no Turborepo; no Three.js; evals in Vitest. Both: Node 24 LTS and Docker Desktop on day 0 (D §0), TypeScript 6.0.3 pinned (D §2.3), `save-exact`.

**12. The approval gate is bureaucracy for an AI that, at Solo, answers customer questions.** — serious
Evidence: 00 proposeOperationalAction + human approval gate; B §0.4 / §5.3 "Ask Spade" is customer-facing Q&A with a "double-check with the team" disclaimer; F §7.4 "can feel like bureaucracy to a founder"; B §3.4 she ships in days.
Fix: V1 Ask is read-only over typed tools with evidence IDs, abstain and conflict (keep all of F §2), plus one button — "Send to team" — which creates a Request row (her portal's own noun; B §2.1). No AI-initiated mutation exists, so there is nothing to gate. Human mutations (vet records a heartbeat, staff confirms an intake) are audited, not approved. Proposals return in V1.1 only if a staff-facing case appears.

**13. Trademark and photo risk: "SPADE OPS", the spade glyph, the card motif, real stallion names.** — serious (brand-protective founder)
Evidence: G §1.6 "Do not copy /brand/*.png… deck cards… any photograph… Do not replicate the S♠LO letter-substitution"; B §5.8 staff hold her social passwords; G §5.4 "did you scrape our site?"; D §5.5 assets are not open source.
Fix: Neutral product name with no Solo, Select or Spade in it. Palette only — #600312 is a colour, not a mark (G §1.6). No spade glyph in V1; lucide icons. Invented stallion, mare, owner and vet names — never a name from /stallions. No photos. README "Trademarks" section (D §5.6).

**14. Dark, cinematic, "architectural" by default is the wrong room.** — cosmetic, immediate
Evidence: 00 "premium, dark, quiet, architectural"; G §5.3 "6 a.m. against spreadsheets, printed contracts, and a white Shopify admin; the brand site itself is white with maroon"; G §1.2 no blue, no gradients; G §5.6 the 1366×768 / 125 % laptop.
Fix: Light default, dark opt-in, G §2.4 tokens as written (warm neutrals, one maroon accent never used as a status, 13 px UI, 32 px rows, sheet overlays at narrow widths). Mobile-first for the farm phone.

**15. The 3D ranch topology costs a bundle and says nothing.** — cosmetic
Evidence: G §5.5 "says nothing the Today board doesn't"; G §3.3 and G3 (measured ~250 KB gz lazy chunk; R3F 9.7 breaks `npm ci` on React 19.3) both land on SVG-only; D §6.5.
Fix: Cut, one step past G3. Three site cards with counts in the Day Sheet header. If a two-hour slot survives day 9, the pre-baked SVG topology from G3 §"Pure SVG alternative" — not before, never R3F.

**16. Eval Lab as a surface is green-tick theater.** — cosmetic
Evidence: 00 "60 cases… Promptfoo"; F §7.1 "proves the plumbing, not the product"; F §5.3 Vitest verdict; D §6.6.
Fix: 12–16 Vitest eval cases (grounding, abstain, conflict, RBAC leak, injection; F §5.4 subset) in CI against seeded data with a spend cap; results as a README table and a CI badge. No page.

**17. Citation per sentence reads like a compliance document.** — cosmetic
Evidence: F §7.3.
Fix: Cite per claim with chips, ≤8 statements per turn, collapsed repeats, an uncited plain-language summary that only restates cited claims (F §2.3).

---

## 2. What the plan got right

1. **Public-only, synthetic-only boundary** (00 §Boundaries). Matches her brand-protectiveness and her own sample-data approach on /portal/learn (B §2). Keep verbatim.
2. **The diagnosis: information dies at handoffs.** A §8 lists sixteen public-evidence handoffs. The thesis is right; only the wording collides with hers.
3. **Typed tools, abstain, conflict, evidence IDs.** F validated the design (F §2). Her live Ask Spade carries a "double-check with the team" disclaimer; grounded-with-evidence is the honest upgrade.
4. **Audit, outbox, idempotency ported from Utility Connect.** Real, tested, MIT, Pavan's own (C §2.1); exactly what Stripe's at-least-once delivery needs (E §1.4).
5. **AI invisible until useful** — a sheet, no mascot. Matches "A real person is still right here" (B §2.1) and G §5.8.
6. **A longitudinal record as the unit.** Her portal's data model confirms it: embryo, recip, contract, status, last checked (B §2.1).
7. **Integer cents, Stripe test mode, idempotent webhooks, "at-least-once + idempotent" rather than "exactly-once"** (E §3, §4.4).
8. **The explicit postponed list** (voice, native mobile, auction platform, fine-tuning…). The auction is a vendor product anyway (A §10.2).

---

## 3. The revised V1

**Positioning:** A backend that writes down what the barn already does by text, ultrasound and deposit — once, audited, and answerable — so nobody retypes a card, hunts a group chat, or ships semen on an unpaid contract.

**Working name:** Pavan's call; must not contain Solo, Select or Spade. "Daysheet" is a safe default.

**Principle:** the UI is a harness for the backend. She builds frontends; the JD wants a backend owner. The star is the schema, RLS/RBAC, state machines, webhooks, the SMS loop, the audit trail and the import — with a clean Radix/Tailwind UI that proves they work.

### Surfaces (four pages, one sheet)

| # | Surface | End-to-end behaviour | Named pain / JD line |
|---|---|---|---|
| 1 | **Day Sheet** (home) | *Collection day:* semen orders vs 5 PM / 8 AM cutoffs, ship-to vet, HOLD if contract not paid in full. *Transfer day:* recips set up, embryos expected / arrived by 1 PM, embryo→recip assignment or "stayed frozen", checks due, day 24/45/55 crossings flagged as billing events, lab results due. Header: South / North / Recip Farm counters. | A §3.1, §3.3, §10.6–10.7; "swamped" stallion office (B §3.6) |
| 2 | **Record** (Embryo / Mare / Contract) | One page per entity, her ID shapes. Timeline newest-first: aspiration → lab batch → count → transfer → checks → milestones → invoices, each with actor and source. Vet records a check; a day-24 heartbeat creates the lease invoice + board start (Stripe test invoice) and an audit row. **Import** action: CSV → validated rows → duplicates flagged → human resolves. | "actively entering legacy records" (B §2.1); milestone confusion (A §3.4) |
| 3 | **Intake** (messages) | Inbound SMS → parsed fields → pending → human confirms (ambiguous dam/sire resolved by pick) → reply SMS with embryo IDs → record. Outbound: per-owner **digest** (one line per embryo: recip #, status, days, last checked) by SMS + email, previewed before send; STOP/HELP honoured. | "A text is not confirmed until we reply" (A §3.3); group-text loss (B §3.5); Twilio (B §1.1) |
| 4 | **Contracts** | Reserve → deposit → signed → paid-in-full → shippable, as a state machine. Deposit via PaymentIntent on a saved card (SetupIntent; "sick of copying that down", B §3.5); milestones via Stripe Invoices (E §1.7); webhook idempotency with a visible replay proof; a plain-language contract summary card ("98% don't read them", B §3.6). | B §3.5–3.6; Stripe (B §1.1); E §1 |
| S | **Ask** (right sheet) | Grounded Q&A over typed tools (getEmbryo, getTimeline, getDaySheet, getContract); evidence chips → record drawer; abstain; conflict; RBAC-scoped (customer sees own; "a stallion's full book remains private to its owners", B §2.1). "Send to team" creates a Request. Read-only. | Ask Spade (B §0.4); Anthropic SDK (B §1.1); F §2 |

Roles: admin, stallion_office, recips, vet, customer. Entities (16): User, Customer, Horse (mare / stallion / recip), Contract, SemenOrder, Aspiration, LabBatch, Embryo, Transfer, Check, Invoice, Payment, Message, Request, IntegrationEvent, AuditEvent.

Rules encoded (all FACT in A): order by 5 PM day before, cancel by 8 AM; collections every other day Feb–Jul; deposit + stud + chute paid before semen ships; card top-up passes the card fee; fresh contract used in year of purchase, ICSI within one year; embryos preferred by 1 PM on transfer day; day-24 heartbeat → lease fee ($5,000 flush/thawed, $6,500 fresh ICSI) + $22/day board; 45–60 days → ICSI stallion fee; 55 days → Select Genes embryo confirmed; open mare → redo or credit; recip back by Dec 1 or $6,000.

Cut from 00: Eval Lab page, 3D, landing + fold, memory tables, proposals, QBO reconciliation UI (S2), Turborepo, pgvector, NestJS (S2), Redis (both).

### Stack — S1 vs S2

| Layer | S1 (Pavan's JD real) | S2 (public posting only — default) |
|---|---|---|
| App | Next.js 16 App Router UI + thin NestJS 12 API (`apps/api`); domain in a framework-free package | Next.js 15/16 App Router; Server Actions + Route Handlers; one app |
| Data | Postgres 17 (Docker) + Prisma 7.10.0 pinned + `@prisma/adapter-pg` | Supabase Postgres; SQL migrations; RLS per role; `supabase-js` (pin day 0 — not versioned in D) |
| Auth | Better Auth 1.7.5 + RBAC (D §6.4) | Supabase Auth (email + password) + RLS + role in `app_metadata` |
| Jobs | BullMQ 6.3.6 on `createPostgresBackend`; no Redis (D §2.7) | `jobs` table + `FOR UPDATE SKIP LOCKED` worker on a Netlify scheduled function (or pg_cron) |
| Payments | Stripe 22.6.2, API `2026-08-26.dahlia`, `constructEvent`, `IntegrationEvent` unique on event id (E §1, §3.3) | same |
| Accounting | `AccountingProvider` port; simulator default; one recorded QBO sandbox run (Customer / Invoice / Payment, `minorversion=75`; E §2) — below cut line | cut; README paragraph + port interface only |
| SMS | Twilio, test credentials (domain demands it even if the S1 JD is silent) | Twilio (JD) |
| Email | Resend (digest copy) | Resend (JD) |
| AI | `@anthropic-ai/sdk` direct; `claude-sonnet-5` default for cost, `claude-opus-5` by env (F §1.3); tool use + structured output + deterministic evidence verifier (F §2.4) | same — JD says "Anthropic SDK" |
| UI | Tailwind 4 + shadcn `-b radix` + lucide + motion 13 (sheet only) | Tailwind + Radix (JD) via shadcn `-b radix` |
| Observability | pino; Sentry on day 9 | Sentry (JD) on day 1 — one hour |
| Hosting | Vercel (Solo's public site runs there; G §1.1) | Netlify (JD) |
| Tests | Vitest 5 (unit + evals), Playwright smoke, GitHub Actions with Postgres service + PGlite lane (C #9) | same; Supabase CLI local in CI |
| Tooling | pnpm, TypeScript 6.0.3 pinned, ESLint 10 flat, Node 24 LTS, `save-exact` (D §0, §2.3) | same |

### Real vs simulated

| Thing | V1 | Why |
|---|---|---|
| Stripe | **Real**, test mode: test cards, `stripe listen`, `stripe trigger`, `stripe events resend` for the replay proof | E §1.5, §3.7 |
| Twilio | **Real** test credentials outbound; inbound simulated by a signed webhook POST in dev, live on the deployed URL | JD; unresearched — day-1 spike |
| Resend | **Real**, free tier | JD |
| Anthropic | **Real**, spend-capped | JD |
| Sentry | **Real** DSN | JD (S2); one hour |
| QuickBooks | S1: simulator default + one recorded sandbox run; S2: none | A §5.10 unverified; E §4.1 scope |
| Genetech (ICSI lab) | **Simulated** `LabProvider`: Monday aspiration → day 7–10 count → transfer / vitrify; demo clock can advance days | A §2, §3.2 |
| Auction Mobility | **Simulated** CSV import of hammer prices → invoices, below cut line; otherwise out of scope, stated | A §10.2 |
| DocuSign | **Simulated** "signed" state with a fake envelope id | A §3.3 |
| Ultrasound checks | Entered by the vet role in the UI, or seeded | A §11 A6 |
| Data | 100 % synthetic, fixed-seed generator, admin "reset demo" action; invented names; her ID shapes, not values | 00 §Boundaries; G §1.6 |

### 90-second demo

| t | The viewer sees |
|---|---|
| 0–12 s | Deployed URL. Login page lists demo logins per role; sign in as recips. Light UI, one-line banner. Day Sheet → Transfer day: 14 recips set up, 9 embryos expected, 2 arrived, 3 checks due — one crossing day 24, marked "lease fee will invoice". |
| 12–30 s | A phone texts the Twilio number: "Cross: Ironwood Cat x Miss Tally, ICSI 9/14, 2 embryos, Tue by 1pm, Dr. Ortega". Intake shows parsed fields; dam is ambiguous (two candidates) → pick → Confirm. The phone receives: "Received E-26-2077, E-26-2078 · 2 embryos · Tue by 1 PM". Day Sheet expected count ticks to 11. |
| 30–50 s | Open E-26-2041: aspirated Monday → Genetech batch → 2 embryos day 7 → transferred to Recip #347 → 14-day check ✓ → 24-day check due today. Switch to vet, record "heartbeat: yes". Milestone fires: $6,500 lease invoice created (Stripe test), board $22/day starts, audit row reads vet → check → invoice. |
| 50–68 s | Contracts: SS-26-0533 at deposit_paid. Pay balance with 4242 → webhook → paid_in_full → tomorrow's collection sheet flips that mare from HOLD to SHIP. Terminal: `stripe events resend evt_…` → `{received:true, duplicate:true}`; one payment row; state unchanged. |
| 68–82 s | Ask: "Which of Jane Alder's embryos haven't been checked in 7 days?" → two statements with evidence chips, one abstention ("E-26-2060 has no check on record"), one conflict if seeded. Chip → record drawer. "Send to team" → Request created. |
| 82–90 s | Digest preview for Jane Alder: one line per embryo, last checked; sent by SMS + email. Cut to README: what is real, what is simulated, what I expect to be wrong. |

### Build order (10 working days)

| Day | Ship | Proof |
|---|---|---|
| 0 | JD pasted or S2 chosen; role-open email sent; Node 24, Docker, Stripe CLI; Twilio, Anthropic, Sentry, Resend keys; Twilio + Supabase spikes | `.env.example` complete |
| 1 | Repo, CI (lint / type / test), deploy pipeline live at a URL, schema + migrations, seed generator, auth + roles (RLS in S2), Sentry, CLAUDE.md, ADR-001..003 | Green badge; login works on the live URL |
| 2 | Record page: Embryo / Mare / Contract timeline; `LabProvider` simulator; audit table with immutability trigger (C #1) | Timeline renders from seed with actors |
| 3 | Milestone rules: check → invoice → board; Stripe test invoice creation; Day Sheet transfer tab | Day-24 heartbeat creates an invoice + audit row |
| 4 | Day Sheet collection tab: orders, cutoffs, HOLD / SHIP from contract state; three site counters | Cutoff and paid rules covered by unit tests |
| 5 | Intake: Twilio inbound webhook (signature check), parser, confirm / reject, reply SMS, STOP / HELP | Text in → confirmed record → reply out |
| **cut** | **If only 5 days exist, ship days 0–5 and stop.** Foundation + Record + Day Sheet + Intake + milestone billing = auth/RLS, SMS, payments-lite — the JD's centre. SMS intake is the domain-signature demo; the Stripe webhook is first over the line. Ask, Contracts, digest, import, QBO are cut; the AI receipt is CLAUDE.md + the build ledger. | |
| 6 | Contracts: state machine, deposit + balance via Stripe, webhook idempotency, replay proof, saved payment method | `stripe events resend` shows `duplicate:true` |
| 7 | Ask: tools, structured output, evidence verifier, RBAC scoping, drawer, "Send to team"; 12–16 Vitest evals in CI | Eval table in README from a real run |
| 8 | Owner digest (SMS + Resend); legacy CSV import with dedupe; S1 only, if ahead: QBO simulator + one sandbox run | Digest received on a test phone |
| 9 | Polish: 375 px mobile, 1366×768 at 125 %, empty / error states, a11y pass, ADR-004..008, THIRD_PARTY_NOTICES, ASSUMPTIONS.md, license allowlist in CI | Playwright smoke green |
| 10 | Three-minute phone walkthrough; README; cover email; buffer for what broke | Send |

### Repo hygiene = the receipt

Public GitHub repo, MIT (© Pavan), daily commits with real messages — no single squash · CI badge green on `main` · deployed URL on the README's first line with demo logins · `CLAUDE.md` ≤80 lines (discipline rules, banned terms, fact/inference labels; C #28) · `docs/AI_BUILD_LEDGER.md` per day: what Claude Code wrote, what was rejected, what was hand-written — the "not conceptually" answer to the JD · `docs/DECISIONS/ADR-001…008` (S1-or-S2; no Redis; no pgvector; Stripe Invoices as primitive; milestone billing; SMS confirm loop; read-only Ask; simulator boundaries) · `docs/ASSUMPTIONS.md` with FACT / HYP / ASSUMPTION / UNKNOWN labels lifted from A and B · `THIRD_PARTY_NOTICES.md` + `pnpm licenses` allowlist in CI (D §5) · no Solo logo, spade, cards or photos; no real horse or person names · synthetic-data banner on every page · `.env.example` complete · `pnpm verify` runs locally (PGlite lane in S1; Supabase CLI in S2) · Sentry screenshot and the eval table in the README · three-minute walkthrough video link.

---

## 4. The honesty layer

**(a) README — "What this is / is not"** (117 words)

> This is an unsolicited prototype built by one job candidate from Solo Select's public website, podcast transcripts and job postings. It is not affiliated with, endorsed by, or connected to Solo Select Horses LLC or any related company. Every horse, person, contract, phone number and dollar figure is synthetic. Stripe runs in test mode; Twilio uses test credentials; the ICSI lab, the auction platform and e-signature are simulated adapters. No Solo Select portal, login, admin page or customer data was accessed. The workflows are my reading of public material, labeled FACT / HYPOTHESIS / ASSUMPTION in docs/ASSUMPTIONS.md. I expect many assumptions to be wrong; the build exists to be corrected by the people who do the work.

**(b) In-app banner** (one line, every page)

> Unofficial candidate prototype · not Solo Select software · all data synthetic · Stripe test mode · built from public sources only · [assumptions]

**(c) Cover email paragraph** (119 words; brackets must be replaced with the truth, including "none")

> You said two things are firm, so I answer them first. Equine experience: [the truth — e.g. "none hands-on; I built your breeding calendar, cutoffs and fee milestones into the prototype from the podcast, but have never set up a recip mare"]. North Texas: [the truth — e.g. "I am in <city> and would relocate to Gainesville within 30 days of an offer; I can spend a self-funded week on site first"]. If either disqualifies me, I understand. The prototype at <URL> uses only your public site, podcasts and job posts; I never touched the portal or customer data. About half my operational assumptions are probably wrong; they are in one file your team can correct in an afternoon.

---

## 5. Open questions Pavan must answer before code

| # | Question | Default if unanswered |
|---|---|---|
| 1 | Paste the "Senior Full Stack / AI-First" JD you hold — where did it come from (email, PDF, recruiter)? | S2: build to the public LinkedIn / Facebook posting; QBO, NestJS, Redis out |
| 2 | What hands-on equine experience do you actually have (barn, breeding, vet, farm), if any? | None; say so in the first paragraph and lead with the domain study |
| 3 | Where are you, and will you relocate to or commute to Gainesville, TX — by when? | "Relocate within 30 days of an offer; a self-funded on-site week before that" |
| 4 | Did mel@ / careers@ reply that the role is open? | Send the four-line check on day 0; build anyway, capped at 10 days; send as a contribution if closed |
| 5 | Budget and accounts: Anthropic spend cap, Twilio trial number, Stripe test account, Netlify / Vercel free tier, Sentry free tier? | $30 API cap; free tiers everywhere; simulator for anything that needs a paid plan |
| 6 | How many working days, and are they full days? | 10 full days; fewer → the day-5 cut line ships |
