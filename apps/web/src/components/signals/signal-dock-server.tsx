import { SignalDock } from '@/components/signals/signal-dock';
import { apiFetchOrNull } from '@/lib/api';
import type { OperationsSummary, Signal } from '@/lib/types';

/**
 * The board's signals, fetched once per page as the session's own identity — or as the
 * demo reviewer on the public pages. A customer session may not read the board, so the
 * dock simply does not appear for one. If the API is down, no dock: nothing here is faked.
 */
export async function SignalDockServer() {
  const [signals, summary] = await Promise.all([
    apiFetchOrNull<Signal[]>('/operations/signals?limit=12', { allowReviewer: true }).catch(() => null),
    apiFetchOrNull<OperationsSummary>('/operations/summary', { allowReviewer: true }).catch(() => null),
  ]);
  if (!signals) return null;
  return <SignalDock signals={signals} total={summary?.open ?? signals.length} />;
}
