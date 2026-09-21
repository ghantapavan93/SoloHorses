'use client';

import { MotionConfig } from 'motion/react';

/**
 * One setting for every scripted motion on the site: a visitor who asked the OS for stillness
 * gets none, not less. The CSS side is the `prefers-reduced-motion` block in the stylesheet.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
