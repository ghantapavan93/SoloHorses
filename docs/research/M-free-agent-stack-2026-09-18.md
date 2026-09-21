# M · A free, local agent stack — four research passes, verified live (2026-09-18)

Four research agents fetched every page they cite on 2026-09-18 (repo pages, npm registry, bundlephobia, vendor docs); "measured" means run on the laptop that builds this (RTX 3060 Laptop, 6 GB VRAM, Node 22). Licenses are the ones on the repo that day. Nothing here was taken from memory; where a claim could not be confirmed it says so. This is the evidence behind ADR-023.

## 1. Agent runtime and local models

| Option | License | Verdict |
|---|---|---|
| LangGraph.js `@langchain/langgraph` 1.4.15 (already ours) | MIT | Stay. Patterns to copy from `examples/how-tos`: `react-human-in-the-loop`, `review-tool-calls`, `tool-calling-errors` (remove the bad turn, retry), `subgraph-transform-state`; `interrupt()` / `Command({ resume })` |
| `@langchain/ollama` 1.3.0 (`ChatOllama`, `OllamaEmbeddings`) | MIT | Use for embeddings and as a judge; tool calling only for models with the capability badge. The compose loop itself talks to Ollama's chat API directly (no dependency) |
| `@langchain/langgraph-supervisor` 1.1.2 | MIT | Only if subagents per context are ever wanted; a 7B router over four subagents is the weak link |
| `deepagents` JS 1.13.5 | MIT | Copy the `interruptOn` decision shape (approve / edit / reject / respond); do not depend (pins `langchain ^1.5`, LangSmith) |
| Vercel AI SDK 7 + `ai-sdk-ollama` / `ollama-ai-provider-v2` | Apache-2.0 / MIT / Apache-2.0 | Rejected: a second agent loop and message format beside LangGraph |
| Mastra `@mastra/core` 1.67 | Apache-2.0 core, `ee/` under an enterprise license | Rejected: replaces LangGraph; dual license fails the allowlist |

Local models that fit 6 GB with tool calling (Ollama library pages): **`qwen2.5:7b-instruct`** Q4_K_M 4.7 GB (Apache-2.0; already pulled) as default, `temperature 0`, `num_ctx 8192`; **`qwen3:4b`** Q4_K_M 2.5 GB (Apache-2.0; `think: false`) as the small-GPU fallback; `qwen3.5:4b`, `granite4.1:3b`, `ministral-3:3b`, `llama3.2:3b`, `phi4-mini` as candidates. `gemma3:4b` has no tools badge (ollama/ollama#9941, open) and is prose only; `gemma4` and `mistral-small` do not fit. Structured output: Ollama `format` takes a JSON schema and decodes against it (ollama.com/blog/structured-outputs). Hosted Hugging Face inference: the free tier is "$0.10, subject to change" a month of provider credit and returns 402 when spent (huggingface.co/docs/inference-providers/pricing) — not for a demo.

## 2. Retrieval for documents, free and local

| Piece | Choice | License | Note |
|---|---|---|---|
| Store | pgvector 0.8.6 in the existing Postgres, `@langchain/pgvector` 0.1.0 | PostgreSQL License / MIT | Hand-written migration (`CREATE EXTENSION vector`, `vector(768)`, HNSW cosine); Prisma's documented path. Alternatives LanceDB (Apache-2.0, embedded) and Qdrant (Apache-2.0, a container) were weaker fits |
| Embeddings | `nomic-embed-text` v1.5 through Ollama | Apache-2.0 | 768-d; measured 64 chunks (17k tokens) in 0.8 s on the GPU, a query in ~35 ms warm. Ollama's modelfile caps context at 2,048 and truncates silently: keep chunks ≤ 1,200 tokens; prefixes `search_document:` / `search_query:` are required |
| In-process alternative | `bge-small-en-v1.5` via `@huggingface/transformers` 4.3.0 | MIT / Apache-2.0 | CPU q8: 3.0 s per 64 chunks; keep as the no-Ollama fallback |
| Chunker | Mastra `MarkdownHeaderTransformer` (vendored, ~195 lines) then `@langchain/textsplitters` 1.0.1 | Apache-2.0 / MIT | Header stack into metadata; citation = `title § headerPath` |
| Reranker (optional) | `mxbai-rerank-xsmall-v1` q8 via Transformers.js | Apache-2.0 | Measured 20 pairs in 1.8 s on CPU; hybrid `tsvector` + RRF first. Ollama has no rerank endpoint |
| Platforms | RAGFlow, Dify, AnythingLLM, Open WebUI | various | Rejected: services or apps that bypass the policy gate and the verifier |

## 3. Briefs, evals, traces

| Need | Choice | License | Note |
|---|---|---|---|
| A scheduled brief | BullMQ repeatable job → the review graph with `PostgresSaver`; a `brief_snapshot` (context, run, projection hash) and a `brief_item` fingerprint with `reportedAt` for dedupe | MIT (ours) | LangGraph Platform cron and Agent Inbox need a LangSmith key even locally; copy Agent Inbox's `HumanInterrupt` / `HumanResponse` shape (accept / edit / respond / ignore) onto `Proposal` instead |
| Agent evals | `agentevals` 0.0.7 + `openevals` 0.2.2 beside the deterministic grader; judge = `ChatOllama` on the local model | MIT | `createTrajectoryMatchEvaluator` (strict / unordered / subset), `extractLangGraphTrajectoryFromThread`. promptfoo (MIT) later as a CI red-team harness with `ollama:chat:` as provider |
| Traces | `@arizeai/openinference-instrumentation-langchain` 4.1.0 → Phoenix (one container, Postgres-backed) | Apache-2.0 / Elastic License 2.0 (a separately deployed service; fine) | Langfuse (MIT + `ee/`) if an OSI server license is required: web, worker, ClickHouse, MinIO, Redis with `noeviction` |

## 4. The causal map and the brief

| Piece | Choice | License | Note |
|---|---|---|---|
| Graph | `@xyflow/react` 12.11.6 | MIT | 60 kB gz; keyboard: Tab through nodes, Enter selects; SSR when nodes carry sizes |
| Layout | `@dagrejs/dagre` 3.1.1 | MIT | 16 kB; run on the server with fixed node sizes so the page renders without a layout flash. `elkjs` is EPL/GPL (not on the allowlist); `d3-dag` pulls an Unlicense dependency |
| Node anatomy | Airflow's state-keyed border and badge; Langfuse's ring for selected and glow for the block; every node an `<a>` to its record | Apache-2.0 / MIT (patterns) | Edges `smoothstep`, label = rule id; edges into the block styled as selected |
| Phone | The same data as an ordered list in rank order, the block `aria-current` | — | No canvas under 768 px |
| Brief typography | shadcn `SectionCards` (`tabular-nums`, trend badge); Circle (Linear-style rows) | MIT | Grafana's alert list, Plane's intake and Midday are AGPL: patterns only; Recharts is not a graph library and too heavy for one sparkline (draw a `<polyline>`) |

## What was not done

No package was added on the strength of this file; each lands with the step that needs it (ADR-023 §5). The measurements are one laptop's; the numbers on `/build` are the ones that count.
