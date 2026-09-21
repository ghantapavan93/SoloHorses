/**
 * The arithmetic of a walk cycle read off a clip, kept pure so it can be tested without a
 * model: when a hoof comes down, how far the planted hooves carry her per cycle, and whether a
 * footfall was crossed between two scrubs of the clip.
 */

/** A sample counts as on the ground within this fraction of the hoof's lift above its lowest. */
const GROUNDED_BAND = 0.12;
/** A scrub further than this fraction of a cycle is a jump, not a step: no footfall is crossed. */
const STEP_LIMIT = 0.25;

function groundedMask(heights: ArrayLike<number>): boolean[] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < heights.length; i += 1) {
    lo = Math.min(lo, heights[i]!);
    hi = Math.max(hi, heights[i]!);
  }
  const band = lo + (hi - lo) * GROUNDED_BAND;
  return Array.from({ length: heights.length }, (_, i) => heights[i]! < band);
}

/**
 * The sample at which the hoof meets the ground: the first grounded sample after one in the
 * air, the cycle taken as a loop. A hoof that never leaves the ground, or never lands, gives -1.
 */
export function touchdownIndex(heights: ArrayLike<number>): number {
  const grounded = groundedMask(heights);
  const n = grounded.length;
  for (let s = 0; s < n; s += 1) if (grounded[s] && !grounded[(s + n - 1) % n]) return s;
  return -1;
}

/**
 * How far she travels per cycle by the hooves' account: while a hoof is planted it moves
 * backward under her at her walking speed, so the mean backward step across grounded samples,
 * times the samples in a cycle, is the stride. Per-step deltas, so the loop's seam never counts.
 * Zero when the hoof is never planted or moves the wrong way.
 */
export function strideFromStance(heights: ArrayLike<number>, forward: ArrayLike<number>): number {
  const grounded = groundedMask(heights);
  const n = grounded.length;
  let travel = 0;
  let count = 0;
  for (let s = 0; s < n; s += 1) {
    const next = (s + 1) % n;
    if (grounded[s] && grounded[next]) {
      travel += forward[s]! - forward[next]!;
      count += 1;
    }
  }
  return count > 0 && travel > 0 ? (travel / count) * n : 0;
}

/**
 * Whether a footfall at `at` seconds into the cycle was passed moving forward from `last` to
 * `now`, wrapping at `duration`. A scroll that runs backward, or jumps more than a quarter of
 * the cycle, crosses nothing: dust is for steps, not for seeks.
 */
export function footfallCrossed(last: number, now: number, duration: number, at: number): boolean {
  const forward = now >= last ? now - last : now + duration - last;
  if (forward === 0 || forward >= duration * STEP_LIMIT) return false;
  const since = at >= last ? at - last : at + duration - last;
  return since > 0 && since <= forward;
}
