# G2 — Premium ops-UI patterns (2025–2026), sub-report to G

Provenance tags: **[P]** primary (vendor blog/docs/repo), **[S]** secondary (community token scrapes — approximate), **[O]** observed in product, not documented.

## 1. Linear
1. **3-variable theme engine in LCH** [P]. 98 per-theme variables collapsed to base color, accent color, contrast. Elevation = lightness offsets from base (background → panel → dialog → modal). Dark theme moved to "a warmer gray, less saturated".
2. **Attention hierarchy via de-emphasis, not decoration** [P]. Sidebar dimmer, icons smaller, inactive text muted, fewer dividers. Inter body, Inter Display headings only.
3. **Triage as a keyboard queue** [P]. `G T` opens; `1` Accept, `2` Duplicate, `3` Decline, `H` Snooze. Status glyphs: dashed circle → empty → partial → filled check.
Don't copy: the user-facing theme generator. Ship one light + one dark.

## 2. Vercel / Geist
1. **10 scales × 10 steps, each step has a job** [P]: 100–300 component bg (default/hover/active), 400–600 borders, 700–800 high-contrast fills, 900 secondary text, 1000 primary text.
2. **Materials = radius + lift presets** [P]: on-page 6px; floating menu/modal 12px; fullscreen 16px. Surface ring `0 0 0 1px rgba(0,0,0,.08)`; focus ring `0 0 0 2px bg, 0 0 0 4px focus`; weights 400/500/600 only; label 14/20, mono 13/20; 4px spacing base.
3. **Status semantics** [P]: Badge green healthy / red error / amber warning / blue info / gray neutral; badges static ("promote to Button if actionable"). StatusDot animates only while in-flight. Logs: 4xx amber, 5xx red; click row → right sidebar with Request Id, timings, timeline.
Don't copy: 100 color tokens — keep the step-role idea with ~5 hues.

## 3. Raycast
1. **Palette anatomy** [P]: big search input on top; bottom action bar (title + toasts left, contextual actions with shortcut labels right). `⌘K` inside the palette opens an Action Panel with its own search. Primary `↵`, secondary `⌘↵`. Rows: title, subtitle, right-aligned accessories.
2. **Metrics** [S]: keycap ~20px, radius 4; inputs ~36px; surfaces #07080a → #0d0d0d → #101111 → #121212; hairline #242728; selected row = one notch lighter. Rows ≈40px [O].
Don't copy: dark-only; hiding the primary action behind ⌘K.

## 4. Midday (repo, [P])
1. Tokens: warm light card `45 18% 96%`, border `45 5% 85%`; dark bg `0 0% 5%`, card `0 0% 7%`, border `0 0% 11%`; radius 0.5rem.
2. Right sheet `w-3/4 sm:max-w-[520px]`, open 300ms / close 200ms. Sidebar 70 → 240 (hover), items 40px, child 32px.
3. Transactions table: virtualised 45px rows; sticky select/date/description; hover `#F2F1EF`; "Pending" badge inline; `↑/↓` moves selection while the detail sheet is open. Empty states: "No results — Try another search, or adjusting the filters — Clear filters".
Don't copy: hover-to-expand sidebar; single-weight non-tabular font for money.

## 5. Twenty + Attio
Twenty [P]: 13px root; xs≈11, sm≈12, md 13, lg 16, xl 20, xxl 24; weights 400/500/600; `RECORD_TABLE_ROW_HEIGHT = 32`; cell padding 8; `sidePanelWidth: 500px`; durations 75/150/300ms; 12-step grays; shadows light `0 2px 4px rgba(0,0,0,.04), 0 0 4px rgba(0,0,0,.08)`.
Attio [P]: record page = left attribute sections + tabs (Overview, Activity, Notes, Tasks, Files); activity timeline grouped by collapsible month with per-type icons; virtualization everywhere.
Don't copy: rem math on a 13px root (blurry); per-object tab sprawl.

## 6. Mercury
1. Semantic tokens grouped by usage roles so dark mode doesn't invert the palette [P].
2. Pending vs posted: rows carry "Pending"/"Failed" badges; balance already subtracts pending outgoing — show state, not mechanics [P].
3. Single chromatic action color; radius 4 default / 12 cards; "no shadows — elevation by value contrast" [S]. The app is light-first; the dark cinematic palette is the marketing site.

## 7. Hex + Notion AI + Attio "Ask"
1. **AI output is provisional until kept** [P Hex]: every suggested change is a diff that must be Confirmed or Undone; "Pending changes" modal; auto-versions for restore.
2. Ask input pattern [P Notion]: accept / discard / try again; `@` pins context; Q&A cites source pages.
3. Streaming without jank [P Attio]: render at a steady pace; streaming-aware parser; structured JSON blocks render record cards progressively.
Don't copy: purple gradients/sparkle chrome. Differentiate AI by state (pending → kept) with a thin rail and Keep/Undo.

## 8. Stripe Dashboard (most relevant to Money Integrity)
1. **Six-type status vocabulary** [P]: neutral, info, positive, negative (no action), warning (optional action), urgent (required action). Payment filters: succeeded / pending / failed / uncaptured / refunded / disputed.
2. **Events & logs anatomy** [P Workbench]: list left, payload + delivery attempts right with Succeeded/Failed tabs and **Resend** per attempt; Errors grouped by type with counts; `⌘I` copies the current object ID.
3. **Empty/feedback copy rules** [P]: title states what's missing with a period ("No successful payments."); description <14 words, active; action mirrors title; section-level empty = 1px dashed border; render order loading → error → empty → content; never show "create" when merely filtered. Toast ≤30 chars. CIELAB contrast: 4.5:1 text, 3:1 icons.
Don't copy: the whole Workbench; brand blurple as a status color.

## 9. Motion (Family, Emil Kowalski)
- Family Values [P]: one action per tray; label morphs; persistent components never re-animate; delight budget inversely proportional to frequency.
- Kowalski [P]: press 100–160ms, tooltips 125–200, dropdowns 150–250, modals/drawers 200–500; `--ease-out: cubic-bezier(.23,1,.32,1)`; drawer `cubic-bezier(.32,.72,0,1)`; enter from `scale(.96)+opacity 0`; transform/opacity only; stagger 30–80ms; **keyboard-initiated actions get no animation**; 100+/day actions get none.
Don't copy: delight on frequent actions; bouncy springs on tables or sheets.

## 10. Apple Sports + Weather
- Numerals as the hero (bold + compact width); dense grids wrap rather than truncate.
- Minimal chrome, hierarchy by scroll. Critique: paired color bars fail when a color matches the canvas; numbers at screen edges are hard to compare.

## Cross-cutting rules for a dense, quiet, fast ops app
| Dimension | Recommendation |
|---|---|
| Base type | 13px body, 12px meta, 11px min; 14px in detail sheets; tabular numerals always; mono for IDs |
| Row height | 36px default, 32px compact |
| Sidebar | 240px, collapsible to ~64px by toggle (not hover) |
| Side sheet | 500–520px, 300ms in / 200ms out, ease-out |
| Elevation | 1px hairline borders on page; shadow only for floating (menu 12px radius, tooltip 6px) |
| Radius | 6px controls, 12px floating, 0–4px on data surfaces |
| Status colors | 5: gray neutral, blue info, green positive, amber warning, red negative; "urgent" = red filled |
| Exceptions | Nav badge counts + a Triage queue with 1/2/3/H actions; group errors by type with counts |
| Timeline | Vertical, newest-first, collapsible month/day headers, per-event-type icon, right-aligned timestamp, mono ref ID, "Retry" per attempt |
| AI output | Provisional state + Keep/Undo per item; thin left rail; steady streaming; citations as record chips |
| Empty states | "No X." + <14-word reason + matching action; dashed 1px for section-level; filtered ≠ empty |
| Keyboard | ⌘K palette; `↵` primary, `⌘↵` secondary; `G`+key nav; `↑/↓` moves row while sheet open; `⌘I` copy ID; zero animation for keyboard-triggered changes |
| Motion | ≤200ms ease-out enter; ≤300ms drawers; scale from .96; no bounce; reduced-motion keeps opacity only |

## Sources
Linear: linear.app/now/how-we-redesigned-the-linear-ui · linear.app/now/behind-the-latest-design-refresh · linear.app/docs/triage
Vercel/Geist: vercel.com/geist/{colors,materials,typography,badge,status-dot,table} · vercel.com/docs/observability/runtime-logs
Raycast: raycast.com/blog/a-fresh-look-and-feel · manual.raycast.com/action-panel · developers.raycast.com/api-reference/user-interface/list
Midday: github.com/midday-ai/midday — packages/ui/src/globals.css, components/sheet.tsx, apps/dashboard/src/components/{sidebar,main-menu}.tsx, tables/transactions/*
Twenty: github.com/twentyhq/twenty — packages/twenty-ui/design-tokens/*, packages/twenty-ui/src/theme/constants/*, record-table/constants/RecordTableRowHeight.ts
Attio: attio.com/changelog/2026/new-activity-timeline · attio.com/engineering/blog/react-data-list-building-virtualized-uis-declaratively · attio.com/engineering/blog/ask-attio-a-technical-look-at-our-new-agent
Mercury: mercury.com/blog/december-2022-product-updates · support.mercury.com/hc/en-us/articles/28778366589076
Hex/Notion: hex.tech/blog/introducing-notebook-agent/ · notion.com/help/notion-agent
Stripe: docs.stripe.com/stripe-apps/components/badge · docs.stripe.com/stripe-apps/patterns/{empty-state,communicating-state} · docs.stripe.com/workbench/overview · stripe.com/blog/accessible-color-systems
Motion: benji.org/family-values · github.com/emilkowalski/skills/blob/main/skills/animate/SKILL.md
Apple: lickability.com/blog/apple-sports/ · mjtsai.com/blog/2026/05/22/stats-visualization-in-apple-sports/
