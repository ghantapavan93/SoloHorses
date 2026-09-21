# ADR-022 — One LangGraph, the ExceptionReviewGraph, which orchestrates and never decides

**Situation.** The assistant's pipeline was a hand-written loop: policy gate → tools → model (or the offline composer) → schema validation → evidence verification → persistence, with a proposal row as the human-in-the-loop (ADR-017). The critique of 2026-09-18 asked for one durable graph — not a swarm — so that the pause for a person is a checkpoint that survives a restart and resumes when the decision is made, and so that the orchestration is legible as a graph rather than as a method.

**Decision.** One `StateGraph` (`@langchain/langgraph`, `apps/api/src/modules/ask/application/review-graph.ts`):

```
gate → authorize → compose (tools · model or offline) → verify → persist
                                                                  │
                                              no proposal ────────┴──→ END
                                              proposal   ──→ await_human (interrupt)
                                                                  │  a person decides on the page
                                                                  ▼
                                                         record → audit → END
```

Checkpoints are in Postgres (`@langchain/langgraph-checkpoint-postgres`, schema `ask_graph`, outside Prisma's migration history) and fall back to memory only when there is no database. The thread id is the assistant message id, so a proposal (which points at its message) names its thread. The person's decision is a domain event (`ProposalDecided`, appended in the same transaction as the proposal row and its audit line); a consumer in the Ask module resumes the paused thread with it, and the graph's last node writes `ask.review.decided`. Tool calls stream out of the `compose` node as the graph runs, so the UI's live tool chips are unchanged.

**What the graph does not do.** It does not decide. The gate is `screenQuestion`, a function with tests. The verifier is `verifyEvidence`, a function with tests. The command an approved proposal turns into runs in `ProposalsService.approve`, which calls the same rule-checked service the UI calls and lets the rule refuse. The graph moves state between those and writes down that it did. Every stage is the same code the specs covered before the graph existed, and the eighteen Ask specs pass unchanged through it. If LangGraph disappeared tomorrow the rules would not notice.

**Memory.** LangGraph's thread checkpoints are the run's short-term state. Longer-term memory stays `AskMemory` — `USER_STATED` preferences only, inspectable and forgettable on the story page. The graph never writes an inferred policy ("this mare is usually safe", "she generally approves this fee") into memory; those are dangerous learned rules, and the role's own words — memory, human review, sensitive information — are read as forbidding exactly that.

**Cost.** Two dependencies and a schema of four tables. One more moving part to explain on the honesty page, which now shows the graph's name and whether its checkpoints are durable. The refactor of the Ask service into stages.

**Would change it.** A second consequential action kind (money is never one — ADR-017) would add a branch, not a graph. A long-running review that spans days and several people would justify the graph's full power; today it justifies its existence by making the pause durable and the orchestration readable.
