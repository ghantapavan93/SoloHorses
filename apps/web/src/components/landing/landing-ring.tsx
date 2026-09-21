import { SignalRing } from '@/components/signals/signal-ring';
import type { Signal } from '@/lib/types';

/** The hero's ring on the landing: every card is a link to the signal's own page. */
export function LandingRing({ signals, total }: { signals: Signal[]; total: number }) {
  return <SignalRing signals={signals} total={total} />;
}
