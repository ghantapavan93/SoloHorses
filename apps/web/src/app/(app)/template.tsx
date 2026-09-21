'use client';

import { motion } from 'motion/react';
import { PRESET } from '@/lib/motion';

/**
 * A page arriving inside the shell: a 180 ms rise of four pixels and a fade, on the product's
 * one curve, once per navigation. Not a curtain and not a slide — the shell stays put and the
 * content settles into it, which is what Linear does and what an operations tool should do.
 * Reduced motion gets none, through the site's MotionConfig.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={PRESET.enter}>
      {children}
    </motion.div>
  );
}
