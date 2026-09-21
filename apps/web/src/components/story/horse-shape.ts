/**
 * An original horse, as points. Tuned here once and drawn twice: as a contour in SVG, and as
 * an extruded, lit body in the threshold scene. She is a drawing, not a photograph or a model
 * of anyone's horse — the story needs a mare walking through a morning, and then needs her to
 * become the records about her. Coordinates are the drawing's own: 340 wide, 280 high, the
 * ground at 258, facing right.
 */
export const HORSE_VIEWBOX = { w: 340, h: 280, ground: 258 } as const;

export type Pt = readonly [number, number];

/** Catmull-Rom through the points, as cubic Béziers. */
export function smooth(points: readonly Pt[], closed: boolean, tension = 0.5): string {
  const n = points.length;
  const at = (i: number): Pt => points[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))]!;
  let d = `M ${points[0]![0]} ${points[0]![1]}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i += 1) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1 = [p1[0] + ((p2[0] - p0[0]) * tension) / 3, p1[1] + ((p2[1] - p0[1]) * tension) / 3];
    const c2 = [p2[0] - ((p3[0] - p1[0]) * tension) / 3, p2[1] - ((p3[1] - p1[1]) * tension) / 3];
    d += ` C ${c1[0]!.toFixed(1)} ${c1[1]!.toFixed(1)}, ${c2[0]!.toFixed(1)} ${c2[1]!.toFixed(1)}, ${p2[0]} ${p2[1]}`;
  }
  return closed ? `${d} Z` : d;
}

/** The same Catmull-Rom, sampled: `per` points per span, for a shape a mesh can be built from. */
export function sample(points: readonly Pt[], closed: boolean, per = 6, tension = 0.5): Pt[] {
  const n = points.length;
  const at = (i: number): Pt => points[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))]!;
  const out: Pt[] = [];
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i += 1) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    for (let k = 0; k < per; k += 1) {
      const t = k / per;
      const t2 = t * t;
      const t3 = t2 * t;
      // Catmull-Rom basis with the same tension the SVG uses, so both drawings are one outline.
      const x =
        p1[0] +
        tension * (p2[0] - p0[0]) * t +
        (3 * (p2[0] - p1[0]) - 2 * tension * (p2[0] - p0[0]) - tension * (p3[0] - p1[0])) * t2 +
        (2 * (p1[0] - p2[0]) + tension * (p2[0] - p0[0]) + tension * (p3[0] - p1[0])) * t3;
      const y =
        p1[1] +
        tension * (p2[1] - p0[1]) * t +
        (3 * (p2[1] - p1[1]) - 2 * tension * (p2[1] - p0[1]) - tension * (p3[1] - p1[1])) * t2 +
        (2 * (p1[1] - p2[1]) + tension * (p2[1] - p0[1]) + tension * (p3[1] - p1[1])) * t3;
      out.push([x, y]);
    }
  }
  if (!closed) out.push(points[n - 1]!);
  return out;
}

// Head, neck, chest, belly, buttock, croup, back, crest — the body without the legs, closed.
export const BODY: Pt[] = [
  [250, 40],
  [262, 44],
  [278, 68],
  [292, 92],
  [296, 100],
  [294, 108],
  [284, 110],
  [272, 104],
  [260, 94],
  [250, 88],
  [244, 98],
  [236, 112],
  [226, 132],
  [218, 150],
  [214, 166],
  [206, 178],
  [178, 172],
  [152, 170],
  [134, 168],
  [120, 172],
  [104, 176],
  [98, 164],
  [94, 142],
  [96, 118],
  [104, 100],
  [112, 90],
  [124, 92],
  [150, 94],
  [176, 92],
  [196, 86],
  [204, 78],
  [216, 68],
  [228, 58],
  [240, 48],
];
// Each leg is its own closed shape, drawn under the body so the join hides; it swings about its top.
export const LEGS: { points: Pt[]; pivot: Pt; near: boolean; sign: 1 | -1 }[] = [
  {
    points: [
      [216, 164],
      [226, 190],
      [232, 206],
      [236, 224],
      [240, 240],
      [245, 252],
      [246, 258],
      [230, 258],
      [228, 246],
      [226, 224],
      [224, 206],
      [212, 180],
      [206, 168],
    ],
    pivot: [212, 170],
    near: true,
    sign: 1,
  },
  {
    points: [
      [126, 168],
      [112, 186],
      [100, 204],
      [94, 226],
      [92, 246],
      [96, 258],
      [80, 258],
      [78, 232],
      [82, 208],
      [92, 182],
      [100, 166],
    ],
    pivot: [110, 172],
    near: true,
    sign: -1,
  },
  {
    points: [
      [206, 176],
      [200, 194],
      [196, 208],
      [190, 232],
      [186, 250],
      [186, 258],
      [172, 258],
      [174, 248],
      [178, 230],
      [184, 208],
      [190, 192],
      [196, 176],
    ],
    pivot: [200, 178],
    near: false,
    sign: -1,
  },
  {
    points: [
      [134, 174],
      [142, 190],
      [138, 208],
      [132, 232],
      [130, 250],
      [130, 258],
      [116, 258],
      [118, 248],
      [120, 230],
      [122, 210],
      [124, 190],
      [124, 176],
    ],
    pivot: [130, 176],
    near: false,
    sign: 1,
  },
];
export const TAIL: Pt[][] = [
  [
    [104, 96],
    [92, 112],
    [82, 138],
    [76, 170],
    [78, 196],
  ],
  [
    [106, 98],
    [96, 120],
    [88, 150],
    [84, 182],
  ],
  [
    [102, 94],
    [88, 108],
    [78, 130],
    [70, 158],
    [70, 184],
  ],
];
export const EARS: Pt[][] = [
  [
    [247, 42],
    [243, 26],
    [252, 40],
  ],
  [
    [254, 42],
    [258, 26],
    [262, 42],
  ],
];
export const MANE: Pt[] = [
  [204, 78],
  [216, 68],
  [228, 58],
  [240, 48],
];
export const CONTOURS = [
  'M 214 100 C 200 118, 194 146, 204 172',
  'M 124 110 C 110 130, 108 150, 118 166',
  'M 166 104 C 156 130, 156 150, 164 168',
];
export const EYE: Pt = [268, 60];

/** Where a record attaches to her, as fractions of the drawing's box. */
export const HORSE_ATTACH = {
  withers: [196 / 340, 86 / 280],
  head: [268 / 340, 60 / 280],
  chest: [218 / 340, 150 / 280],
  belly: [200 / 340, 176 / 280],
  croup: [112 / 340, 90 / 280],
  flank: [126 / 340, 168 / 280],
  hock: [90 / 340, 205 / 280],
} as const satisfies Record<string, readonly [number, number]>;
export type HorseAttach = keyof typeof HORSE_ATTACH;
