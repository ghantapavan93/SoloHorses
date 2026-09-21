# ADR-024 — The visual layer says something, or it does not go in

**Status:** accepted, 2026-09-19. Extends ADR-019 (the visual reference lock) and ADR-023 §6.

## Context

ADR-023 turned the build around: Daysheet is the synthetic estate, the assistant is the product. A product whose value is _understanding across systems_ has to show that understanding, and a page of counters and bar charts shows nothing a founder does not already know. The author's earlier front-end work carries a vocabulary — living diagrams, numerals that arrive, film grain, tinted shadows, glass chrome, motion tokens — and a set of effects that dazzle for a second (cursor spotlights, magnetic buttons, tilt cards, text scrambles). The question was which of these earn a place in an operations tool.

## Decision

Every visual element must make a claim a reader could check against the records, or it is cut. Four diagrams, one rule for motion, one rule for chrome.

1. **The authority boundary, drawn from the code** (`AgentMembrane`, `/future` and the landing). The strands are the tool catalog and the refused capabilities as `authorityCatalog()` returns them; the strands that light are the tools the last real question reached for. Nothing is illustrative: the diagram cannot drift from the gate because it is rendered from the same definitions the gate runs on.
2. **Why this one** (`CausalMap`, a signal's own address). The record and the records the detector cited, the facts as the tables hold them, the rule that read them, the block, the person who decides. Laid out once on the API by dagre so the page draws it at once and a phone reads it as a list in the same order. Records are links. One moving thing: a dot on the edge into the block, under `motion-safe` only.
3. **The morning brief** (`BriefHeader`, Operations and the Day Sheet). Five numerals that arrive, each read from the tables now and compared against a snapshot this app wrote; a sparkline appears only once four snapshots exist. "First brief · no snapshot from yesterday yet" is a legitimate state and is shown as such.
4. **The trace on a time axis** (`TraceTimeline`, the trace drawer and `/traces/:id`). Rows placed by when they happened and how long they took; a bar is a span, a dot an instant, a dashed bar a span still open, failures the only red. It shows where the time went — the outbox publish beat, the breaker's wait, the books' latency — which the list beneath cannot.

**Motion.** One ease (`--ease-out`, ease-out quint) and three durations (`--dur-fast/base/slow`), declared once in the stylesheet and mirrored in `lib/motion.ts` for script-driven motion. A numeral arrives once per mount; a dot travels only where the edge means something. Every motion respects `prefers-reduced-motion`, and the server renders the final state so the page is right before any script runs.

**Chrome.** Shadows carry the palette's warmth (`.lift`), never a grey smear; the public nav is glass with a little saturation (`.glass`); film grain stays on the public pages only, never over the application. Dark by default, light by cookie, as ADR-019 says.

**Rejected.** Cursor spotlights, magnetic buttons, tilt cards and text effects: they say the page is clever, not that the operation is understood. Pie and bar charts of the board: the counts are two digits and read faster as numerals. Export to a spreadsheet: the records already live in the operation's own systems. Per-kind swimlanes on the trace: eight rows do not need lanes.

## Addendum (2026-09-20): the finish, and where the author's vocabulary was allowed in

The second pass raised the finish without changing the rule. The public pages (the landing, `/story`, `/future`, a decision's and a run's own address) may carry the author's motion vocabulary from earlier work, because a first impression is part of what those pages say; the application (Day Sheet, Operations, the ledger, the runs) keeps stillness and gets micro-interaction only.

- **One vocabulary, in `lib/motion.ts`.** Eases as `motion` tuples beside the CSS curve (`outQuart` for entrances, `inQuart` for exits only), seconds beside milliseconds, one spring for a sheet a hand is pulling, and four presets the pages repeat. `MotionConfig reducedMotion="user"` at the root: a visitor who asked for stillness gets none, not less.
- **The thesis arrives word by word** (`BlurWords`): each word of the landing's headline comes into focus in reading order, out of a blur, so the sentence lands the way it is read. Sections reveal once, on scroll, with a 14 px rise under 300 ms (`Reveal`, `Stagger`). Adapted from the author's `BlurReveal` and `Reveal`; the durations here are the house rules.
- **A page arrives, the shell stays put** (`(app)/template.tsx`): four pixels and 220 ms, once per navigation. Not a curtain.
- **The shape before the page**: `loading.tsx` skeletons for the board, the ledger, the runs, the evals, the story, a decision and a run — structure first, never a blank.
- **Answers as they happen**: a tool row slides in as its call returns; the answer and the investigation settle in together; a decision card's border changes as a surface, not a flash.
- **The X-ray answers the hand**: hover thickens a node's stroke; selecting one dims everything an edge does not join to it, so the neighbourhood of a fact is the thing on screen.
- **The register's last details**: the theme changes as one surface (a 320 ms colour transition on the body), thin scrollbars, balanced headlines and pretty paragraphs, a hairline of light along a raised surface's top edge in the dark, a press that acknowledges the hand.

**Still rejected, and why.** The scroll-lit sentence, the letter-by-letter headline with an image inside each glyph, the text that vaporises, cursor spotlights, magnetic buttons, tilt cards, a curtain page transition: every one says the page is clever. The operation does not need to be told that; it needs to know which mare cannot leave and who decides.

## Consequences

- A new visual element needs a sentence naming the claim it makes and the rows it is drawn from; the review asks for that sentence first.
- The four diagrams are pure SVG over API data with list fallbacks, so they render on the server, print, and read to a screen reader (each carries an `aria-label` that states the claim in words).
- The design vocabulary now lives in three places that must agree: `globals.css` tokens, `lib/motion.ts`, and this record.
