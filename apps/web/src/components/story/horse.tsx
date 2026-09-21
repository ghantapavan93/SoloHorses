'use client';

import { motion, useTransform, type MotionValue } from 'motion/react';
import { BODY, CONTOURS, EARS, EYE, HORSE_VIEWBOX, LEGS, MANE, TAIL, smooth } from '@/components/story/horse-shape';

export { HORSE_ATTACH, HORSE_VIEWBOX, type HorseAttach } from '@/components/story/horse-shape';

/**
 * The horse as a contour: the same line the terrain behind her is drawn with, from the shape
 * in `horse-shape.ts`. The gait is driven by a phase, not by time: the legs swing only while
 * the person scrolls. `erase` retracts the contour (1 = gone) as the records take over from
 * the silhouette. This is the drawing the page falls back to where WebGL is not available.
 */
const BODY_D = smooth(BODY, true);
const LEG_D = LEGS.map((leg) => smooth(leg.points, true));
const TAIL_D = TAIL.map((t) => smooth(t, false));
const EARS_D = EARS.map((e) => `M ${e[0]![0]} ${e[0]![1]} L ${e[1]![0]} ${e[1]![1]} L ${e[2]![0]} ${e[2]![1]}`).join(
  ' ',
);
const MANE_D = MANE.map(([x, y]) => `M ${x} ${y} l -9 7`).join(' ');

export function Horse({
  phase,
  erase,
  className,
}: {
  phase: MotionValue<number>;
  erase: MotionValue<number>;
  className?: string;
}) {
  const drawn = useTransform(erase, (e) => Math.max(0, 1 - e));
  const fill = useTransform(erase, (e) => Math.max(0, 1 - e * 1.6));
  // A walk: diagonal pairs swing together, twelve degrees either way.
  const swingA = useTransform(phase, (p) => Math.sin(p) * 12);
  const swingB = useTransform(phase, (p) => -Math.sin(p) * 12);
  const bob = useTransform(phase, (p) => Math.abs(Math.sin(p)) * -3);
  return (
    <motion.svg
      viewBox={`0 0 ${HORSE_VIEWBOX.w} ${HORSE_VIEWBOX.h}`}
      className={className}
      style={{ y: bob }}
      aria-hidden
    >
      <defs>
        <linearGradient id="horse-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a2c22" stopOpacity="0.92" />
          <stop offset="1" stopColor="#17110e" stopOpacity="0.96" />
        </linearGradient>
      </defs>
      {LEGS.map((leg, i) => (
        <motion.g
          key={i}
          style={{
            rotate: leg.sign === 1 ? swingA : swingB,
            originX: `${leg.pivot[0]}px`,
            originY: `${leg.pivot[1]}px`,
          }}
        >
          <motion.path d={LEG_D[i]} fill={leg.near ? 'url(#horse-fill)' : '#1b1512'} style={{ opacity: fill }} />
          <motion.path
            d={LEG_D[i]}
            fill="none"
            stroke="#e8dcc8"
            strokeOpacity={leg.near ? 1 : 0.4}
            strokeWidth={leg.near ? 1.4 : 1}
            strokeLinejoin="round"
            style={{ pathLength: drawn }}
          />
        </motion.g>
      ))}
      {TAIL_D.map((d, i) => (
        <motion.path
          key={i}
          d={d}
          fill="none"
          stroke="#e8dcc8"
          strokeOpacity={0.85 - i * 0.22}
          strokeWidth={1.2}
          style={{ pathLength: drawn }}
        />
      ))}
      <motion.path d={BODY_D} fill="url(#horse-fill)" style={{ opacity: fill }} />
      <motion.path
        d={BODY_D}
        fill="none"
        stroke="#e8dcc8"
        strokeWidth={1.4}
        strokeLinejoin="round"
        style={{ pathLength: drawn }}
      />
      <motion.path
        d={EARS_D}
        fill="none"
        stroke="#e8dcc8"
        strokeWidth={1.4}
        strokeLinejoin="round"
        style={{ pathLength: drawn }}
      />
      <motion.path
        d={MANE_D}
        fill="none"
        stroke="#e8dcc8"
        strokeOpacity={0.7}
        strokeWidth={1}
        style={{ pathLength: drawn }}
      />
      {CONTOURS.map((d, i) => (
        <motion.path
          key={i}
          d={d}
          fill="none"
          stroke="#c9b9a3"
          strokeOpacity={i === 2 ? 0.2 : 0.35}
          strokeWidth={1}
          style={{ pathLength: drawn }}
        />
      ))}
      <motion.circle cx={EYE[0]} cy={EYE[1]} r={2} fill="#e8dcc8" style={{ opacity: fill }} />
      <motion.path
        d="M 288 94 c 3 1, 4 3, 3 6"
        fill="none"
        stroke="#e8dcc8"
        strokeOpacity={0.8}
        strokeWidth={1}
        style={{ pathLength: drawn }}
      />
    </motion.svg>
  );
}
