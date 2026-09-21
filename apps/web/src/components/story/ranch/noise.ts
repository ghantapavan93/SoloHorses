/**
 * The ground under the threshold scene: a smooth value noise, so the field rolls without being
 * a place — nothing here is a map of anywhere. One function serves the terrain, the fence posts
 * and her hooves, so everything stands on the same ground.
 */
const PERM = new Uint8Array(512);
{
  // A fixed permutation: the field is the same on every visit.
  const p = Array.from({ length: 256 }, (_, i) => i);
  let seed = 1337;
  for (let i = 255; i > 0; i -= 1) {
    seed = (seed * 16807) % 2147483647;
    const j = seed % (i + 1);
    [p[i], p[j]] = [p[j]!, p[i]!];
  }
  for (let i = 0; i < 512; i += 1) PERM[i] = p[i & 255]!;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const grad = (h: number, x: number, y: number) => {
  switch (h & 3) {
    case 0:
      return x + y;
    case 1:
      return -x + y;
    case 2:
      return x - y;
    default:
      return -x - y;
  }
};

/** Perlin-style gradient noise in two dimensions, in [-1, 1]. */
export function noise2(x: number, y: number): number {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = fade(xf);
  const v = fade(yf);
  const aa = PERM[PERM[X]! + Y]!;
  const ab = PERM[PERM[X]! + Y + 1]!;
  const ba = PERM[PERM[X + 1]! + Y]!;
  const bb = PERM[PERM[X + 1]! + Y + 1]!;
  return lerp(
    lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u),
    lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u),
    v,
  );
}

/**
 * Height of the field at a point, in metres. Rolling far off; flat where she walks and where
 * the barn stands, so the doorway, the fence and her hooves share one level.
 */
export function ground(x: number, z: number): number {
  const rolling =
    2.6 * noise2(x * 0.018 + 3.1, z * 0.018 - 1.7) +
    0.7 * noise2(x * 0.07, z * 0.07) +
    0.18 * noise2(x * 0.25, z * 0.25);
  const reach = Math.max(Math.abs(x), -z, 0) - 16;
  const flat = Math.max(0, Math.min(1, reach / 34));
  const eased = flat * flat * (3 - 2 * flat);
  return rolling * eased;
}
