# C — Existing Work Audit / Reuse Plan (SPADE OPS)

Research agent C. Read-only audit of 22 repos on the Desktop, 2026-09-16.
Rule: do not rebuild what Pavan already owns. Second rule: do not make Spade Ops
a re-skin of something else.

Base path: `C:\Users\Pavan Kalyan\OneDrive\Documents\Desktop\` (abbreviated `D:\` below).
All repos push to `github.com/ghantapavan93/*` (personal account). Ownership risk
is therefore about *content* (brand names, real people, client marketing sites,
take-home assignments), not repo ownership.

---

## 0. Headline findings

**What exists and is genuinely reusable (TypeScript, tested, MIT):**

1. `The Utility Connect` (Move Relay) is the single most valuable source. Next 16
   + React 19 + TS strict + `noUncheckedIndexedAccess`, Tailwind 4, Zod, pg,
   PGlite, R3F, Framer Motion, Vitest (68 files, 11,879 test LOC) + Playwright
   (10 specs), GitHub Actions with a real Postgres 16 service, MIT (c) Pavan.
   It already contains: append-only audit with DB triggers, transactional
   outbox + dead letters, persistent idempotency keys, durable workflow rows,
   Zanzibar-style authz tuples, a three-tier agent tool registry
   (`read_only` / `requires_approval` / `forbidden`), agent runs/steps tables,
   an AI gateway with versioned prompts + PII masking + grounding + fallback,
   an agent eval harness, a read-only MCP bridge, 12 ADRs, an AI Build Ledger.
2. `Ditto Kinetic` has the best motion/3D infrastructure: `useSyncExternalStore`
   media-query hooks, a shared DOM/WebGL motion vocabulary (`damp`, `spring`,
   `smoothstep`), a `next/dynamic` SSR-off stage loader, cmdk palette, Radix +
   Framer `Sheet`, a WCAG contrast CI script.
3. `ShelfTrace Control Plane` and `Efficast` have the best *ops-console* React
   pieces: `AppShell`, `ConfirmDialog` (tested), `Toast` (tested), `Skeleton`,
   `AuditTimeline`, `StatusPill`, `NavRail`, cmdk `CommandPalette`, `useLive`.
4. Python repos (Dreamship, ShelfTrace, Efficast, Rokt, canopyops) carry
   *patterns* worth porting to TS — Agent Action Gateway pipeline, HMAC
   hash-chained audit + seal, `Money` minor-units type, AST architecture
   fitness test, idempotency decorator semantics — but no code is lift-able.

**What does NOT exist anywhere (must be built new):**

| Target-stack item | Evidence |
|---|---|
| Stripe webhook handler / Stripe server SDK | Only `Get Towed` (2024 Flask + CRA, `PaymentIntent.create`, CardElement, no webhooks). Unusable. |
| Intuit OAuth / QuickBooks Online | Zero hits across all `package.json` and source. |
| BullMQ / Redis queue in TS | Zero hits. Outbox in UC is Postgres-only, dispatcher invoked inline. Celery (Dreamship) and a Python worker loop (ShelfTrace) exist. |
| NestJS | Zero hits. All TS backends are Next.js route handlers or a GraphQL Yoga `.mjs` server (Farmers). |
| Auth.js / NextAuth | Zero hits. UC uses an `X-Actor` header stand-in (documented as such in `src/lib/actor.ts`). Efficast uses a localStorage role switcher. |
| Vercel AI SDK / `@ai-sdk/*` / `openai` / `@anthropic-ai/sdk` in TS | Zero hits. UC calls the Anthropic Messages API via raw `fetch` (`src/lib/ai-gateway.ts:92-125`) and Ollama (`:143-187`). portfolio uses LangChain JS. |
| pgvector / embeddings in TS | Zero hits. RAG exists only in Python (Episode Companion: ChromaDB; Farmers: `rag.mjs` in-memory). UC ADR-004 explicitly postponed RAG. |
| Prisma in a real Postgres app | Only `100 Miles of Summer`, and its runtime actually uses `better-sqlite3` + an in-memory mock (`src/lib/db.ts`); the Prisma schema is a mirror, not the data path. |
| Turborepo / pnpm workspaces | Zero hits (Ytech's `turbo` match is `next dev --turbopack`). Every repo is single-package npm. |
| `@tanstack/react-table` | Declared in NexusWatch only; the tables there are hand-rolled (`PremiumInvoiceTable.tsx`, 587 lines). |

So the reuse plan is: port *patterns and primitives* from UC / Ditto / ShelfTrace /
Efficast into a fresh Turborepo, and treat Stripe, QBO, BullMQ, NestJS, Auth.js,
AI SDK, pgvector and Prisma as greenfield.

---

## 1. Per-repo summary

| Repo | Stack | Quality signals | Ownership / content risk | Reuse verdict |
|---|---|---|---|---|
| The Utility Connect (Move Relay) | Next 16, React 19, TS strict + `noUncheckedIndexedAccess`, Tailwind 4, Zod 3, pg + PGlite, R3F/drei/postprocessing, Framer 12, vaul, sonner | 68 Vitest files vs real Postgres, 10 Playwright specs, CI with PG16 service + PGlite lane, `verify-constraints.mjs` schema checks, 12 ADRs, MIT (c) Pavan | Candidate prototype for Utility Connect LLC; brand tokens measured from utilityconnect.net; uses UC name and blue everywhere | **PRIMARY SOURCE.** Port backend patterns + test harness + docs discipline. Strip all UC branding/domain. |
| Dreamship (AirLock) | Django 5 + DRF + Celery + Redis; Vite/React 18 frontend (Zustand, react-query); `experience/` Next 16 + R3F + GSAP + Lenis | 31 pytest files, CI with Postgres+Redis services, immutable `AuditEvent` model | Independent prototype; honesty note in README | Patterns only (AuditEvent fields, idempotency decorator semantics, reconcile "diverge only when a rule touches it"). No code lift (Python). |
| 100 Miles of Summer | Next 16, Prisma 7 schema, better-sqlite3 runtime, shadcn (new-york), Framer, Vitest | 4 Vitest files; `strict: true`; `src/lib/db.ts` "Holographic DB" mocks prod; `any` types; `ops/page.tsx` 1,362 lines | Prototype for a nonprofit challenge (100 Miles of Summer) | **DO NOT REUSE data layer.** shadcn components are stock — regenerate via CLI. Concept of "two providers disagree" sync log is thin. |
| Ditto Kinetic (First Scene) | Next 16, React 19, TS strict, Tailwind 3, R3F 9, Framer 11, cmdk, Radix Dialog, Zustand, Zod | No unit tests; `npm run check` runs 5 drift/contrast guards; `strict: true` | "Unofficial interaction concept" for Ditto (dating app); emotional/cinematic tone | Port motion + 3D infra + palette/sheet primitives. Never port scenes, copy, or palette. |
| portfolio-main | Vite + React 19 **JSX** (no TS), GSAP + SplitText, LangChain/LangGraph, shadcn JSX | No tests, no strict, `HeroSection-backup2.jsx` etc. in tree | Personal brand content (name, resume, LinkedIn) | **DO NOT REUSE.** GSAP pin/scrub pattern is a reference only. |
| Design Room | Next 16 (JS-ish TS) + **Rails 7 GraphQL + ActionCable** | `page.tsx` 1,694 lines, `preview_canvas.tsx` 1,087 lines, `any[]`, `patch_*.rb` scripts in repo root, no TS tests | Unclear client (roofing/siding contractor imagery) | **DO NOT REUSE.** Concept (ledger + approve/reject suggestion + `STALE_VERSION` banner) is already better in UC. |
| ShelfTrace Control Plane | FastAPI + SQLAlchemy + Alembic; Next 14, React 18, Tailwind 3, Framer 11, Vitest | 55 pytest files ("410 PG tests"), 2 frontend component tests, `CLAUDE.md` discipline rules, OTel opt-in | "Independent prototype" inspired by BetterBasket | Port ops-console React components + CLAUDE.md rule style. Vision pages (1–2.7k-line monoliths) are off-limits. |
| UVM Work Console / canopyops | **Angular 18** + MapLibre + PWA; FastAPI + PostGIS | 21 pytest, 5 Jest specs, cypress-axe | Independent concept (Davey Tree) | Stack mismatch. Reference only: `core/circuit.py` breaker, "human-signed outcome" framing. |
| Efficast (Verified Recovery Agent) | FastAPI + SQLModel; Next 14, React 18, TS strict, react-query, cmdk, Radix, Framer, Vitest + Playwright | 57 pytest, 8 Vitest, 1 Playwright; `CLAUDE.md` frozen decisions; MIT; `THIRD_PARTY_NOTICES.md` | Independent, "Efficast-aligned"; synthetic data | Port shell (`NavRail`, `CommandPalette`, `RoleProvider`), `forge/primitives`; port **Gateway pipeline** concept to TS. |
| Ytech (Value Shift) | Next 15, React 19, TS strict, Tailwind 4, Framer 13, Vitest | 31 Vitest files, CI (types/lint/test/build), `count-invariants.mjs`, MIT (c) Pavan | Independent | Docs pattern (`DECISIONS.md` narrative style), `count-invariants` script, `CommandPalette.tsx`. Engines are AEC-domain — no. |
| Rokt (Threshold) | FastAPI + SQLAlchemy; Next 14, R3F 8 + drei 9 (old), GSAP, Lenis, matter-js | 23 pytest incl. `test_architecture.py` (AST purity), hash-chained audit, `design-system/MASTER.md` | Independent proof-of-work | Port `domain/audit.py` (HMAC chain + seal), `domain/money.py`, AST fitness test **as TS**. Design system is Rokt-flavoured — no. |
| NexusWatch MVP | Next 15, Supabase, Tailwind 3, recharts, tesseract, pdfjs | No tests; duplicate `Premium*Table` vs `*Table`; `HANDOFF.md` reads like a client handoff | Likely client work (handoff doc, Supabase project) | **DO NOT LIFT.** Supabase SQL migrations are domain-specific. |
| Farmers Insurance (ISL Performance Compiler) | Vite React 19 TS; **GraphQL Yoga `.mjs` server**, `node --test` | 4 node tests; plain JS server | Names a real person and his businesses in README | **DO NOT REUSE content.** `server/src/hashchain.mjs` (57 lines) is a clean chain — port to TS only after removing agency fields. |
| Dear D(IA)ry | Next 16, Framer, GSAP, Zustand | No tests | Independent prototype for a health-tech company | Cinematic/emotional. No. |
| Get Towed | CRA + Bootstrap + Flask + Stripe (2024) | Bootcamp-era | Personal | No. Legacy Stripe pattern (CardElement, no webhooks). |
| Censys Summarization Agent | FastAPI + Vite React 18 TS, Vitest, tsd | Root littered with `fix_*.py`, `test_*.py`, logs | Take-home for Censys | **DO NOT REUSE** (take-home + hygiene). |
| Episode Companion Agent | Python, ChromaDB, Gemini/OpenAI, FastAPI | Debug scripts at root | Personal | RAG reference only; no TS. |
| aec-research-os | Claude skills/agents + research state | n/a | Personal | `CLAUDE.md` "fact vs inference" rule style is worth mirroring. |
| The Light Guys / The Fridge Vending / SSC | Static HTML / Vite React JSX + GSAP / Next 16 marketing | No tests | **Real small-business client sites** | **DO NOT REUSE.** |
| fanflow-ai-complete | Next 14, leaflet, Vitest | Not inspected deeply | Likely take-home (Fan Flow) | No. |

---

## 2. Per-repo detail (only where it changes the plan)

### 2.1 The Utility Connect — `D:\The Utility Connect\`

Backend/data (all `src/lib/*.ts` unless noted):

| Asset | Path | LOC | Notes |
|---|---|---|---|
| Schema | `db/schema.sql` | 624 | `audit_events` (BIGSERIAL, no FKs by design, `RAISE EXCEPTION` triggers on UPDATE/DELETE, lines 288-341), `outbox_events` + `outbox_consumers` (PK consumer,event_id) + `dead_letter_events` (379-421), `idempotency_records` (229-238), `provider_submissions` w/ `operation_key` unique + `request_fingerprint` + `provider_request_key` (183-227), `workflow_executions`/`workflow_steps` (348-376), `auth_tuples` (426-435), `ai_runs` (grounded/fallback/metrics, 253-277), `agent_runs`/`agent_steps` with copied `authority` (528-591), `trace_spans` (482-521), bitemporal `field_versions` (95-136). |
| DB adapter | `db.ts` | 313 | pg Pool vs PGlite behind one `Queryable`; `transact` pins a connection; per-file `RELAY_PG_SCHEMA`. |
| Outbox | `outbox.ts` | 207 | claim + handle in one transaction; dead letter written outside; `replayDeadLetters`, `backlog`. No `FOR UPDATE SKIP LOCKED` (single dispatcher). |
| Audit | `audit.ts` | 100 | `recordAudit(client, …)` same-tx; nested-path redaction. |
| Idempotency | `provider-submission.ts` | 513 | canonical JSON fingerprint, `IdempotencyConflictError` on same key/different body, `unknown` state blocks blind retry, `reconcile()` only exit. |
| Durable workflow | `workflow.ts` | 223 | resumable/idempotent/signalled steps on Postgres. |
| Authz | `authz.ts`, `actor.ts` | 121, 182 | tuple graph walk returning granting path; header actor documented as a stand-in. |
| Contracts | `contracts.ts` | 137 | versioned Zod contracts per channel + quarantine. |
| CSV | `csv.ts` | 209 | dependency-free quoted CSV parser + row mapper. |
| AI gateway | `ai-gateway.ts` | 391 | versioned prompt registry, `maskPII`, structured JSON output, citation grounding drops uncited claims, deterministic fallback, Anthropic + Ollama adapters (raw fetch). |
| Agent | `agent/tools.ts`, `agent/case-agent.ts`, `agent/eval.ts`, `agent/narrative.ts` | 311, 526, 430, 609 | tool registry with three tiers, `invokeTool` checks authority before parsing args, deterministic plan, NDJSON streaming route (`src/app/api/v1/agent/runs/route.ts`, 124), 5-metric eval harness (`forbiddenBlockRate`, `falseAllClearRate`, `injectionInfluence`). |
| Observability | `observability.ts`, `tracing.ts` | 230, 180 | correlation/causation ids, PII scrub, spans persisted fire-and-forget with failure counter. |
| MCP bridge | `mcp/server.mjs` | 242 | stdio JSON-RPC, no SDK, advertises read-only tools only via HTTP to the app. |
| Test harness | `vitest.config.ts`, `src/lib/__tests__/setup-pg-schema.ts`, `scripts/verify-constraints.mjs` | 63, 112, 220 | `fileParallelism:false`, per-file PG schema, schema-guarantee checks that CI runs. |
| CI | `.github/workflows/ci.yml` | 104 | PGlite lane + Postgres 16 service lane. |
| Playwright | `playwright.config.ts`, `e2e/reduced-motion.spec.ts`, `e2e/mobile.spec.ts` | 52, 272, 284 | real `reducedMotion:"reduce"` context, asserts diagrams render *finished*. |
| Docs | `docs/DECISIONS/ADR-001…012`, `docs/AI_BUILD_LEDGER.md`, `docs/ARCHITECTURE.md`, `docs/DESIGN_SYSTEM.md` | 44-223 each, 386, 174, 194 | ADR-003 "AI cannot merge", ADR-010 "agent proposes never decides", ADR-011 "MCP read-only", ADR-005 "exactly one 3D scene, real state only". |

Frontend (`src/components`, `src/app`):

| Asset | Path | LOC | Notes |
|---|---|---|---|
| Motion tokens | `src/lib/motion.ts` | 61 | `EASE`/`SPRING`/`DUR`, 280 ms cap. Near-identical to ShelfTrace `frontend/lib/motion.ts` (111). |
| Stillness hook | `src/lib/use-stillness.ts` | 39 | OS pref OR in-page toggle (`data-a11y-still`). |
| Reveal | `src/components/Reveal.tsx` | 33 | one scroll-reveal primitive. |
| State badge | `src/components/StateBadge.tsx` | 50 | glyph + label + colour (never colour alone). |
| Sidebar | `src/components/AppSidebar.tsx` | 124 | hidden below `lg`, "live" vs "future" items. |
| Provenance drawer | `src/components/ProvenanceDrawer.tsx` | 161 | vaul drawer; failed ≠ empty. |
| Merge approval | `src/components/control-room/MergeApproval.tsx` | 345 | recommendation never preselected; reason required; 409 rendered as "stale", not error. |
| Table | `src/components/console/MovesTable.tsx` | 182 | DB-backed list, empty state honest. |
| 3D (restrained) | `src/components/Constellation3D.tsx` | 227 | WebGL probe fallback, `dpr [1,1.75]`, `frameloop="demand"` under reduced motion, no post-processing. **Not** lazy-loaded via `next/dynamic` (no `next/dynamic` anywhere in UC). |
| 3D (cinematic) | `src/components/living-home/LivingHome.tsx` (+`Furniture.tsx` 645, `HouseModel.tsx` 525) | 1,182 | scroll-directed house walk-through with N8AO/Bloom/DoF, GI bake. **Do not reuse.** |
| Tokens | `src/app/globals.css` | 286 | Tailwind 4 `@theme`, dark-first, `tabular-nums`, reduced-motion block. Colours are UC's measured brand (`#0087b5`). |
| Fonts | `src/app/layout.tsx` | 95 | Open Sans + Fraunces via `next/font` (UC's typeface — do not copy). |
| Decorative UI kit | `src/components/ui/*` (particle-canvas 325, cosmic-aurora, liquid-text, typewriter, marquee, tilt-card…) | ~1,900 | marketing effects. **Do not reuse.** |
| Third-party | `.claude/skills/impeccable/**` (Apache 2.0, v4.0.4) | large | vendored public skill, not Pavan's work. |

### 2.2 Ditto Kinetic — `D:\Ditto Kinetic\`

| Asset | Path | LOC | Notes |
|---|---|---|---|
| Motion vocabulary | `src/lib/motion.ts` | 84 | `SPRING`/`DUR`/`EASE` + `damp`, critically-damped `spring` (dt clamped), `smoothstep`, `seeded`. Shared by DOM and WebGL. |
| Media-query hooks | `src/components/shared/useReducedMotion.ts` | 44 | `useSyncExternalStore` — no double render, SSR snapshot; `useCoarsePointer`. |
| Stage loader | `src/components/stage/StageLoader.tsx` | 33 | `next/dynamic` `ssr:false` boundary with server-rendered `<noscript>` fallback preserved. |
| Command palette | `src/components/shared/CommandK.tsx` | 142 | cmdk, groups reused from the site menu so nav and palette cannot disagree; scores labels only. |
| Sheet | `src/components/shared/Sheet.tsx` | 92 | Radix Dialog + Framer with `forceMount` for exit animation. |
| Camera rig | `src/components/three/SpatialStage.tsx` | 354 | authored camera, spring pointer parallax, `suspended` prop to stop the render loop when hidden; eslint-disable rationale for R3F mutation. |
| Dev probe | `src/components/three/StageProbe.tsx` | 57 | publishes scene geometry to `window.__fsStage` for assertions. |
| CI guards | `scripts/check.mjs`, `scripts/contrast.mjs` | 60, 232 | run-all-report-all runner; WCAG AA contrast measured from tailwind config, fails on regression. |
| Tokens | `tailwind.config.ts` | ~200 | warm-night palette, 5 font families (Anton/Archivo/Caveat/Instrument Serif/JetBrains Mono), height breakpoint. **Palette/fonts not reusable.** |

### 2.3 ShelfTrace Control Plane — `D:\ShelfTrace Control Plane\frontend\`

| Asset | Path | LOC | Notes |
|---|---|---|---|
| Shell | `components/AppShell.tsx` | 373 | sidebar with `match` regex per item, mobile drawer, status pill polling, reset behind `ConfirmDialog`. |
| Confirm dialog | `components/ConfirmDialog.tsx` (+ `.test.tsx`) | 153 (+133) | focus confirm, Esc, busy state, tested. |
| Toast | `components/Toast.tsx` (+ `.test.tsx`) | 156 (+105) | context queue, sticky option, tested. |
| Skeleton | `components/Skeleton.tsx` | 152 | shimmer collapses under reduced motion. |
| Audit timeline | `components/AuditTimeline.tsx` | 56 | actor badge operator/automated/system. |
| Live fetch | `lib/useLive.ts` | 58 | epoch-guarded fetch-on-mount + reload. |
| Others | `StatusPill.tsx` 43, `MetricCard.tsx` 43, `ErrorBoundary.tsx` 125, `ModeProvider.tsx` 85 (demo/live mode) | | |
| Docs | `CLAUDE.md` (root) | ~200 | "Discipline rules (non-negotiable)", banned terms, anti-patterns, typography scale. |
| Backend patterns | `backend/app/services/dead_letter.py` 63, `worker.py` 35, `tests/conftest.py` 68 | | dead-letter webhook alert; sibling `_test` DB guard. |
| Off-limits | `components/vision/*` (KeynotePage 2,687; MissionControlPage 1,618; AislePage 1,499), `components/text/VaporizeTextCycle.tsx` 643 | | cinematic monoliths. |

### 2.4 Efficast — `D:\Efficast\`

| Asset | Path | LOC | Notes |
|---|---|---|---|
| Nav rail | `frontend/components/shell/nav-rail.tsx` | 77 | icon rail with badges from react-query hooks, `aria-current`. |
| Palette | `frontend/components/shell/command-palette.tsx` | 114 | cmdk with Navigate / Agent / Demo groups; footer states what is never available. |
| Role switch | `frontend/lib/role.tsx` | 55 | demo identities → API user header. (Replace with Auth.js.) |
| Primitives | `frontend/components/forge/primitives.tsx`, `badges.tsx`, `states.tsx`, `reveal.tsx` | 149, 120, 100, 48 | Button variants incl. `approval`; Radix Tooltip. |
| Tests | `frontend/tests/unit/*.test.tsx` (8), `tests/e2e/recovery.spec.ts`, `vitest.config.ts` | | RTL + jsdom pattern. |
| Gateway (pattern) | `backend/app/gateway/gateway.py` | 255 | schema → identity → scope → role → risk class → policy → human-approval → idempotency → breaker → audit → execute → validate → transition. Denials audited + security event. |
| Docs | `CLAUDE.md`, `THIRD_PARTY_NOTICES.md`, `docs/EFFICAST_EVIDENCE_LEDGER.md` | | "Frozen architectural decisions" + VERIFIED/OBSERVED/INFERRED tags. |

### 2.5 Rokt (Threshold) — `D:\Rokt\`

| Asset | Path | LOC | Notes |
|---|---|---|---|
| Hash-chained audit | `backend/app/domain/audit.py` | 148 | HMAC over (seq, type, payload, prev), genesis anchor, head **seal** detects truncation; threat model honest. |
| Money | `backend/app/domain/money.py` | 143 | integer minor units, ISO-4217 exponent, refuses unknown currency, no float. |
| Fitness test | `backend/tests/test_architecture.py` | 45 | AST scan: domain must not import LLM/HTTP/DB/web. |
| Outbox | `backend/app/outbox.py` | 91 | Python; pattern only. |

### 2.6 Ytech — `D:\Ytech\`

`DECISIONS.md` (narrative decision log with sources and recalibrations),
`scripts/count-invariants.mjs` (derives the test count into source so docs
cannot go stale), `components/CommandPalette.tsx` (256), CI `.github/workflows`.

### 2.7 Farmers Insurance — `D:\Farmers Insurance\server\src\`

`hashchain.mjs` (57) canonical-JSON chain; `hitl.mjs` (19) confidence tiers
(≥0.95 auto / 0.80–0.95 review / <0.80 escalate). Content names a real person —
strip entirely before any port.

---

## 3. REUSE PLAN

Legend — Ownership: **P** = Pavan, MIT, no third-party content · **P/B** = Pavan's code but carries another company's brand/domain · **X** = client / take-home / real-person content.

| # | Asset | Source path | Why reusable | What must change | Own. |
|---|---|---|---|---|---|
| 1 | Append-only audit table + immutability triggers | `D:\The Utility Connect\db\schema.sql:288-341`, `src\lib\audit.ts` | Exactly Spade's "every action attributable"; trigger-enforced, tested (`audit-immutable.test.ts`) | Express in Prisma (`AuditEvent` model + raw-SQL migration for triggers); rename `move_id` → polymorphic `subject_type/subject_id`; actor enum `human:` / `ai:` / `system:` keep | P/B |
| 2 | Transactional outbox + per-consumer claims + dead letters | `schema.sql:379-421`, `src\lib\outbox.ts` (207) | Proven at-least-once + exactly-once-per-consumer; replay path | Dispatcher becomes a BullMQ worker; add `FOR UPDATE SKIP LOCKED` for multi-worker; Prisma `$transaction` instead of `withTransaction` | P/B |
| 3 | Persistent idempotency (operation key + fingerprint + `unknown` state) | `schema.sql:183-238`, `src\lib\provider-submission.ts` (513) | Stripe/QBO calls need the same "timeout ≠ failure" discipline | Generalise from "provider enrolment" to `ExternalOperation` (stripe, qbo); reuse `fingerprint()` (lines 109-135) and `IdempotencyConflictError` | P/B |
| 4 | Agent tool registry (3 authority tiers) + `invokeTool` | `src\lib\agent\tools.ts` (311) | This *is* "Spade reads, proposes, requires approval"; authority checked before args parsed; refusals recorded | Replace tool bodies with Spade domain reads (mare, embryo, invoice); keep `forbidden` list explicit (e.g. `charge_card`, `post_journal_entry`, `mark_pregnancy_confirmed`) | P/B |
| 5 | `agent_runs` / `agent_steps` tables + NDJSON streaming route | `schema.sql:528-591`, `src\app\api\v1\agent\runs\route.ts` (124) | Persisted proposal / refusal / human decision; streaming after persistence | Move to NestJS controller + Prisma; keep `authority` copied at call time | P/B |
| 6 | AI gateway (prompt registry, PII mask, grounding, fallback, `ai_runs`) | `src\lib\ai-gateway.ts` (391), `schema.sql:253-277` | Guards are the product; fallback recorded not hidden | Swap raw fetch adapters for Vercel AI SDK `generateObject` + Zod schema; keep `maskPII`, citation-drop, `fallback` column | P/B |
| 7 | Agent eval harness (5 safety metrics, injection cases) | `src\lib\agent\eval.ts` (430), `__tests__\agent-eval.test.ts` | "Must be 1.0 / must be 0" metrics are the right bar for an approval-gated assistant | Re-seed with horse/contract cases; run in Vitest against Postgres | P/B |
| 8 | Durable workflow rows (resumable, idempotent steps, signals) | `schema.sql:348-376`, `src\lib\workflow.ts` (223) | Breeding cycle → recipient → vet → contract → payment spans days; needs park/resume | Keep as Postgres tables; drive step execution from BullMQ jobs; audit each step | P/B |
| 9 | Test harness: real Postgres per test file, PGlite lane, schema-guarantee script, dual-lane CI | `vitest.config.ts`, `src\lib\__tests__\setup-pg-schema.ts` (112), `scripts\verify-constraints.mjs` (220), `.github\workflows\ci.yml` (104) | Reviewer can `npm run verify` with no Docker; CI proves constraints | Adapt to Prisma migrations + Turborepo (`turbo run test`); add Redis service for BullMQ lane | P |
| 10 | ADR set + AI Build Ledger + DECISIONS narrative | `D:\The Utility Connect\docs\DECISIONS\*`, `docs\AI_BUILD_LEDGER.md`, `D:\Ytech\DECISIONS.md` | Format is strong: context/options/consequence + "enforced by" line | Rewrite content for Spade; keep ADR-003/010/011 *ideas* (AI cannot merge; proposes never decides; MCP read-only) with new numbering | P |
| 11 | Motion tokens + stillness hook + Reveal | `D:\The Utility Connect\src\lib\motion.ts` (61), `src\lib\use-stillness.ts` (39), `src\components\Reveal.tsx` (33); `D:\Ditto Kinetic\src\lib\motion.ts` (84), `src\components\shared\useReducedMotion.ts` (44) | 280 ms cap, spring-vs-ease rule, `useSyncExternalStore` hook | Merge into one `packages/ui/motion.ts`; keep Ditto's `damp/spring` for the 3D scene only | P |
| 12 | Restrained 3D scene scaffold | `D:\The Utility Connect\src\components\Constellation3D.tsx` (227) + `D:\Ditto Kinetic\src\components\stage\StageLoader.tsx` (33) + `SpatialStage.tsx` camera rig (354) + `StageProbe.tsx` (57) | WebGL probe fallback, dpr cap, `frameloop="demand"`, `next/dynamic` SSR-off boundary, `suspended` loop, dev geometry probe | Rebuild geometry as "ranch topology" (barns/pastures/lab nodes) bound to real state; drop `Html` labels for DOM overlay; no post-processing | P |
| 13 | Ops-console shell pieces | `D:\ShelfTrace Control Plane\frontend\components\AppShell.tsx` (373), `ConfirmDialog.tsx` (153+133 test), `Toast.tsx` (156+105 test), `Skeleton.tsx` (152), `AuditTimeline.tsx` (56), `StatusPill.tsx` (43), `lib\useLive.ts` (58); `D:\Efficast\frontend\components\shell\nav-rail.tsx` (77) | Tested, reduced-motion aware, ops-shaped | Rebase on shadcn/Radix (`AlertDialog`, `Sonner`) rather than hand-rolled; keep tests; recolour to Spade tokens | P/B |
| 14 | Command palette | `D:\Ditto Kinetic\src\components\shared\CommandK.tsx` (142), `D:\Efficast\frontend\components\shell\command-palette.tsx` (114) | cmdk wired to the same nav data as the sidebar; labels-only scoring | Use shadcn `Command`; groups: Navigate / Spade actions (all approval-gated) / Admin | P/B |
| 15 | Sheet / drawer with exit animation | `D:\Ditto Kinetic\src\components\shared\Sheet.tsx` (92), `D:\The Utility Connect\src\components\ProvenanceDrawer.tsx` (161) | Radix + Framer `forceMount`; vaul provenance drawer with failed≠empty | Use shadcn `Sheet`/`Drawer`; keep the "failed vs empty" state split | P/B |
| 16 | Approval control pattern | `D:\The Utility Connect\src\components\control-room\MergeApproval.tsx` (345) | Recommendation never preselected; reason required; 409 = stale, not error | Generalise to `ApprovalCard` for Spade proposals (`agent_runs.awaiting_approval`) | P/B |
| 17 | State badge (glyph + label + colour) | `D:\The Utility Connect\src\components\StateBadge.tsx` (50) | WCAG 1.4.1; tiny | New state vocabulary (open / cycling / bred / pregnant / invoiced / paid / synced) | P/B |
| 18 | Zod contract layer + quarantine | `D:\The Utility Connect\src\lib\contracts.ts` (137), `schema.sql:452-470` | Versioned per-source contracts; bad payloads quarantined with reasons | Sources become Stripe webhook events, QBO responses, lab CSVs | P/B |
| 19 | Dependency-free CSV parser | `D:\The Utility Connect\src\lib\csv.ts` (209) | Lab results / registry exports arrive as CSV | Drop UC row mapper; keep parser + `CsvRowError` | P |
| 20 | Observability + trace spans | `D:\The Utility Connect\src\lib\observability.ts` (230), `tracing.ts` (180), `schema.sql:482-521` | Correlation ids, PII scrub, spans in Postgres, failure counter | NestJS interceptor; consider real OTel exporter | P/B |
| 21 | Read-only MCP bridge | `D:\The Utility Connect\mcp\server.mjs` (242) | Same registry decides in-process and external authority | Port to TS in `apps/mcp`; point at NestJS API | P/B |
| 22 | Relationship authz (tuples) | `D:\The Utility Connect\src\lib\authz.ts` (121) | Owner → clinic → customer graph fits; returns granting path for audit | Spade needs simpler RBAC first (owner / office / vet / customer); keep tuples as ADR-deferred option | P/B |
| 23 | Hash-chained audit + seal (pattern) | `D:\Rokt\backend\app\domain\audit.py` (148), `D:\Farmers Insurance\server\src\hashchain.mjs` (57) | Tamper-evidence for a financial audit trail | Port to TS as an optional `content_hmac/prev_hmac` on `AuditEvent`; document threat model honestly | P / X(content) |
| 24 | `Money` minor-units type (pattern) | `D:\Rokt\backend\app\domain\money.py` (143) | Stripe + QBO both use integer minor units | Port to TS with `bigint` cents, USD-only for v1, refuse floats | P |
| 25 | Architecture fitness test (pattern) | `D:\Rokt\backend\tests\test_architecture.py` (45) | Enforce "domain layer imports no AI/HTTP/Stripe" | Rewrite as a Vitest test over `ts-morph` or `dependency-cruiser` config | P |
| 26 | Gateway pipeline stages (pattern) | `D:\Efficast\backend\app\gateway\gateway.py` (255) | schema→identity→scope→role→policy→approval→idempotency→breaker→audit→execute→validate | Implement as a NestJS `ActionGateway` service; all Spade side effects go through it | P |
| 27 | Contrast + run-all-checks CI scripts | `D:\Ditto Kinetic\scripts\contrast.mjs` (232), `scripts\check.mjs` (60); `D:\Ytech\scripts\count-invariants.mjs` | Design tokens measured, docs can't drift from test count | Point at Tailwind 4 `@theme` vars instead of `tailwind.config.ts` | P |
| 28 | CLAUDE.md discipline block | `D:\ShelfTrace Control Plane\CLAUDE.md`, `D:\Efficast\CLAUDE.md`, `D:\aec-research-os\CLAUDE.md` | "No fabricated numbers", "frozen decisions", "[fact] vs [inference]" | Write Spade's own; keep it under ~80 lines | P |
| 29 | Playwright reduced-motion + mobile specs | `D:\The Utility Connect\e2e\reduced-motion.spec.ts` (272), `e2e\mobile.spec.ts` (284), `playwright.config.ts` (52) | Real media query; "stillness collapses pacing, never content" | Re-target to Spade routes | P |
| 30 | Dead-letter alerting + sibling test DB (pattern) | `D:\ShelfTrace Control Plane\backend\app\services\dead_letter.py` (63), `backend\tests\conftest.py` (68) | Poison-message alert path; never test against the live DB | BullMQ `failed` event → structured log + optional webhook | P |

---

## 4. Gaps to build new (nothing to reuse)

- **Stripe**: webhook route with signature verification, event idempotency via
  asset #3, Checkout/PaymentIntent in test mode. Only prior art is `Get Towed`
  (legacy CardElement, no webhooks).
- **QuickBooks Online**: Intuit OAuth2 + token refresh + sandbox; invoice/
  customer sync with reconciliation. No prior art at all.
- **BullMQ + Redis**: queues, repeatable jobs, `failed` handling. Prior art is
  Postgres-only outbox (UC) and Python workers.
- **NestJS**: modules/guards/interceptors. All TS backends were Next route handlers.
- **Auth.js**: sessions + RBAC. Prior art is header/localStorage stand-ins.
- **Vercel AI SDK + Zod structured output**, **pgvector** retrieval: no TS prior art.
- **Prisma schema for Spade**: write from scratch; borrow only the table
  *shapes* from UC's SQL. Do not reuse 100 Miles' schema (domain-specific,
  runtime bypasses Prisma).
- **Turborepo/pnpm**: every existing repo is single-package npm.
- **Table component**: `@tanstack/react-table` + shadcn `DataTable`; nothing
  reusable exists (NexusWatch tables are hand-rolled state soup).

---

## 5. CRITIC — what must NOT be reused, and why

1. **UC's brand, tokens, fonts and copy.** `globals.css` `@theme` colours were
   *measured from utilityconnect.net* (`#0087b5`, `#1a2128`), fonts are Open
   Sans + Fraunces, sidebar reads `MOVE RELAY`, and every comment references
   "concierge", "move", "provider enrolment". Lifting any of it makes Spade
   Ops look like a re-skin of a prototype built for another employer — the
   exact impression a candidate repo must avoid. Port *mechanisms* (schema
   shapes, outbox, tool registry) and rename everything at the boundary.
2. **Every cinematic layer.** `LivingHome.tsx` (1,182 + 645 + 525 lines, GI
   bake, N8AO, DoF), UC `src/components/cinematic/*` (709 + 628 + 310),
   `src/components/ui/{particle-canvas,cosmic-aurora,liquid-text,…}`, ShelfTrace
   `components/vision/*` (KeynotePage 2,687 lines), Rokt `builder/keynote/*`,
   Dreamship `experience/*`, Dear D(IA)ry `TwilightScene.tsx`, portfolio
   `Preloader.jsx`/`IntroCinema.jsx`. An internal ops tool for a horse
   operation needs one restrained, state-bound 3D scene (ADR-005's own rule)
   and zero auroras, curtains, cursors-with-labels, or scroll-pinned keynotes.
3. **Client / real-person / take-home content.** `The Light Guys`, `The Fridge
   Vending`, `SSC` are real small-business sites; `Farmers Insurance` names a
   real individual and his companies in README/data; `NexusWatch MVP` has a
   client-style `HANDOFF.md` and a live Supabase project; `Censys` and likely
   `fanflow-ai-complete` are hiring take-homes. None of this belongs in a
   public candidate repo, even as "inspiration" commits.
4. **100 Miles of Summer's data layer.** `src/lib/db.ts` is a "Holographic
   Database Adapter" that serves in-memory mocks in production, typed `any`,
   with services doing raw `db.prepare()` against SQLite while a Prisma schema
   sits unused beside it. `ops/page.tsx` is 1,362 lines. Reusing it would
   import the anti-pattern Spade is supposed to demonstrate it avoids.
5. **Design Room and NexusWatch UI code.** 1,694-line `page.tsx`, 1,087-line
   canvas, `any[]` props, `patch_*.rb` scripts committed at the repo root
   (Design Room); duplicated `PremiumInvoiceTable` vs `InvoiceTable` with a
   dozen `useState` filters and no tests (NexusWatch). Low-quality generated
   code; the concepts (ledger, stale-version banner, review queue) are already
   done better in UC.
6. **Python code, even the good parts, as code.** Dreamship, ShelfTrace,
   Efficast, Rokt, canopyops backends are FastAPI/Django. Their *patterns*
   (gateway pipeline, hash-chain seal, Money, AST fitness test, dead-letter
   alert) should be re-implemented in TS with fresh tests — not transliterated
   line by line, which produces un-idiomatic Nest code and drags Python
   assumptions (sync sessions, `drop_all` per test) into the monorepo.
7. **Hand-rolled primitives where shadcn exists.** ShelfTrace/Efficast/UC each
   hand-roll Button, Tooltip, Dialog, Toast, Drawer. Spade's stack names
   shadcn/ui; copying three slightly different `Button`s in is churn. Take the
   *behaviour tests* (`ConfirmDialog.test.tsx`, `Toast.test.tsx`) and the
   reduced-motion handling, generate the components with the shadcn CLI.
8. **Stand-in auth.** UC's `X-Actor` header (`src/lib/actor.ts`) and
   Efficast's localStorage `RoleProvider` are honest demo shims and are
   documented as such. Carrying either into Spade would contradict a stack that
   specifies Auth.js and would be the first thing a reviewer flags.
9. **UC's deterministic "agent" as-is.** `case-agent.ts` is control flow with
   no model in the plan — correct for UC's retry-safety thesis, but Spade's
   brief is a model that *reads and proposes*. Keep the authority registry,
   the persisted refusals and the eval metrics; replace the hard-coded plan
   with AI-SDK tool calling whose *only* side-effect path is `requires_approval`.
10. **Vendored third-party skill.** `.claude/skills/impeccable/**` in UC (and a
    duplicate under `.github/skills/`) is an Apache-2.0 public skill, not
    Pavan's work. Do not copy it into the Spade repo as if it were project code.
11. **Ditto's palette and voice.** Warm-night ink/paper, acid pink, five
    display fonts, lowercase "cut to:" copy — an evening-date aesthetic. Port
    `motion.ts`, the hooks and the loader; leave `tailwind.config.ts` colours,
    `SiteMenu` copy and sound (`sound.ts`) behind.
12. **Single-dispatcher outbox assumptions.** `outbox.ts` selects pending rows
    without `FOR UPDATE SKIP LOCKED` and is invoked inline; correct for one
    process, wrong once BullMQ runs concurrent workers. Reuse the table design,
    rewrite the claim loop.

---

## 6. Suggested porting order

1. Monorepo skeleton (Turborepo, pnpm, NestJS, Prisma) — greenfield.
2. Port schema shapes #1, #2, #3, #5, #8, #20 into Prisma + raw-SQL migrations
   for triggers/partial indexes; port `verify-constraints.mjs` idea (#9).
3. Port test harness + CI (#9, #29) before any feature code.
4. Port tool registry + gateway (#4, #26), then AI gateway on AI SDK (#6), eval (#7).
5. UI kit: shadcn base + motion tokens (#11) + shell/palette/sheet/badge
   (#13–#17) recoloured to Spade tokens.
6. One 3D "ranch topology" scene from #12, last, behind `next/dynamic`.
7. Docs: ADRs + Build Ledger + CLAUDE.md (#10, #28) written fresh, referencing
   the mechanisms above.
