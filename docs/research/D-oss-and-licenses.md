# D — Open-source dependencies, versions, licenses, architecture references

Research agent D. Date: 2026-09-16. Every version below was read live from the npm registry (`npm view`) and every license from the package manifest or the repo LICENSE file on this date. Breaking-change notes come from vendor upgrade guides fetched today. Scope: SPADE OPS prototype (horse lifecycle + Stripe + QuickBooks + approval-gated AI assistant).

## 0. Environment gaps — fix before `pnpm install`

| Item | Local | Required | Action |
|---|---|---|---|
| Node | 22.14.0 | `ai@7` >=22; `vitest@5` ^22.12; `promptfoo` >=22.22; `prisma@8-rc` >=22.18 | Install Node **24.21.0** (active LTS "Krypton"). Minimum acceptable: 22.23.2. |
| pnpm | none | pnpm 12 | `corepack enable && corepack prepare pnpm@12.4.2 --activate` |
| Docker | 29 | Postgres 16/17 only (no Redis needed, see §2.7) | `postgres:17-alpine` |
| TypeScript | — | see §2.3 | Pin **6.0.3**, not `latest` (7.0.2) |

## 1. Version + license table (verified 2026-09-16)

Legend: verdict = **use** / **study** / **skip**. "Peer" = React/Node peer requirement that matters for us.

| Package | Latest | License | Peer / engine | Breaking in last 12 mo | Verdict |
|---|---|---|---|---|---|
| next | 16.3.5 (16.0: 2025-10-22) | MIT | node >=20.9; react ^18.2 \|\| ^19 | §2.1 | **use** |
| react / react-dom | 19.3.0 (2026-09-09) | MIT | — | R3F caps `<19.3` | **use 19.2.8** (pin) |
| typescript | 7.0.2 (Go compiler, 2026-07-08) | Apache-2.0 | — | no JS compiler API until 7.1; ts-eslint `<6.1`; `@nestjs/cli` pins `~6.0.2` | **use 6.0.3** |
| tailwindcss | 4.3.3 | MIT | — | v4 CSS-first (`@import "tailwindcss"`, `@theme`), `@tailwindcss/postcss` 4.3.3 | **use** |
| shadcn (CLI) | 4.21.0 | MIT | node >=20.18.1 | CLI v4 (Mar 2026): presets, `--base`; **Base UI default since Jul 2026**; `cn` moved to package (Sep 2026) | **use** |
| radix-ui (unified) | 1.6.7 | MIT | react ^16.8–^19 | — | use only if `-b radix` |
| @base-ui/react | 1.8.0 | MIT | react 19 | shadcn default primitives | **use** |
| motion (= framer-motion) | 13.4.0 (13.0: 2026-08-05) | MIT | react ^18 \|\| ^19 | v13 drops `@emotion/is-prop-valid` auto-inject; otherwise additive | **use** |
| gsap | 3.15.0 | **"Standard no-charge" (proprietary, not OSI)** | — | free for commercial use since Webflow; forbids use in no-code animation tools competing with Webflow | **skip** (pick one; motion) |
| @react-three/fiber | 9.7.0 | MIT | react >=19 **<19.3**; three >=0.156 | v9 = React 19 only; scheduler 0.27 vs React 19.3's 0.28 | **study/optional** |
| @react-three/drei | 10.7.8 | MIT | react ^19; fiber ^9; three >=0.159 | v10 = R3F 9 only | optional |
| three | 0.186.0 | MIT | ESM (`"type":"module"`) | monthly minors; pin exact | optional |
| gltfjsx | 6.5.3 (last publish 2024-11-04) | MIT | node >=16 | dev-time CLI, stale but works | dev tool only |
| @nestjs/core, common | 12.0.3 (12.0: 2026-08-27) | MIT | node >=20 | ESM packages; CLI rewritten; TS `~6.0.2`; Vitest/oxlint/Rspack defaults | **skip in V1** (§6.1) |
| prisma / @prisma/client | **7.10.0** (`latest` tag mis-points to 8.0.0-rc.15 — prisma/orm#30322) | Apache-2.0 | node ^20.19 \|\| ^22.12 \|\| >=24 | §2.4 | **use 7.10.0 exact** |
| @prisma/adapter-pg | 7.10.0 | Apache-2.0 | pg | mandatory in v7 | **use** |
| pgvector (npm) | 0.3.0 | MIT | node >=22 | Prisma 7 migrate drift bug with `Unsupported("vector")` (prisma#28867, open) | **skip in V1** |
| bullmq | 6.3.6 (6.0: 2026-07-30) | MIT | pg / ioredis optional peers | v6: backend abstraction; **PostgreSQL backend** (`createPostgresBackend`); ioredis no longer bundled | **use (pg backend)** |
| ioredis | 6.0.0 | MIT | node >=20 | v6 major | **skip** |
| next-auth | 4.24.15 stable; 5.0.0-beta.32 (2026-07-20) | ISC | — | v5 still beta after 3 yrs; Auth.js in maintenance mode under Better Auth (Sep 2025) | **skip** |
| better-auth | 1.7.5 (1.7: 2026-08-18) | MIT | next ^14–^16; prisma ^5–^7 | Vercel acquired Better Auth 2026-07-07; stays MIT | **use** |
| ai (Vercel AI SDK) | **7.0.105** (7.0: 2026-06-25) | Apache-2.0 | node >=22; **ESM-only**; zod ^3.25.76 \|\| ^4.1.8 | §2.2 | **use** |
| @ai-sdk/anthropic | 4.0.56 | Apache-2.0 | node >=22 | tracks ai@7 | **use** |
| @ai-sdk/openai | 4.0.69 | Apache-2.0 | node >=22 | tracks ai@7 | optional |
| @ai-sdk/react | 4.0.108 | Apache-2.0 | react ^18 \|\| ^19.2.1 | `addToolApprovalResponse` | **use** |
| zod | 4.6.5 | MIT | TS strict required | v4 (2025-07): `z.email()`, unified `error`, `z.strictObject`, `z.toJSONSchema()` | **use** |
| promptfoo | 0.123.0 | MIT | **node >=22.22** | config `promptfooconfig.yaml` | **study** (Vitest evals first, §6.6) |
| langfuse | 3.39.2 | MIT | — | **deprecated on npm**; new SDK `@langfuse/tracing` + `@langfuse/otel` 5.11.1 | skip V1 |
| @sentry/nextjs | 10.75.0; 11.0.0-rc.0 (2026-09-16) | MIT | next ^16 | v10 (2025-07) | skip V1 |
| stripe | 22.6.2 (22.0: 2026-04-03) | MIT | node >=18 | pinned API `2026-08-26.dahlia`; `EventNotificationHandler` for thin events; empty webhook secret now throws | **use** |
| intuit-oauth | 4.2.5 | Apache-2.0 | node >=10 | — | **use** |
| node-quickbooks | 2.0.50 | ISC (package.json; **no LICENSE file in repo**) | — | sporadic (last commit 2026-03-29; 42 open issues) | **skip** (raw REST) |
| vitest | 5.0.1 (5.0: 2026-09-03) | MIT | node ^22.12 \|\| ^24; vite ^6.4–^8 | `clearMocks` default on; un-awaited async assertions fail; no ancestor config lookup | **use** |
| @playwright/test | 1.63.0 | Apache-2.0 | node >=20 | — | **use** (smoke) |
| turbo | 2.10.13 | MIT | — | — | optional (§6.8) |
| pnpm | 12.4.2 (12.0: 2026-08-26) | MIT | node >=18 | — | **use** |
| cmdk | 1.1.1 | MIT | react ^18 \|\| ^19 | — | **use** |
| lucide-react | 1.46.0 | ISC | react ^16.5–^19 | 1.x | **use** |
| date-fns / dayjs | 4.4.0 / 1.11.23 | MIT / MIT | — | — | **use date-fns** |
| @tanstack/react-query | 5.103.1 | MIT | react ^18 \|\| ^19 | — | **use** |
| @tanstack/react-table | 9.2.4 (9.0: 2026-08-04) | MIT | node >=20 | v9: `useTable`, feature slots, readonly data; **shadcn data-table examples still v8** | **use 8.21.3** |
| recharts / @visx/visx | 3.10.1 / 4.0.0 | MIT / MIT | react ^16.8–^19 | shadcn charts wrap recharts 3 | **use recharts** |
| sonner | 2.0.8 | MIT | react ^18 \|\| ^19 | — | **use** |
| vaul | 1.1.2 (last publish 2024-12) | MIT | react ^16.8–^19 | depends on Radix Dialog | optional |
| eslint | 10.10.0 (10.0: 2026-02-06) | MIT | node ^20.19 \|\| ^22.13 | eslintrc removed; flat config only; config resolved per linted file | **use** |
| typescript-eslint | 8.70.0 | MIT | eslint ^8.57–^10; **typescript <6.1** | — | **use** |
| eslint-config-next | 16.3.5 | MIT | eslint >=9 | flat config default | **use** |
| tsx | 4.23.13 | MIT | node >=18 | no decorator metadata emit (irrelevant without Nest) | **use** |
| class-variance-authority | 0.7.1 | Apache-2.0 | — | — | **use** |
| tailwind-merge | 3.7.0 | MIT | — | — | **use** |
| drizzle-orm (alt) | 0.45.2 | Apache-2.0 | — | — | alternative (§6.9) |
| @copilotkit/react-core | 1.72.0 | MIT | react ^18 \|\| ^19; zod >=3.25 | — | **skip** (§4.4) |
| @assistant-ui/react | 0.15.20 (pre-1.0) | MIT | react ^18 \|\| ^19 | — | skip V1 |
| @langchain/langgraph | 1.4.15 | MIT | zod ^3.25 \|\| ^4.2 | — | skip V1 |

## 2. Breaking changes that change how we write code

### 2.1 Next.js 16 (16.0 Oct 2025 → 16.3 Aug 2026)
- `cookies()`, `headers()`, `draftMode()`, `params`, `searchParams` are **async only**; use `PageProps<'/route'>` helpers from `next typegen`.
- Turbopack default for dev+build; a `webpack` key in `next.config` **fails** the build (`--webpack` to opt out).
- `middleware.ts` → **`proxy.ts`**, export `proxy()`; runtime is Node only (no edge).
- `next lint` removed; run ESLint yourself. `eslint` key in config removed.
- `revalidateTag(tag, 'max')` requires the second arg; `updateTag()` for read-your-writes; `cacheLife`/`cacheTag` stable; PPR now `cacheComponents: true` (opt-in).
- Parallel route slots need `default.tsx`. `images.qualities` defaults to `[75]`, `minimumCacheTTL` 4h, `images.domains` deprecated.
- `next build` type-checks by invoking the local `tsc` CLI (16.3), so TS 6 or 7 both work.
- Codemod: `pnpm dlx @next/codemod@canary upgrade latest`.

### 2.2 Vercel AI SDK 7 (ai@7.0.x, June 2026) — the API we will write against
- **ESM-only, Node >= 22.** `"type": "module"` in every package.
- Structured output: `generateObject`/`streamObject` are deprecated since v6. Write
  `const { output } = await generateText({ model, output: Output.object({ schema }), prompt })`; streaming uses `partialOutputStream`.
- Tools: `tool({ description, inputSchema: z.object({...}), execute })`; name comes from the object key. Optional `contextSchema` + `toolsContext` per tool; `runtimeContext` for shared data.
- **Human-in-the-loop is built in:** `toolApproval: { issueRefund: 'user-approval', createInvoice: async ({ amount }, { runtimeContext }) => amount > 1000 ? 'user-approval' : undefined }` on `generateText`/`streamText`/`ToolLoopAgent`. Client: `useChat({ sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses })` and `addToolApprovalResponse({ id: part.approval.id, approved })` when `part.state === 'approval-requested'`. Server-only resumption: push `{ role: 'tool', content: [{ type: 'tool-approval-response', approvalId, approved, reason }] }` and call again. Sign approvals with `experimental_toolApprovalSecret` (fail-closed). `needsApproval` (v6) is deprecated.
- Renames: `system` → `instructions` (system messages inside `messages` are rejected unless `allowSystemInMessages: true`); `onFinish` → `onEnd`; `onStepFinish` → `onStepEnd`; `fullStream` → `stream`; `stepCountIs` → `isStepCount`; `Experimental_Agent` → `ToolLoopAgent` (default stop `isStepCount(20)`); `convertToModelMessages` is async.
- Results: `usage` is now the multi-step total (`finalStep.usage` for last step); `result.finalStep.{reasoning,response,request}`; `usage.inputTokenDetails.cacheReadTokens`.
- Telemetry moved to `@ai-sdk/otel` (`registerTelemetry(new OpenTelemetry())`); enabled by default once registered.
- Codemod: `npx @ai-sdk/codemod v7`.

### 2.3 TypeScript 7 (Go compiler) — why we pin 6.0.3
- `typescript@latest` = 7.0.2, a native binary with **no programmatic API until 7.1**. typescript-eslint (`<6.1.0`), `@nestjs/cli` (`~6.0.2`), ts-jest, ts-morph all break. Microsoft ships `@typescript/typescript6` (6.0.2) as a shim.
- 7.0 also turns 6.0 deprecations into hard errors (`strict` and `esnext` defaults). Pin `typescript@6.0.3`, optionally run `npx -p typescript@7.0.2 tsc --noEmit` for a fast check in CI. Decorator metadata still works in 7 if we ever need it.

### 2.4 Prisma 7.10 (and why not 8-rc)
- Rust engine gone; **driver adapter mandatory**: `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`.
- Generator is `prisma-client` with a required `output` (not in `node_modules`); import from the generated path.
- `prisma.config.ts` holds migrate URLs; `.env` is **not auto-loaded** (use `dotenv` or `import 'dotenv/config'`). ESM. `$use` middleware removed (`$extends`).
- pgvector: `Unsupported("vector")` + raw SQL; open migrate drift regression in 7.x.
- Prisma 8 ("Prisma Next", GA expected Oct 2026) renames `.take/.skip` → `.limit/.offset`, returns Temporal/text for date columns, new config envelope. Do not build on the RC.

### 2.5 Tailwind 4.3 + shadcn 4.x
- No `tailwind.config.js`; tokens live in CSS: `@import "tailwindcss"; @theme { --color-brand: ...; }`. Next.js: `@tailwindcss/postcss` in `postcss.config.mjs`.
- `pnpx shadcn@4.21.0 init` defaults to **Base UI** (`@base-ui/react`); use `-b radix` to keep Radix. Blocks/components ship for both. Components now import `cn` from a package (Sep 2026), so old copied `lib/utils.ts` snippets differ.

### 2.6 Zod 4
- Top-level formats `z.email()`, `z.uuid()`, `z.url()`; `{ error: '...' }` replaces `message`/`required_error`; `z.strictObject()`; `z.toJSONSchema(schema)` built in (useful for tool docs). Requires `strict: true` tsconfig.

### 2.7 BullMQ 6 — Postgres backend removes Redis
- `import { Queue, Worker, createPostgresBackend } from 'bullmq'`; `new Queue('sync', { connection: DATABASE_URL }, createPostgresBackend)`; same API for delayed, repeatable, flows, rate limits, priorities, QueueEvents. Requires `pg` and Postgres >= 13 (14+ recommended). ioredis is an optional peer now.

### 2.8 Smaller items
- **React 19.2.8 pin**: `@react-three/fiber@9.7.0` peer is `>=19 <19.3` (scheduler mismatch); do not `--legacy-peer-deps`. Drop the pin once fiber widens the range.
- **ESLint 10**: `eslint.config.mjs` only; `typescript-eslint@8.70.0`; `eslint-config-next@16.3.5` flat preset.
- **Vitest 5**: mocks are cleared before each test; add `clearMocks: false` only if tests depended on leakage; always `await expect(...).resolves`.
- **Stripe 22.6.2**: `new Stripe(key)` pins `2026-08-26.dahlia`; set the same version on the webhook endpoint; `stripe.webhooks.constructEvent(rawBody, sig, secret)` — secret must be non-empty; consider `EventNotificationHandler` only if you adopt thin events (not needed).
- **@tanstack/react-table**: pin `8.21.3` so shadcn `data-table` docs match; v9 later via `useTable`.
- **Langfuse**: the `langfuse` package is deprecated; the v5 SDK is OpenTelemetry-based and pairs with `@ai-sdk/otel`.

## 3. Recommended dependency list (exact pins, one Next.js app + one worker)

```jsonc
// package.json (root, pnpm workspace: apps/web, apps/worker, packages/db, packages/ai)
{ "packageManager": "pnpm@12.4.2", "engines": { "node": ">=22.23 <27" } }

// apps/web — runtime
"next": "16.3.5", "react": "19.2.8", "react-dom": "19.2.8",
"ai": "7.0.105", "@ai-sdk/anthropic": "4.0.56", "@ai-sdk/react": "4.0.108", "zod": "4.6.5",
"better-auth": "1.7.5",
"@prisma/client": "7.10.0", "@prisma/adapter-pg": "7.10.0", "pg": "8.23.0",
"stripe": "22.6.2", "intuit-oauth": "4.2.5",
"@tanstack/react-query": "5.103.1", "@tanstack/react-table": "8.21.3",
"@base-ui/react": "1.8.0", "class-variance-authority": "0.7.1", "tailwind-merge": "3.7.0", "clsx": "latest-2.x",
"lucide-react": "1.46.0", "cmdk": "1.1.1", "sonner": "2.0.8", "motion": "13.4.0",
"recharts": "3.10.1", "date-fns": "4.4.0"
// apps/web — dev
"typescript": "6.0.3", "@types/react": "19.2.18", "@types/react-dom": "19.2.7", "@types/pg": "8.23.1", "@types/node": "24.x",
"tailwindcss": "4.3.3", "@tailwindcss/postcss": "4.3.3", "shadcn": "4.21.0",
"eslint": "10.10.0", "typescript-eslint": "8.70.0", "eslint-config-next": "16.3.5", "@eslint/js": "10.0.1", "prettier": "3.9.7",
"vitest": "5.0.1", "@vitest/coverage-v8": "5.0.1", "@testing-library/react": "16.3.3", "@playwright/test": "1.63.0", "tsx": "4.23.13",
"prisma": "7.10.0"  // CLI — never `latest` (resolves to 8.0.0-rc.15 today)

// apps/worker — runtime
"bullmq": "6.3.6", "pg": "8.23.0", "@prisma/client": "7.10.0", "@prisma/adapter-pg": "7.10.0", "ai": "7.0.105", "@ai-sdk/anthropic": "4.0.56", "zod": "4.6.5"

// optional, only if the landing page keeps a 3D hero (loads via next/dynamic, ssr:false)
"three": "0.186.0", "@react-three/fiber": "9.7.0", "@react-three/drei": "10.7.8", "gltfjsx": "6.5.3" (dev)

// deferred (not V1): "turbo": "2.10.13", "@sentry/nextjs": "10.75.0", "promptfoo": "0.123.0",
// "@langfuse/tracing"+"@langfuse/otel": "5.11.1", "@ai-sdk/otel": "1.0.105", "@ai-sdk/openai": "4.0.69"
```

Renovate/Dependabot: pin exact (`save-exact=true` in `.npmrc`), weekly grouped PRs, block majors for `prisma`, `react`, `typescript`.

## 4. Architecture references — study, do not clone

### 4.1 twentyhq/twenty — license: AGPL-3.0 core with two carve-outs
- `LICENSE` (root): AGPLv3 for the repo **except** (1) files marked `/* @license Enterprise */` → commercial license; (2) MIT packages: `twenty-sdk`, `twenty-client-sdk`, `create-twenty-app`, `twenty-shared`, `twenty-ui`, and everything under `packages/twenty-apps`. Plus an AGPL §7 "Twenty Application Exception" so apps built on its APIs are not infected. `packages/twenty-server` is **AGPL** — study only.
- Patterns worth mirroring (NestJS 12 app; paths under `packages/twenty-server/src/`):
  1. **Two-tier module layout**: `engine/core-modules/*` (auth, billing, message-queue, event-logs, tool, tool-provider, workflow) vs `modules/*` (domain: company, opportunity, timeline, workflow) registered in `modules/modules.module.ts`. We mirror this as `packages/core` (auth, queue, audit, ai-tools) vs `packages/domain` (horses, sales, invoices, sync).
  2. **Queue abstraction with swappable drivers**: `engine/core-modules/message-queue/decorators/{processor,process}.decorator.ts` (`@Processor(MessageQueue.x)` on a class, `@Process(JobClass.name)` on the handler), drivers `drivers/bullmq.driver.ts` and `drivers/sync.driver.ts` (in-process driver for tests). Copy the *idea*: `defineJob({ name, schema, handler })` with a `sync` driver in Vitest.
  3. **Audit/timeline from events**: `modules/timeline/jobs/upsert-timeline-activity-from-internal-event.job.ts` consumes a `WorkspaceEventBatch` from the `entityEventsToDbQueue` and upserts `timeline-activity.workspace-entity.ts`; `engine/core-modules/event-logs/` (ingest, registry, live resolver). Our `ActivityLog` table + a single queue job that writes it.
  4. AI tooling: `engine/core-modules/tool/` and `tool-provider/` (tools registered per provider with `output-transforms/`) and `engine/metadata-modules/ai/` — a registry of typed tools separate from the agent loop.

### 4.2 midday-ai/midday — license: AGPL-3.0 + commercial clause
- `LICENSE` = AGPLv3 (Midday Labs AB). `README.md` §License: "AGPL-3.0 for non-commercial use. For commercial use or deployments requiring a setup fee, contact engineer@midday.ai." Treat as **study only**; last push 2026-06-13 (development has slowed publicly).
- UX patterns (paths under `apps/dashboard/src/components/`):
  1. **Suggested match card with confirm/decline** — `suggested-match.tsx`, `inbox/match-transaction.tsx`, `inbox/transaction-match-item.tsx`, `inbox/transaction-unmatch-item.tsx`: the AI proposes a receipt→transaction match with confidence; two mutations `inbox.confirmMatch` / `inbox.declineMatch`; query invalidation on success; a one-time "we learn from this" toast. Exactly our "Stripe payout ↔ QuickBooks invoice" reconciliation card.
  2. **Tool calls grouped in chat + cache invalidation after AI actions** — `chat/tool-call-group.tsx`, `chat/chat-invalidation.ts`, `chat/sources-list.tsx`, `chat/thinking-indicator.tsx`: collapsed tool-call group per assistant turn; after a tool mutates data the client invalidates the affected TanStack queries.
  3. **Inline single-field assistant** — `tax-rate-assistant.tsx`: a tiny AI helper attached to one form field (suggests a value, user accepts). Reuse for "suggest sale price / suggest QBO item".
  - Job layout: `packages/jobs/src/tasks/{bank,inbox,invoice,transactions,notifications}` + `apps/worker` — one task file per domain event.

### 4.3 dubinc/dub — license: AGPL-3.0 with EE directories
- `LICENSE.md`: AGPLv3 except `apps/web/app/(ee)` and `apps/web/app/app.dub.co/(dashboard)/[slug]/(ee)` (commercial `ee/LICENSE.md`). Note the Stripe webhook lives **inside** `(ee)` → commercial; study only.
- Repo-organization patterns:
  1. **Turborepo layout**: `apps/web` (single Next app) + `packages/{ui,utils,email,tailwind-config,tsconfig,stripe-app,cli}`; `turbo.json`, `pnpm-workspace.yaml` at root. Our shape: `apps/web`, `apps/worker`, `packages/{db,ai,ui,config}`.
  2. **Prisma multi-file schema**: `apps/web/prisma/schema/*.prisma` (37 files: `activity.prisma`, `invoice.prisma`, `payout.prisma`, `webhook.prisma`, `workflow.prisma`, …). Prisma 7 supports folder schemas natively; do `prisma/schema/{horse,sale,invoice,sync,audit,auth}.prisma`.
  3. **Stripe webhook router**: `apps/web/app/(ee)/api/stripe/webhook/route.ts` — `relevantEvents = new Set([...])`, `stripe.webhooks.constructEvent(await req.text(), sig, secret)`, early `200` for unsupported events, one handler file per event (`charge-succeeded.ts`, `invoice-payment-failed.tsx`, …). Add what dub lacks: idempotency table keyed by `event.id`.
  4. **Auth + audit helpers**: `apps/web/lib/auth/{options.ts,session.ts,admin-impersonation.ts,rate-limit-request.ts}` (NextAuth v4 wrapped in `withSession`/`withWorkspace` route guards) and `apps/web/lib/api/{audit-logs,activity-log,errors.ts,error-codes.ts}` — typed error codes + `withWorkspace` wrapper pattern is worth mirroring with Better Auth.

### 4.4 CopilotKit/CopilotKit — MIT (Atai Barkai)
- HITL is `useHumanInTheLoop({ name, parameters, render: ({ args, respond }) => <ApproveCard onApprove={() => respond(...)} /> })`; agent run suspends until `respond`. Transport is the **AG-UI protocol** (event stream), needs `@copilotkit/runtime` server + `CopilotKit` provider.
- **Verdict: not needed.** AI SDK 7 gives the same suspend/resume with `toolApproval` + `addToolApprovalResponse`, no extra runtime, no second protocol, and signed approvals. CopilotKit only pays off if the agent lives in LangGraph/Mastra/Python.

### 4.5 assistant-ui/assistant-ui — MIT (AgentbaseAI Inc.), 0.15.x
- Composable chat primitives (thread, composer, tool UI) that sit on top of AI SDK `useChat`. Paperclip uses it. **Verdict: skip in V1** — shadcn's chat/AI elements + `useChat` cover a single approval-centric thread; revisit if chat UI polish becomes the bottleneck.

### 4.6 langchain-ai/langgraphjs — MIT, @langchain/langgraph 1.4.15
- **Verdict: not in V1 (confirmed).** `ToolLoopAgent` + `toolApproval` handles a single-agent loop with interrupts. LangGraph is justified only for multi-node graphs with checkpointed state across many sessions.

### 4.7 pmndrs (react-three-fiber, drei, gltfjsx) — all MIT
- Confirmed via GitHub API and package manifests. gltfjsx is a dev CLI (last publish 2024-11); output JSX is yours.

### 4.8 promptfoo — MIT (Promptfoo 2025)
- Config `promptfooconfig.yaml`: `providers[].id` (`anthropic:claude-…`, `openai:…`) with `config.tools` in **OpenAI function format** (auto-converted for Anthropic), `prompts`, `tests[].vars` + `tests[].assert`.
- Tool/structured assertions: `is-valid-function-call`, `is-valid-openai-tools-call`, `tool-call-f1`, `is-json` (with inline JSON schema), `contains-json`, `javascript` (output as string + context), `llm-rubric`. `tool_choice: required` to force a call.
- CI: `promptfoo eval -c promptfooconfig.yaml --no-cache` in GitHub Actions (official `promptfoo/promptfoo-action`), fail on threshold. Needs Node >= 22.22.
- Limits for us: it tests one model turn, not a multi-step approval loop with our real `execute` functions. See §6.6.

### 4.9 Closer "ops console + AI copilot + approvals" projects (2025–2026)
| Project | License | Why |
|---|---|---|
| paperclipai/paperclip (Mar 2026, 80k stars) | MIT | Approval queues, decision tracking, budgets, immutable audit log for agents; Express 5 + Drizzle + Zod 4 + React 19 + Base UI + assistant-ui. Study `server/src/services/approvals.ts` (statuses `pending → revision_requested → approved/rejected`, atomic resolve), `routes/{approvals,decision-queues,activity}.ts`, `services/agent-action-audit.ts`. **Copyable (MIT).** |
| vercel/workflow (Oct 2025) | Apache-2.0 | Durable TypeScript workflows with human-approval hooks (`requestHumanApproval` pattern) — if a sale-to-invoice flow needs to pause for days. |
| triggerdotdev/trigger.dev | Apache-2.0 | `wait.forToken()` approval waitpoints inside background tasks; good reference for "job pauses until a human clicks". |
| openops-cloud/openops (2025) | Apache-2.0 | FinOps automation with explicit approval steps before cost-affecting actions; closest in spirit to "money-touching actions need sign-off". |
| humanlayer/humanlayer | Apache-2.0 | Original "require_approval" SDK for agent tool calls (Slack/email channels); quieter since mid-2026 but the approval-contract design is worth reading. |
Also: agentscope-ai/AgentTeams (Apache-2.0, HITL multi-agent) and elie222/inbox-zero (AGPL-3.0, "AI proposes rule, human approves") — study only.

## 5. License compliance rules for the SPADE OPS repo

1. **May copy verbatim (with attribution):** MIT, ISC, Apache-2.0, BSD-2/3, 0BSD, Unlicense/CC0. Keep the original copyright + license text. Apache-2.0 additionally requires carrying any `NOTICE` file contents and noting modified files. Examples: shadcn components (MIT), Paperclip approval service (MIT), R3F/drei examples (MIT), AI SDK cookbook (Apache-2.0), Better Auth examples (MIT).
2. **May study, may not copy code (structure and ideas only):** AGPL-3.0 (twenty core, midday, dub, inbox-zero), BUSL/SSPL/"fair-source" (Inngest core), any `(ee)`/`/* @license Enterprise */` directory, GSAP (proprietary no-charge license — usable as a dependency, never vendored or modified). Re-implement from scratch; do not paste snippets, do not copy schema files, do not copy CSS wholesale. Naming the pattern in a comment ("inspired by dub's webhook router") is fine.
3. **Dependencies vs. vendoring:** importing an AGPL library at runtime would make our server AGPL if distributed/hosted. None of our runtime deps are AGPL (all MIT/ISC/Apache-2.0). Enforce with `pnpm licenses list` in CI and an allowlist `MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD, CC0-1.0, Unlicense, MPL-2.0` (MPL only for unmodified deps). Fail the build on `AGPL-*`, `GPL-*`, `SSPL`, `BUSL`, `UNLICENSED`, `NOASSERTION`.
4. **`THIRD_PARTY_NOTICES.md` (repo root):** one entry per vendored/copied file or snippet: source repo + commit URL, original license (full text or link to the repo copy), copyright line, what was modified. Also list packages whose license requires notice reproduction (Apache-2.0 `NOTICE`s: `ai`, `prisma`, `stripe`? — stripe is MIT; check on each add). Generate the dependency section with `pnpm licenses list --json` → script; hand-write the vendored section.
5. **Assets:** Solo Select Horses name, logo, photos, horse names/records are **not** open source. Put them under `assets/brand/` with `LICENSE-ASSETS.md`: "All rights reserved, Solo Select Horses LLC; used with permission for this prototype." Synthetic data must be clearly synthetic (`data/seed/README.md`).
6. **Recommended license for Pavan's repo:** **MIT** for all code (simplest for a portfolio/prototype; compatible with every dep). Root `LICENSE` (MIT, © 2026 Pavan Kalyan), plus `README` "Trademarks and images" section: MIT does not grant rights to Solo Select Horses trademarks, branding, or photographs. If the repo may later become a product, MIT still leaves that door open; AGPL would not add protection worth the friction.
7. **Model output:** AI-generated code is treated like our own code (MIT). Do not commit prompts or outputs that reproduce AGPL sources.

## 6. CRITIC — what is unnecessary, risky, or wrong in the proposed stack

1. **NestJS is job-description theater for this prototype.** A separate `apps/api` on NestJS 12 doubles routing, auth, DTO validation and deployment for ~15 endpoints. NestJS 12 also forces TS `~6.0.2`, decorators + `emitDecoratorMetadata`, a rewritten CLI, and an ESM migration — all friction with zero demo value. Use Next.js Route Handlers + Server Actions for the API and one plain `apps/worker/src/index.ts` (BullMQ `Worker`) for jobs. If the JD needs a NestJS artifact, extract `apps/api` in week 3 behind the same `packages/domain` services — the module layout in §4.1 is designed so that move is mechanical.
2. **Redis is dead weight.** BullMQ 6 runs on Postgres with the identical API (`createPostgresBackend`). One datastore, one Docker container, one connection string, no `ioredis` major to track. Add Redis only if queue throughput ever matters (it will not for one barn).
3. **pgvector for ~50 horses is theater, and currently risky.** Prisma 7 has an open migrate drift regression with `Unsupported("vector")`; you would spend a day on plumbing to search 50 rows. Do structured filters + Postgres `ILIKE`/`tsvector`. If a "semantic search" demo is required, `embedMany` from the AI SDK + cosine similarity in memory over 50 vectors is 20 lines and needs no extension. Revisit when data > 10k rows.
4. **Auth.js v5 is a dead end.** Still `5.0.0-beta.32`, maintenance mode since Sep 2025, its maintainers point new projects to Better Auth, which Vercel bought in July 2026 and kept MIT. Use `better-auth@1.7.5` with the Prisma adapter, email+password plus one OAuth provider; done in an afternoon.
5. **Three.js + drei will hurt the ops console.** `three` alone is ~650 KB minified (~160 KB gz) before drei; R3F 9.7 pins React below 19.3 (scheduler 0.28 mismatch) for the whole monorepo. Keep any 3D strictly on the marketing/landing route, loaded with `next/dynamic({ ssr: false })`, one scene, one compressed GLB, and measure with Lighthouse (Next 16 removed the "First Load JS" build metric). Better: a 6-second looping video or Lottie for the hero, and zero 3D in the console. Do not ship both `motion` and `gsap`; motion 13 (MIT) covers UI transitions; GSAP's license is free but proprietary.
6. **Promptfoo is the wrong first eval harness for an approval-gated tool agent.** It evaluates single turns with OpenAI-shaped tool assertions and needs Node >= 22.22; it cannot exercise `toolApproval` resumption or our real `execute` functions against a seeded DB. Write evals as Vitest tests: call `generateText`/`ToolLoopAgent` with the real tool registry, mocked side effects, and `toolApproval`, assert on `result.content` (`tool-approval-request` present for money-touching tools, absent for reads), record fixtures with `MockLanguageModelV3` for deterministic CI, run the live-model suite nightly with a spend cap. Add Promptfoo later for prompt regression and red-teaming of the system prompt.
7. **Sentry in a demo adds an org, DSNs, source-map uploads, and a `sentry.*.config.ts` triad** for a product with one user. Use structured logs (`pino`) + the Next 16 dev overlay; wire `@sentry/nextjs@10.75.0` in the last week if the reviewer cares about observability (about one hour). Same for Langfuse: `langfuse@3` is deprecated; if tracing is wanted, `@ai-sdk/otel` → console/OTLP exporter is enough.
8. **Turborepo is premature.** Two apps and two packages do not need a task graph or remote cache; `pnpm -r --filter` scripts are enough and one fewer config to explain. Add `turbo@2.10.13` when the build graph has >= 4 nodes or CI time exceeds 5 minutes.
9. **Prisma vs Drizzle — decide once.** Prisma 7.10 is fine and readable for a demo, but note: (a) `npm i prisma` today installs an 8.0 RC, so pin exact; (b) Prisma 8 GA (~Oct 2026) renames pagination and changes date types — a migration tax within the prototype's lifetime. Drizzle 0.45 (Apache-2.0) is SQL-first, has no generator step, and is what Paperclip/Better Auth/BullMQ-pg examples use. **Decision: keep Prisma 7.10.0 pinned** (schema-as-documentation sells better in a walkthrough; multi-file schema like dub), but isolate all DB access in `packages/db` repositories so a Drizzle swap or Prisma 8 upgrade touches one package.
10. **`typescript@latest` (7.0.2) will break lint and any NestJS CLI.** Pin 6.0.3; use 7 only as an extra `--noEmit` check.
11. **`node-quickbooks` is not worth its risk surface.** Sporadic maintenance, no LICENSE file, callback-era API. The prototype touches four QBO entities (Customer, Item, Invoice, Payment): use `intuit-oauth` for tokens and `fetch` against `https://quickbooks.api.intuit.com/v3/company/{realmId}/...` with Zod-validated responses. Also plan for QBO sandbox rate limits and the 100-req/min throttle in the sync job.
12. **Do not adopt v9 of `@tanstack/react-table` yet** if you scaffold tables from shadcn — its docs still emit v8 code; pin 8.21.3 and upgrade with the `useLegacyTable` shim later.

## 7. Sources (fetched 2026-09-16)
- npm registry via `npm view` for every package above (versions, licenses, engines, peerDependencies, dist-tags, publish dates).
- Next.js 16 upgrade guide: https://nextjs.org/docs/app/guides/upgrading/version-16 ; TS 7 support: https://github.com/vercel/next.js/discussions/95633
- AI SDK 7 migration: https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0 ; v6: https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0 ; tool approvals: https://ai-sdk.dev/docs/agents/tool-approvals
- TypeScript 7: https://www.infoq.com/news/2026/08/typescript-7-released/ ; https://mergify.com/blog/native-typescript-compiler-faster-typecheck ; NestJS + tsgo: https://fernforge.github.io/devnotes/nestjs-typescript-7/
- Prisma 7 upgrade: https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7 ; latest-tag issue: https://github.com/prisma/orm/issues/30322 ; pgvector drift: https://github.com/prisma/prisma/issues/28867
- BullMQ Postgres backend: https://docs.bullmq.io/guide/postgresql ; changelog: https://docs.bullmq.io/changelog
- Auth.js → Better Auth: https://github.com/nextauthjs/next-auth/discussions/13252 ; Vercel acquisition: https://vercel.com/blog/vercel-acquires-better-auth
- GSAP license: https://gsap.com/standard-license/
- R3F React 19.3 cap: https://github.com/atomantic/PortOS/issues/7370 ; https://www.npmjs.com/package/@react-three/fiber
- shadcn CLI v4: https://ui.shadcn.com/docs/changelog/2026-03-cli-v4 ; Base UI default: https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default ; table v9 tracking: https://github.com/shadcn-ui/ui/issues/11389
- Stripe API version: https://github.com/stripe/stripe-node/blob/master/src/apiVersion.ts ; changelog: https://github.com/stripe/stripe-node/blob/master/CHANGELOG.md
- ESLint 10: https://eslint.org/blog/2026/02/eslint-v10.0.0-released/ ; Vitest 5: https://vitest.dev/blog/vitest-5.html ; Zod 4: https://zod.dev/v4/changelog ; NestJS 12: https://trilon.io/blog/nestjs-12-is-now-available ; Motion 13: https://motion.dev/docs/upgrade-guide ; TanStack Table v9: https://tanstack.com/blog/announcing-tanstack-table-v9
- Promptfoo: https://www.promptfoo.dev/docs/configuration/tools/ ; https://www.promptfoo.dev/docs/configuration/expected-outputs/
- Reference repos (GitHub API + raw LICENSE files): twentyhq/twenty, midday-ai/midday, dubinc/dub, CopilotKit/CopilotKit, assistant-ui/assistant-ui, langchain-ai/langgraphjs, pmndrs/{react-three-fiber,drei,gltfjsx}, promptfoo/promptfoo, paperclipai/paperclip, vercel/workflow, triggerdotdev/trigger.dev, openops-cloud/openops, humanlayer/humanlayer, mcohen01/node-quickbooks, intuit/oauth-jsclient.
