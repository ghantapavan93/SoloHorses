'use client';

import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import Link from 'next/link';
import { TraceSteps } from '@/components/platform/trace-steps';
import { traceAction } from '@/lib/actions';
import type { TraceStep } from '@/lib/types';

/**
 * One correlation id, every row that shares it, in time order: the web click, the inbox
 * row, the jobs, the domain events, the accounting attempts, the exception. This is what
 * production support looks like when the id was threaded through from the start.
 */
export function TraceDrawer({ correlationId, onClose }: { correlationId: string | null; onClose: () => void }) {
  // Keyed by the id it belongs to, so a stale result is never shown for a newer id.
  const [result, setResult] = useState<{ id: string; steps: TraceStep[] | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!correlationId) return;
    let cancelled = false;
    void traceAction(correlationId).then((res) => {
      if (cancelled) return;
      setResult(
        res.ok
          ? { id: correlationId, steps: res.data.steps, error: null }
          : { id: correlationId, steps: null, error: res.error },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [correlationId]);
  const current = result?.id === correlationId ? result : null;
  const steps = current?.steps ?? null;
  const error = current?.error ?? null;

  return (
    <Sheet open={correlationId !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[560px]">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-[14px]">Trace</SheetTitle>
          <SheetDescription className="code text-[12px]">
            {correlationId ? (
              <Link
                href={`/traces/${encodeURIComponent(correlationId)}`}
                className="underline-offset-2 hover:underline"
                onClick={onClose}
              >
                {correlationId}
              </Link>
            ) : null}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 py-3 text-[12px]">
          {error ? <p className="text-critical">{error}</p> : null}
          {steps === null && !error ? <p className="text-muted-foreground">Loading…</p> : null}
          {steps ? <TraceSteps steps={steps} /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
