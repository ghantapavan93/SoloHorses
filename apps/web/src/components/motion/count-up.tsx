'use client';

import { useEffect, useRef, useState } from 'react';
import { usd } from '@/lib/format';
import { DUR, EASE } from '@/lib/motion';
import { useStillness } from '@/lib/use-stillness';

/** Named, not passed: a server component cannot hand a function to a client one. */
const FORMATS = {
  integer: (n: number) => String(n),
  usd,
  signed: (n: number) => (n > 0 ? `+${n}` : String(n)),
} as const;

/**
 * A numeral that arrives: from zero to its value on the product's one ease, once. The server
 * renders the final figure, so the page is right before any script runs; the motion is a
 * courtesy on the client, and none at all for people who asked for stillness.
 */
export function CountUp({
  value,
  format = 'integer',
  duration = DUR.slow,
  className,
}: {
  value: number;
  format?: keyof typeof FORMATS;
  duration?: number;
  className?: string;
}) {
  const still = useStillness();
  const [shown, setShown] = useState(value);
  const animated = useRef(false);

  useEffect(() => {
    if (still || animated.current || value === 0) return;
    animated.current = true;
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / duration);
      setShown(Math.round(value * EASE.outFn(progress)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration, still]);

  // A value that changes after the first arrival simply shows; one animation per mount is enough.
  useEffect(() => {
    if (animated.current) setShown(value);
  }, [value]);

  return <span className={className ?? 'tabular-nums'}>{FORMATS[format](shown)}</span>;
}
