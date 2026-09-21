import type { Easing, Transition } from 'motion/react';

/**
 * The motion vocabulary, once. The stylesheet declares the same ease and durations as custom
 * properties (`--ease-out`, `--dur-*` in globals.css); this is the copy for motion that script
 * has to drive — a numeral arriving, a dot travelling, a word coming into focus — so the two
 * never drift apart.
 *
 * Two families and the rule between them: an EASE for anything autonomous (a mount, a scroll
 * reveal, a page arriving), because nothing is pushing it; a SPRING only where something answers
 * a hand (a sheet being dragged). Exits are always faster than entrances. Entrances decelerate;
 * only an exit may accelerate. Transform and opacity only; nothing animates layout.
 */
export const EASE = {
  /** The one curve: ease-out quint, as CSS spells it and as a function of progress. */
  out: 'cubic-bezier(0.22, 1, 0.36, 1)',
  outFn: (t: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 5),
  /** The same family as `motion` tuples: a long decelerating tail for entrances. */
  outQuart: [0.16, 1, 0.3, 1] as Easing,
  /** Snappier: an in-view reveal that should not linger. */
  outExpo: [0.19, 1, 0.22, 1] as Easing,
  /** Standard ease-out for secondary reveals. */
  outCubic: [0.33, 1, 0.68, 1] as Easing,
  /** Accelerating. Exits and dismissals only — never an entrance. */
  inQuart: [0.5, 0, 0.75, 0] as Easing,
} as const;

/** Milliseconds, for CSS and for the numeral. */
export const DUR = {
  /** A hover, a focus ring. */
  fast: 160,
  /** A panel opening, a row settling. */
  base: 320,
  /** A number arriving. */
  slow: 600,
} as const;

/** Seconds, for `motion`. The same three steps, plus the one reveals may take. */
export const SEC = {
  instant: 0.08,
  fast: 0.16,
  base: 0.22,
  slow: 0.28,
  reveal: 0.62,
} as const;

export const SPRING = {
  /** A panel or sheet a person is waiting for. */
  snappy: { type: 'spring', stiffness: 280, damping: 28 } as Transition,
} as const;

/** The recipes the pages repeat. Spread one into `transition`. */
export const PRESET = {
  /** A page or a card arriving. */
  enter: { duration: SEC.base, ease: EASE.outQuart } satisfies Transition,
  /** A row appearing in a list that is being filled. */
  row: { duration: SEC.fast, ease: EASE.outCubic } satisfies Transition,
  /** Something leaving. Faster than it came. */
  exit: { duration: SEC.fast, ease: EASE.inQuart } satisfies Transition,
  /** A section revealing on scroll. */
  reveal: { duration: SEC.slow, ease: EASE.outQuart } satisfies Transition,
} as const;
