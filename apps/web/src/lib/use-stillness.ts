'use client';

import { useEffect, useState } from 'react';

/** Whether this visitor asked for stillness: the OS-level reduced-motion preference, watched live. */
export function useStillness(): boolean {
  const [still, setStill] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const read = () => setStill(query.matches);
    read();
    query.addEventListener('change', read);
    return () => query.removeEventListener('change', read);
  }, []);
  return still;
}
