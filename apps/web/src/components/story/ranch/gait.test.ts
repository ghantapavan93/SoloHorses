import { describe, expect, it } from 'vitest';
import { footfallCrossed, strideFromStance, touchdownIndex } from './gait';

/** A hoof's height over one cycle: in the air for the first `swing` samples, then planted flat. */
function arc(n: number, swing: number, lift = 0.2): number[] {
  return Array.from({ length: n }, (_, s) => (s < swing ? lift * Math.sin((Math.PI * (s + 0.5)) / swing) : 0));
}

describe('touchdownIndex', () => {
  it('is the moment the hoof comes down, not wherever it happens to be lowest', () => {
    // The stance is flat: the lowest sample is not unique. Touchdown is the first grounded one after the swing.
    expect(touchdownIndex(arc(24, 10))).toBe(10);
  });
  it('reads across the seam of the loop', () => {
    const heights = arc(24, 10);
    // Rotate so the landing sits at the very start of the cycle: the sample before it is the last one, in the air.
    const rotated = [...heights.slice(10), ...heights.slice(0, 10)];
    expect(touchdownIndex(rotated)).toBe(0);
  });
  it('is -1 for a hoof that never lands or never lifts', () => {
    expect(touchdownIndex(Array.from({ length: 12 }, () => 0))).toBe(-1);
  });
});

describe('strideFromStance', () => {
  it('is the distance the planted hoof carries her per cycle', () => {
    const n = 24;
    const heights = arc(n, 10);
    // While planted the hoof slides back 0.05 m per sample; over a full cycle that is 1.2 m.
    const forward = Array.from({ length: n }, (_, s) => (s < 10 ? 0.4 : 0.4 - (s - 10) * 0.05));
    expect(strideFromStance(heights, forward)).toBeCloseTo(1.2, 6);
  });
  it('is nothing for a hoof that slides the wrong way, or is never planted', () => {
    const n = 24;
    expect(
      strideFromStance(
        arc(n, 10),
        Array.from({ length: n }, (_, s) => s * 0.05),
      ),
    ).toBe(0);
    expect(
      strideFromStance(
        arc(n, n),
        Array.from({ length: n }, () => 0),
      ),
    ).toBe(0);
  });
});

describe('footfallCrossed', () => {
  const duration = 1.2;
  it('is crossed by a small forward step over it', () => {
    expect(footfallCrossed(0.4, 0.5, duration, 0.45)).toBe(true);
    expect(footfallCrossed(0.4, 0.5, duration, 0.5)).toBe(true);
    expect(footfallCrossed(0.4, 0.5, duration, 0.4)).toBe(false);
    expect(footfallCrossed(0.4, 0.5, duration, 0.6)).toBe(false);
  });
  it('is crossed across the seam of the loop', () => {
    expect(footfallCrossed(1.15, 0.05, duration, 1.18)).toBe(true);
    expect(footfallCrossed(1.15, 0.05, duration, 0.02)).toBe(true);
    expect(footfallCrossed(1.15, 0.05, duration, 0.1)).toBe(false);
  });
  it('is never crossed scrolling backward, however little', () => {
    expect(footfallCrossed(0.5, 0.4, duration, 0.45)).toBe(false);
    expect(footfallCrossed(0.05, 1.15, duration, 1.18)).toBe(false);
  });
  it('is never crossed by a seek: a jump of a quarter cycle or more', () => {
    expect(footfallCrossed(0.1, 0.4, duration, 0.2)).toBe(false);
    expect(footfallCrossed(0.1, 0.39, duration, 0.2)).toBe(true);
  });
  it('is never crossed when nothing moved', () => {
    expect(footfallCrossed(0.3, 0.3, duration, 0.3)).toBe(false);
  });
});
