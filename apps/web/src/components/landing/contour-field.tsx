'use client';

import { useEffect, useRef } from 'react';

/**
 * A faint field of contour lines behind the landing headline. Generated from a smooth
 * function, not a map: nothing here is a place. Three points sit on it because the
 * operation runs on three sites; where they are is not claimed. The mouse moves the field
 * by a few pixels — depth, not spectacle — and reduced-motion turns that off.
 */
const WIDTH = 1200;
const HEIGHT = 700;
const LINES = 22;

function contour(i: number): string {
  // A slow wave stacked with a slower one, offset per line, so the lines read as terrain.
  const points: string[] = [];
  const base = 80 + i * ((HEIGHT - 140) / LINES);
  for (let x = 0; x <= WIDTH; x += 24) {
    const t = x / WIDTH;
    const y =
      base +
      Math.sin(t * Math.PI * 2 + i * 0.35) * 18 +
      Math.sin(t * Math.PI * 5.3 + i * 0.9) * 7 +
      Math.cos(t * Math.PI * 1.1 - i * 0.2) * 12;
    points.push(`${x === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return points.join(' ');
}

const PATHS = Array.from({ length: LINES }, (_, i) => contour(i));
// Kept to the right of the headline column so the labels never sit behind the type, and short of
// the right edge so `slice` scaling never clips a label.
const NODES: { x: number; y: number; label: string }[] = [
  { x: 820, y: 128, label: 'stallion station · office' },
  { x: 900, y: 310, label: 'breeding · foaling' },
  { x: 860, y: 480, label: 'recipient farm' },
];

export function ContourField() {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const dx = (e.clientX / window.innerWidth - 0.5) * 6;
        const dy = (e.clientY / window.innerHeight - 0.5) * 4;
        el.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0)`;
      });
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      className="pointer-events-none absolute inset-0 size-full text-foreground transition-transform duration-300 ease-out will-change-transform"
      style={{ opacity: 0.22 }}
    >
      <defs>
        <radialGradient id="contour-fade" cx="50%" cy="45%" r="65%">
          <stop offset="0%" stopColor="white" stopOpacity="1" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <mask id="contour-mask">
          <rect width={WIDTH} height={HEIGHT} fill="url(#contour-fade)" />
        </mask>
      </defs>
      <g mask="url(#contour-mask)" fill="none" stroke="currentColor" strokeWidth="0.8">
        {PATHS.map((d, i) => (
          <path key={i} d={d} opacity={0.35 + (i % 3) * 0.2} />
        ))}
        {NODES.map((n) => (
          <g key={n.label}>
            <circle cx={n.x} cy={n.y} r="3" fill="currentColor" stroke="none" />
            <circle cx={n.x} cy={n.y} r="14" strokeWidth="0.6" opacity="0.6" />
            <text
              x={n.x + 20}
              y={n.y + 4}
              fill="currentColor"
              stroke="none"
              fontSize="10"
              fontFamily="var(--font-geist-mono), monospace"
              letterSpacing="0.18em"
              opacity="0.9"
            >
              {n.label.toUpperCase()}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}
