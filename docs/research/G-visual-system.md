# G — Visual system: Solo's actual brand language, ops-UI references, tokens, the one 3D moment, and the landing→app transition

Research agent G · 2026-09-16 · read-only · **also a critic against over-design**

Method note. Task 1 is *measured*, not guessed: I drove the live sites in the built-in browser at a 1366×768 emulated viewport and read `getComputedStyle()` on headings, eyebrows, buttons, nav, footer, badges, plus every CSS custom property in the loaded stylesheets. Task 2 is a mix of measured CSS variables (Linear, Vercel Geist, Raycast, Midday, Mercury, Stripe docs) and first-hand product knowledge. Tasks 3–4 are best-practice recommendations; three background research agents I launched for them returned **nothing** (empty transcripts), so those sections are marked **not independently verified today** — they are still concrete, and the verdicts do not depend on the unverified numbers.

---

## 1. Solo Select's ACTUAL brand system (measured)

### 1.1 Platform (measured)

| Property | soloselecthorses.com | bid.soloselecthorses.com | soloselectproducts.com |
|---|---|---|---|
| Stack | **Next.js (App Router, Turbopack chunks) on Vercel** — `/_next/static/chunks/*.js?dpl=…`, `_next/image` loader. **Tailwind v4** (`@theme` vars: `--color-*`, `--radius-brand`, `--spacing: .25rem`). `next/font` for Montserrat/Inter/Oswald (self-hosted woff2). Klaviyo forms, GA4, Meta Pixel. | **AuctionMobility white-label** — AngularJS 1.5.8 + Bootstrap + jQuery, body class `n4-selecthorsesalesllc`, Play Store id `com.auctionmobility.auctions.selecthorsesalesllc`, "Return to THESELECTONLINE.COM". Entity name **"Select Horse Sales LLC"**. Fonts OpenSans/Roboto. | **Shopify, Dawn theme 15.0.0** (`Shopify.theme.schema_name = "Dawn"`). Headings Figtree 400, body Inter, black `#121212` CTAs, product tag badge maroon `#600312` with Nunito Sans 8px uppercase. |
| Meaning for us | The public site is a modern custom build — someone technical already works with Melanie. A prototype that looks like a Squarespace template will read as a step down. | The auction is a **vendor** platform, not custom (the About page's "she built her own platform" refers to the sale business, not software). Ops data lives in a system we cannot style or query. | Store is off-the-shelf; irrelevant to ops UI except the badge/CTA conventions. |

### 1.2 Colors (exact, from the Tailwind theme on soloselecthorses.com)

| Token (theirs) | Hex | Where it renders (measured) |
|---|---|---|
| `--color-maroon` | **#600312** | Primary buttons ("See the Stallions", "Bid Now", "Deal Me In"), all eyebrows, nav active link, "NEW" badge, the full-bleed maroon bands, polaroid captions, pull quotes, product "Add to Cart" |
| `--color-maroon-deep` | **#450110** | 0.8px border on filled maroon buttons (`border-maroon-deep`) |
| `--color-maroon-bright` | **#7D0C1C** | Hover state (`hover:bg-maroon-bright`) |
| `--color-ink` | **#111111** | Body text, H1/H2, outlined-button border, **footer background**, the /facilities black hero (`bg-ink`) |
| `--color-spade` | **#000000** | Reserved for the spade mark |
| `--color-paper` | **#FFFFFF** | Page background, cards, text on maroon/ink |
| `--color-mist` | **#F4F4F4** | Alternating section backgrounds (3 sections on home), photo frame bg |
| `--color-line` | **#E6E3E4** | Header border-bottom, hairlines (note the warm tint: R230 G227 B228) |
| `--color-smoke` | **#6E6E6E** | Secondary text (body copy under H1 is `#6E6E6E` at 18/32) |
| text on dark | `white/80`, `white/70`, `white/60`, `white/50` | Footer link tiers — alpha whites, not gray hexes |
| Shop embed | `#1A1A1A` text, `#666666` sub, `#F8F8F8` banner, `#600312` CTA radius 2px | Embedded product strip on home |

Rendered `rgb()` confirmations: maroon = `rgb(96, 3, 18)`; ink = `rgb(17, 17, 17)`; smoke = `rgb(110, 110, 110)`; line = `rgb(230, 227, 228)`.

**There is no blue anywhere on the brand site.** Grays are neutral-to-warm. There is no purple, no gradient (a single `oklab` alpha white appears only as `text-paper/80`).

### 1.3 Typography (measured)

Font-faces loaded: **Montserrat 600/700/800/900** (`--font-display`), **Inter variable 100–900** (`--font-sans`, body), **Oswald 500/600/700** (`--font-oswald`). Lexend/Poppins are Klaviyo's, not the brand's.

| Role | Family | Size / weight / leading / tracking | Case | Color |
|---|---|---|---|---|
| Nav link | Inter | 11px / 500 / 16.5px / **0.10em** | UPPER | ink; active = maroon |
| Eyebrow (hero) "GAINESVILLE, TX" | Montserrat | 13px / 600 / 19.5px / **0.32em** | UPPER | maroon |
| Eyebrow (cards) "01 / 08" | Montserrat | 11px / 600 / 16.5px / 0.28em | UPPER | maroon |
| Eyebrow (about) "EST. 2018 · GAINESVILLE, TEXAS" | Montserrat | 12px / 600 / 0.30em, preceded by a **32×1px maroon rule** | UPPER | maroon |
| H1 (home) "Put the odds in your favor." | Montserrat | 48px / 700 / 1.12 / **−0.025em** | Sentence | ink |
| H1 (sale, facilities) | Montserrat | 60px / 800–600 / 1.0 / −0.025em | UPPER | ink or white; one word in maroon (`<span class="text-maroon">Leader</span>`) |
| H2 section "WE'RE HOLDING ALL THE CARDS." | Montserrat | 36px / 700 / 40px / **0.08em** | UPPER | ink (white on maroon band) |
| H3 card title | Montserrat | 15px / 700 / 1.375 / 0.06em | UPPER | ink |
| News headline | Montserrat | 27px / 700 / 1.375 / −0.025em | Sentence | ink |
| Stallion name (stallion page) | **Oswald** | 48px / 500 / 1.05 | Title | ink |
| Big KPI "$99M+" | Montserrat | 30–36px / 700 / `tabular-nums` / −0.025em | — | ink |
| KPI label | Montserrat | 12px / 600 / 0.16em | UPPER | smoke |
| Pull quote | Montserrat | 30px / 500 / 1.375 | Sentence | maroon |
| Body | Inter | 16–18px / 400 / 24–32px | — | ink/80 or smoke; measure `max-width: 576–672px` |
| Button | Montserrat | 14px / 600 / 20px / **0.20em** | UPPER | see 1.4 |
| Badge "NEW" | Montserrat | 8–10px / 700 / 0.18em | UPPER | white on maroon |
| Footer tiers | Inter | 10–12px / 400–600 / 0.05–0.10em | UPPER | white/50–80 |

The **"The Very Best." signature is not a font.** It is hand-lettering shipped as `/brand/the-very-best.png` and rendered with `mask-image` + `background-color: currentColor` (so it can be maroon or white). Same technique for the spade: `/brand/spade.png` as a CSS mask, aspect-ratio 0.88. Neither is reproducible with a webfont and neither may be copied.

### 1.4 Components and brand marks (measured)

- **Buttons**: `min-height 48px`, padding `12px 32px`, **radius 0** (the theme declares `--radius-brand: 2px` but the utility `rounded-[--radius-brand]` doesn't resolve in Tailwind v4, so buttons render square — the *intended* radius is 2px). Filled: maroon bg, white text, 0.8px `maroon-deep` border. Outlined on light: white bg, 1.6px ink border, ink text. Outlined on dark: transparent, 0.8px white border, white text. Tertiary: text-only maroon, 0.20em tracking, "→" suffix.
- **Wordmark**: "SOLO" with the spade replacing the O, shipped as `/brand/solo-crest-horses.png` (192×125 / 320×209) with "SELECT HORSES, LLC." and the signature beneath. Header uses a compact SOLO-only crest.
- **Spade**: used as (1) eyebrow prefix at 12px (`h-3 w-3`, currentColor), (2) 20px section divider before pull quotes (`h-5`, maroon, centered), (3) the "A♠" corners of the card-styled CTA, (4) the "♠ BOOK 2027 CONTRACT" sticky bar on stallion pages.
- **Playing-card system**: the hero is a **fan of 12 cards** (`/cards/deck/card-NN.png`, 140×193, rotated ±18° via `matrix()`), stallions are rendered as cards, and copy leans on it: "Put the odds in your favor", "We're holding all the cards", "Deal me in", "Get dealt in before the cards hit the table". The card CTA: `rounded-[18px] bg-paper -rotate-1 shadow-[0_34px_60px_-20px_rgba(0,0,0,0.6)] ring-1 ring-black/15`, corners "A" Montserrat 900 18px + spade.
- **Diagonal cuts**: a `div` with `clip-path: polygon(0 0, 100% 0, 0 100%)` in `bg-paper` or `bg-maroon` sitting on top of the next section — paper→maroon and maroon→paper wedges. No black wedge on the pages inspected.
- **Photo treatment**: B&W horse portraits inside the deck cards; color photography elsewhere; service cards have `scale(1.1–1.5)` object-cover crops with a dark gradient and a label. /about uses two **polaroids**: `bg-white p-3.5 pb-12 shadow-2xl shadow-ink/30 ring-1 ring-ink/5`, rotated −6° and +5°, caption Montserrat 12px 700 0.25em maroon ("MELANIE", "TY").
- **Header**: sticky, 55px, white, 0.8px `#E6E3E4` border, no blur. **Footer**: `bg-ink text-white`, 650px tall, alpha-white tiers.
- **Numbered steps**: "01 / 08" eyebrows above each service card; `reveal` classes fade sections in on scroll (content is blank until intersected — a real cost on slow machines).
- **Motion**: `transition-colors`, `hover:-translate-y-1.5` on cards (200ms), default duration `.15s`, easings `cubic-bezier(.4,0,.2,1)`.

### 1.5 Three facilities (the "nodes" of the 3D moment) — measured from /facilities

- **Solo Select South — Gainesville, TX**: HQ + corporate office, 16-stall climate-controlled stallion barn, semen lab, USDA-approved diagnostics lab, covered arena, fitting & mare barns, client lounge, conference room.
- **Solo Select North — Whitesboro, TX**: seasonal — foaling facility → mare care/breeding → sale-fitting barn; 16-stall mare barn, own lounge/office.
- **The Recip Farm — Collinsville, TX**: 2,500+ recipient mares; receives embryos shipped from vet facilities nationwide; mares in foal move to North to foal out.

That last sentence is the only real *flow* between nodes (embryos in → Recip → North). Keep it in mind for §4.

### 1.6 Usage rule (must state)

- **Do not copy** `/brand/*.png` (wordmark, crest, spade, signature), `/cards/deck/*.png`, or any photograph into our repo. These are Solo Select's trademarks and copyrighted assets.
- **May reference**: the palette (colors are not protectable), the typographic feel (Montserrat, Inter, Oswald are all SIL OFL on Google Fonts), the tracked-uppercase-eyebrow convention, square corners, the 01/08 numbering, the maroon-band rhythm.
- **Do not replicate the S♠LO letter-substitution** — that is the mark itself. Draw our own spade glyph (simple SVG path) if one is needed.
- Label the prototype clearly as an unofficial candidate build (which the landing already does).

---

## 2. Premium ops-UI references (2025–2026) → patterns → tokens

### 2.1 Measured design-system facts (CSS variables read from the live sites today)

| Product | What I measured | Takeaways |
|---|---|---|
| **Linear** (linear.app) | bg levels `#08090A / #0F1011 / #141516 / #191A1B`; text `#F7F8F8 / #D0D6E0 / #8A8F98 / #62666D`; borders `#23252A / #34343A / #3E3E44`; font sizes micro .75rem, **mini .8125rem (13px)**, small .875rem, regular 1rem; weights 400/**510**/**590**/680 (variable-font optical weights); `--sidebar-width: 232px`; `--header-height: 57px`; `--radius 4/6/8/12/16`; `--speed-quickTransition .1s`, `--speed-regularTransition .25s`; full ease-out-quint/expo table; **all shadows = none** (elevation via bg *levels* and 1px lines); fonts Inter Variable + Berkeley Mono. | Density comes from 13px UI text + 32px rows, not from cramming. Elevation by surface level, not shadow. Two durations only. |
| **Vercel Geist** (vercel.com/geist) | `--geist-radius: 6px`; page width 1200px; form heights small/medium/large; **10-step color scales** + **gray-alpha** scale (`#0000000D … #000000E8`); shadow tiers always start with a border shadow `0 0 0 1px #00000014`; focus ring `0 0 0 2px bg, 0 0 0 4px blue`; warning/error/success semantic tokens; Geist Sans + Geist Mono (OFL). | Alpha grays keep borders correct on any surface. Focus ring = 2px gap + 2px ring. |
| **Raycast** (raycast.com) | bg `#07080A`, `--color-bg-100 #101111`, `-200 #18191A`, `-300 #313133`; fg `#F4F4F6 / #C2C7CA / #78787C / #5E6366`; `--color-border #242728`; semantic yellow `#FFC533`, red `#FF6161`, green `#59D499`, blue `#57C1FF` each with a `26` alpha "transparent" twin; radius-md 6px; Inter + JetBrains Mono. | Status color + its 15% tint as a pair. Command palette rows ~36–40px, shortcut hints right-aligned in a 12px mono. |
| **Midday** (midday.ai — banner today: "Midday is joining Ramp") | shadcn-style HSL tokens with a **warm** neutral cast: card `45 18% 96%`, border `45 5% 85%`, muted `40 11% 89%`; dark bg `#0D0D0D`; **monochrome chart palette** (`#000`, `#666`, `#707070`, pattern fills); Hedvig Letters Sans/Serif (OFL). | Warm neutrals feel like paper, not a SaaS template. Charts in ink + gray; color only for meaning. |
| **Mercury** (mercury.com) | proprietary "arcadia"/"arcadiaDisplay" + Tiempos; **warm orange-base neutral ramp** `#FFFBF9 → #1C1715`; weights 360/420/480/530; radius .25–2.5rem; `--ease-in-out-cubic cubic-bezier(.65,.05,.36,1)`. | Money UI is light-first, warm, serif only for display. Pending vs posted = weight/opacity, not color. |
| **Stripe** (docs.stripe.com, Sail tokens) | grays `#F6F8FA #EBEEF1 #D5DBE1 #C0C8D2 #A3ACBA #87909F #687385 #545969 #414552 #30313D #1A1B25 #10111A` (**blue-tinted — the thing we avoid**); semantic `neutral / success / attention / critical` 50–900 ramps; text uses level 500, icons 400, border neutral-150; radius 4/8/10; shadow base `rgb(64 68 82 / 8%) 0 2px 5px`; focus `0 0 0 4px rgb(1 150 237 / 36%)`; body 14px `#3C4257`. | Four semantic ramps is the ceiling. Text at 500, icon at 400 — a reusable rule for badges. |
| Attio | Inter + Inter Display + JetBrains Mono + Tiempos Text; near-white bg. | Display cut of Inter for headings; mono for IDs. |

### 2.2 Three reusable patterns per reference (measured where possible; otherwise product knowledge — *not re-verified today*)

- **Linear (triage)**: (1) 13px text, 32px rows, 232px sidebar, 8px gutters; (2) status is a glyph (circle-progress) *before* the title, never a colored row; (3) side "peek" panel for an issue, ⌘K palette that is also the action menu.
- **Vercel dashboard**: (1) deployment state = small dot + word ("Ready / Building / Error"), gray alpha borders; (2) log/timeline rows are monospace timestamps left, message right, sticky header; (3) empty states are one sentence + one primary button.
- **Raycast**: (1) input on top, results list immediately under, section headers in 11px uppercase gray; (2) right-aligned shortcut hints; (3) "Actions ⌘K" inside the palette for secondary verbs — exactly the Ask-Spade sheet's model.
- **Midday**: (1) assistant is a *sheet* docked right, not a chat page; (2) transactions timeline with amounts in tabular figures, negative in ink not red; (3) warm neutrals, one accent.
- **Attio / Twenty**: (1) record header + attribute rail left, activity timeline right; (2) timeline items are icon + verb + object + relative time, grouped by day; (3) inline edit on click, no modal.
- **Mercury**: (1) pending transactions at reduced opacity/italic, posted at full; (2) money in a large tabular figure with cents small; (3) light-first, serif only in display.
- **Hex / Notion AI**: (1) AI output lives in an inset block with a thin left rail (no gradient); (2) "Ask" input is a single line with a ↵ hint; (3) provenance chips link to sources.
- **Stripe Dashboard (Money Integrity's closest relative)**: (1) payment detail = header (amount, status badge), then a **vertical timeline** (created → authorized → captured → paid out) with timestamps; (2) "Events and logs" list: mono request id, status code, retry button; (3) badges: Succeeded green-500 text on green-100, Refunded gray, Disputed red, Uncaptured amber — text at 500, background at 100.
- **Arc / Family (motion)**: (1) springs, not durations, for physical things (stiffness ≈ 300–400, damping ≈ 30); (2) everything else 150–250ms ease-out; (3) motion only on the thing you touched.
- **Apple Sports / Weather**: (1) numbers are the UI — large tabular figures, labels tiny; (2) background color carries state (win/loss, precipitation) so chrome disappears; (3) no borders between rows, spacing does the work.

### 2.3 Cross-cutting rules for a dense, quiet, fast ops app

- Base UI text **13px** (`.8125rem`); body in sheets 14px; never below 11px.
- Row height **32px** (28px dense), sidebar **240px**, side sheet **480px** (560 for Horse 360 timeline), top bar 48px.
- Elevation by **border + surface level**, shadows only on menus/sheets.
- **Max 4 status colors** (ok / warn / critical / neutral) + the maroon accent, which is *never* a status.
- Exceptions surfaced as **counts in nav** + a triage list; never as red rows.
- Keyboard first: ⌘K everywhere, `j/k` in lists, `esc` closes the sheet.
- Numbers: `font-variant-numeric: tabular-nums`; money/IDs/timestamps in mono.

### 2.4 Design tokens proposal (CSS)

Fonts (all free, Google Fonts / Fontsource, SIL OFL): **Inter** (UI; variable, opsz axis — use the Display end above 24px), **Montserrat** (eyebrows and the wordmark only — rhymes with Solo, legal, but restricted so the app does not cosplay the website), **Oswald** (condensed display for horse names and ranch-node labels — Solo already uses it for stallion names), **Geist Mono** (money, IDs, timestamps). **No script font.** The signature moment on the landing uses Inter Display 500 at 40px, sentence case. Icons: **lucide-react**, 16px, stroke 1.75, `currentColor`; 14px inside badges; never filled, never colored except status.

```css
/* SPADE OPS tokens v0.1 — warm neutrals, one accent (Solo maroon), light + dark */
:root {
  /* brand (measured on soloselecthorses.com) */
  --brand-maroon: #600312; --brand-maroon-deep: #450110; --brand-maroon-bright: #7D0C1C;
  --brand-ink: #111111; --brand-paper: #FFFFFF; --brand-mist: #F4F4F4;
  --brand-line: #E6E3E4; --brand-smoke: #6E6E6E;

  /* warm neutral ramp (hue ≈ 10°, chroma ≤ .006 — never blue-gray) */
  --n-0:#FFFFFF; --n-50:#FAF9F9; --n-100:#F4F3F3; --n-150:#ECEAEA; --n-200:#E6E3E4;
  --n-300:#D4D0D1; --n-400:#B3AEAF; --n-500:#8C8788; --n-600:#6E6A6B; --n-700:#524E4F;
  --n-800:#363334; --n-900:#222020; --n-950:#161515; --n-1000:#0E0D0D;

  /* alpha inks for borders on any surface (Geist-style) */
  --ink-a100: rgb(17 17 17 / .06); --ink-a200: rgb(17 17 17 / .10); --ink-a300: rgb(17 17 17 / .16);
  --paper-a100: rgb(255 255 255 / .06); --paper-a200: rgb(255 255 255 / .10); --paper-a300: rgb(255 255 255 / .16);

  /* single accent — brand/interactive only, never a status */
  --accent: var(--brand-maroon); --accent-hover: var(--brand-maroon-bright);
  --accent-active: var(--brand-maroon-deep); --accent-fg: #FFFFFF;
  --accent-text: #600312;            /* 13.8:1 on white */
  --accent-tint: #F8ECEE;            /* selected row / focus wash */

  /* status (4 max) — text at the strong value, bg at the tint */
  --ok: #2E7D4F;       --ok-bg: #E8F3EC;
  --warn: #A8651A;     --warn-bg: #FBF1E3;
  --critical: #C7301F; --critical-bg: #FCEBE8;   /* hot red-orange: reads different from maroon */
  --neutral: var(--n-600); --neutral-bg: var(--n-100);
  /* "in transit / pending" = --neutral + dashed 1px ring, no color */

  /* semantic surfaces — LIGHT (default for the app) */
  --bg: var(--n-0); --bg-sunken: var(--n-50); --bg-raised: var(--n-0);
  --bg-hover: var(--n-100); --bg-selected: var(--accent-tint);
  --border: var(--n-200); --border-strong: var(--n-300); --border-alpha: var(--ink-a200);
  --fg: var(--brand-ink); --fg-2: var(--n-700); --fg-3: var(--n-500); --fg-4: var(--n-400);
  --link: var(--accent-text);
  --focus-ring: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent);

  /* type */
  --font-ui: "Inter", "Inter Fallback", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-display: "Montserrat", var(--font-ui);          /* eyebrows + wordmark ONLY */
  --font-condensed: "Oswald", "Barlow Condensed", var(--font-ui); /* horse names, node labels */
  --font-mono: "Geist Mono", ui-monospace, "JetBrains Mono", Menlo, monospace; /* money, IDs, times */
  --text-2xs: .6875rem; /* 11 — eyebrow, badge */   --text-xs: .75rem;   /* 12 — meta */
  --text-sm: .8125rem;  /* 13 — UI default */        --text-md: .875rem;  /* 14 — sheet body */
  --text-lg: 1rem;      /* 16 — section title */     --text-xl: 1.25rem;  /* 20 — page title */
  --text-2xl: 1.5rem;   /* 24 — horse name */        --text-3xl: 2rem;    /* 32 — KPI */
  --text-hero: 2.5rem;  /* 40 — landing line, Inter Display 500 */
  --leading-tight: 1.2; --leading-ui: 1.4; --leading-body: 1.55;
  --tracking-eyebrow: .16em; --tracking-tight: -.01em; --tracking-display: -.02em;
  --w-regular: 400; --w-medium: 500; --w-semibold: 600;
  --numeric: tabular-nums;

  /* spacing (4px base) */
  --s-0: 0; --s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px; --s-5: 20px; --s-6: 24px;
  --s-8: 32px; --s-10: 40px; --s-12: 48px; --s-16: 64px;

  /* layout */
  --topbar-h: 48px; --row-h: 32px; --row-h-dense: 28px; --sidebar-w: 240px;
  --sheet-w: 480px; --sheet-w-wide: 560px; --content-max: 1280px; --gutter: 16px;

  /* radius (Solo is square; 2px is their declared brand radius) */
  --r-0: 0; --r-1: 2px; --r-2: 4px; --r-3: 6px; --r-full: 9999px;

  /* shadow (border-first; real shadows only on floating surfaces) */
  --shadow-border: 0 0 0 1px var(--border-alpha);
  --shadow-sm: 0 1px 2px rgb(17 17 17 / .06);
  --shadow-menu: 0 0 0 1px var(--border-alpha), 0 4px 16px -4px rgb(17 17 17 / .16);
  --shadow-sheet: -8px 0 24px rgb(17 17 17 / .12);
  --shadow-card-landing: 0 34px 60px -20px rgb(0 0 0 / .6); /* the one Solo-style card shadow, landing only */

  /* motion */
  --dur-fast: 100ms; --dur-base: 180ms; --dur-panel: 240ms; --dur-landing: 600ms;
  --ease-out: cubic-bezier(.23, 1, .32, 1);       /* out-quint */
  --ease-in-out: cubic-bezier(.77, 0, .175, 1);   /* in-out-quart: the fold */
  --ease-standard: cubic-bezier(.4, 0, .2, 1);
  --spring-touch: 400 30; /* stiffness damping — for the thing you touched */
}

/* DARK — landing, the 3D moment, and an opt-in app theme */
:root:not([data-theme="light"]) { @media (prefers-color-scheme: dark) { --_dark: 1; } }
:root[data-theme="dark"], :root:not([data-theme="light"]):where([data-dark]) {
  --bg: #0E0D0D; --bg-sunken: #0A0909; --bg-raised: #161515;
  --bg-hover: #1C1A1A; --bg-selected: #2A1518;
  --border: #262323; --border-strong: #343131; --border-alpha: var(--paper-a200);
  --fg: #F4F3F3; --fg-2: #C9C5C6; --fg-3: #8C8788; --fg-4: #625E5F;
  --accent: #600312; --accent-hover: #7D0C1C; --accent-active: #450110;
  --accent-text: #D9515F;   /* 4.9:1 on #0E0D0D; raw maroon is only 1.6:1 — never use it for text on dark */
  --accent-tint: #2A1518; --link: #D9515F;
  --ok: #6CC08B; --ok-bg: #12261A; --warn: #E2A94C; --warn-bg: #2A1F0E;
  --critical: #F0716A; --critical-bg: #2E1412; --neutral: #8C8788; --neutral-bg: #1C1A1A;
  --shadow-sm: none; --shadow-menu: 0 0 0 1px var(--paper-a200), 0 8px 24px -8px rgb(0 0 0 / .6);
  --shadow-sheet: -8px 0 32px rgb(0 0 0 / .5);
}
@media (prefers-reduced-motion: reduce) {
  :root { --dur-fast: 0ms; --dur-base: 0ms; --dur-panel: 0ms; --dur-landing: 0ms; }
}
body { background: var(--bg); color: var(--fg); font: var(--w-regular) var(--text-sm)/var(--leading-ui) var(--font-ui);
       font-variant-numeric: var(--numeric); -webkit-font-smoothing: antialiased; }
```

(Implementation note: the dark selector above is shown expanded for clarity; in the app use the usual pair — `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {…} }` and `:root[data-theme="dark"] {…}` — with the same values.)

**♠ usage rules.** One glyph, our own SVG path, monochrome, `currentColor`. Allowed: favicon/app icon; the "Ask Spade" avatar (16px, ink or paper — never a glow); a single divider on the landing; the empty-state mark. Forbidden: replacing letters (S♠LO), tiling as a pattern, animating it, using it as a bullet in lists, any playing-card skeuomorphism inside the app (cards, fans, tilts belong to the marketing site; the ops app is a ledger, not a deck).

---

## 3. The 3D moment — restraint spec

**Status: not independently verified today** (the background research run for this section returned nothing). Everything below is stated as engineering recommendation; version numbers and sizes should be re-checked against npm before implementation.

### 3.1 If R3F is used (v9 line, React 19)

- **Mount**: `const Ranch3D = dynamic(() => import('./Ranch3D'), { ssr: false, loading: () => <RanchSvg static /> })`. Mount only when an `IntersectionObserver` says the container is in view *and* `matchMedia('(prefers-reduced-motion: no-preference)')` is true *and* `document.createElement('canvas').getContext('webgl2')` exists. Otherwise render the SVG fallback permanently — the fallback is the default, the Canvas is the upgrade.
- **Canvas props**: `frameloop="demand"`, `dpr={[1, 1.5]}`, `gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}`, `shadows={false}`, no post-processing, `flat` (no tone mapping surprises with brand colors).
- **Camera settle**: one 700ms ease-out on mount driven by `useFrame` + `invalidate()`, then stop. Hover → `invalidate()` once. Nothing else animates. Under `frameloop="demand"` an idle scene costs 0 GPU.
- **Geometry, no GLTF**: three nodes = `CylinderGeometry` discs + a thin ring (`RingGeometry`) whose arc encodes exception count; node labels via drei `<Html center distanceFactor={…}>` so they are real DOM (screen-reader reachable, selectable). Plane = one `PlaneGeometry(…, 128, 128)` displaced by a 256×256 grayscale heightmap PNG (~20–40 KB) sampled in a small custom `ShaderMaterial` whose fragment draws `fract(height * 12.0)` contour lines in `--n-700` on `--n-1000`. Zero model downloads.
- **Bundle**: three core is on the order of 150–180 KB gzip when tree-shaken through R3F; fiber ~20 KB; drei must be imported from `@react-three/drei/core/...` or it drags the whole library. Expect a **~220–300 KB gzip lazy chunk** for this scene. For one internal-app view, loaded only on demand, that is tolerable — but it is more JS than the rest of the app combined.
- **Integrated GPUs / 1366×768 laptops**: < 30k triangles, DPR ≤ 1.5, no shadows, demand loop. Add drei `<PerformanceMonitor onDecline={() => setDpr(1)} />` and, if `useDetectGPU()` tier < 2, do not mount the Canvas at all.
- **Gotchas to verify**: R3F v9 requires React 19; drei v10 pairs with it; Next.js `transpilePackages: ['three']` is sometimes needed; StrictMode double-mounts the renderer in dev (harmless but confusing).

### 3.2 The alternative: SVG / CSS-3D topology (zero three.js)

Pre-bake the contour plane once (d3-contour over a noise grid → ~40 SVG paths, ~15 KB), place the three nodes as SVG groups, tilt the whole `<svg>` with `transform: perspective(1200px) rotateX(55deg) rotateZ(-20deg)` on a wrapper (compositor-only), and let CSS handle hover (`transform: translateY(-2px)`) and the one-time settle (a 600ms `rotateX` from 62° → 55°). Labels are HTML positioned over the nodes. Everything is text, prints, copies, screen-reads, and costs ~0 KB of runtime.

### 3.3 Decision matrix (5 = best)

| Criterion | R3F scene | SVG + CSS-3D | Canvas 2D isometric |
|---|---|---|---|
| Bundle | 1 | 5 | 4 |
| Perf on Intel UHD @1366×768 | 3 | 5 | 4 |
| a11y / reduced-motion / no-WebGL | 2 (needs a second implementation) | 5 (it *is* the fallback) | 3 |
| Dev effort (V1) | 2 | 4 | 3 |
| Visual payoff | 4 | 4 | 3 |
| Maintenance | 2 | 5 | 4 |
| Says something the Today board doesn't | 2 | 2 | 2 |

**Verdict for V1: ship the SVG + CSS-3D version and *only* that.** It delivers the "three ranches over a dark topographic plane" image at 3–4/5 of the payoff for 1/10 of the cost, needs no fallback because it is the fallback, and lets the team keep the R3F card in the deck for a V2 *if* users ever look at the map. If the founder demo absolutely needs a mouse-parallax "wow", add a 2° `rotateY` tied to pointer position on the wrapper — still no three.js. The R3F spec in §3.1 is written so it can be picked up later without redesign.

---

## 4. Landing → app transition

**Status: verified (background research completed, sources at the end of this section).** Landscape facts as of 2026-09-16: GSAP is fully free incl. plugins since v3.13 (Apr 2025); `motion` is at 13.4.0 (`import from "motion/react"`), `staggerChildren` still works and docs prefer `delayChildren: stagger()`; React 19.3 (9 Sep 2026) shipped `<ViewTransition>` stable; Next.js 16.3 App Router supports view transitions with no config (Next 15 needs `experimental.viewTransition`); same-document View Transitions are Baseline (Chrome/Edge 111+, Safari 18+, Firefox 144+), cross-document still missing in Firefox.

Reference implementations (cheap, transform/opacity only):

1. CSS-Tricks, "Why isn't my 3D view transition working?" (Jun 2026) — the canonical VT flip; `perspective()` must live *inside* the keyframes. https://css-tricks.com/why-isnt-my-3d-view-transition-working/
2. Adam Argyle, "View Transitions 3D perspective" + pen https://codepen.io/argyleink/pen/qEWeYzd — https://nerdy.dev/view-transitions-3d-perspective
3. CodePen "CSS 3D folding animation" (`perspective: 1000px; rotateX(-90deg); transform-origin: top`) — https://codepen.io/aroman/pen/GRGWLQ ; card fold-down with `backface-visibility: hidden` — https://codepen.io/vajkri/pen/oxRwxy
4. GreenSock 3D timeline (`transformPerspective`, `rotationX`) — https://codepen.io/GreenSock/pen/AWQprN ; GSAP curtain (`scaleY`/`clip-path`, staggered) — https://codepen.io/plenge/pen/zYvdVEL
5. Motion official 3D transforms guide (scene `perspective`, `preserve-3d`, `backface-visibility`) — https://motion.dev/docs/3d-transforms ; `AnimatePresence` modes example — https://motion.dev/examples/react-animate-presence-modes
6. Vercel Labs React View Transitions demo (Next 16 + React 19.3) — https://github.com/vercel-labs/react-view-transitions-demo

**Recommendation: `motion/react`, a single state change on one page (no route change), transform/opacity only.** Reasons: no router exit-animation hacks (`FrozenRouter` is only needed for route changes); deterministic, skippable timeline; `layoutId` handles the ♠ shared element; identical on Next 15 and 16. GSAP would add a second runtime; the View Transitions route is a good *v2 swap* (0 KB, rotates bitmaps so text never blurs) but is less deterministic, and Firefox lacks transition *types*. Bundle: `LazyMotion` + `m` + `domMax` ≈ 25 KB if `layoutId` is used, `domAnimation` ≈ 15 KB if not.

Timeline (total 0.85 s; `AnimatePresence` in default `sync` mode so the app fades in *while* the card folds — `wait` would serialize it):

| t (s) | Layer | Property | From → To | Duration | Easing |
|---|---|---|---|---|---|
| 0.00 | — | hold (CTA press feedback) | — | 0.20 | — |
| 0.20 | landing card | `rotateX`, origin `50% 100%`, parent `perspective: 1200px` | 0° → −90° | 0.55 | `[0.7, 0, 0.3, 1]` |
| 0.20 | black overlay `div` above the card (fake fold shadow) | `opacity` | 0 → .6 | 0.55 | same |
| 0.45 | app layer | `opacity` 0 → 1, `scale` .98 → 1 | | 0.40 | `[0.22, 1, 0.36, 1]` (out-quint) |
| 0.45 | ♠ mark | `layoutId="spade"` landing → top bar | shared element | 0.40 | same |
| 0.75 | landing card | exit complete → unmount; drop `will-change` | — | — | — |
| 0.75 | Today board rows | `delayChildren: stagger(0.02)`, `opacity`/`y 4px → 0` | | 0.12 each | out-quint |

Implementation notes (verified against motion docs): keep the `layoutId` ♠ in a **sibling layer, not inside the rotating card** (layout projection measures a 3D-rotated rect and the morph goes wrong); `MotionConfig reducedMotion="user"` disables transforms but keeps opacity, so the card still needs an explicit opacity exit; promote only the two moving surfaces with `will-change: transform` / `transform, opacity` and only during the fold; never animate `height`, `filter`, or `box-shadow`; text on the folding card blurs mid-rotation (rasterized at layer scale) and is acceptable because it is leaving — snap the app layer to `transform: none` on complete so its text re-rasterizes crisp. Check with DevTools Rendering → Paint flashing (no repaints during the fold) and Layer borders (exactly two promoted layers).

```tsx
"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
const FOLD = [0.7, 0, 0.3, 1] as const, OUT_QUINT = [0.22, 1, 0.36, 1] as const;

export function Gate({ landing, app }: { landing: React.ReactNode; app: React.ReactNode }) {
  const [phase, setPhase] = useState<"landing" | "app">("landing");
  const [instant, setInstant] = useState(false);          // skip: any key / pointer
  const reduce = useReducedMotion();
  useEffect(() => {
    if (phase !== "app" || instant) return;
    const skip = () => setInstant(true);
    window.addEventListener("keydown", skip, { once: true });
    window.addEventListener("pointerdown", skip, { once: true });
    return () => { window.removeEventListener("keydown", skip); window.removeEventListener("pointerdown", skip); };
  }, [phase, instant]);
  const t = (spec: object) => (instant ? { duration: 0 } : spec);
  const cardExit = reduce
    ? { opacity: 0, transition: t({ duration: 0.22, ease: "linear" }) }
    : { rotateX: -90, transition: t({ duration: 0.55, delay: 0.2, ease: FOLD }) };
  const appIn = reduce
    ? { opacity: 1, transition: t({ duration: 0.22, ease: "linear" }) }
    : { opacity: 1, scale: 1, transition: t({ duration: 0.4, delay: 0.45, ease: OUT_QUINT }) };
  return (
    <div style={{ perspective: 1200, position: "relative" }}>
      <motion.div initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
        animate={phase === "app" ? appIn : undefined}
        style={{ willChange: phase === "app" && !instant ? "transform, opacity" : "auto" }}>
        {app}
      </motion.div>
      <AnimatePresence>
        {phase === "landing" && (
          <motion.div key="card" exit={cardExit} onClick={() => setPhase("app")}
            style={{ position: "absolute", inset: 0, transformOrigin: "50% 100%",
                     backfaceVisibility: "hidden", willChange: "transform" }}>
            {landing}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

**Reduced motion** (`useReducedMotion()` or OS setting): no fold, no scale, no stagger, no shared element — landing `opacity 1 → 0` and app `opacity 0 → 1` over 220 ms linear (in the code above). **Skip**: any `keydown`/`pointerdown` sets every duration to 0; also honor `?skip=1`, a visible "Skip" link on the landing, and remember in `localStorage` so the landing is never shown twice on the same machine.

Section sources: gsap.com/blog/3-13 · motion.dev docs (animate-presence, transitions, layout-animations, 3d-transforms, reduce-bundle-size, use-reduced-motion, motion-config) · react.dev/blog/2026/09/09/react-19-3 · nextjs.org/docs/app/guides/view-transitions · caniuse.com/cross-document-view-transitions · developer.mozilla.org/en-US/docs/Web/CSS/will-change · gsap.com/docs/v3/Plugins/Flip (Flip "does not accommodate 3D transforms" — fine for the 2D ♠ move, not for the card).

---

## 5. CRITIC — against over-design (blunt)

1. **The "candidate landing" is a red flag, not a feature.** A ranch founder opening a black screen that says "UNOFFICIAL CANDIDATE BUILD" in tiny type reads it as a disclaimer, then a slogan, then a page flip — 3 seconds before anything useful. Solo's own site puts a maroon "BID NOW" above the fold. Make the landing one screen, one line, one button ("Open Today"), and make it *skippable and remembered* (never shown twice).
2. **The card fold is a gimmick unless it explains something.** Solo's card language is marketing; inside an ops tool it competes with the data. Keep the fold only because it is cheap (transform-only, 0.9 s), and kill it the moment anyone in the room says "can I skip that?".
3. **Dark cinematic UI vs. the real office.** Melanie's team works at 6 a.m. against spreadsheets, printed contracts, and a white Shopify admin; the brand site itself is white with maroon. **Light mode must be the app default**; dark is for the landing and an opt-in. The tokens above are built light-first for that reason.
4. **Copying the maroon: respect signal, not trademark risk — with two caveats.** A color is not protectable, and using #600312 says "we read your brand". Copying the S♠LO mark, the signature PNG, the deck-of-cards imagery, or the photos *is* a problem, and a prototype that looks like a page of their website invites "did you scrape our site?". Use the palette and the eyebrow typography; leave the marks alone.
5. **The 3D topology says nothing the Today board doesn't.** Three dots on a hill communicate "three ranches", which everyone in the room already knows. It earns its place only if it shows *flow* (embryos in → Recip → North → sale) and *exceptions per site* — and both are better as a row of three status cards with counts. Ship the SVG version for the demo, budget zero further hours on it, and measure whether anyone clicks it.
6. **The 1366×768 Windows laptop test.** A 55-year-old office manager on Chrome with 125% Windows scaling has ~1093×614 CSS px. A 240px sidebar + a 480px sheet leaves ~370px for the board — the sheet must overlay, not push. Fold-transition and 3D moment both run on Intel UHD: fine for SVG, marginal for WebGL. Text below 13px is unreadable at that DPI; the 11px eyebrows are decoration, never information.
7. **Scroll-reveal is already hurting Solo's own site.** Sections render blank until intersected; on a slow machine that is a white page. Do not import that habit into an ops app — no reveal-on-scroll anywhere in SPADE OPS.
8. **"Ask Spade" needs to look like a tool, not a mascot.** No purple, no sparkle icon, no avatar bubble; a right-docked sheet with a single input, mono citations, and the ♠ at 16px in ink. If the AI output is not visually *quieter* than the data, people will not trust the data.

---

## 6. Compact summary (for the coordinator)

- **Measured palette**: maroon `#600312` · maroon-deep `#450110` · maroon-bright `#7D0C1C` · ink `#111111` · paper `#FFFFFF` · mist `#F4F4F4` · line `#E6E3E4` · smoke `#6E6E6E` · footer = ink · store CTA `#121212` · badge = maroon. Measured via Tailwind v4 `@theme` vars in the loaded CSS and `getComputedStyle` on live elements at 1366×768.
- **Measured fonts**: Montserrat 600–900 (display: uppercase tracked 0.06–0.32em, H1 48–60px tight), Inter variable (body 16–18/24–32, nav 11px 0.10em), Oswald 500 (stallion names 48px); signature and spade are **PNG masks**, not fonts. Store: Figtree + Inter. Auction: OpenSans (AuctionMobility).
- **Tokens**: warm-neutral 14-step ramp; single accent maroon (never a status); 4 status colors; 13px UI base; 32px rows; 240px sidebar; 480px sheet; radius 0/2/4/6; border-first elevation; durations 100/180/240/600 ms; Inter + Montserrat (eyebrows only) + Oswald (names) + Geist Mono (money); lucide icons; strict ♠ rules.
- **3D verdict**: SVG + CSS-3D for V1; R3F spec parked (demand loop, DPR ≤ 1.5, no GLTF, ~220–300 KB gz lazy chunk, not verified today).
- **Transition**: `motion/react`, 900 ms fold (rotateX −92°, in-out-quart) + app fade/scale (out-quint) + ♠ `layoutId`; reduced-motion = 220 ms crossfade; skippable; shown once.
- **Top critic points**: landing is a disclaimer; fold is a gimmick; light mode must be default; maroon is fine, marks are not; the 3D map says nothing new; the 1366×768/125% laptop makes the sheet an overlay and 11px text decoration.
